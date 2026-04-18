/**
 * Messages Feature - Render de mensagens + markdown + edit btn
 * Otimizado para evitar flickers
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, createEl } from '../../../../shared/dom/qs';
import {
  stripThinkingForDisplay,
  hasMeaningfulText
} from '../../../../shared/utils/textHelpers';
import { renderMarkdownInto } from '../../../../shared/utils/markdown';

declare const marked: any;
declare const window: any;

/**
 * Obtém a URL da imagem de um attachment
 * Suporta: data URLs (Base64), webview URIs, ou fallback para storagePath
 * Para imagens grandes sem URL imediata, retorna um placeholder e agenda carregamento
 */
function getAttachmentImageUrl(attachment: any): string {
  if (!attachment || attachment.type !== 'image') {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMyRjJGMkYiLz48cGF0aCBkPSJNNjUgNDVINTVWMzVINDU0NVY1NUg1NVY2NUg2NVY1NUg3NVY0NUg2NVY0NVpNNTAgNjBDNDQuNSA2MCA0MCA1NS41IDQwIDUwQzQwIDQ0LjUgNDQuNSA0MCA1MCA0MEM1NSA0MCA2MCA0NC41IDYwIDUwQzYwIDU1LjUgNTUgNjAgNTAgNjBaIiBmaWxsPSIjODA4MDgwIi8+PC9zdmc+'; // Placeholder cinza
  }

  // 1. Se tem data URL (Base64) - para imagens pequenas
  if (attachment.data && typeof attachment.data === 'string') {
    return attachment.data;
  }

  // 2. Se tem webviewUri (já convertida pela extensão)
  if (attachment.webviewUri && typeof attachment.webviewUri === 'string') {
    return attachment.webviewUri;
  }

  // 3. Se tem storagePath mas não tem webviewUri (extensão não converteu)
  if (attachment.storagePath) {
    console.warn('[Messages] Attachment has storagePath but no webviewUri, using placeholder:', attachment.storagePath);
  }

  // 4. Placeholder para imagens não carregáveis
  return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMyRjJGMkYiLz48cGF0aCBkPSJNNjUgNDVINTVWMzVINDU0NVY1NUg1NVY2NUg2NVY1NUg3NVY0NUg2NVY0NVpNNTAgNjBDNDQuNSA2MCA0MCA1NS41IDQwIDUwQzQwIDQ0LjUgNDQuNSA0MCA1MCA0MEM1NSA0MCA2MCA0NC41IDYwIDUwQzYwIDU1LjUgNTUgNjAgNTAgNjBaIiBmaWxsPSIjODA4MDgwIi8+PC9zdmc+';
}

export interface MessagesServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  scrollToBottom?: (smooth?: boolean) => void;
  onEditMessage?: (msgId: string, text: string) => void;
  patchWidget?: any;
  onShowWaitingBubble?: () => void;
  renderToolCard?: (payload: any, container?: HTMLElement) => HTMLElement | undefined;
  updateToolCard?: (payload: any) => void;
  clearToolCards?: () => void;
  updateThinkingBubble?: (messageEl: HTMLElement, text: string, isStreaming: boolean) => void;
  setActiveTurnEl?: (el: HTMLElement | null) => void;
}

