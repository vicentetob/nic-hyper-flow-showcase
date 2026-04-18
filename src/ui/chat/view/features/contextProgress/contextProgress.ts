/**
 * Context Progress Feature - Barra de progresso de contexto
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, qs } from '../../../../shared/dom/qs';

export interface ContextProgressServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  getSelectedModelContextWindow?: () => number | null;
}

export function initContextProgress(services: ContextProgressServices) {
  const { bridge, store, getSelectedModelContextWindow } = services;
  const contextProgressFill = $('context-progress-fill');
  const contextProgressText = $('context-progress-text');
  const contextProgressWidget = $('context-progress-widget');
  const contextProgressCircleFg = qs('.context-progress-fg', contextProgressWidget || undefined);
  const contextProgressPercent = qs('.context-progress-percent', contextProgressWidget || undefined);

  // Circular widget is the main element - if it exists, we can continue
  if (!contextProgressWidget) {
    console.warn('[ContextProgress] Circular widget not found');
    return;
  }

  function formatTokens(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return n.toString();
  }

  function debuggableUpdateContextProgress(
    currentTokens: number,
    maxTokens: number,
    reason: string
  ) {
    
    updateContextProgress(currentTokens, maxTokens);
  }

  function updateContextProgress(
    currentTokens: number,
    maxTokens: number = 200000
  ) {
    const state = store.getState();

    if (contextProgressWidget) {
      contextProgressWidget.classList.toggle('hidden', !state.showTokenCounter);
    }

    // Main focus: circular widget
    if (!contextProgressWidget || !contextProgressCircleFg || !contextProgressPercent) return;

    const percentage = Math.min(100, (currentTokens / maxTokens) * 100);
    const maxFormatted = formatTokens(maxTokens);
    const currentFormatted = formatTokens(currentTokens);

    // Update SVG stroke-dasharray (circumference = 100)
    const dashValue = percentage;
    contextProgressCircleFg.setAttribute('stroke-dasharray', `${dashValue}, 100`);
    
    // Update percentage text
    contextProgressPercent.textContent = `${percentage.toFixed(0)}%`;
    
    // Update tooltip with requested format
    const tooltipText = `${percentage.toFixed(0)}%\n${currentFormatted} / ${maxFormatted} tokens`;
    contextProgressWidget.setAttribute('data-tooltip', tooltipText);
    
    // Update warning/danger classes
    contextProgressWidget.classList.remove('progress-warning', 'progress-danger');
    if (percentage > 90) {
      contextProgressWidget.classList.add('progress-danger');
    } else if (percentage > 75) {
      contextProgressWidget.classList.add('progress-warning');
    }

    // Optional linear elements (if they exist)
    if (contextProgressFill && contextProgressText) {
      contextProgressFill.style.setProperty(
        '--progress-width',
        percentage + '%'
      );
      contextProgressText.textContent = `${currentFormatted} / ${maxFormatted} tokens (${percentage.toFixed(0)}%)`;
      
      contextProgressFill.classList.remove('progress-warning', 'progress-danger');
      if (percentage > 90) {
        contextProgressFill.classList.add('progress-danger');
      } else if (percentage > 75) {
        contextProgressFill.classList.add('progress-warning');
      }
    }
  }

  // Atualiza quando estado muda
  store.subscribe((state) => {
    const maxTokens = getSelectedModelContextWindow?.() || 200000;
    debuggableUpdateContextProgress(
      state.currentUsedTokens,
      maxTokens,
      'Store state change'
    );
  });

  updateContextProgress(store.getState().currentUsedTokens, getSelectedModelContextWindow?.() || 200000);

  // Manual summarization
  const summarizeBtn = $('summarize-context-button');
  if (summarizeBtn) {
    summarizeBtn.addEventListener('click', () => {
      bridge.post('chat/summarizeContext');
    });
  }

  // Handlers
  bridge.on('core/stateChanged', (payload: any) => {
    if (typeof payload.contextSize === 'number') {
      store.setState({ currentUsedTokens: payload.contextSize });
      const maxTokens =
        payload.maxInputTokens || getSelectedModelContextWindow?.() || 200000;
      debuggableUpdateContextProgress(
        payload.contextSize,
        maxTokens,
        'core/stateChanged event'
      );
    }
  });

  bridge.on('core/contextSizeUpdate', (payload: any) => {
    if (payload.contextSize !== undefined) {
      debuggableUpdateContextProgress(
        payload.contextSize,
        payload.maxTokens || 200000,
        'core/contextSizeUpdate event'
      );
    }
  });

  return {
    updateContextProgress,
    destroy: () => {
      // Cleanup
    },
  };
}
