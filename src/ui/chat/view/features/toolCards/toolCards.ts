/**
 * Tool Cards Feature - Render de tool cards
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, createEl } from '../../../../shared/dom/qs';
import { asPrettyString, toMarkdownBlock, summarizeTool, getFriendlyToolName } from '../../../../shared/utils/toolHelpers';
import { renderMarkdownInto } from '../../../../shared/utils/markdown';
import { stripHtml } from '../../../../shared/utils/textHelpers';

export interface ToolCardsServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  scrollToBottom?: (smooth?: boolean) => void;
  patchWidget?: any;
  onFileEdit?: (payload: any) => void;
}

interface ToolCard {
  el: HTMLElement;
  bodyEl: HTMLElement;
  statusEl: HTMLElement;
  titleEl: HTMLElement;
}

const CLAUDE_TOOL_NAMES = new Set(['call_claude', 'call_claude_reply', 'call_claude_check', 'call_claude_stop']);

export function initToolCards(services: ToolCardsServices) {
  const { bridge, store, scrollToBottom, onFileEdit } = services;
  const chatFeed = $('chat-feed');

  if (!chatFeed) {
    console.warn('[ToolCards] chat-feed element not found');
    return;
  }

  let activeTurnEl: HTMLElement | null = null;

  const toolCards = new Map<string, ToolCard>();
  const toolBuffers = new Map<string, string>();
  const cardCreationTime = new Map<string, number>(); // Track when cards were created
  const claudeSessionByToolId = new Map<string, any>();
  // Terminal session tracking: toolId -> sessionId
  const terminalActiveSessions = new Map<string, string>();
  // Reverse map: sessionId -> toolId (for stop events from other tools)
  const sessionIdToToolId = new Map<string, string>();
  // Autoscroll pause state: toolId -> true when user scrolled up manually
  const terminalScrollPaused = new Map<string, boolean>();

  const defaultScrollToBottom = (smooth = false) => {
    if (scrollToBottom) {
      scrollToBottom(smooth);
    } else {
      chatFeed.scrollTo({
        top: chatFeed.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  function getClaudeCardId(payload: any): string {
    return payload?.id || payload?.sessionId || payload?.jobId;
  }

  function isClaudePayload(payload: any): boolean {
    const toolName = String(payload?.name || payload?.toolName || '').trim();
    return CLAUDE_TOOL_NAMES.has(toolName);
  }

  function getClaudeStatusLabel(phase?: string): string {
    switch (phase) {
      case 'start': return 'RUNNING';
      case 'progress': return 'LIVE';
      case 'background': return 'BACKGROUND';
      case 'replying': return 'REPLY';
      case 'checking': return 'CHECK';
      case 'checked_done': return 'DONE';
      case 'done': return 'DONE';
      case 'error': return 'ERROR';
      case 'stopped': return 'STOPPED';
      default: return 'CLAUDE';
    }
  }

  function renderClaudeSessionEvent(payload: any) {
    const cardId = getClaudeCardId(payload);
    if (!cardId) return;

    const toolName = payload?.toolName || 'call_claude';
    const normalizedPayload = {
      id: cardId,
      name: toolName,
      args: {
        session_id: payload?.sessionId,
        job_id: payload?.jobId,
      },
      isClaudeSession: true,
      claudePhase: payload?.phase,
      claudeMeta: payload,
    };

    const promptPreview = String(payload?.promptPreview || '').trim();

    const shouldHidePromptPreview = ['done', 'checked_done', 'error', 'stopped'].includes(String(payload?.phase || ''));

    const phaseText = String(payload?.text || '').trim();
    if (phaseText) {
      const prev = toolBuffers.get(cardId) || '';
      const next = `${prev}${prev ? '\n' : ''}${phaseText}`.slice(-12000);
      toolBuffers.set(cardId, next);
    }

    claudeSessionByToolId.set(cardId, payload);

    if (!toolCards.has(cardId)) {
      renderToolCard(normalizedPayload);
    }

    const card = toolCards.get(cardId);
    if (!card) return;

    card.el.classList.add('claude-session-card');
    card.el.classList.toggle('running', !['done', 'error', 'stopped', 'checked_done'].includes(payload?.phase));
    card.el.classList.toggle('success', ['done', 'checked_done'].includes(payload?.phase));
    card.el.classList.toggle('error', ['error', 'stopped'].includes(payload?.phase));
    card.statusEl.textContent = getClaudeStatusLabel(payload?.phase);

    const title = payload?.sessionId
      ? `Claude Code Live · ${payload.sessionId}`
      : payload?.jobId
        ? `Claude Code Live · ${payload.jobId}`
        : 'Claude Code Live';

    card.titleEl.title = title;
    card.titleEl.innerHTML = `
      <span class="tool-icon">✦</span>
      <span class="tool-spinner claude-orb" aria-label="Claude session active"></span>
      <span class="tool-name">Claude Code Live</span>
      <span class="tool-args-inline">${payload?.sessionId || payload?.jobId || toolName}</span>
    `;

    card.bodyEl.style.display = 'block';
    let shell = card.bodyEl.querySelector('.claude-session-shell') as HTMLElement | null;
    if (!shell) {
      card.bodyEl.innerHTML = `
        <div class="claude-session-shell">
          <div class="claude-session-meta"></div>
          <pre class="tool-stream-pre claude-stream-pre"></pre>
        </div>
      `;
      shell = card.bodyEl.querySelector('.claude-session-shell') as HTMLElement | null;
    }

    const metaEl = card.bodyEl.querySelector('.claude-session-meta') as HTMLElement | null;
    const pre = card.bodyEl.querySelector('.claude-stream-pre') as HTMLPreElement | null;
    if (metaEl) {
      metaEl.textContent = [
        payload?.phase ? `phase=${payload.phase}` : '',
        payload?.jobId ? `job=${payload.jobId}` : '',
        payload?.sessionId ? `session=${payload.sessionId}` : '',
        payload?.durationMs ? `duration=${payload.durationMs}ms` : '',
      ].filter(Boolean).join(' · ');
    }

    if (pre) {
      const streamText = toolBuffers.get(cardId) || '';
      pre.textContent = !shouldHidePromptPreview && promptPreview
        ? `Prompt enviado ao Claude:\n${promptPreview}${streamText ? `\n\n--- saída ---\n${streamText}` : ''}`
        : streamText;
      pre.scrollTop = pre.scrollHeight;
    }

    defaultScrollToBottom(true);
  }

  function renderTerminalControls(card: ToolCard, toolId: string, sessionId: string) {
    // Remove existing controls to avoid duplicates
    const existing = card.bodyEl.querySelector('.terminal-controls');
    if (existing) existing.remove();

    const controls = createEl('div', { class: 'terminal-controls' });

    const input = document.createElement('input') as HTMLInputElement;
    input.type = 'text';
    input.className = 'terminal-input';
    input.placeholder = 'Send command to session...';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'terminal-btn terminal-btn-send';
    sendBtn.textContent = 'Send';

    const stopBtn = document.createElement('button');
    stopBtn.className = 'terminal-btn terminal-btn-stop';
    stopBtn.textContent = 'Stop';

    const doSend = () => {
      const text = input.value;
      if (!text.trim()) return;
      console.log('[ToolCards] terminal/send -> sessionId:', sessionId, 'input:', text);
      bridge.post('ui/terminal/send', { sessionId, input: text });
      input.value = '';
      input.focus();
    };

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });

    sendBtn.addEventListener('click', () => doSend());

    stopBtn.addEventListener('click', () => {
      console.log('[ToolCards] terminal/stop -> sessionId:', sessionId);
      bridge.post('ui/terminal/stop', { sessionId });
      removeTerminalControls(toolId);
    });

    controls.appendChild(input);
    controls.appendChild(sendBtn);
    controls.appendChild(stopBtn);
    card.bodyEl.appendChild(controls);

    terminalActiveSessions.set(toolId, sessionId);
    sessionIdToToolId.set(sessionId, toolId);
  }

  function removeTerminalControls(toolId: string) {
    const card = toolCards.get(toolId);
    if (card) {
      const controls = card.bodyEl.querySelector('.terminal-controls');
      if (controls) controls.remove();
    }
    const sessionId = terminalActiveSessions.get(toolId);
    if (sessionId) sessionIdToToolId.delete(sessionId);
    terminalActiveSessions.delete(toolId);
  }

  function renderToolCard(payload: any, container?: HTMLElement) {
    if (!payload?.id) return undefined;
    
    // ✅ CORREÇÃO: Se o card já existe, retorna sem recriar
    // Durante restauração de histórico, evita duplicação
    if (toolCards.has(payload.id)) {
      const existing = toolCards.get(payload.id)!.el;
      
      // Se o card existe no DOM E no container correto, apenas retorna
      if (existing.parentElement) {
        
        return existing;
      }
      
      // Se o card existe mas não está anexado, anexa ao container
      if (container) {
        container.appendChild(existing);
      } else {
        (activeTurnEl || chatFeed)?.appendChild(existing);
      }
      return existing;
    }
    
    // Ocultar certas tools do usuário para não poluir
    const toolName = payload.name || "tool";
    const editTools = new Set(['patch', 'replace', 'create', 'delete', 'patch_file', 'apply_patch_batch']);
    const hiddenTools = new Set(['report_cognitive_state', 'report_status', 'current_plan', 'name_chat', 'patch_file', 'patch', 'create', 'replace', 'apply_patch_batch', 'terminal_list', 'terminal_read', 'terminal_stop', 'terminal_write']);
    const isClaudeSession = !!payload?.isClaudeSession || isClaudePayload(payload);
    
    // Se for tool de edição e tiver patchWidget, inicializa o preview imediatamente
    if (editTools.has(toolName.toLowerCase()) && services.patchWidget) {
      // Configurar o path adequado (no batch pode não estar no nível raiz de args)
      let displayPath = payload.args?.path || payload.args?.file_path;
      if (toolName.toLowerCase() === 'apply_patch_batch' && payload.args?.operations?.length > 0) {
        // Exibir "(batch: N arquivos)" ou similar quando aplicável, ou o caminho do primeiro
        const ops = payload.args.operations;
        const count = ops.length;
        if (count > 0) {
          displayPath = ops[0].path + (count > 1 ? ` (+${count - 1} operações)` : '');
        }
      }

      services.patchWidget.renderPreview({
        id: `tool_${payload.id}`,
        commandType: toolName.toUpperCase(),
        path: displayPath,
        content: "",
        isComplete: false
      });
    }

    if (!isClaudeSession && hiddenTools.has(toolName)) {
      return undefined;
    }

    
    const div = createEl('div', { class: 'tool-card running', id: `tool-${payload.id}` });
    div.classList.add(`tool-type-${toolName.toLowerCase()}`);
    if (toolName === 'run_command') {
      div.classList.add('run-command');
    }

    const header = createEl('div', { class: 'tool-header' });
    header.style.cursor = 'pointer';

    const summary = summarizeTool(payload.name, payload.args, null);
    const fullSummary = summarizeTool(payload.name, payload.args, null, { full: true });

    const title = createEl('div', { class: 'tool-title' });
   // Tooltip com o conteúdo completo (tool + args) ao passar o mouse
   title.title = fullSummary ? stripHtml(fullSummary) : '';
    title.innerHTML = isClaudeSession
      ? `
      <span class="tool-icon">✦</span>
      <span class="tool-spinner claude-orb" aria-label="Claude session active"></span>
      <span class="tool-name">Claude Code Live</span>
      <span class="tool-args-inline">
        ${payload.args?.session_id || payload.args?.job_id || getFriendlyToolName(payload.name) || "tool"}
      </span>
    `
      : `
      <span class="tool-icon">🔧</span>
      <span class="tool-spinner" aria-label="Running"></span>
      <span class="tool-name">${getFriendlyToolName(payload.name) || "tool"}</span>
      <span class="tool-args-inline">
        ${summary ? summary.replace(new RegExp(`^${payload.name}\\s*`), "") : ""}
      </span>
    `;

    const status = createEl('div', { class: 'tool-status' });
    status.textContent = "RUNNING";

    const chevron = createEl('span', { class: 'tool-chevron', 'aria-hidden': 'true' });
    chevron.textContent = '›';

    header.appendChild(title);
    header.appendChild(status);
    header.appendChild(chevron);

    if (toolName === 'run_command') {
        const stopBtn = createEl('span', { class: 'tool-stop-btn', title: 'Stop Execution' });
        stopBtn.textContent = '⏹️';
        stopBtn.style.cursor = 'pointer';
        stopBtn.style.marginLeft = '8px';
        stopBtn.onclick = (e) => {
            e.stopPropagation();
            services.bridge.post('ui/stopRunCommand', { id: payload.id });
        };
        header.appendChild(stopBtn);
    }

    const meta = createEl('div', { class: 'tool-meta' });
    const body = createEl('div', { class: 'tool-body' });

    meta.appendChild(body);
    div.appendChild(header);
    div.appendChild(meta);

    if (container) {
      container.appendChild(div);
    } else {
      (activeTurnEl || chatFeed)?.appendChild(div);
    }

    toolCards.set(payload.id, { el: div, bodyEl: body, statusEl: status, titleEl: title });
    cardCreationTime.set(payload.id, Date.now()); // Record creation time
    toolBuffers.set(payload.id, payload.toolContent ? asPrettyString(payload.toolContent) : "");

    // Click no header expande/colapsa o body do card
    header.addEventListener('click', () => {
      const isHidden = body.style.display === 'none' || getComputedStyle(body).display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      div.classList.toggle('tool-card-expanded', isHidden);
    });

    defaultScrollToBottom(true);
    return div;
  }

  function updateToolContent(payload: any) {
    const toolId = payload?.id;
    if (!toolId) return;
    
    const toolName = payload.name || payload.toolName || "tool";
    const normalizedToolName = String(toolName).toLowerCase();
    const editTools = new Set(['patch', 'replace', 'create', 'delete', 'patch_file', 'apply_patch_batch']);
    const isEditTool = editTools.has(normalizedToolName);
    const isClaudeSession = normalizedToolName === 'call_claude' || normalizedToolName === 'call_claude_reply' || payload?.phase;

    // Atualiza o buffer acumulado para a tool
    const prev = toolBuffers.get(toolId) || "";
    const incomingChunk = payload.delta || payload.content || payload.text || "";
    const next = prev + incomingChunk;
    toolBuffers.set(toolId, next);

    // Se for tool de edição, envia para o patchWidget
    if (isEditTool && services.patchWidget) {
      // Configurar o path adequado (no batch pode não estar no nível raiz de args)
      let displayPath = payload.args?.path || payload.args?.file_path;
      if (normalizedToolName === 'apply_patch_batch' && payload.args?.operations?.length > 0) {
        // Exibir "(batch: N arquivos)" ou similar quando aplicável, ou o caminho do primeiro
        const ops = payload.args.operations;
        const count = ops.length;
        if (count > 0) {
          displayPath = ops[0].path + (count > 1 ? ` (+${count - 1} operações)` : '');
        }
      }

      services.patchWidget.renderPreview({
        id: `tool_${toolId}`,
        commandType: toolName.toUpperCase(),
        path: displayPath,
        content: next,
        isComplete: false
      });
    }

    // Ocultar certas tools do usuário para não poluir
    const hiddenTools = new Set(['report_cognitive_state', 'report_status', 'current_plan', 'name_chat', 'patch_file', 'patch', 'create', 'replace', 'apply_patch_batch', 'terminal_list', 'terminal_read', 'terminal_stop']);
    if (hiddenTools.has(normalizedToolName)) {
      return;
    }

    if (!toolCards.has(toolId)) {
      renderToolCard({ id: toolId, name: toolName, args: payload.args || {} });
    }

    const card = toolCards.get(toolId);
    if (!card) return;

    // Streaming de tool output: render leve durante o stream (evita parse/markdown a cada delta)
    // e aplica auto-scroll "stick-to-bottom" dentro do pre do terminal.
    const isTerminalLike = card.el?.classList?.contains('run-command') || isClaudeSession
      || normalizedToolName === 'terminal_start' || normalizedToolName === 'terminal_send';

    let pre = card.bodyEl.querySelector('pre.tool-stream-pre') as HTMLPreElement | null;
    if (!pre) {
      card.bodyEl.innerHTML = '';
      pre = document.createElement('pre');
      pre.className = 'tool-stream-pre';
      card.bodyEl.appendChild(pre);

      // Attach scroll listener to bodyEl — it is the actual scrollable container
      // (.tool-body:has(.tool-stream-pre) has max-height:300px + overflow-y:auto).
      // The <pre> itself has no overflow, so listening/scrolling on it has no effect.
      if (isTerminalLike) {
        const bodyEl = card.bodyEl;
        bodyEl.addEventListener('scroll', () => {
          const distFromBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight;
          const paused = distFromBottom > 100;
          terminalScrollPaused.set(toolId, paused);
          console.log(`[ToolCards][scroll] toolId=${toolId} dist=${Math.round(distFromBottom)} paused=${paused}`);
        }, { passive: true });
      }
    }

    // Janela deslizante (Sliding Window): limita o buffer exibido no DOM.
    // Buffer interno (toolBuffers) mantém tudo; só o DOM é truncado.
    const SLIDING_WINDOW = 50_000;
    const TRUNCATION_MARKER = '[... saída anterior truncada — role para baixo para ver o conteúdo mais recente ...]\n';
    let display = next;
    let isTruncated = false;
    if (display.length > SLIDING_WINDOW) {
      display = TRUNCATION_MARKER + display.slice(-SLIDING_WINDOW);
      isTruncated = true;
    }

    if (isTruncated) {
      pre.setAttribute('data-truncated', 'true');
    } else {
      pre.removeAttribute('data-truncated');
    }

    // Atualiza texto sem markdown
    pre.textContent = display;

    if (isTerminalLike) {
      card.bodyEl.style.display = 'block';

      // Stick-to-bottom: scroll no bodyEl, que é o contêiner com overflow-y:auto.
      // Usa requestAnimationFrame para garantir que o DOM recalculou scrollHeight
      // antes de mover o scroll (necessário após truncamento e após textContent updates).
      const isPaused = terminalScrollPaused.get(toolId) ?? false;
      console.log(`[ToolCards][update] toolId=${toolId} isPaused=${isPaused} bodyScrollH=${card.bodyEl.scrollHeight} bodyScrollTop=${card.bodyEl.scrollTop} isTruncated=${isTruncated}`);
      if (!isPaused) {
        const bodyEl = card.bodyEl;
        requestAnimationFrame(() => {
          bodyEl.scrollTop = bodyEl.scrollHeight;
        });
      }
    }

    defaultScrollToBottom(true);
  }

  function updateToolCard(payload: any) {
    const toolId = payload?.id;
    if (!toolId) return;
    
    const toolName = payload.name || payload.toolName || "tool";
    const normalizedToolName = String(toolName || '').toLowerCase();
    const ok = !!payload.ok;
    const isRunCommandLike = normalizedToolName === 'run_command'
      || normalizedToolName === 'terminal_start'
      || normalizedToolName === 'terminal_read'
      || normalizedToolName === 'terminal_send'
      || normalizedToolName === 'terminal_stop'
      || normalizedToolName === 'terminal_list';
    const isClaudeSession = normalizedToolName === 'call_claude'
      || normalizedToolName === 'call_claude_reply'
      || normalizedToolName === 'call_claude_check'
      || normalizedToolName === 'call_claude_stop';

    // Integração com patchWidget - DEVE acontecer antes de qualquer return para não travar a UI
    try {
      const editTools = new Set(['patch', 'replace', 'create', 'delete', 'patch_file', 'apply_patch_batch']);
      if (services.patchWidget && editTools.has(normalizedToolName)) {
        const previewId = `tool_${toolId}`;
        services.patchWidget.markComplete(previewId, ok);
      }
    } catch (err) {
      console.warn('[ToolCards] markComplete patchWidget falhou:', err);
    }

    // Notificar edição de arquivo (independente de ser visível)
    if (onFileEdit) {
      onFileEdit(payload);
    }

    // Ocultar certas tools do usuário para não poluir o feed de chat (DOM)
    const hiddenTools = new Set(['report_cognitive_state', 'report_status', 'current_plan', 'name_chat', 'patch_file', 'patch', 'create', 'replace', 'apply_patch_batch', 'terminal_list', 'terminal_read', 'terminal_stop']);
    if (hiddenTools.has(normalizedToolName)) {
      return;
    }

    

    // If card doesn't exist yet and the tool has already finished,
    // we should create it with the final status directly
    if (!toolCards.has(toolId)) {
      // Create a minimal payload for renderToolCard
      const renderPayload = { id: toolId, name: toolName, args: payload.args || {} };
      renderToolCard(renderPayload);
      
      // If the tool has already finished, we should update it immediately
      // but still respect the minimum display time for RUNNING status
      // (handled by the creationTime check below)
    }

    const card = toolCards.get(toolId);
    if (!card) return;

    // Check if card was created very recently (less than 500ms ago)
    // This ensures RUNNING status is visible for a minimum time
    const creationTime = cardCreationTime.get(toolId);
    const now = Date.now();
    if (creationTime && (now - creationTime) < 500) {
      // Card was created too recently, schedule update for later
      setTimeout(() => {
        updateToolCard(payload);
      }, 500 - (now - creationTime));
      return;
    }

    card.el.classList.remove("running", "success", "error");
    card.el.classList.add(ok ? "success" : "error");
    card.statusEl.textContent = ok ? "" : "FAIL";
    const spinnerEl = card.titleEl?.querySelector?.('.tool-spinner');
    if (spinnerEl) spinnerEl.remove();
    
    const stopBtn = card.titleEl?.parentElement?.querySelector?.('.tool-stop-btn');
    if (stopBtn) stopBtn.remove();

    const streamedContent = toolBuffers.get(toolId) || '';
    const hasStreamedContent = streamedContent.trim().length > 0;
    const claudeMeta = claudeSessionByToolId.get(toolId);
    const claudePhase = String(claudeMeta?.phase || '');
    const isClaudeStopTool = normalizedToolName === 'call_claude_stop';
    const shouldPreferClaudeSummary = isClaudeSession || isClaudeStopTool;
    const claudeSummaryText = shouldPreferClaudeSummary
      ? String(
          payload?.result?.what_was_done
          || payload?.result?.summary?.what_was_done
          || payload?.result?.message
          || payload?.result?.instruction
          || payload?.result?.raw_result
          || payload?.result?.error
          || ''
        ).trim()
      : '';
    const shouldHideClaudeStreamOnStop = isClaudeStopTool || claudePhase === 'stopped';
    
    const summaryText = summarizeTool(toolName, payload.args, payload.result);
    const fullSummaryText = summarizeTool(toolName, payload.args, payload.result, { full: true });

    if (card.titleEl && summaryText) {
      // Tooltip com o conteúdo completo (tool + args) ao passar o mouse
      card.titleEl.title = fullSummaryText ? stripHtml(fullSummaryText) : '';
      card.titleEl.innerHTML = `
        <span class="tool-icon">🔧</span>
        <span class="tool-name">${getFriendlyToolName(toolName)}</span>
        <span class="tool-args-inline">
          ${summaryText.replace(new RegExp(`^${toolName}\\s*`), "")}
        </span>
      `;
    }

    card.bodyEl.innerHTML = "";
    const resultStr = asPrettyString(payload.result);
    const hasContent = resultStr && resultStr !== "undefined" && resultStr !== "null" && resultStr.trim() !== "";

    if (!ok) {
      card.el.classList.add('tool-card-expanded');
      card.bodyEl.style.display = 'block';
      card.bodyEl.innerHTML = '';
      
      const container = document.createElement('div');
      container.className = 'tool-error-silent';
      
      const icon = document.createElement('span');
      icon.className = 'error-icon';
     
      
      const msg = document.createElement('span');
      msg.textContent = 'Model requested tool with invalid arguments';
      
      const toggle = document.createElement('span');
      toggle.className = 'error-details-toggle';
      toggle.textContent = 'Show details';
      
      const details = document.createElement('div');
      details.className = 'error-details-content';
      details.style.display = 'none';
      details.textContent = resultStr || streamedContent || "Unknown error";
      
      toggle.onclick = (e) => {
        e.stopPropagation();
        const isHidden = details.style.display === 'none';
        details.style.display = isHidden ? 'block' : 'none';
        toggle.textContent = isHidden ? 'Hide details' : 'Show details';
      };
      
      container.appendChild(icon);
      container.appendChild(msg);
      container.appendChild(toggle);
      
      card.bodyEl.appendChild(container);
      card.bodyEl.appendChild(details);
    } else if (isRunCommandLike || isClaudeSession || hasStreamedContent || claudeSummaryText) {
      const pre = document.createElement('pre');
      pre.className = 'tool-stream-pre';
      pre.textContent = shouldHideClaudeStreamOnStop
        ? (claudeSummaryText || resultStr || 'Claude Code interrompido.')
        : (claudeSummaryText || (hasStreamedContent ? streamedContent : (hasContent ? resultStr : '')));
      card.bodyEl.appendChild(pre);
      card.bodyEl.style.display = 'block';
      card.bodyEl.scrollTop = card.bodyEl.scrollHeight;

      // Render terminal controls for active terminal_start sessions
      if (ok && normalizedToolName === 'terminal_start') {
        const sessionId = String(
          payload?.result?.session_id
          || payload?.args?.session_id
          || payload?.id
          || toolId
        );
        renderTerminalControls(card, toolId, sessionId);
      }

      // Remove terminal controls when a terminal_stop completes
      if (ok && normalizedToolName === 'terminal_stop') {
        const stoppedSessionId = String(payload?.args?.session_id || '');
        const targetToolId = stoppedSessionId
          ? (sessionIdToToolId.get(stoppedSessionId) ?? toolId)
          : toolId;
        removeTerminalControls(targetToolId);
      }
    } else if (!hasContent || resultStr === "undefined") {
      card.bodyEl.style.display = "none";
      if (resultStr === "undefined") {
        card.statusEl.textContent = "⚠️";
        card.statusEl.title = "Resultado indefinido";
      }
    } else {
      // Render normal do resultado
      renderMarkdownInto(card.bodyEl, toMarkdownBlock(payload.result));

      // Caso especial: tools com `result.images[]` devem mostrar preview visual
      try {
        if (['get_image', 'browser_action'].includes(String(toolName).toLowerCase())) {
          const images = (payload?.result as any)?.images;
          if (Array.isArray(images) && images.length > 0) {
            const attDiv = document.createElement('div');
            attDiv.className = 'message-attachments';
            images.forEach((img: any) => {
              const mime = img?.mimeType || 'image/png';
              const b64 = img?.dataBase64 ?? img?.data;
              if (!b64) return;
              const el = document.createElement('img');
              el.className = 'message-attachment-img';
              el.src = `data:${mime};base64,${b64}`;
              el.title = img?.name || 'image';
              el.onclick = () => {
                const win = window.open();
                if (!win) return;
                win.document.write(`<!DOCTYPE html><html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="data:${mime};base64,${b64}" style="max-width:100%;max-height:100vh"></body></html>`);
              };
              attDiv.appendChild(el);
            });
            card.bodyEl.appendChild(attDiv);
          }
        }
      } catch {}

      // Mantém o corpo oculto por padrão no design Ultra Slim.
      card.bodyEl.style.display = "none";
    }

    // Clean up creation time tracking now that the card has been fully updated
    cardCreationTime.delete(toolId);

    defaultScrollToBottom(true);
  }

  // Handlers
  bridge.on('core/toolStart', (payload: any) => {
    renderToolCard(payload);
  });

  bridge.on('core/toolContentUpdate', (payload: any) => {
    updateToolContent(payload);
  });

  bridge.on('core/toolResult', (payload: any) => {
    updateToolCard(payload);
  });

  bridge.on('core/claudeSession', (payload: any) => {
    renderClaudeSessionEvent(payload);
  });

  // ── Approval sticky bar helpers ───────────────────────────────
  const approvalStickyBar = document.getElementById('approval-sticky-bar');
  const approvalStickyInner = document.getElementById('approval-sticky-inner');

  function showApprovalSticky(id: string, command: string, isTerminal: boolean) {
    if (!approvalStickyBar || !approvalStickyInner) return;

    const alwaysAllowLabel = isTerminal ? 'Always allow this terminal command' : 'Always allow this command';
    const successMessage = isTerminal ? '✅ Terminal session approved. Starting...' : '✅ Approved. Executing...';
    const globalTrustMessage = isTerminal ? '🛡️ Global Trust Enabled. Starting terminal session...' : '🛡️ Global Trust Enabled. Executing...';

    approvalStickyInner.innerHTML = `
      <div class="approval-sticky-header">
        <span class="approval-sticky-icon">⚠️</span>
        <span class="approval-sticky-title">${isTerminal ? 'Terminal session approval required' : 'Approval required'}</span>
      </div>
      <div class="approval-sticky-command">${command}</div>
      <div class="approval-sticky-footer">
        <label class="approval-options">
          <input type="checkbox" id="sticky-always-allow-${id}">
          <span>${alwaysAllowLabel}</span>
        </label>
        <div class="approval-sticky-user-msg-wrap">
          <textarea id="sticky-user-msg-${id}" class="approval-user-message" placeholder="Mensagem para o agente (opcional)" rows="2"></textarea>
        </div>
        <div class="approval-sticky-actions">
          <button id="sticky-deny-${id}" class="approval-btn deny">Deny</button>
          <button id="sticky-allow-all-${id}" class="approval-btn allow-all" title="Allow this and ALL future commands">Allow All 🛡️</button>
          <button id="sticky-approve-${id}" class="approval-btn approve">Allow</button>
        </div>
      </div>
    `;
    approvalStickyBar.classList.remove('approval-sticky-hidden');

    const checkAlways = approvalStickyInner.querySelector(`#sticky-always-allow-${id}`) as HTMLInputElement;
    const userMsgInput = approvalStickyInner.querySelector(`#sticky-user-msg-${id}`) as HTMLTextAreaElement;

    function hideSticky(resultHtml: string) {
      approvalStickyInner!.innerHTML = `<div class="approval-sticky-result">${resultHtml}</div>`;
      setTimeout(() => {
        approvalStickyBar!.classList.add('approval-sticky-hidden');
        approvalStickyInner!.innerHTML = '';
      }, 1500);
    }

    approvalStickyInner.querySelector(`#sticky-allow-all-${id}`)?.addEventListener('click', () => {
      const userMessage = userMsgInput?.value?.trim() || undefined;
      bridge.post('ui/setRunCommandAllowAll', { allowAll: true });
      bridge.post('ui/runCommandDecision', { id, approved: true, alwaysAllow: false, userMessage });
      hideSticky(`<span style="color:var(--vscode-testing-iconPassed); font-weight:bold;">${globalTrustMessage}</span>`);
    });

    approvalStickyInner.querySelector(`#sticky-approve-${id}`)?.addEventListener('click', () => {
      const userMessage = userMsgInput?.value?.trim() || undefined;
      bridge.post('ui/runCommandDecision', { id, approved: true, alwaysAllow: checkAlways?.checked, userMessage });
      hideSticky(`<span style="color:var(--vscode-testing-iconPassed);">${successMessage}</span>`);
    });

    approvalStickyInner.querySelector(`#sticky-deny-${id}`)?.addEventListener('click', () => {
      const userMessage = userMsgInput?.value?.trim() || undefined;
      bridge.post('ui/runCommandDecision', { id, approved: false, userMessage });
      hideSticky(`<span style="color:var(--vscode-testing-iconFailed);">❌ Denied.</span>`);
    });
  }

  bridge.on('core/toolApprovalRequest', (payload: any) => {
    const approvalToolName = payload?.toolName || 'run_command';
    const isTerminalApproval = approvalToolName === 'terminal_start';
    const approvalArgs = isTerminalApproval
      ? { command: payload.command }
      : { cmd: payload.command };

    // Robustez: o evento de aprovação pode chegar antes do toolStart.
    let card = toolCards.get(payload.id);
    if (!card) {
      renderToolCard({
        id: payload.id,
        name: approvalToolName,
        args: approvalArgs
      });
      card = toolCards.get(payload.id);
    }
    if (!card) return;

    // Tool card mostra placeholder compacto
    card.el.classList.add('tool-card-expanded');
    card.bodyEl.style.display = 'block';
    card.bodyEl.innerHTML = '<div class="approval-pending-placeholder">⏳ Aguardando aprovação...</div>';

    // UI de aprovação aparece no sticky bar acima do composer
    showApprovalSticky(payload.id, payload.command, isTerminalApproval);
  });

  // Restaurar histórico de tools
  // Listener historyLoaded removido - agora é gerenciado pelo messages.ts
  // para garantir a ordem correta das mensagens
  return {
    renderToolCard,
    updateToolCard,
    setActiveTurnEl: (el: HTMLElement | null) => { activeTurnEl = el; },
    clearAll: () => {
      toolCards.clear();
      toolBuffers.clear();
      claudeSessionByToolId.clear();
      terminalActiveSessions.clear();
      sessionIdToToolId.clear();
      terminalScrollPaused.clear();
    },
    destroy: () => {
      toolCards.clear();
      toolBuffers.clear();
      claudeSessionByToolId.clear();
      terminalActiveSessions.clear();
      sessionIdToToolId.clear();
      terminalScrollPaused.clear();
    }
  };
}
