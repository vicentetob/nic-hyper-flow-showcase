/**
 * Bootstrap/Orquestrador do Chat Webview
 * Inicializa features e serviços
 */

import { getBridge } from '../../shared/webview/bridge';
import { getStore } from './state/store';
import { $ } from '../../shared/dom/qs';
import { initComposer } from './features/composer/composer';
import { initMessages } from './features/messages/messages';
import { initToolCards } from './features/toolCards/toolCards';
import { initThinking } from './features/thinking/thinking';
import { initAttachments } from './features/attachments/attachments';
import { initSidebar } from './features/sidebar/sidebar';
import { initChatListHeader } from './features/chatListHeader/chatListHeader';
import { initRunCommand } from './features/runCommand/runCommand';
import { initFileChanges } from './features/fileChanges/fileChanges';
import { initContextProgress } from './features/contextProgress/contextProgress';
import { initSubscriptionWarning } from './features/subscriptionWarning/subscriptionWarning';
import { initEditModal } from './features/editModal/editModal';
import { initCurrentPlanView } from './features/planBoard/currentPlan';
import { initAgentStatus } from './features/agentStatus/agentStatus';
import { createEl } from '../../shared/dom/qs';

declare const window: any;

type EditApprovalMode = 'apply_everything' | 'ask_before_apply';
type BackgroundMode = 'cognitive' | 'static' | 'none';

interface ChatUiSettings {
  backgroundMode?: BackgroundMode;
  backgroundImagePath?: string;
  showReasoningButton?: boolean;
  showApiCost?: boolean;
  showSummarizeButton?: boolean;
  focusedModeEnabled?: boolean;
  showTokenCounter?: boolean;
}

interface Services {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  scrollToBottom?: (smooth?: boolean) => void;
  patchWidget?: any;
}

