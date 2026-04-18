(function() {
  const vscode = acquireVsCodeApi();

  const state = {
    settings: null,
  };

  const els = {
    toast: document.getElementById('toast'),
    refreshBtn: document.getElementById('refresh-settings-btn'),

    backgroundModeBadge: document.getElementById('background-mode-badge'),
    backgroundModeButtons: Array.from(document.querySelectorAll('[data-background-mode]')),
    selectBackgroundImageBtn: document.getElementById('select-background-image'),
    removeBackgroundImageBtn: document.getElementById('remove-background-image'),
    backgroundImageStatus: document.getElementById('background-image-status'),

    toggleShowReasoning: document.getElementById('toggle-show-reasoning'),
    toggleShowApiCost: document.getElementById('toggle-show-api-cost'),
    toggleShowSummarize: document.getElementById('toggle-show-summarize'),
    toggleShowTokenCounter: document.getElementById('toggle-show-token-counter'),
    toggleFocusedMode: document.getElementById('toggle-focused-mode'),
    toggleDefaultFocusedMode: document.getElementById('toggle-default-focused-mode'),

    openaiReasoningSelect: document.getElementById('openai-reasoning-select'),
    anthropicReasoningSelect: document.getElementById('anthropic-reasoning-select'),
    summarizeNowBtn: document.getElementById('summarize-now-btn'),

    editApprovalModeButtons: Array.from(document.querySelectorAll('[data-edit-approval-mode]')),

    defaultModelSelect: document.getElementById('default-model-select'),
    selectedModelMeta: document.getElementById('selected-model-meta'),
    pricingModelList: document.getElementById('pricing-model-list'),
    providerKeysGrid: document.getElementById('provider-keys-grid'),

    runEverythingToggle: document.getElementById('run-everything-toggle'),
    allowlistTextarea: document.getElementById('allowlist-textarea'),
    saveAllowlistBtn: document.getElementById('save-allowlist-btn'),
    allowedCommandsList: document.getElementById('allowed-commands-list'),

    customPrompt: document.getElementById('custom-prompt'),
    saveCustomPromptBtn: document.getElementById('save-custom-prompt'),
    clearCustomPromptBtn: document.getElementById('clear-custom-prompt'),
    customPromptStatus: document.getElementById('custom-prompt-status'),

    imageModelSelector: document.getElementById('image-model-selector'),
    saveImageModelBtn: document.getElementById('save-image-model'),
    imageModelStatus: document.getElementById('image-model-status'),
  };

  const PROVIDERS = [
    { id: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
    { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
    { id: 'google', label: 'Google Gemini', placeholder: 'AIza...' },
    { id: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
    { id: 'xai', label: 'xAI', placeholder: 'xai-...' },
    { id: 'qwen', label: 'Qwen (DashScope)', placeholder: 'sk-...' },
    { id: 'ollama', label: 'Ollama (Opcional)', placeholder: 'API Key se usar proxy' },
    { id: 'fal', label: 'Fal.ai', placeholder: 'fal_key_...' },
    { id: 'serper', label: 'Serper', placeholder: 'Search API key' },
    { id: 'brave', label: 'Brave Search', placeholder: 'Brave Search API key' },
  ];

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = String(message || 'Done');
    els.toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2600);
  }

  function post(type, payload = {}) {
    vscode.postMessage({ type, payload });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setActiveSegment(buttons, activeValue, attrName) {
    buttons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute(attrName) === activeValue);
    });
  }

  function formatBackgroundMode(mode) {
    if (mode === 'cognitive') return 'Cognitive';
    if (mode === 'none') return 'No background';
    return 'Static image';
  }

  function formatPrice(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
  }

  function getSelectedModel() {
    const payload = state.settings || {};
    const selectedModelId = payload.selectedModelId;
    const allModels = Array.isArray(payload.allModels) ? payload.allModels : [];
    return allModels.find((model) => model.id === selectedModelId) || null;
  }

  function renderBackground(uiSettings) {
    const mode = uiSettings?.backgroundMode || 'static';
    setActiveSegment(els.backgroundModeButtons, mode, 'data-background-mode');

    if (els.backgroundModeBadge) {
      els.backgroundModeBadge.textContent = formatBackgroundMode(mode);
    }

    if (els.backgroundImageStatus) {
      const imagePath = uiSettings?.backgroundImagePath || 'assets/background.png';
      const isDefault = imagePath === 'assets/background.png';
      const modeLabel = mode === 'cognitive'
        ? 'Modo cognitivo ativo'
        : mode === 'none'
          ? 'Sem background visual'
          : (isDefault ? 'Imagem padrão: assets/background.png' : `Imagem importada: ${imagePath}`);
      els.backgroundImageStatus.textContent = modeLabel;
    }
  }

  function renderToggles(uiSettings) {
    if (els.toggleShowReasoning) els.toggleShowReasoning.checked = !!uiSettings?.showReasoningButton;
    if (els.toggleShowApiCost) els.toggleShowApiCost.checked = !!uiSettings?.showApiCost;
    if (els.toggleShowSummarize) els.toggleShowSummarize.checked = !!uiSettings?.showSummarizeButton;
    if (els.toggleShowTokenCounter) els.toggleShowTokenCounter.checked = !!uiSettings?.showTokenCounter;
    if (els.toggleFocusedMode) els.toggleFocusedMode.checked = !!uiSettings?.focusedModeEnabled;
    if (els.toggleDefaultFocusedMode) els.toggleDefaultFocusedMode.checked = !!uiSettings?.defaultFocusedMode;
  }

  function renderReasoning(reasoning) {
    if (els.openaiReasoningSelect) {
      els.openaiReasoningSelect.value = reasoning?.openai || 'medium';
    }
    if (els.anthropicReasoningSelect) {
      els.anthropicReasoningSelect.value = reasoning?.anthropic || 'none';
    }
  }

  function renderEditApproval(uiSettings) {
    const mode = uiSettings?.editApprovalMode === 'ask_before_apply' ? 'ask_before_apply' : 'apply_everything';
    setActiveSegment(els.editApprovalModeButtons, mode, 'data-edit-approval-mode');
  }

  function renderModels(payload) {
    const allModels = Array.isArray(payload?.allModels) ? payload.allModels : [];
    const selectedModelId = payload?.selectedModelId || '';

    if (els.defaultModelSelect) {
      els.defaultModelSelect.innerHTML = allModels.map((model) => `
        <option value="${escapeHtml(model.id)}">${escapeHtml(model.displayName || model.id)} · ${escapeHtml(model.providerName || model.provider || '')}</option>
      `).join('');
      els.defaultModelSelect.value = selectedModelId;
    }

    const selectedModel = getSelectedModel();
    if (els.selectedModelMeta) {
      if (!selectedModel) {
        els.selectedModelMeta.textContent = 'Selecione um modelo para ver detalhes.';
      } else {
        const supportsVision = selectedModel.supportsVision ? 'Vision' : 'No Vision';
        const protocol = selectedModel.protocolMode === 'tool_calling' ? 'Native Tools' : 'Text Protocol';
        const contextWindow = selectedModel.inputTokenLimit || selectedModel.contextWindow || 0;
        const outputWindow = selectedModel.outputTokenLimit || 0;
        els.selectedModelMeta.textContent = `${selectedModel.providerName || selectedModel.provider} · ${contextWindow.toLocaleString()} ctx · ${outputWindow.toLocaleString()} out · ${supportsVision} · ${protocol}`;
      }
    }

    if (els.pricingModelList) {
      const pricingByModel = Array.isArray(payload?.pricingByModel) ? payload.pricingByModel : [];
      els.pricingModelList.innerHTML = pricingByModel.map((entry) => {
        const isSelected = entry.modelId === selectedModelId;
        const pricing = entry.pricing;
        return `
          <div class="pricing-model-item${isSelected ? ' active' : ''}">
            <div class="pricing-model-head">
              <strong>${escapeHtml(entry.displayName || entry.modelId)}</strong>
              <span class="provider-mini-badge">${escapeHtml(entry.provider)}</span>
            </div>
            <div class="pricing-model-copy">
              In: ${pricing ? formatPrice(pricing.input) : '—'} · Out: ${pricing ? formatPrice(pricing.output) : '—'} · Cached: ${pricing && pricing.cachedInput !== null ? formatPrice(pricing.cachedInput) : '—'}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function renderProviderKeys(payload) {
    if (!els.providerKeysGrid) return;
    const providers = payload?.providers || {};

    els.providerKeysGrid.innerHTML = PROVIDERS.map((provider) => {
      const configured = !!providers[provider.id];
      return `
        <div class="api-key-card feature-card provider-key-card" data-provider-card="${escapeHtml(provider.id)}">
          <div class="setting-head">
            <div>
              <h3>${escapeHtml(provider.label)}</h3>
              <p class="setting-copy">Armazenada no secret storage do VS Code.</p>
            </div>
            <span class="provider-key-status ${configured ? 'configured' : ''}">${configured ? 'Configured' : 'Not configured'}</span>
          </div>
          <label class="input-group">
            <span>API key</span>
            <input type="password" class="provider-key-input" data-provider-input="${escapeHtml(provider.id)}" placeholder="${escapeHtml(provider.placeholder)}" />
          </label>
          <div class="button-group compact-group">
            <button type="button" class="btn-primary" data-provider-save="${escapeHtml(provider.id)}">Salvar</button>
            <button type="button" class="btn-ghost" data-provider-remove="${escapeHtml(provider.id)}" ${configured ? '' : 'disabled'}>Remover</button>
          </div>
        </div>
      `;
    }).join('');

    els.providerKeysGrid.querySelectorAll('[data-provider-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const provider = button.getAttribute('data-provider-save');
        const input = els.providerKeysGrid.querySelector(`[data-provider-input="${provider}"]`);
        const key = input?.value?.trim();
        if (!key) {
          showToast('Digite uma API key válida.');
          return;
        }
        post('ui/saveProviderKey', { provider, key });
        if (input) input.value = '';
        showToast(`${provider} salvo.`);
      });
    });

    els.providerKeysGrid.querySelectorAll('[data-provider-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const provider = button.getAttribute('data-provider-remove');
        post('ui/removeProviderKey', { provider });
        showToast(`${provider} removido.`);
      });
    });
  }

  function renderRunCommand(runCommand) {
    const allowAll = !!runCommand?.allowAll;
    const commands = Array.isArray(runCommand?.allowedCommands) ? runCommand.allowedCommands : [];

    if (els.runEverythingToggle) {
      els.runEverythingToggle.checked = allowAll;
    }

    if (els.allowlistTextarea) {
      els.allowlistTextarea.value = commands.join('\n');
    }

    if (els.allowedCommandsList) {
      if (commands.length === 0) {
        els.allowedCommandsList.innerHTML = '<div class="empty-state">Nenhum comando allowlisted ainda.</div>';
      } else {
        els.allowedCommandsList.innerHTML = commands.map((command) => `
          <div class="command-item">
            <code class="command-code">${escapeHtml(command)}</code>
            <button type="button" class="btn-danger btn-small" data-remove-command="${escapeHtml(command)}">Remove</button>
          </div>
        `).join('');

        els.allowedCommandsList.querySelectorAll('[data-remove-command]').forEach((button) => {
          button.addEventListener('click', () => {
            post('ui/removeFromWhitelist', { command: button.getAttribute('data-remove-command') });
            showToast('Comando removido da allowlist.');
          });
        });
      }
    }
  }

  function renderCustomPrompt(customPrompt) {
    if (els.customPrompt) {
      els.customPrompt.value = customPrompt || '';
    }
    if (els.customPromptStatus) {
      const normalized = String(customPrompt || '').trim();
      els.customPromptStatus.textContent = normalized ? `Configured · ${normalized.length} chars` : 'No custom instructions';
    }
  }

  function renderImageModel(imageModel) {
    if (els.imageModelSelector) {
      els.imageModelSelector.value = imageModel || 'gpt-image-1.5';
    }
    if (els.imageModelStatus) {
      els.imageModelStatus.textContent = imageModel ? `Usando ${imageModel}` : 'Not configured';
    }
  }

  function renderSettings(payload) {
    state.settings = payload || {};
    renderBackground(payload?.uiSettings || {});
    renderToggles(payload?.uiSettings || {});
    renderReasoning(payload?.reasoning || {});
    renderEditApproval(payload?.uiSettings || {});
    renderModels(payload || {});
    renderProviderKeys(payload || {});
    renderRunCommand(payload?.runCommand || {});
    renderCustomPrompt(payload?.customPrompt || '');
    renderImageModel(payload?.imageModel || 'gpt-image-1.5');
  }

  els.refreshBtn?.addEventListener('click', () => {
    post('ui/requestSettings');
    showToast('Settings recarregadas.');
  });

  els.backgroundModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const backgroundMode = button.getAttribute('data-background-mode');
      if (!backgroundMode) return;
      const currentPath = state.settings?.uiSettings?.backgroundImagePath || 'assets/background.png';
      post('ui/saveUiSettings', { backgroundMode, backgroundImagePath: currentPath });
    });
  });

  els.selectBackgroundImageBtn?.addEventListener('click', () => {
    post('ui/selectBackgroundImage');
  });

  els.removeBackgroundImageBtn?.addEventListener('click', () => {
    post('ui/removeBackgroundImage');
    showToast('Background removido.');
  });

  els.toggleShowReasoning?.addEventListener('change', (event) => post('ui/saveReasoningVisibility', { enabled: !!event.target.checked }));
  els.toggleShowApiCost?.addEventListener('change', (event) => post('ui/saveTokenCostVisibility', { enabled: !!event.target.checked }));
  els.toggleShowSummarize?.addEventListener('change', (event) => post('ui/saveSummarizeVisibility', { enabled: !!event.target.checked }));
  els.toggleShowTokenCounter?.addEventListener('change', (event) => post('ui/saveTokenCounterVisibility', { enabled: !!event.target.checked }));
  els.toggleFocusedMode?.addEventListener('change', (event) => post('ui/saveFocusedMode', { enabled: !!event.target.checked }));
  els.toggleDefaultFocusedMode?.addEventListener('change', (event) => post('ui/saveDefaultFocusedMode', { enabled: !!event.target.checked }));

  els.openaiReasoningSelect?.addEventListener('change', (event) => {
    post('ui/saveOpenAIReasoning', { effort: event.target.value });
    showToast('OpenAI reasoning atualizado.');
  });

  els.anthropicReasoningSelect?.addEventListener('change', (event) => {
    post('ui/saveAnthropicReasoning', { effort: event.target.value });
    showToast('Anthropic thinking atualizado.');
  });

  els.summarizeNowBtn?.addEventListener('click', () => {
    post('ui/summarizeCurrentChat');
    showToast('Solicitação de sumarização enviada ao chat.');
  });

  els.editApprovalModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-edit-approval-mode');
      if (!mode) return;
      post('ui/saveEditApprovalMode', { mode });
      showToast('Modo de aprovação atualizado.');
    });
  });

  els.defaultModelSelect?.addEventListener('change', (event) => {
    const modelId = event.target.value;
    if (!modelId) return;
    post('ui/selectDefaultModel', { modelId });
    showToast('Modelo padrão atualizado.');
  });

  els.runEverythingToggle?.addEventListener('change', (event) => {
    post('ui/setRunCommandAllowAll', { allowAll: !!event.target.checked });
  });

  els.saveAllowlistBtn?.addEventListener('click', () => {
    const commands = String(els.allowlistTextarea?.value || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    post('ui/saveAllowlist', { commands });
    showToast('Allowlist salva.');
  });

  els.saveCustomPromptBtn?.addEventListener('click', () => {
    post('ui/saveCustomPrompt', { prompt: String(els.customPrompt?.value || '') });
    showToast('Custom prompt salvo.');
  });

  els.clearCustomPromptBtn?.addEventListener('click', () => {
    if (els.customPrompt) {
      els.customPrompt.value = '';
    }
    post('ui/saveCustomPrompt', { prompt: '' });
    showToast('Custom prompt limpo.');
  });

  els.saveImageModelBtn?.addEventListener('click', () => {
    const model = els.imageModelSelector?.value;
    if (!model) return;
    post('ui/saveImageModel', { model });
    showToast('Modelo de imagem salvo.');
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    switch (message.type) {
      case 'core/settingsData':
        renderSettings(message.payload || {});
        break;
      case 'core/success':
        showToast(message.text || 'Done');
        break;
    }
  });

  post('ui/requestSettings');
}());
