/**
 * Composer Feature - Textarea autosize, send/stop, shortcuts
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $ } from '../../../../shared/dom/qs';

export interface ComposerServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  onSend?: (text: string, attachments: any[], msgId?: string) => void;
  onStop?: () => void;
}

const ALL_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
type ReasoningEffort = typeof ALL_REASONING_EFFORTS[number];

/**
 * Opções válidas por modelo:
 *
 * OpenAI (Responses API):
 * - gpt-5-mini : low/medium/high          → sem 'none', sem 'xhigh'
 * - gpt-5.2    : low/medium/high          → sem 'none', sem 'xhigh'
 * - gpt-5.4    : low/medium/high/xhigh    → sem 'none'
 *
 * Anthropic (Extended Thinking):
 * - claude-*   : none/low/medium/high  → sem 'xhigh'
 *   none  → thinking desativado (padrão)
 *   low   → budget_tokens: 1 024
 *   medium→ budget_tokens: 5 000
 *   high  → budget_tokens: 10 000
 */
function getValidEffortsForModel(modelId: string): ReasoningEffort[] {
  const m = modelId.toLowerCase();
  // Anthropic: none/low/medium/high (sem xhigh)
  if (m.startsWith('anthropic:') || m.includes('claude')) {
    return ['none', 'low', 'medium', 'high'];
  }
  // OpenAI GPT-5 family
  if (m.includes('gpt-5-mini')) return ['low', 'medium', 'high'];
  if (m.includes('gpt-5.2'))    return ['low', 'medium', 'high'];
  if (m.includes('gpt-5.4'))    return ['low', 'medium', 'high', 'xhigh'];
  // fallback para qualquer outro gpt-5 futuro
  if (m.includes('gpt-5'))      return ['low', 'medium', 'high'];
  return [...ALL_REASONING_EFFORTS];
}

function modelSupportsReasoningEffort(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return m.startsWith('openai:gpt-5') || m.startsWith('anthropic:') || m.includes('claude');
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  const normalized = String(value || '').toLowerCase() as ReasoningEffort;
  return (ALL_REASONING_EFFORTS as readonly string[]).includes(normalized) ? normalized : 'medium';
}

function formatReasoningEffortLabel(value: string): string {
  const normalized = normalizeReasoningEffort(value);
  return normalized === 'xhigh'
    ? 'XHigh'
    : normalized.charAt(0).toUpperCase() + normalized.slice(1);
}