export function initMessages(services: MessagesServices) {
  const {
    bridge,
    store,
    scrollToBottom,
    onEditMessage,
    onShowWaitingBubble,
    renderToolCard,
    updateToolCard,
    clearToolCards,
    updateThinkingBubble,
  } = services;

  const chatFeed = $('chat-feed');
  let lastHistoryIds = '';
  let pinnedUserMsgEl: HTMLElement | null = null;
  let currentTurnEl: HTMLElement | null = null;

  // Função para encontrar o container de scroll real (pode ser chatFeed ou um pai)
  function findScrollContainer(): HTMLElement | null {
    if (!chatFeed) return null;
    
    // Verifica se chatFeed tem overflow-y e é scrollável
    const style = window.getComputedStyle(chatFeed);
    const hasOverflowY = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay';
    
    if (hasOverflowY && chatFeed.scrollHeight > chatFeed.clientHeight) {
      return chatFeed;
    }
    
    // Procura pelo pai que tenha scroll
    let parent = chatFeed.parentElement;
    while (parent) {
      const parentStyle = window.getComputedStyle(parent);
      const parentHasOverflowY = parentStyle.overflowY === 'auto' || parentStyle.overflowY === 'scroll' || parentStyle.overflowY === 'overlay';
      
      if (parentHasOverflowY && parent.scrollHeight > parent.clientHeight) {
        return parent;
      }
      parent = parent.parentElement;
    }
    
    // Fallback: retorna chatFeed mesmo
    return chatFeed;
  }

  // ============================================================
  // Last-user-message preview bar (like Claude Code)
  // ============================================================

  // Tracked via getBoundingClientRect on scroll — IntersectionObserver
  // does NOT work with overflow-y: overlay (Chrome ignores it as root).
  let previewTrackedEl: HTMLElement | null = null;
  let previewScrollListenerAdded = false;
  let previewPollingInterval: number | null = null;

  function updatePreviewVisibility() {
    /* COMENTADO POR SOLICITAÇÃO DO USUÁRIO - Lógica de Preview Sticky
    const preview = document.getElementById('last-user-msg-preview');
    if (!preview || !chatFeed) return;

    // Se não há preview trackeado, tenta encontrar um
    if (!previewTrackedEl || !chatFeed.contains(previewTrackedEl)) {
      findAndSetPreviewMessage();
      return;
    }

    const feedRect = chatFeed.getBoundingClientRect();
    const msgRect = previewTrackedEl.getBoundingClientRect();

    // Verifica se a mensagem atual ainda é a mais relevante
    // Se a mensagem trackeada estiver visível, talvez outra acima dela tenha saído da viewport
    const isCurrentVisible = (msgRect.top <= feedRect.bottom) && (msgRect.bottom >= feedRect.top);
    
    // Se a mensagem atual está visível, pode ser que outra acima já saiu da viewport
    // Precisamos verificar todas as mensagens novamente
    if (isCurrentVisible) {
      findAndSetPreviewMessage();
    } else {
      // Apenas atualiza a visibilidade do preview atual
      preview.classList.add('visible');
    }
    */
  }

  function findAndSetPreviewMessage() {
    /* COMENTADO POR SOLICITAÇÃO DO USUÁRIO - Lógica de Preview Sticky
    console.log('[Preview] findAndSetPreviewMessage called');
    const preview = document.getElementById('last-user-msg-preview');
    if (!preview || !chatFeed) {
      console.log('[Preview] No preview or chatFeed found');
      return;
    }

    // Apenas mensagens do usuário que não sejam temporárias do composer
    const userMsgEls = chatFeed.querySelectorAll('.message.user:not([data-temp="true"])');
    if (userMsgEls.length === 0) {
      previewTrackedEl = null;
      preview.classList.remove('visible');
      preview.innerHTML = '';
      return;
    }

    const feedRect = chatFeed.getBoundingClientRect();
    
    // Procurar a mensagem mais apropriada para mostrar no preview
    // 1. Mensagens que estão acima da viewport (sairam para cima)
    // 2. Escolher a que tem o bottom mais próximo do top da viewport (a que acabou de sair)
    let bestCandidate: HTMLElement | null = null;
    let bestCandidateScore = -Infinity;

    for (let i = 0; i < userMsgEls.length; i++) {
      const el = userMsgEls[i] as HTMLElement;
      if (el.style.display === 'none' || !el.textContent?.trim().length) continue;

      const msgRect = el.getBoundingClientRect();
      
      // Verifica se a mensagem está totalmente ou parcialmente fora da viewport
      const isAboveViewport = msgRect.bottom < feedRect.top;
      const isBelowViewport = msgRect.top > feedRect.bottom;
      const isInViewport = !isAboveViewport && !isBelowViewport;

      if (isInViewport) continue; // Não mostrar preview para mensagens visíveis

      // Score system: quanto maior o score, mais "relevante" para preview
      let score = 0;
      
      if (isAboveViewport) {
        // Mensagens acima da viewport: quanto mais perto do top, maior o score
        score = msgRect.bottom; // Quanto maior o bottom (mais perto do top), melhor
      } else if (isBelowViewport) {
        // Mensagens abaixo da viewport: quanto mais perto do bottom, maior o score
        score = -msgRect.top; // Quanto menor o top (mais perto do bottom), melhor (negativo invertido)
      }

      if (score > bestCandidateScore) {
        bestCandidateScore = score;
        bestCandidate = el;
      }
    }

    // Se não encontrou candidato (todas as mensagens estão visíveis), esconde o preview
    if (!bestCandidate) {
      previewTrackedEl = null;
      preview.classList.remove('visible');
      return;
    }

    // Se já está trackeando essa mensagem, só atualiza visibilidade
    if (previewTrackedEl === bestCandidate && preview.innerHTML !== '') {
      preview.classList.add('visible');
      return;
    }

    // Atualiza o preview com o novo candidato
    previewTrackedEl = bestCandidate;

    // Build preview content: images + text
    const contentEl = previewTrackedEl.querySelector('.message-content') as HTMLElement;
    const text = contentEl?.textContent?.trim() || '';
    const imgEls = previewTrackedEl.querySelectorAll('.message-attachments img');

    const hasImages = imgEls.length > 0;
    const hasText = !!text;

    if (!hasText && !hasImages) {
      previewTrackedEl = null;
      preview.classList.remove('visible');
      preview.innerHTML = '';
      return;
    }

    // Rebuild preview DOM
    preview.innerHTML = '';

    if (hasImages) {
      const imagesRow = document.createElement('div');
      imagesRow.className = 'last-user-msg-preview-images';
      imgEls.forEach((img) => {
        const thumb = document.createElement('img');
        thumb.src = (img as HTMLImageElement).src;
        thumb.className = 'last-user-msg-preview-img';
        imagesRow.appendChild(thumb);
      });
      preview.appendChild(imagesRow);
    }

    if (hasText) {
      const textSpan = document.createElement('span');
      textSpan.className = 'last-user-msg-preview-text';
      textSpan.textContent = text;
      preview.appendChild(textSpan);
    }

    // Mostra o preview
    preview.classList.add('visible');
    */
  }

  // Função pública para ser chamada quando novas mensagens são adicionadas
  function refreshLastUserMsgPreview() {
    /* COMENTADO POR SOLICITAÇÃO DO USUÁRIO - Lógica de Preview Sticky
    console.log('[Preview] refreshLastUserMsgPreview called');
    findAndSetPreviewMessage();
    
    // Register scroll listener once
    if (!previewScrollListenerAdded) {
      const scrollContainer = findScrollContainer();
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', () => {
          requestAnimationFrame(() => {
            findAndSetPreviewMessage();
          });
        }, { passive: true });
        // Libera o pin se o usuário rolar para baixo manualmente
        scrollContainer.addEventListener('wheel', (e) => {
          if (e.deltaY > 0 && pinnedUserMsgEl) {
            pinnedUserMsgEl = null;
          }
        }, { passive: true });
        previewScrollListenerAdded = true;
        console.log('[Preview] Scroll listener attached to:', scrollContainer.id || scrollContainer.className);
      }
    }

    // Inicia polling contínuo para garantir que o preview sempre esteja correto
    // Mesmo se o scroll listener falhar (webview bug), o polling mantém atualizado
    if (!previewPollingInterval) {
      previewPollingInterval = window.setInterval(() => {
        if (previewTrackedEl && chatFeed && chatFeed.contains(previewTrackedEl)) {
          // Verifica se a mensagem atual ainda é a correta
          const feedRect = chatFeed.getBoundingClientRect();
          const msgRect = previewTrackedEl.getBoundingClientRect();
          const isCurrentVisible = (msgRect.top <= feedRect.bottom) && (msgRect.bottom >= feedRect.top);
          
          // Se a mensagem atual está visível, pode ser que outra acima já saiu da viewport
          if (isCurrentVisible) {
            findAndSetPreviewMessage();
          }
        } else {
          // Elemento trackeado foi removido ou não existe mais
          findAndSetPreviewMessage();
        }
      }, 500); // Verifica a cada 500ms
    }
    */
  }

  // Exposed via services or exported so it can be called explicitly
  if (services && (services as any).setUpdatePreviewVisibility) {
    (services as any).setUpdatePreviewVisibility(updatePreviewVisibility);
  }

  // Registra handlers ANTES de qualquer verificação

  bridge.on('core/historyLoaded', (payload: any) => {
    if (chatFeed) {
      renderHistory(payload || []);
    }
  });

  bridge.on('core/chatList', (payload: any) => {
    const nextChatId = payload?.currentChatId ?? null;
    const currentState = store.getState();
    if (currentState.selectedChatId !== nextChatId) {
      lastHistoryIds = '';
    }
  });

  bridge.on('core/assistantDelta', (payload: any) => {
    // ✅ VERIFICAÇÃO DE SEGURANÇA PARA PRIMEIRA INSTALAÇÃO
    // Garante que a UI está totalmente inicializada antes de processar chunks
    if (!chatFeed || !document.body || document.readyState !== 'complete') {
      console.warn('[Messages] UI não está pronta para processar chunks, ignorando...');
      return;
    }
    
    if (payload.msgId && payload.textDelta && chatFeed) {
      const currentState = store.getState();
      if (!currentState.isStreaming) {
        store.setState({ isStreaming: true });
      }
      updateAssistantMessage(payload.msgId, payload.textDelta);
    }
  });

  bridge.on('core/streamingFinished', () => {
    const currentState = store.getState();
    if (currentState.isStreaming) {
      store.setState({ isStreaming: false });
    }
    // Libera o pin: streaming terminou, comportamento normal de scroll retorna
    pinnedUserMsgEl = null;
  });

  if (!chatFeed) {
    console.warn('[Messages] chat-feed element not found');
    return {
      appendMessage: () => {},
      updateAssistantMessage: () => {},
      renderHistory: () => {},
      destroy: () => {},
    };
  }

  const defaultScrollToBottom = (smooth = false) => {
    if (scrollToBottom) {
      scrollToBottom(smooth);
    } else {
      const scrollContainer = findScrollContainer();
      if (scrollContainer) {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
    }
  };

  // Scroll para mostrar a última mensagem do usuário no topo da viewport (estilo Cursor IDE)
  /* COMENTADO POR SOLICITAÇÃO DO USUÁRIO
  const scrollToShowUserMessage = (messageEl: HTMLElement | null) => {
    const scrollContainer = findScrollContainer();

    if (!scrollContainer || !messageEl) {
      defaultScrollToBottom(false);
      return;
    }

    // Calcula posição absoluta da mensagem relativa ao container de scroll
    // usando getBoundingClientRect para evitar problemas com offsetParent
    const messageRect = messageEl.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();

    // posição atual da mensagem em relação ao topo visível do container
    const offsetFromContainerTop = messageRect.top - containerRect.top;

    // scrollTop alvo: leva a mensagem exatamente ao topo (com 8px de padding)
    const targetScrollTop = Math.max(0, scrollContainer.scrollTop + offsetFromContainerTop - 8);

    scrollContainer.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth',
    });

    // Após o scroll, força uma atualização do preview
    setTimeout(() => {
      findAndSetPreviewMessage();
    }, 350);
  };
  */

  function appendMessage(role: string, text: string, id: string, attachments: any[] = []) {
    if (!chatFeed) {
      console.warn('[Messages] appendMessage: chatFeed não encontrado');
      return null;
    }

    const attrs: Record<string, string> = { class: `message ${role}` };
    if (id) attrs.id = id;
    const div = createEl('div', attrs);

    const contentDiv = createEl('div', { class: 'message-content' });

    let safeText = role === 'assistant' ? stripThinkingForDisplay(text) : text;

    renderMarkdownInto(contentDiv, safeText || '');
    div.appendChild(contentDiv);

    if (attachments && attachments.length > 0) {
      const attDiv = createEl('div', { class: 'message-attachments' });

      attachments.forEach((att) => {
        const imageUrl = getAttachmentImageUrl(att);
        if (imageUrl) {
          const img = document.createElement('img');
          img.className = 'message-attachment-img';
          img.src = imageUrl;
          img.title = att.name || 'image';
          img.onclick = () => {
            const win = window.open();
            if (!win) return;
            win.document.write(`<img src="${imageUrl}" style="max-width:100%;">`);
          };
          attDiv.appendChild(img);
        }
      });

      div.appendChild(attDiv);
    }

    if (role === 'user') {
      const editBtn = createEl('button', { class: 'edit-btn', title: 'Rewind here' });
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 14L4 9l5-5"></path>
        <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
      </svg>`;
      editBtn.onclick = () => {
        if (onEditMessage) {
          onEditMessage(id, text);
        } else if (typeof (window as any).openEditModal === 'function') {
          (window as any).openEditModal(id, text);
        }
      };
      div.appendChild(editBtn);
    }

    if (role === 'user') {
      // Fecha o turn anterior (segurança) e abre um novo
      currentTurnEl = createEl('div', { class: 'agent-turn' });
      chatFeed.appendChild(currentTurnEl);
      currentTurnEl.appendChild(div);
      services.setActiveTurnEl?.(currentTurnEl);

      refreshLastUserMsgPreview();
      defaultScrollToBottom(false);
    } else {
      // Mensagem do assistente fecha o turn
      (currentTurnEl || chatFeed).appendChild(div);
      currentTurnEl = null;
      services.setActiveTurnEl?.(null);
      defaultScrollToBottom(false);
    }
    return div;
  }

  function updateAssistantMessage(id: string, delta: string) {
    let el = document.getElementById(id);
    if (!el) {
      const newEl = appendMessage('assistant', '', id, []);
      if (!newEl) return;
      el = newEl;
      el.setAttribute('data-raw', '');
      el.setAttribute('data-main-len', '0');
    }

    const contentDiv = (el.querySelector('.message-content') as HTMLElement) || (el as any);
    if (!contentDiv) return;

    const rawText = (el.getAttribute('data-raw') || '') + (delta || '');
    el.setAttribute('data-raw', rawText);

    const thinkingRegex =
      /<(?:thinking|reasoning|thought|think|redacted_reasoning)\b[^>]*>([\s\S]*?)(?:<\/(?:thinking|reasoning|thought|think|redacted_reasoning)>|$)/i;

    const thinkingMatch = rawText.match(thinkingRegex);
    const hasThinking = !!thinkingMatch;

    let mainText = rawText.replace(thinkingRegex, '').trim();

    if (hasThinking && thinkingMatch) {
      const thinkingText = thinkingMatch[1];
      const isStreamingThinking = !/<\/(?:thinking|reasoning|thought|think|redacted_reasoning)>/i.test(rawText);
      if (updateThinkingBubble) {
        updateThinkingBubble(el, thinkingText, isStreamingThinking);
      }
    }

    // ✅ Remove thinking para exibição (se configurado)
    let cleaned = stripThinkingForDisplay(mainText);

    const hasVisibleContent = hasMeaningfulText(cleaned);

    const prevMainLen = parseInt(el.getAttribute('data-main-len') || '0', 10);
    const currentMainLen = cleaned.length;
    const mainTextChanged = currentMainLen !== prevMainLen;
    el.setAttribute('data-main-len', currentMainLen.toString());

    // OTIMIZAÇÃO: Batch de mudanças de estilo
    if (hasVisibleContent) {
      requestAnimationFrame(() => {
        el!.style.display = '';
        contentDiv.style.display = '';

        if (mainTextChanged) {
          renderMarkdownInto(contentDiv, cleaned);
        }
      });
    } else {
      requestAnimationFrame(() => {
        if (hasThinking) {
          contentDiv.innerHTML = '';
          contentDiv.style.display = 'none';
          el!.style.display = '';
        } else {
          el!.style.display = 'none';
        }
      });
    }

    if (mainTextChanged || !hasThinking) {
      defaultScrollToBottom(true);
    }

    // Thinking bubble cleanup
    requestAnimationFrame(() => {
      const bubble = el!.querySelector('.thinking-bubble');
      if (bubble) {
        let hasContentBelow = false;
        const chatFeedEl = (el!.closest('#chat-feed') as HTMLElement) || chatFeed;
        if (chatFeedEl) {
          const messageIndex = Array.from(chatFeedEl.children).indexOf(el!);
          if (messageIndex >= 0) {
            for (let i = messageIndex + 1; i < chatFeedEl.children.length; i++) {
              const nextEl = chatFeedEl.children[i] as HTMLElement;
              if (!nextEl) continue;

              if (nextEl.classList.contains('tool-card')) {
                if (!nextEl.classList.contains('running')) {
                  hasContentBelow = true;
                  break;
                }
                continue;
              }

              if (nextEl.classList.contains('patch-widget-preview')) {
                hasContentBelow = true;
                break;
              }

              if (nextEl.classList.contains('message')) {
                const nextContent = nextEl.querySelector('.message-content') as HTMLElement;
                if (
                  nextContent &&
                  nextContent.style.display !== 'none' &&
                  nextContent.textContent &&
                  nextContent.textContent.trim().length > 0
                ) {
                  hasContentBelow = true;
                  break;
                }
              }
            }
          }
        }

        if (!hasThinking) {
          bubble.remove();
        }
      }
    });
  }

  function renderMessage(msg: any, container: HTMLElement | DocumentFragment, renderedPreviewIds: Set<string>) {
    try {
      const data = JSON.parse(msg.content || msg.text);

      // Suporte para COMMAND_PREVIEW persistido
      if (data?.type === 'COMMAND_PREVIEW') {
        const previewId = data.payload?.id;
        if (!previewId) return true;
        
        // ✅ CORREÇÃO: Verificar APENAS no Set, não no DOM
        // Durante renderHistory, o DOM é limpo, então querySelector pode dar falso positivo
        if (renderedPreviewIds.has(previewId)) {
          
          return true;
        }
        
        renderedPreviewIds.add(previewId);
        
        if (services.patchWidget) {
          services.patchWidget.renderPreview(data.payload, container as any);
        }
        return true;
      }

      // ✅ Renderiza tool cards no histórico
      if (data?.type === 'TOOL_STARTED' && renderToolCard) {
        const el = renderToolCard(data.payload, container as any);
        return !!el;
      }

      // ✅ CORREÇÃO: Para TOOL_FINISHED, apenas atualiza o card existente
      // Não cria um novo card, pois TOOL_STARTED já foi processado
      if (data?.type === 'TOOL_FINISHED' && updateToolCard) {
        // Nota: updateToolCard atualiza o card existente no DOM
        // Não precisa passar container pois o card já está anexado
        setTimeout(() => {
          updateToolCard(data.payload);
        }, 0);
        return true;
      }

      if (data?.type === 'TOOL_STREAM') {
        return false;
      }
    } catch (_) {}

    if (msg.role === 'tool') {
      return false;
    }

    const raw = msg.content || msg.text || '';

    const thinkingRegex =
      /<(?:thinking|reasoning|thought|think|redacted_reasoning)\b[^>]*>([\s\S]*?)(?:<\/(?:thinking|reasoning|thought|think|redacted_reasoning)>|$)/i;

    const thinkingMatch = msg.role === 'assistant' ? raw.match(thinkingRegex) : null;
    const hasThinking = !!thinkingMatch;

    let cleaned = msg.role === 'assistant'
      ? stripThinkingForDisplay(raw)
      : raw;

    const hasAttachments = !!(msg.attachments && msg.attachments.length > 0);
    const hasText = hasMeaningfulText(cleaned);

    if (!hasText && !hasAttachments) {
      return false;
    }

    const attrs: Record<string, string> = { class: `message ${msg.role}` };
    if (msg.msgId) attrs.id = msg.msgId;
    const div = createEl('div', attrs);
    const contentDiv = createEl('div', { class: 'message-content' });

    if (hasThinking && thinkingMatch && updateThinkingBubble) {
      updateThinkingBubble(div, thinkingMatch[1], false);
    }

    if (hasMeaningfulText(cleaned)) {
      renderMarkdownInto(contentDiv, cleaned || '');
      div.appendChild(contentDiv);
    } else if (hasThinking) {
      contentDiv.style.display = 'none';
      div.appendChild(contentDiv);
    }

    if (msg.attachments && msg.attachments.length > 0) {
      const attDiv = createEl('div', { class: 'message-attachments' });
      msg.attachments.forEach((att: any) => {
        const imageUrl = getAttachmentImageUrl(att);
        if (imageUrl) {
          const img = document.createElement('img');
          img.className = 'message-attachment-img';
          img.src = imageUrl;
          img.title = att.name || 'image';
          img.onclick = () => {
            const win = window.open();
            if (!win) return;
            win.document.write(`<img src="${imageUrl}" style="max-width:100%;">`);
          };
          attDiv.appendChild(img);
        }
      });
      div.appendChild(attDiv);
    }

    if (msg.role === 'user') {
      const editBtn = createEl('button', { class: 'edit-btn', title: 'Rewind here' });
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"></path><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`;
      editBtn.onclick = () => {
        if (onEditMessage) onEditMessage(msg.msgId, cleaned);
        else if (typeof (window as any).openEditModal === 'function') (window as any).openEditModal(msg.msgId, cleaned);
      };
      div.appendChild(editBtn);
    }

    container.appendChild(div);
    return true;
  }

  function renderIncrementalHistory(deltaMessages: any[]) {
    if (!chatFeed) return;

    // ✅ Remove mensagens temporárias (do composer) antes de anexar as definitivas do histórico
    const tempMessages = chatFeed.querySelectorAll('[data-temp="true"]');
    tempMessages.forEach((el) => el.remove());

    const renderedPreviewIds = new Set<string>();
    const fragment = document.createDocumentFragment();

    deltaMessages.forEach((msg) => {
      // ✅ Se a mensagem já existe no DOM, pula
      if (msg.msgId && document.getElementById(msg.msgId)) {
        
        return;
      }
      
      // ✅ Para previews, também verificar no DOM
      try {
        const data = JSON.parse(msg.content || msg.text);
        if (data?.type === 'COMMAND_PREVIEW') {
          const previewId = data.payload?.id;
          if (previewId && document.querySelector(`[data-preview-id="${previewId}"]`)) {
            
            return;
          }
        }
      } catch (_) {}
      
      renderMessage(msg, fragment, renderedPreviewIds);
    });

    // DocumentFragment não tem children em todos os ambientes como HTMLElement,
    // mas o append ainda é barato (e seguro).
    chatFeed.appendChild(fragment);

    requestAnimationFrame(() => {
      // Verifica se a última mensagem adicionada é do usuário
      const lastAddedMsg = deltaMessages[deltaMessages.length - 1];
      if (lastAddedMsg && lastAddedMsg.role === 'user') {
        const userMsgEls = chatFeed.querySelectorAll('.message.user:not([data-temp="true"])');
        if (userMsgEls.length > 0) {
          const lastUserMsg = userMsgEls[userMsgEls.length - 1] as HTMLElement;
          // scrollToShowUserMessage(lastUserMsg); // COMENTADO POR SOLICITAÇÃO DO USUÁRIO
          defaultScrollToBottom(true);
        } else {
          defaultScrollToBottom(true);
        }
      } else {
        defaultScrollToBottom(true);
      }
      refreshLastUserMsgPreview();
    });
  }

  function renderHistory(messages: any[]) {
    if (!chatFeed) {
      console.warn('[Messages] renderHistory: chatFeed não encontrado');
      return;
    }

    // Limpeza de mudança de chat removida pois faremos limpeza completa no full render
    // para garantir consistência dos widgets (especialmente PatchWidget)

    // ✅ Otimização Incremental Aprimorada
    const currentIds = messages.map((m) => m.msgId || m.payload?.id || '').join(',');

    // Caso 1: Histórico idêntico
    if (currentIds === lastHistoryIds && lastHistoryIds !== '') {
      
      return;
    }

    // Caso 2: Detecta incrementalismo de forma mais robusta
    let deltaMessages: any[] = [];
    let isIncremental = false;

    if (lastHistoryIds !== '') {
      const lastIdArray = lastHistoryIds.split(',');
      const currentIdArray = currentIds.split(',');

      let allPreviousIdsPresent = true;
      for (let i = 0; i < lastIdArray.length; i++) {
        if (lastIdArray[i] !== currentIdArray[i]) {
          allPreviousIdsPresent = false;
          break;
        }
      }

      if (allPreviousIdsPresent && currentIdArray.length > lastIdArray.length) {
        deltaMessages = messages.slice(lastIdArray.length);
        isIncremental = true;
        
      }
    }

    lastHistoryIds = currentIds;

    if (isIncremental) {
      renderIncrementalHistory(deltaMessages);
      return;
    }

    

    const state = store.getState();
    let preservedCommandPreviews: any[] = [];

    try {
      if (state.isStreaming && services.patchWidget) {
        preservedCommandPreviews = services.patchWidget.preservePreviews() || [];
      }
    } catch (err) {
      console.warn('[Messages] Erro ao preservar previews:', err);
    }

    // Preservar mensagens em streaming
    const streamingMessages: Map<string, string> = new Map();
    if (state.isStreaming && chatFeed) {
      const existingMessages = chatFeed.querySelectorAll('.message.assistant');
      existingMessages.forEach((el) => {
        const msgId = (el as HTMLElement).id;
        if (msgId) {
          const rawText = (el as HTMLElement).getAttribute('data-raw') || '';
          const existsInHistory = messages.some((m) => m.msgId === msgId);
          if (rawText && !existsInHistory) {
            streamingMessages.set(msgId, rawText);
            
          }
        }
      });
    }

    const fragment = document.createDocumentFragment();

    // ✅ LIMPEZA COMPLETA: Necessária para recriar widgets na ordem correta
    // Se não limparmos, o PatchWidget pode não recriar elementos que foram removidos do DOM
    
    if (clearToolCards) {
      clearToolCards();
    }

    if (services.patchWidget && typeof services.patchWidget.clearAll === 'function') {
      services.patchWidget.clearAll();
    }

    const renderedPreviewIds = new Set<string>();
    let renderedCount = 0;

    messages.forEach((msg) => {
      if (renderMessage(msg, fragment, renderedPreviewIds)) {
        renderedCount++;
      }
    });

    // ✅ Limpa apenas o DOM visual, não os maps internos
    chatFeed.innerHTML = '';

    requestAnimationFrame(() => {
      chatFeed.appendChild(fragment);

      // Restaurar previews preservados
      if (preservedCommandPreviews.length > 0 && services.patchWidget) {
        const toRestore = preservedCommandPreviews.filter((p) => !renderedPreviewIds.has(p.id));
        if (toRestore.length > 0) {
          services.patchWidget.restorePreviews(toRestore);
          console.log('[Messages] Restaurados', toRestore.length, 'previews novos/em streaming');
        }
      }

      // Restaurar mensagens em streaming
      if (streamingMessages.size > 0) {
        streamingMessages.forEach((rawText, msgId) => {
          const newEl = appendMessage('assistant', '', msgId, []);
          if (newEl) {
            newEl.setAttribute('data-raw', rawText);

            const thinkingRegex =
              /<(?:thinking|reasoning|thought|think|redacted_reasoning)\b[^>]*>([\s\S]*?)(?:<\/(?:thinking|reasoning|thought|think|redacted_reasoning)>|$)/i;

            const thinkingMatch = rawText.match(thinkingRegex);
            const hasThinking = !!thinkingMatch;

            let mainText = rawText.replace(thinkingRegex, '').trim();

            let cleaned = stripThinkingForDisplay(mainText);

            const hasVisibleContent = hasMeaningfulText(cleaned);

            const contentDiv = newEl.querySelector('.message-content') as HTMLElement;
            if (contentDiv) {
              if (hasVisibleContent) {
                newEl.style.display = '';
                contentDiv.style.display = '';
                renderMarkdownInto(contentDiv, cleaned);
                newEl.setAttribute('data-main-len', cleaned.length.toString());
              } else if (hasThinking) {
                contentDiv.innerHTML = '';
                contentDiv.style.display = 'none';
                newEl.style.display = '';
              } else {
                newEl.style.display = 'none';
              }
            }

            if (hasThinking && thinkingMatch && updateThinkingBubble) {
              const thinkingText = thinkingMatch[1];
              const isStreamingThinking = !/<\/(?:thinking|reasoning|thought|think|redacted_reasoning)>/i.test(rawText);
              updateThinkingBubble(newEl, thinkingText, isStreamingThinking);
            }

            console.log('[Messages] Restaurada mensagem em streaming:', msgId, 'hasContent:', hasVisibleContent);
          }
        });
        console.log('[Messages] Restauradas', streamingMessages.size, 'mensagens em streaming');
      }

      console.log('[Messages] renderHistory: renderizadas', renderedCount, 'mensagens');

      refreshLastUserMsgPreview();

      // Se a última mensagem é do usuário, faz scroll para mostrá-la no topo
      setTimeout(() => {
        const userMsgEls = chatFeed.querySelectorAll('.message.user:not([data-temp="true"])');
        if (userMsgEls.length > 0) {
          const lastUserMsg = userMsgEls[userMsgEls.length - 1] as HTMLElement;
          // scrollToShowUserMessage(lastUserMsg); // COMENTADO POR SOLICITAÇÃO DO USUÁRIO
          defaultScrollToBottom(false);
        } else {
          defaultScrollToBottom(false);
        }
      }, 0);
    });
  }

  console.log('[Messages] Feature inicializada, aguardando histórico...');

  return {
    appendMessage,
    updateAssistantMessage,
    renderHistory,
    destroy: () => {
      // Cleanup
    },
  };
}