function createEditApprovalModal(bridge: ReturnType<typeof getBridge>) {
  let activeRequestId: string | null = null;

  const overlay = document.createElement('div');
  overlay.className = 'nhf-edit-approval-overlay hidden';
  overlay.innerHTML = `
    <div class="nhf-edit-approval-modal" role="dialog" aria-modal="true" aria-labelledby="nhf-edit-approval-title">
      <div class="nhf-edit-approval-header">
        <div>
          <div id="nhf-edit-approval-title" class="nhf-edit-approval-title">Confirmar edição</div>
          <div class="nhf-edit-approval-subtitle">O agente quer modificar arquivos do projeto.</div>
        </div>
      </div>
      <div class="nhf-edit-approval-body">
        <div class="nhf-edit-approval-summary"></div>
        <div class="nhf-edit-approval-files"></div>
        <pre class="nhf-edit-approval-preview hidden"></pre>
      </div>
      <div class="nhf-edit-approval-user-message-wrap">
        <label class="nhf-edit-approval-user-message-label" for="nhf-edit-approval-user-msg">Mensagem para o agente</label>
        <textarea id="nhf-edit-approval-user-msg" class="nhf-edit-approval-user-message" placeholder="Insira uma mensagem para o agente (opcional)" rows="2"></textarea>
      </div>
      <div class="nhf-edit-approval-actions">
        <button type="button" class="nhf-edit-approval-btn nhf-edit-approval-btn-secondary" data-decision="reject">Reject</button>
        <button type="button" class="nhf-edit-approval-btn nhf-edit-approval-btn-primary" data-decision="approve">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const summaryEl = overlay.querySelector('.nhf-edit-approval-summary') as HTMLElement;
  const filesEl = overlay.querySelector('.nhf-edit-approval-files') as HTMLElement;
  const previewEl = overlay.querySelector('.nhf-edit-approval-preview') as HTMLElement;
  const userMsgEl = overlay.querySelector('#nhf-edit-approval-user-msg') as HTMLTextAreaElement;

  const close = (approved: boolean) => {
    if (!activeRequestId) {return;}
    const userMessage = userMsgEl?.value?.trim() || undefined;
    bridge.post('ui/editApprovalDecision', { id: activeRequestId, approved, userMessage });
    userMsgEl.value = '';
    activeRequestId = null;
    overlay.classList.add('hidden');
  };

  overlay.querySelector('[data-decision="approve"]')?.addEventListener('click', () => close(true));
  overlay.querySelector('[data-decision="reject"]')?.addEventListener('click', () => close(false));

  return {
    show(payload: any) {
      activeRequestId = String(payload?.id || '');
      const request = payload?.request || {};
      const files = Array.isArray(request.files) ? request.files : [];
      summaryEl.textContent = String(request.summary || 'O agente quer aplicar uma edição.');
      filesEl.innerHTML = files.length > 0
        ? `<strong>Arquivos:</strong> ${files.map((f: string) => `<code>${f}</code>`).join(', ')}`
        : '<strong>Arquivos:</strong> não informado';

      const preview = String(
        request?.metadata?.replacementPreview
        || request?.metadata?.contentPreview
        || request?.metadata?.patchPreview
        || request?.metadata?.exactMatchPreview
        || ''
      ).trim();

      if (preview) {
        previewEl.textContent = preview;
        previewEl.classList.remove('hidden');
      } else {
        previewEl.textContent = '';
        previewEl.classList.add('hidden');
      }

      overlay.classList.remove('hidden');
    }
  };
}

function initApp() {
  const initialUiSettings: ChatUiSettings = (window.CHAT_UI_SETTINGS || {}) as ChatUiSettings;

  // Inicializa serviços
  const bridge = getBridge();
  
  // Tratamento de Erros Global
  window.onerror = (message: string, source: string, lineno: number, colno: number, error: Error | undefined) => {
    bridge.post('ui/error', {
      message: String(message),
      source,
      lineno,
      colno,
      stack: error?.stack
    });
    return false;
  };

  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    bridge.post('ui/error', {
      message: 'Unhandled Promise Rejection',
      reason: String(event.reason),
      stack: event.reason?.stack
    });
  };

  const store = getStore();
  store.setState({
    isFocusedMode: !!initialUiSettings.focusedModeEnabled,
    showReasoningButton: initialUiSettings.showReasoningButton !== false,
    showApiCost: initialUiSettings.showApiCost !== false,
    showSummarizeButton: initialUiSettings.showSummarizeButton !== false,
    showTokenCounter: initialUiSettings.showTokenCounter !== false,
  });
  const chatFeed = $('chat-feed');
  const chatApiCostEl = $('chat-api-cost');
  const modelDisplay = $<HTMLButtonElement>('model-name-display');
  const modelDisplayText = $<HTMLSpanElement>('model-name-display-text');
  const modelSelectorMenu = $<HTMLDivElement>('model-selector-menu');
  const summarizeButton = $<HTMLButtonElement>('summarize-context-button');
  const focusedModeButton = $<HTMLButtonElement>('focused-mode-button');
  const composerToolsToggle = $<HTMLButtonElement>('composer-tools-toggle');
  const composerToolsDrawer = $<HTMLDivElement>('composer-tools-drawer');
  const editApprovalModal = createEditApprovalModal(bridge);

  // Helper de scroll compartilhado
  let userIsScrolling = false;
  const scrollToBottom = (smooth = false) => {
    if (!chatFeed) {return;}

    const isScrolledToBottom = () => {
      // Aumentado de 100px para 300px para melhorar scroll automático com múltiplos patches/tools
      const threshold = 300;
      const scrollTop = chatFeed.scrollTop;
      const scrollHeight = chatFeed.scrollHeight;
      const clientHeight = chatFeed.clientHeight;
      return scrollHeight - scrollTop - clientHeight < threshold;
    };

    if (!userIsScrolling || isScrolledToBottom()) {
      chatFeed.scrollTo({
        top: chatFeed.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      // ✅ Call preview visibility check se já estiver resolvido o scroll
      setTimeout(() => {
        if (typeof (services as any).updatePreviewVisibility === 'function') {
          (services as any).updatePreviewVisibility();
        }
      }, 80); // Um pouco mais de tolerância para viewports maiores darem relayout
    } else {
      // ✅ Also check visibility even if we didn't scroll
      if (typeof (services as any).updatePreviewVisibility === 'function') {
        (services as any).updatePreviewVisibility();
      }
    }
  };

  // Inicializa patch widget
  let patchWidget: any = null;
  function initializePatchWidget() {
    if (typeof window.PatchWidget === 'function' && chatFeed) {
      try {
        patchWidget = window.PatchWidget({
          containerEl: chatFeed,
          scrollToBottomFn: scrollToBottom,
          onScrollToBottom: () => scrollToBottom(true)
        });
        
      } catch (error) {
        
      }
    }
    return patchWidget;
  }

  // ✅ CONFIGURAÇÃO INICIAL PARA PRIMEIRA INSTALAÇÃO
  // Garante que nhf.hideThinking esteja definido para esconder marcadores do protocolo
  function initializeFirstInstallConfig() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // Define nhf.hideThinking como "1" por padrão (esconde thinking e marcadores)
        if (!window.localStorage.getItem('nhf.hideThinking')) {
          window.localStorage.setItem('nhf.hideThinking', '1');
          console.log('[App] Configuração nhf.hideThinking definida para primeira instalação');
        }
        
        // Também define a flag global para garantir compatibilidade
        (window as any).__NHF_HIDE_THINKING__ = true;
      }
    } catch (error) {
      // Silenciosamente ignora erros de localStorage (pode não estar disponível)
    }
  }

  // Tenta inicializar patch widget IMEDIATAMENTE se o DOM já estiver pronto
  if (document.readyState !== 'loading') {
    initializeFirstInstallConfig(); // ✅ Configuração para primeira instalação
    initializePatchWidget();
    setTimeout(() => {
      warmCognitiveBackgroundCache().catch(() => undefined);
    }, 50);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      initializeFirstInstallConfig(); // ✅ Configuração para primeira instalação
      initializePatchWidget();
    });
  }

  const services: Services = {
    bridge,
    store,
    scrollToBottom,
    get patchWidget() { return patchWidget; }, // Getter dinâmico para garantir que as features usem a instância quando criada
    setUpdatePreviewVisibility: (fn: any) => { (services as any).updatePreviewVisibility = fn; }
  } as any;

  const renderChatApiCost = () => {
    if (!chatApiCostEl) {return;}
    const state = store.getState();
    chatApiCostEl.textContent = state.currentChatApiCostFormatted || '$0.00';
    chatApiCostEl.classList.toggle('hidden', !state.showApiCost);
    chatApiCostEl.removeAttribute('title');
    chatApiCostEl.setAttribute('data-tooltip', state.currentChatApiCostTooltip || 'Custo estimado de API deste chat');
  };

  const formatTokenLimit = (value: number | null | undefined) => {
    if (!value || !Number.isFinite(Number(value))) {return '?';}
    const num = Number(value);
    if (num >= 1_000_000) {
      const millions = num / 1_000_000;
      return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
    }
    return `${Math.max(1, Math.round(num / 1000))}k`;
  };

  const buildModelTooltip = (model: any) => {
    if (!model) {
      return 'Selecionar modelo';
    }

    const name = model.displayName || model.modelId || model.id || 'Modelo';
    const ctx = formatTokenLimit(model.inputTokenLimit || model.contextWindow);
    const out = formatTokenLimit(model.outputTokenLimit);
    const vision = model.supportsVision ? 'OCR' : 'No Vision';
    const protocol = model.protocolMode === 'tool_calling' ? 'Native Tools' : 'Text Protocol';
    return `${name}\n${ctx} ctx · ${out} out · ${vision}\n${protocol}`;
  };

  const closeModelSelector = () => {
    const state = store.getState();
    if (!state.isModelSelectorOpen) {return;}
    if (modelSelectorMenu) {
      modelSelectorMenu.classList.add('hidden');
    }
    if (modelDisplay) {
      modelDisplay.setAttribute('aria-expanded', 'false');
    }
    store.setState({ isModelSelectorOpen: false });
  };

  const openModelSelector = () => {
    if (!modelSelectorMenu || !modelDisplay) {return;}
    modelSelectorMenu.classList.remove('hidden');
    modelDisplay.setAttribute('aria-expanded', 'true');
    store.setState({ isModelSelectorOpen: true });
  };

  const renderModelSelector = () => {
    if (!modelSelectorMenu) {return;}

    const state = store.getState();
    const activeElement = document.activeElement as HTMLElement | null;
    const shouldRestoreFocus = !!activeElement?.dataset?.modelId;
    const restoreModelId = shouldRestoreFocus ? activeElement?.dataset?.modelId || '' : '';
    const models = Array.isArray(state.allModels) ? state.allModels : [];
    const selectedId = state.modelSelected || state.selectedModelInfo?.modelId || '';

    modelSelectorMenu.innerHTML = '';

    if (models.length === 0) {
      const empty = createEl('div', { class: 'model-selector-option-meta' }, ['Nenhum modelo disponível.']);
      modelSelectorMenu.appendChild(empty);
      return;
    }

    models.forEach((model: any) => {
      const isActive = model.id === selectedId;
      const button = createEl('button', {
        type: 'button',
        class: `model-selector-option${isActive ? ' active' : ''}`,
        role: 'option',
        'aria-selected': isActive ? 'true' : 'false',
        'data-model-id': String(model.id || '')
      });

      const top = createEl('div', { class: 'model-selector-option-top' });
      top.appendChild(createEl('div', { class: 'model-selector-option-name' }, [model.displayName || model.id || 'Modelo']));
      if (isActive) {
        top.appendChild(createEl('span', { class: 'model-selector-option-badge' }, ['Atual']));
      }

      const providerName = model.providerName || model.provider || 'Provider';
      const meta = `${providerName} · ${formatTokenLimit(model.inputTokenLimit || model.contextWindow)} ctx · ${formatTokenLimit(model.outputTokenLimit)} out · ${model.supportsVision ? 'Vision' : 'No Vision'}`;
      const protocol = model.protocolMode === 'tool_calling' ? 'Native Tools' : 'Text Protocol';

      button.appendChild(top);
      button.appendChild(createEl('div', { class: 'model-selector-option-meta' }, [`${meta} · ${protocol}`]));
      button.appendChild(createEl('div', { class: 'model-selector-option-description' }, [model.description || 'Sem descrição disponível.']));

      button.addEventListener('click', () => {
        if (!model?.id || model.id === selectedId) {
          closeModelSelector();
          return;
        }

        button.setAttribute('disabled', 'true');
        bridge.post('ui/selectModelById', { modelId: model.id });
        closeModelSelector();
      });

      modelSelectorMenu.appendChild(button);
    });

    if (shouldRestoreFocus && restoreModelId) {
      const nextFocusedButton = modelSelectorMenu.querySelector<HTMLElement>(`[data-model-id="${restoreModelId}"]`);
      nextFocusedButton?.focus();
    }
  };

  const syncModelDisplayFromState = () => {
    const state = store.getState();
    const selectedId = state.modelSelected || state.selectedModelInfo?.modelId || '';
    const selected = state.selectedModelInfo || state.allModels.find((m: any) => m.id === selectedId) || null;
    const name = selected?.displayName || selected?.modelId || selected?.id || state.currentModelName || 'Selecionar modelo';

    if (modelDisplayText) {
      modelDisplayText.textContent = name;
    }

    if (modelDisplay) {
      modelDisplay.setAttribute('data-tooltip', buildModelTooltip(selected));
      modelDisplay.setAttribute('aria-expanded', state.isModelSelectorOpen ? 'true' : 'false');
    }
  };

  if (modelDisplay && modelSelectorMenu) {
    modelDisplay.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const { isModelSelectorOpen } = store.getState();
      if (isModelSelectorOpen) {
        closeModelSelector();
      } else {
        renderModelSelector();
        openModelSelector();
      }
    });

    document.addEventListener('click', (event) => {
      const target = event.target as Node | null;
      if (!target) {return;}
      if (modelSelectorMenu.contains(target) || modelDisplay.contains(target)) {return;}
      closeModelSelector();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeModelSelector();
      }
    });
  }

  const closeComposerToolsDrawer = () => {
    composerToolsDrawer?.classList.add('hidden');
    composerToolsToggle?.setAttribute('aria-expanded', 'false');
  };

  const toggleComposerToolsDrawer = () => {
    if (!composerToolsDrawer || !composerToolsToggle) {return;}
    const willOpen = composerToolsDrawer.classList.contains('hidden');
    composerToolsDrawer.classList.toggle('hidden', !willOpen);
    composerToolsToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  };

  const renderRuntimeSettings = () => {
    const state = store.getState();
    summarizeButton?.classList.toggle('hidden', !state.showSummarizeButton);
  };

  if (composerToolsToggle && composerToolsDrawer) {
    composerToolsToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleComposerToolsDrawer();
    });

    document.addEventListener('click', (event) => {
      const target = event.target as Node | null;
      if (!target) {return;}
      if (composerToolsDrawer.contains(target) || composerToolsToggle.contains(target)) {return;}
      closeComposerToolsDrawer();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeComposerToolsDrawer();
      }
    });
  }

  renderChatApiCost();
  syncModelDisplayFromState();
  renderRuntimeSettings();
  store.subscribe(() => {
    renderChatApiCost();
    syncModelDisplayFromState();
    renderModelSelector();
    renderRuntimeSettings();
  });

  // Handlers compartilhados
  const onClearUI = () => {
    const userInput = $<HTMLTextAreaElement>('user-input');
    if (userInput) {
      userInput.value = "";
      userInput.style.height = "44px";
    }
    // Outros clears serão feitos pelas features
  };

  // Inicializa features auxiliares primeiro
  const fileChanges = initFileChanges({
    ...services,
    onOpenFile: (path: string, line?: number, column?: number) => {
      bridge.post('ui/openFile', { path, line, column });
    },
  });

  const subscriptionWarning = initSubscriptionWarning(services);
  const editModal = initEditModal(services);
  const thinking = initThinking({
    ...services,
    scrollToBottom,
  });

  // Inicializa agentStatus antes do composer para poder referenciar no onSend
  const agentStatusFeature = initAgentStatus(services);

  const features = {
    composer: initComposer({
      ...services,
      onSend: (text: string, attachments: any[], msgId?: string) => {
        // Se status era "Ready for input…", muda para "Processing…"
        (agentStatusFeature as any)?.setProcessingOnFirstMessage?.();

        // Validação Client-Side de Trial Expirado
        const state = store.getState();
        if (state.isTrialExpired) {
          // Mostra banner discreto (estilo VisionWarning) também no client-side
          // setTimeout evita race condition com renderização/scroll do chat
          setTimeout(() => {
            try {
              (subscriptionWarning as any)?.showSubscriptionRequired?.(undefined);
            } catch (e) {
              
            }
          }, 150);

          // Adiciona mensagem do usuário
          bridge.post('ui/sendMessage', { text, attachments, msgId, mode: 'CHAT', forceState: 'CHAT', localOnly: true }); 

          // Simula resposta do sistema IMEDIATAMENTE
          bridge.post('ui/postEphemeral', { 
            text: "⚠️ **Assinatura Expirada**\n\nSeu período de teste ou assinatura expirou. Você precisa fazer upgrade para continuar usando os modelos (Cloud ou Local).\n\n[Clique aqui para Assinar](command:nic-hyper-flow.openSettings)"
          });
          return;
        }

        const selectedMode = 'AGENT'; 

        if (state.isStreaming) {
          // Message Queuing logic
          const msgId = `user-queued-${Date.now()}`;
          const queuedMessage = { text, attachments, msgId };
          
          store.setState({ queuedMessage });
          
          bridge.post('ui/queueMessage', {
            text,
            attachments,
            msgId,
            mode: selectedMode
          });
          return;
        }

        // Marcar que o streaming começou
        store.setState({ isStreaming: true });

        bridge.post('ui/sendMessage', {
          text,
          attachments,
          msgId,
          mode: selectedMode,
          forceState: selectedMode,
        });
      },
      onStop: () => {
        bridge.post('ui/stopGeneration');
        store.setState({ isStreaming: false, queuedMessage: null });
      }
    }),
    toolCards: initToolCards({
      ...services,
      scrollToBottom,
      patchWidget: patchWidget || undefined,
      onFileEdit: (payload: any) => {
        if (fileChanges && typeof (fileChanges as any).trackToolFileEdit === 'function') {
          (fileChanges as any).trackToolFileEdit(payload);
        }
      },
    }),
  };

  // Agora inicializa messages passando as funções de toolCards e thinking
  // Precisamos adicionar messages ao objeto features depois
  const messagesFeature = initMessages({
    ...services,
    scrollToBottom,
    patchWidget: patchWidget || undefined,
    renderToolCard: features.toolCards?.renderToolCard,
    updateToolCard: features.toolCards?.updateToolCard,
    clearToolCards: features.toolCards?.clearAll,
    setActiveTurnEl: features.toolCards?.setActiveTurnEl,
    updateThinkingBubble: (thinking as any)?.updateThinkingBubble,
  });

  // Completa o objeto features
  Object.assign(features, {
    messages: messagesFeature,
    thinking,
    attachments: initAttachments({
      ...services,
      onVisionWarning: () => {
        // Vision warning não está mais disponível
      },
    }),
    modelSelector: undefined as any,
    sidebar: initSidebar(services),
    chatListHeader: initChatListHeader({
      ...services,
      onNewChat: () => {
        bridge.post('ui/newChat');
        setCognitiveBackground('idle-receptive');
      },
      onClearUI,
    }),
    runCommand: initRunCommand(services),
    fileChanges,
    contextProgress: initContextProgress({
      ...services,
      getSelectedModelContextWindow: () => {
        const state = store.getState();
        if (!state.modelSelected) {return null;}
        const fromList = state.allModels.find((m: any) => m.id === state.modelSelected);
        return state.selectedModelInfo?.inputTokenLimit
          ?? state.selectedModelInfo?.contextWindow
          ?? fromList?.inputTokenLimit
          ?? fromList?.contextWindow
          ?? null;
      },
    }),
    subscriptionWarning,
    editModal,
    currentPlan: initCurrentPlanView(services),
    agentStatus: agentStatusFeature,
  });

  // Handlers globais de estado
  bridge.on('core/streamingFinished', () => {
    store.setState({ isStreaming: false, queuedMessage: null });
    userIsScrolling = false;
  });

  bridge.on('core/modelSwitchInProgress', () => {
    store.setState({ isStreaming: true, queuedMessage: null });
    userIsScrolling = false;
  });

  bridge.on('core/queuedMessageConsumed', () => {
    store.setState({ queuedMessage: null });
  });

  bridge.on('core/commandPreview', (payload: any) => {
    // 🔥 Preview é emitido em TEMPO REAL durante streaming (throttled a cada ~80ms)
    // O widget aparece assim que a tool de edição começa a ser chamada
    if (patchWidget && payload?.id) {
      patchWidget.renderPreview(payload);
    }
  });

  bridge.on('core/editApprovalRequest', (payload: any) => {
    editApprovalModal.show(payload);
  });

  // Auth Status Handler
  bridge.on('core/terminalSessions', (_payload: any) => {
    // Sessions list received — no auto-open to avoid triggering VS Code panel
    // layout race conditions (TreeError [DebugRepl]) on startup.
  });

  // ── Auth Gate ──────────────────────────────────────────────────────────────

  bridge.on('core/authStatus', (payload: any) => {
    const isAuthenticated = !!payload?.isAuthenticated;
    store.setState({ isAuthenticated, authStatus: payload });

    const modal = document.getElementById('login-gate-modal');
    if (!modal) {return;}

    if (!isAuthenticated) {
      modal.classList.remove('hidden');
      _showQrState();
    } else {
      modal.classList.add('hidden');
    }
  });

  // QR code recebido da extensão: exibe na tela
  bridge.on('core/qrCode', (payload: any) => {
    const { dataUrl, expiresInSeconds } = payload || {};
    const qrContainer = document.getElementById('qr-container');
    const expiryText = document.getElementById('qr-expiry-text');

    if (qrContainer && dataUrl) {
      qrContainer.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:10px;" alt="QR Code" />`;
    }
    if (expiryText) {
      const mins = Math.ceil((expiresInSeconds || 600) / 60);
      expiryText.textContent = `Expira em ${mins} minuto${mins !== 1 ? 's' : ''}`;
    }

    _showQrState();
  });

  // Mobile escaneou e está autenticando
  bridge.on('core/qrScanned', () => {
    const qrState = document.getElementById('login-qr-state');
    const loadingState = document.getElementById('login-loading-state');
    qrState?.classList.add('hidden');
    loadingState?.classList.remove('hidden');
  });

  function _showQrState() {
    document.getElementById('login-qr-state')?.classList.remove('hidden');
    document.getElementById('login-loading-state')?.classList.add('hidden');
    document.getElementById('login-success-state')?.classList.add('hidden');
  }

  bridge.on('core/selectedModel', (payload: any) => {
    store.setState({
      modelSelected: payload?.modelId || null,
      selectedModelInfo: payload || null,
      currentModelName: payload?.displayName || payload?.modelId || '',
      currentReasoningEffort: payload?.reasoningEffort || store.getState().currentReasoningEffort || 'medium',
    });

    if (payload?.supportsVision !== undefined) {
      store.setState({ currentModelSupportsVision: !!payload.supportsVision });
    }
  });

  bridge.on('core/allModels', (payload: any) => {
    store.setState({ allModels: Array.isArray(payload) ? payload : [] });
  });

  bridge.on('core/stateChanged', (payload: any) => {
    if (typeof payload.contextSize === 'number') {
      store.setState({ currentUsedTokens: payload.contextSize });
    }
    if (payload.supportsVision !== undefined) {
      store.setState({ currentModelSupportsVision: !!payload.supportsVision });
    }
    // Sincronizar o modo (Planning Only) - Comentado pois o botão foi removido
    // if (payload.state) {
    //   const planningToggle = document.getElementById('planning-toggle');
    //   if (planningToggle) {
    //     const isPlanning = payload.state === 'PLANNING';
    //     planningToggle.classList.toggle('active', isPlanning);
    //     planningToggle.textContent = isPlanning ? '◉ Planning' : '○ Planning';
    //   }
    // }
  });

  // Quando um chat é selecionado, restaura o contador de tokens armazenado
  bridge.on('core/chatSelected', (payload: any) => {
    if (payload?.contextSize !== undefined) {
      store.setState({ currentUsedTokens: payload.contextSize });
    }
  });

  bridge.on('core/chatApiCost', (payload: any) => {
    store.setState({
      currentChatApiCostUsd: Number(payload?.totalCostUsd || 0),
      currentChatApiCostFormatted: payload?.formattedCostUsd || '$0.00',
      currentChatApiCostTooltip: payload?.tooltip || 'Custo estimado de API deste chat'
    });
  });

  // ✅ BRIDGE ← REMOTE CONTROL: sincroniza focused mode quando alterado pelo app mobile
  bridge.on('core/focusedModeChanged', (payload: any) => {
    if (typeof payload?.enabled === 'boolean') {
      store.setState({ isFocusedMode: payload.enabled });
    }
  });

  bridge.on('core/contextCompacted', (payload: any) => {
    showContextCompactedNotification(payload?.message || 'Previous messages were summarized to preserve context.');
  });

  bridge.on('core/modeChanged', (payload: any) => {
    // Comentado pois o botão Planning foi removido
    // if (payload?.mode) {
    //   const planningToggle = document.getElementById('planning-toggle');
    //   if (planningToggle) {
    //     const isPlanning = payload.mode === 'PLANNING';
    //     planningToggle.classList.toggle('active', isPlanning);
    //     planningToggle.textContent = isPlanning ? '◉ Planning' : '○ Planning';
    //   }
    // }
  });

  // Handler para mudança do modo pelo usuário no Pill Toggle - Comentado pois o botão foi removido
  // function setupPlanningToggle() {
  //   const planningToggle = document.getElementById('planning-toggle');
  //   if (planningToggle) {
  //     // Remover listener antigo se houver (prevenção de duplicatas)
  //     const newToggle = planningToggle.cloneNode(true) as HTMLButtonElement;
  //     planningToggle.parentNode?.replaceChild(newToggle, planningToggle);
  // 
  //     newToggle.addEventListener('click', (e) => {
  //       e.preventDefault();
  //       e.stopPropagation();
  //       
  //       const isCurrentlyActive = newToggle.classList.contains('active');
  //       const nextIsPlanningOnly = !isCurrentlyActive;
  //       const selectedMode = nextIsPlanningOnly ? 'PLANNING' : 'AGENT';
  //       
  //       // Reação visual imediata
  //       newToggle.classList.toggle('active', nextIsPlanningOnly);
  //       newToggle.textContent = nextIsPlanningOnly ? '◉ Planning' : '○ Planning';
  //       
  //       console.log('[App] 🧠 Planning Mode HUD Toggle:', selectedMode);
  //       
  //       // Aplicar o modo no backend e avisar o sistema
  //       bridge.post('ui/changeMode', { mode: selectedMode });
  //     });
  //     console.log('[App] ✅ Event listener do planning-toggle (pill) HUD injetado');
  //   }
  // }
  // 
  // // Configurar o toggle quando o DOM estiver pronto - Comentado pois o botão foi removido
  // if (document.readyState === 'loading') {
  //   document.addEventListener('DOMContentLoaded', () => {
  //     setTimeout(setupPlanningToggle, 100);
  //   });
  // } else {
  //   setTimeout(setupPlanningToggle, 100);
  // }

  // Scroll behavior
  if (chatFeed) {
    let scrollTimeout: any;
    chatFeed.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      const state = store.getState();
      if (state.isStreaming) {
        userIsScrolling = true;
      }
      scrollTimeout = setTimeout(() => {
        const isScrolledToBottom = () => {
          const threshold = 100;
          const scrollTop = chatFeed.scrollTop;
          const scrollHeight = chatFeed.scrollHeight;
          const clientHeight = chatFeed.clientHeight;
          return scrollHeight - scrollTop - clientHeight < threshold;
        };
        if (isScrolledToBottom()) {
          userIsScrolling = false;
        }
      }, 150);
    });
  }

  // Handler para mudança de estado cognitivo (Background dinâmico)
  const COGNITIVE_STATE_MAP: Record<string, { folder: string; prefix: string }> = {
    'idle-receptive': { folder: 'idle-receptive', prefix: 'idle-receptive' },
    'comprehension': { folder: '02-comprehension', prefix: 'comprehension' },
    'disambiguation': { folder: '03-disambiguation', prefix: 'disambiguation' },
    'planning-strategy': { folder: '04-planning-strategy', prefix: 'planning-strategy' },
    'deep-focus': { folder: '05-deep-focus', prefix: 'deep-focus' },
    'execution': { folder: '06-execution', prefix: 'execution' },
    'monitoring': { folder: '07-monitoring', prefix: 'monitoring' },
    'cognitive-tension': { folder: '08-cognitive-tension', prefix: 'cognitive-tension' },
    'insight-restructuring': { folder: '09-insight-restructuring', prefix: 'insight-restructuring' },
    'consolidation': { folder: '10-consolidation', prefix: 'consolidation' },
    'final-validation': { folder: '11-final-validation', prefix: 'final-validation' },
    'closure': { folder: '12-closure', prefix: 'closure' },
  };

  function buildCognitiveBackgroundUrl(state: string, imageIndex: number): string | null {
    const map = COGNITIVE_STATE_MAP[state];
    if (!window.ASSETS_URI || !map) {return null;}
    const numStr = imageIndex.toString().padStart(2, '0');
    return `${window.ASSETS_URI}/generated/cognitive-states/${map.folder}/${map.prefix}_${numStr}.png`;
  }

  async function preloadImage(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      let resolved = false;

      const done = () => {
        if (resolved) {return;}
        resolved = true;
        resolve();
      };

      img.onload = done;
      img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${url}`));

      // decode ajuda a evitar flicker em alguns engines, mas onload é o fallback
      try {
        const decode = (img as any).decode?.bind(img);
        if (decode) {
          decode().then(done).catch(() => {
            /* onload resolve */
          });
        }
      } catch {
        // ignore
      }

      // Importante: setar src por último
      img.src = url;
    });
  }

  async function warmCognitiveBackgroundCache(): Promise<void> {
    if (!window.ASSETS_URI) {return;}

    const urls: string[] = [];
    for (const state of Object.keys(COGNITIVE_STATE_MAP)) {
      for (let i = 1; i <= 5; i++) {
        const url = buildCognitiveBackgroundUrl(state, i);
        if (url) {urls.push(url);}
      }
    }

    // Best-effort: aquece cache sem travar a UI
    for (const url of urls) {
      preloadImage(url).catch(() => undefined);
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  let bgLayerActive: 'a' | 'b' = 'a';

  function getBgLayerEls() {
    const a = document.getElementById('cognitive-background-a') as HTMLDivElement | null;
    const b = document.getElementById('cognitive-background-b') as HTMLDivElement | null;
    return { a, b };
  }

  function applyLayerVisibility(visible: HTMLDivElement | null, hidden: HTMLDivElement | null) {
    if (visible) {
      visible.classList.remove('is-hidden');
      visible.classList.add('is-visible');
    }
    if (hidden) {
      hidden.classList.remove('is-visible');
      hidden.classList.add('is-hidden');
    }
  }

  // Função para mostrar a UI após o carregamento inicial
  function showUI() {
    const loadingScreen = document.getElementById('initial-loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('hidden');
      setTimeout(() => loadingScreen.remove(), 500);
    }
    document.body.style.opacity = '1';
  }

  function updateLoadingStatus(text: string) {
    const statusEl = document.getElementById('loading-status');
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  async function setBackgroundImage(url: string, isInitial = false): Promise<void> {
    if (!url) {return;}

    const { a, b } = getBgLayerEls();
    const nextEl = bgLayerActive === 'a' ? b : a;
    const prevEl = bgLayerActive === 'a' ? a : b;
    if (!nextEl || !prevEl) {return;}

    try {
      await preloadImage(url);
      nextEl.style.backgroundImage = `url('${url}')`;
      applyLayerVisibility(nextEl, prevEl);
      bgLayerActive = bgLayerActive === 'a' ? 'b' : 'a';
      if (isInitial) {showUI();}
    } catch {
      prevEl.style.backgroundImage = `url('${url}')`;
      applyLayerVisibility(prevEl, nextEl);
      if (isInitial) {showUI();}
    }
  }

  function getConfiguredBackgroundMode(): BackgroundMode {
    const value = String(initialUiSettings.backgroundMode || 'static').toLowerCase();
    if (value === 'cognitive' || value === 'static' || value === 'none') {return value;}
    return 'static';
  }

  function getConfiguredStaticBackgroundUrl(): string {
    const value = String(initialUiSettings.backgroundImagePath || '').trim();
    if (value) {
      if (/^(https?:|vscode-webview-resource:|vscode-webview:|data:|blob:)/.test(value)) {return value;}
      if (value === 'assets/background.png' && window.STATIC_BACKGROUND_URI) {return String(window.STATIC_BACKGROUND_URI);}
      if (window.STATIC_BACKGROUND_URI && /chat-background\.[a-z0-9]+(?:\?.*)?$/i.test(String(window.STATIC_BACKGROUND_URI))) {
        return String(window.STATIC_BACKGROUND_URI);
      }
    }
    return String(window.STATIC_BACKGROUND_URI || '');
  }

  async function applyConfiguredBackground(isInitial = false): Promise<void> {
    const mode = getConfiguredBackgroundMode();
    if (mode === 'none') {
      const { a, b } = getBgLayerEls();
      if (a) {a.style.backgroundImage = 'none';}
      if (b) {b.style.backgroundImage = 'none';}
      if (isInitial) {showUI();}
      return;
    }

    if (mode === 'cognitive') {
      const allStates = Object.keys(COGNITIVE_STATE_MAP);
      const randomState = allStates[Math.floor(Math.random() * allStates.length)];
      await setCognitiveBackground(randomState, isInitial);
      return;
    }

    await setBackgroundImage(getConfiguredStaticBackgroundUrl(), isInitial);
  }

  // Função para definir background de um estado
  async function setCognitiveBackground(state: string, isInitial = false): Promise<void> {
    if (getConfiguredBackgroundMode() !== 'cognitive') {
      return;
    }

    const map = COGNITIVE_STATE_MAP[state];
    if (!map) {
      console.warn('[App] Estado cognitivo desconhecido:', state);
      return;
    }

    const randomNum = Math.floor(Math.random() * 5) + 1; // 1 to 5
    const fullPath = buildCognitiveBackgroundUrl(state, randomNum);
    if (!fullPath) {return;}

    await setBackgroundImage(fullPath, isInitial);
  }

  // Handler para mudança de estado cognitivo
  bridge.on('setCognitiveState', (payload: any) => {
    if (getConfiguredBackgroundMode() !== 'cognitive') {return;}
    const state = typeof payload === 'string' ? payload : payload?.state;
    if (!state) {return;}
    setCognitiveBackground(state);
  });

  // Handler para atualizar input do controle remoto
  bridge.on('core/remoteInputUpdate', (payload: any) => {
    const userInput = document.getElementById('user-input') as HTMLTextAreaElement;
    if (userInput && payload?.text !== undefined) {
      userInput.value = payload.text;
      // Dispara evento input para ajustar altura do textarea
      userInput.dispatchEvent(new Event('input'));
      // Foca no campo de input
      userInput.focus();
    }
  });

  // Função para mostrar notificação de contexto compactado
  function showContextCompactedNotification(message: string) {
    // Remove notificação anterior se existir
    const existing = document.getElementById('context-compacted-notification');
    if (existing) {
      existing.remove();
    }

    // Cria elemento de notificação
    const notification = document.createElement('div');
    notification.id = 'context-compacted-notification';
    notification.className = 'context-compacted-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">⚠️</span>
        <span class="notification-text">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;

    // Adiciona ao body
    document.body.appendChild(notification);

    // Anima entrada
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);

    // Remove automaticamente após 8 segundos
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 300);
    }, 8000);
  }

  // Inicialização do background configurado
  async function initializeConfiguredBackground(): Promise<void> {
    updateLoadingStatus('Carregando background...');
    if (!window.ASSETS_URI && !window.STATIC_BACKGROUND_URI) {
      return new Promise(resolve => {
        setTimeout(async () => {
          await initializeConfiguredBackground();
          resolve();
        }, 100);
      });
    }

    await applyConfiguredBackground(true);
  }

  // Função para enviar sinal de que a UI está pronta
  function sendUiReady() {
    bridge.post('ui/ready');
  }

  // Função modificada para inicializar background e enviar ready
  async function initializeBackgroundAndSendReady() {
    try {
      updateLoadingStatus('Preparando assets...');
      await initializeConfiguredBackground();
    } catch (error) {
      
    }
    // Enviar ready após background inicializado (ou após erro)
    updateLoadingStatus('Finalizando...');
    sendUiReady();
  }

  // Debug visual para confirmar que a webview está recebendo eventos Claude
  bridge.on('core/claudeSession', (payload: any) => {
    try {
      console.log('[App] core/claudeSession recebido:', payload);
    } catch {}
  });

  // Inicializa background aleatório quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
     setTimeout(() => {
       warmCognitiveBackgroundCache().catch(() => undefined);
     }, 50);
      setTimeout(() => {
        initializeBackgroundAndSendReady();
      }, 200);
    });
  } else {
    setTimeout(() => {
      initializeBackgroundAndSendReady();
    }, 200);
  }
  
  return {
    destroy: () => {
      Object.values(features).forEach(feature => {
        if (feature && typeof feature.destroy === 'function') {
          feature.destroy();
        }
      });
    }
  };
}

// Inicializa quando DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    
    initApp();
  });
} else {
  
  initApp();
}
