/**
 * Agent Status Bar
 * Indicador sempre visível do estado atual do agente.
 * Posicionado entre o header e o chat-feed.
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $ } from '../../../../shared/dom/qs';

export interface AgentStatusServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
}

type AgentStatusState = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error' | 'paused' | 'custom';

export function initAgentStatus(services: AgentStatusServices) {
  const { bridge, store } = services;

  const bar = $('agent-status-bar') as HTMLElement | null;
  if (!bar) {
    console.warn('[AgentStatus] #agent-status-bar não encontrado');
    return;
  }

  const dot   = bar.querySelector('.status-dot') as HTMLElement;
  const label = bar.querySelector('.status-label') as HTMLElement;
  const detail = bar.querySelector('.status-detail') as HTMLElement;
  const badge  = bar.querySelector('.status-mode-badge') as HTMLElement;

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingState: { state: AgentStatusState; label: string; detail: string; autoHideMs: number } | null = null;
  const DEBOUNCE_MS = 150;

  // ── State Priority System ──────────────────────────────────────
  const STATE_PRIORITY: Record<AgentStatusState, number> = {
    custom:   200,  // Model-reported status — ABSOLUTE MAXIMUM priority
    error:    100,
    waiting:   90,
    paused:    80,
    executing: 60,
    thinking:  50,
    idle:      20,
  };

  function canTransition(from: AgentStatusState, to: AgentStatusState): boolean {
    if (from === to) return false;
    const fromPriority = STATE_PRIORITY[from] ?? 0;
    const toPriority = STATE_PRIORITY[to] ?? 0;
    return toPriority >= fromPriority;
  }

  async function setState(
    state: AgentStatusState,
    labelText: string,
    detailText = '',
    autoHideMs = 0,
    force = false
  ) {
    const prevState = (bar!.dataset.state || 'idle') as AgentStatusState;
    if (!force && !canTransition(prevState, state)) return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    pendingState = { state, label: labelText, detail: detailText, autoHideMs };
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const p = pendingState!;
      pendingState = null;
      applyState(p.state, p.label, p.detail, p.autoHideMs, force);
    }, DEBOUNCE_MS);
  }

  async function applyState(
    state: AgentStatusState,
    labelText: string,
    detailText = '',
    autoHideMs = 0,
    force = false
  ) {
    const prevState = (bar!.dataset.state || 'idle') as AgentStatusState;
    if (!force && !canTransition(prevState, state)) return;

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    // ── Style Management ──
    
    // 1. Reset everything if state changed
    if (prevState !== state) {
      dot!.style.background = '';
      dot!.style.animation = '';
      dot!.style.boxShadow = '';
      bar!.style.background = '';
      bar!.style.borderBottomColor = '';
      if (label) {
        label.style.color = '';
        label.style.fontWeight = '';
        label.style.textShadow = '';
      }
    }

    // 2. Apply Theme based on state
    if (state === 'idle' && labelText.includes('Ready')) {
      // GOLD THEME for Ready
      const gold = '#FFD700';
      dot!.style.background = gold;
      dot!.style.boxShadow = `0 0 8px ${gold}66`;
      dot!.style.animation = 'agent-status-pulse 2s ease-in-out infinite';
      bar!.style.background = 'rgba(255, 215, 0, 0.08)';
      bar!.style.borderBottomColor = 'rgba(255, 215, 0, 0.2)';
      if (label) {
        label.style.color = '#FFE066';
        label.style.fontWeight = '500';
        label.style.textShadow = '0 0 4px rgba(255, 215, 0, 0.1)';
      }
    } else if (state !== 'idle') {
      // WHITE THEME for everything else (Processing, Thinking, etc)
      if (label) {
        label.style.color = '#FFFFFF';
        label.style.fontWeight = '400';
      }
    }

    // ── Content Transition ──
    const labelChanged = label && label.textContent !== labelText;
    const detailChanged = detail && detail.textContent !== detailText;

    if ((labelChanged || detailChanged) && bar!.dataset.state !== 'idle' && state !== 'idle') {
      label?.classList.add('status-fade-out');
      detail?.classList.add('status-fade-out');
      await new Promise(r => setTimeout(r, 150));
      
      if (label)  label.textContent  = labelText;
      if (detail) detail.textContent = detailText;
      bar!.dataset.state = state;

      label?.classList.remove('status-fade-out');
      detail?.classList.remove('status-fade-out');
      label?.classList.add('status-fade-in');
      detail?.classList.add('status-fade-in');
      setTimeout(() => {
        label?.classList.remove('status-fade-in');
        detail?.classList.remove('status-fade-in');
      }, 150);
    } else {
      bar!.dataset.state = state;
      if (state === 'idle' && labelText === '') {
        bar!.classList.add('agent-status-hidden');
      } else {
        bar!.classList.remove('agent-status-hidden');
        if (label)  label.textContent  = labelText;
        if (detail) detail.textContent = detailText;
      }
    }

    if (autoHideMs > 0) {
      hideTimer = setTimeout(() => setIdle(), autoHideMs);
    }
  }

  function setIdle() {
    if (hideTimer) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      pendingState = null;
    }
    applyState('idle', '');
  }

  // ── Bridge events ──────────────────────────────────────────────

  bridge.on('core/historyLoaded', () => setState('idle', '✨ Ready...', '', 0, true));
  bridge.on('core/chatSelected', () => setState('idle', '✨ Ready...', '', 0, true));

  bridge.on('core/reportStatus', (payload: any) => {
    const text = payload?.text || '';
    const dotColor = payload?.dotColor || '';
    const backgroundColor = payload?.backgroundColor || '';
    const autoHideMs = payload?.autoHideMs || 0;

    // Custom overrides from the model
    applyState('custom', text, '', autoHideMs, true);

    if (dotColor) {
      dot!.style.background = dotColor;
      dot!.style.animation = 'agent-status-pulse 1.4s ease-in-out infinite';
    }
    if (backgroundColor) {
      bar!.style.background = backgroundColor;
      bar!.style.borderBottomColor = backgroundColor + '40';
    }
  });

  bridge.on('core/stateChanged', (payload: any) => {
    const mode = payload?.state?.currentState || payload?.state || '';
    if (badge && mode) {
      badge.textContent = mode;
      badge.className = `status-mode-badge status-mode-${mode.toLowerCase()}`;
    }
  });

  const subBar = document.getElementById('subagent-status-bar') as HTMLElement | null;
  let subHideTimer: ReturnType<typeof setTimeout> | null = null;

  bridge.on('core/subAgentStateChanged', (payload: any) => {
    if (!subBar) return;
    const { label: subLabelTxt, state: subStateTxt, isRunning } = payload || {};
    if (!subLabelTxt && !subStateTxt) return;

    const sLabel = subBar.querySelector('.subagent-label') as HTMLElement | null;
    const sDetail = subBar.querySelector('.subagent-detail') as HTMLElement | null;

    if (subHideTimer) { clearTimeout(subHideTimer); subHideTimer = null; }
    subBar.classList.remove('subagent-status-hidden');
    subBar.dataset.running = isRunning ? 'true' : 'false';

    if (sLabel) sLabel.textContent = subLabelTxt || 'Subagent';
    if (sDetail) sDetail.textContent = subStateTxt || '';

    if (!isRunning) {
      subHideTimer = setTimeout(() => {
        subBar?.classList.add('subagent-status-hidden');
      }, 5000);
    }
  });

  return {
    setIdle,
    setProcessingOnFirstMessage: () => {},
  };
}