export function initComposer(services: ComposerServices) {
  const { bridge, store, onSend, onStop } = services;
  const userInput = $<HTMLTextAreaElement>('user-input');
  const sendButton = $<HTMLButtonElement>('send-button');
  const reasoningButton = $<HTMLButtonElement>('reasoning-effort-button');
  const reasoningMenu = $<HTMLDivElement>('reasoning-effort-menu');
  const composerToolsDrawer = document.getElementById('composer-tools-drawer') as HTMLDivElement | null;
  const reasoningLabel = reasoningButton?.querySelector<HTMLElement>('.reasoning-effort-label') || null;
  const reasoningOptions = Array.from(document.querySelectorAll<HTMLButtonElement>('.reasoning-effort-option'));

  if (!userInput || !sendButton) {
    console.warn('[Composer] Required elements not found');
    return;
  }

  const focusedModeToggle = document.getElementById('focused-mode-button') as HTMLButtonElement | null;
  const editApprovalModeButton = document.getElementById('edit-approval-mode-button') as HTMLButtonElement | null;

  // Ajusta posicionamento do tooltip para evitar que ele fique fora da viewport
  let _tooltipAdjustTimer: number | null = null;
  const adjustToolbarTooltipPosition = (button: HTMLElement | null) => {
    if (!button) return;
    button.classList.remove('tooltip-shift-left', 'tooltip-shift-right');

    try {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const defaultHalfTooltip = 110;
      const halfTooltip = Math.min(defaultHalfTooltip, Math.max(0, (viewportWidth - 24) / 2));
      const margin = 12;

      if (centerX + halfTooltip > viewportWidth - margin) {
        button.classList.add('tooltip-shift-left');
      } else if (centerX - halfTooltip < margin) {
        button.classList.add('tooltip-shift-right');
      }
    } catch {
      // ignore
    }
  };

  const adjustReasoningTooltipPosition = () => {
    adjustToolbarTooltipPosition(reasoningButton);
  };

  const adjustEditApprovalTooltipPosition = () => {
    adjustToolbarTooltipPosition(editApprovalModeButton);
  };

  const debounceAdjustReasoningTooltip = () => {
    if (typeof window === 'undefined') return;
    if (_tooltipAdjustTimer) {
      window.clearTimeout(_tooltipAdjustTimer as any);
    }
    _tooltipAdjustTimer = window.setTimeout(() => {
      adjustReasoningTooltipPosition();
      adjustEditApprovalTooltipPosition();
      _tooltipAdjustTimer = null;
    }, 80);
  };

  const closeReasoningMenu = () => {
    reasoningMenu?.classList.add('hidden');
    reasoningButton?.setAttribute('aria-expanded', 'false');
  };

  const closeComposerToolsDrawer = () => {
    composerToolsDrawer?.classList.add('hidden');
    const toggle = document.getElementById('composer-tools-toggle');
    toggle?.setAttribute('aria-expanded', 'false');
  };

  const updateReasoningUi = () => {
    const state = store.getState();
    const modelId = String(state.modelSelected || state.selectedModelInfo?.modelId || '');
    const supportsReasoning = modelSupportsReasoningEffort(modelId);
    const isAnthropicModel = modelId.toLowerCase().startsWith('anthropic:') || modelId.toLowerCase().includes('claude');

    const validEfforts = getValidEffortsForModel(modelId);
    let effort = normalizeReasoningEffort(state.currentReasoningEffort);

    // Para Anthropic, 'none' é válido (desativa thinking). Para OpenAI, fallback para 'medium'.
    if (!validEfforts.includes(effort)) {
      effort = isAnthropicModel
        ? 'none'
        : (validEfforts[validEfforts.length - 1] ?? 'medium');
    }

    // Mostrar/ocultar cada opção conforme o modelo
    reasoningOptions.forEach((option) => {
      const optEffort = option.dataset.effort as ReasoningEffort;
      const isValid = validEfforts.includes(optEffort);
      option.classList.toggle('hidden', !isValid);
      option.classList.toggle('active', optEffort === effort);
    });

    if (reasoningButton) {
      // Para Anthropic: label especial quando thinking está ativo
      const effortLabel = formatReasoningEffortLabel(effort);
      const label = isAnthropicModel
        ? (effort === 'none' ? 'Thinking: Off' : `Thinking: ${effortLabel}`)
        : `Reasoning: ${effortLabel}`;
      const shouldShowReasoning = state.showReasoningButton && supportsReasoning;
      // Usar apenas data-tooltip (estilo padrão do sistema). Remover title para evitar tooltip nativo duplicado.
      reasoningButton.removeAttribute('title');
      reasoningButton.setAttribute('aria-label', label);
      reasoningButton.setAttribute('data-tooltip', label);
      reasoningButton.classList.toggle('hidden', !shouldShowReasoning);
      reasoningButton.setAttribute('data-effort', effort);
      // Destaque visual quando thinking está ativo no Anthropic
      reasoningButton.classList.toggle('reasoning-active', isAnthropicModel && effort !== 'none');

      // Ajustar posição do tooltip sempre que a UI muda (ex.: ao abrir menu ou trocar modelo)
      debounceAdjustReasoningTooltip();
    }

    if (focusedModeToggle) {
      focusedModeToggle.classList.toggle('active', state.isFocusedMode);
      focusedModeToggle.setAttribute('aria-pressed', String(state.isFocusedMode));
      focusedModeToggle.setAttribute('data-tooltip', state.isFocusedMode ? 'Modo foco ativado' : 'Ativar modo foco');
    }

    if (editApprovalModeButton) {
      const mode = state.editApprovalMode === 'ask_before_apply' ? 'ask_before_apply' : 'apply_everything';
      const label = mode === 'ask_before_apply' ? 'Ask before apply' : 'Apply everything';
      const tooltip = mode === 'ask_before_apply'
        ? 'Ask before apply\nPergunta antes de qualquer edição de código ou arquivo.'
        : 'Apply everything\nAplica automaticamente toda edição de código ou arquivo.';
      editApprovalModeButton.dataset.mode = mode;
      editApprovalModeButton.setAttribute('data-tooltip', tooltip);
      editApprovalModeButton.setAttribute('aria-label', label);
    }

    if (!supportsReasoning) {
      closeReasoningMenu();
    }
  };

  const applyReasoningEffort = (effort: string) => {
    const normalized = normalizeReasoningEffort(effort);
    store.setState({ currentReasoningEffort: normalized });
    bridge.post('ui/setReasoningEffort', { effort: normalized });
    updateReasoningUi();
    closeReasoningMenu();
  };

  const toggleFocusedMode = () => {
    const current = store.getState().isFocusedMode;
    const next = !current;
    store.setState({ isFocusedMode: next });
    bridge.post('ui/setFocusedMode', { enabled: next });
    updateReasoningUi();
    // keep menu open so user can see the toggle state change
  };

  const toggleEditApprovalMode = () => {
    const current = store.getState().editApprovalMode;
    const next = current === 'ask_before_apply' ? 'apply_everything' : 'ask_before_apply';
    store.setState({ editApprovalMode: next });
    bridge.post('ui/setEditApprovalMode', { mode: next });
    updateReasoningUi();
  };

  bridge.on('core/reasoningEffort', (payload: any) => {
    store.setState({ currentReasoningEffort: normalizeReasoningEffort(payload?.effort) });
    updateReasoningUi();
  });

  bridge.on('core/editApprovalMode', (payload: any) => {
    const mode = payload?.mode === 'ask_before_apply' ? 'ask_before_apply' : 'apply_everything';
    store.setState({ editApprovalMode: mode });
    updateReasoningUi();
  });

  bridge.on('core/selectedModel', () => {
    updateReasoningUi();
  });

  if (reasoningButton && reasoningMenu) {
    reasoningButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeComposerToolsDrawer();
      const willOpen = reasoningMenu.classList.contains('hidden');
      reasoningMenu.classList.toggle('hidden', !willOpen);
      reasoningButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

      // re-calcula posição do tooltip quando o menu abre/fecha
      debounceAdjustReasoningTooltip();
    });

    reasoningOptions.forEach((option) => {
      option.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyReasoningEffort(option.dataset.effort || 'medium');

        // re-ajusta posição pois o menu pode mudar tamanho
        debounceAdjustReasoningTooltip();
      });
    });

    document.addEventListener('click', (event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (reasoningMenu.contains(target) || reasoningButton.contains(target)) return;
      closeReasoningMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeReasoningMenu();
      }
    });

    updateReasoningUi();
  }

  // Focus mode button — independente do reasoning menu, sempre visível
  if (focusedModeToggle) {
    focusedModeToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFocusedMode();
    });
  }

  if (editApprovalModeButton) {
    editApprovalModeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleEditApprovalMode();
    });
  }

  // Auto-grow textarea (expande para cima avançando no chat)
  if (userInput) {
    const adjustHeight = (el: HTMLTextAreaElement) => {
      const minHeight = 84;
      const maxHeight = 400;
      
      // Reset temporário para calcular o scrollHeight real sem flicker
      el.style.height = minHeight + 'px';
      
      const scrollHeight = el.scrollHeight;
      const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
      
      el.style.height = newHeight + 'px';
      
      if (scrollHeight > maxHeight) {
        el.style.overflowY = 'auto';
      } else {
        el.style.overflowY = 'hidden';
      }

      // Sincroniza o chat feed para não perder o foco na última mensagem
      if (typeof (services as any).scrollToBottom === 'function') {
        (services as any).scrollToBottom(false);
      }
    };

    userInput.addEventListener('input', function() {
      adjustHeight(this);
    });
    
    // Ajuste inicial se houver conteúdo (ex: prepareEdit)
    adjustHeight(userInput);
  }

  // Send button click
  if (sendButton) {
    sendButton.addEventListener('click', () => {
      const state = store.getState();
      const text = userInput.value.trim();

      if (state.isStreaming) {
        if (text || state.attachmentsDraft.length > 0) {
          handleSend();
        } else if (onStop) {
          onStop();
        }
      } else {
        handleSend();
      }
    });
  }

  // Enter key handler
  if (userInput) {
    userInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const state = store.getState();
        const text = userInput.value.trim();

        if (state.queuedMessage) {
          // Do nothing or toggle? Let's say enter doesn't cancel.
        } else if (state.isStreaming) {
          if (text || state.attachmentsDraft.length > 0) {
            handleSend();
          } else if (onStop) {
            onStop();
          }
        } else {
          handleSend();
        }
      }
    });
  }

  function handleSend() {
    if (!userInput) return;
    const text = userInput.value.trim();
    const state = store.getState();
    if (!text && state.attachmentsDraft.length === 0) return;

    const msgId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (onSend) {
      onSend(text, state.attachmentsDraft, msgId);
    }

    // Renderizar mensagem do usuário imediatamente usando o mesmo msgId persistido
    // Isso evita mismatch entre UI otimista e banco, especialmente no Time Travel.
    const chatFeed = document.getElementById('chat-feed');
    if (chatFeed && (text || state.attachmentsDraft.length > 0)) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user';
      messageDiv.id = msgId;
      messageDiv.setAttribute('data-temp', 'true');
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = text;
      messageDiv.appendChild(contentDiv);

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.title = 'Rewind here';
      editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"></path><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`;
      editBtn.addEventListener('click', () => {
        const openEditModal = (window as any).openEditModal;
        if (typeof openEditModal === 'function') {
          openEditModal(msgId, text);
        }
      });
      messageDiv.appendChild(editBtn);

      // Render anexos na mensagem temporária
      if (state.attachmentsDraft.length > 0) {
        const attDiv = document.createElement('div');
        attDiv.className = 'message-attachments';
        state.attachmentsDraft.forEach((att: any) => {
          if (att.type === "image" && att.data) {
            const img = document.createElement('img');
            img.className = 'message-attachment-img';
            img.src = att.data;
            attDiv.appendChild(img);
          }
        });
        messageDiv.appendChild(attDiv);
      }
      
      chatFeed.appendChild(messageDiv);
      
      // Scroll para o final
      chatFeed.scrollTo({
        top: chatFeed.scrollHeight,
        behavior: 'smooth'
      });
    }

    userInput.value = '';
    userInput.style.height = '44px';
    userInput.style.overflowY = 'hidden';
    store.setState({ attachmentsDraft: [] });
    
    // Notifica que mensagem foi enviada (para thinking feature)
    if (typeof (window as any).onMessageSent === 'function') {
      (window as any).onMessageSent();
    }
  }

  // Handler para preparar edição (Time Travel)
  bridge.on('core/prepareEdit', (payload: any) => {
    if (userInput && payload?.text) {
      userInput.value = payload.text;
      userInput.focus();
      // Dispara o evento de input para ajustar a altura do textarea
      userInput.dispatchEvent(new Event('input'));
      
      // Garante que o scroll vá para o final para o usuário ver o input
      const chatFeed = document.getElementById('chat-feed');
      if (chatFeed) {
        setTimeout(() => {
          chatFeed.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
        }, 100);
      }
    }
  });

  function updateButtonState() {
    if (!userInput || !sendButton) return;

    const state = store.getState();
    const text = userInput.value.trim();
    const hasContent = text.length > 0 || state.attachmentsDraft.length > 0;
    
    // Reset classes
    sendButton.classList.remove('stop-button', 'queue-intent-button', 'active');
    
    if (state.isStreaming) {
      if (hasContent) {
        sendButton.textContent = '▲';
        sendButton.classList.add('queue-intent-button');
      } else {
        sendButton.textContent = 'Stop';
        sendButton.classList.add('stop-button');
      }
    } else {
      sendButton.textContent = 'Send';
      if (hasContent) {
        sendButton.classList.add('active');
      }
    }
  }

  // Update button text based on streaming state
  store.subscribe(() => {
    updateButtonState();
  });

  if (userInput) {
    userInput.addEventListener('input', () => {
      updateButtonState();
    });
  }

  return {
    destroy: () => {
      // Cleanup if needed
    }
  };
}
