import { $ } from '../../../../shared/dom/qs';
import { getBridge } from '../../../../shared/webview/bridge';

type Bridge = ReturnType<typeof getBridge>;

interface PlanStep {
  id: string;
  title: string;
  intent?: string;
  writes?: string[];
  dependsOn?: string[];
  status: 'pending' | 'active' | 'completed' | 'failed';
}

interface PlanPayload {
  goal: string;
  steps: PlanStep[];
}

export function initPlanBoard(services: { bridge: Bridge; scrollToBottom?: (smooth?: boolean) => void }) {
  const { bridge, scrollToBottom } = services;
  const chatFeed = $('chat-feed');

  function renderPlanBoard(payload: PlanPayload) {
    if (!chatFeed) return;

    // Remove plan board anterior se existir um em progresso
    const existing = document.querySelector('.plan-board:not(.final)');
    if (existing) existing.remove();

    const board = document.createElement('div');
    board.className = 'plan-board';
    
    board.innerHTML = `
      <div class="plan-header">
        <div class="plan-title-wrap">
          <span class="plan-icon">📊</span>
          <span class="plan-goal" title="${payload.goal}">${payload.goal}</span>
        </div>
        <span class="plan-badge">Hyper Flow DAG</span>
      </div>
      <div class="plan-steps">
        ${payload.steps.map((step, idx) => {
          const deps = step.dependsOn && step.dependsOn.length > 0 
            ? `<div class="plan-step-deps">🔗 ${step.dependsOn.join(', ')}</div>` 
            : '';
          
          const files = step.writes && step.writes.length > 0
            ? `<div class="plan-step-files">📝 ${step.writes.join(', ')}</div>`
            : '';

          return `
            <div id="step-${step.id}" class="plan-step ${step.status}">
              <div class="plan-step-main">
                <span class="plan-step-index">${idx + 1}</span>
                <div class="plan-step-content">
                  <div class="plan-step-title">${step.title}</div>
                  ${step.intent ? `<div class="plan-step-intent">${step.intent}</div>` : ''}
                  <div class="plan-step-meta">
                    ${deps}
                    ${files}
                  </div>
                </div>
                <span class="plan-step-status-icon">${getStatusIcon(step.status)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    chatFeed.appendChild(board);
    if (scrollToBottom) scrollToBottom(true);
  }

  function updateStep(payload: { stepId: string; status: PlanStep['status'] }) {
    const stepEl = document.getElementById(`step-${payload.stepId}`);
    if (stepEl) {
      stepEl.className = `plan-step ${payload.status}`;
      const iconEl = stepEl.querySelector('.plan-step-status-icon');
      if (iconEl) iconEl.textContent = getStatusIcon(payload.status);

      // Se todas as etapas estiverem concluídas, marca o board como final
      const board = stepEl.closest('.plan-board');
      if (board) {
        const steps = Array.from(board.querySelectorAll('.plan-step'));
        const allDone = steps.every(el => el.classList.contains('completed'));
        if (allDone) {
          board.classList.add('final');
          const badge = board.querySelector('.plan-badge');
          if (badge) {
            badge.textContent = '✓ Executado';
            badge.classList.add('completed');
          }
        }
      }
    }
  }

  function getStatusIcon(status: PlanStep['status']) {
    switch (status) {
      case 'completed': return '✅';
      case 'active': return '⚡';
      case 'failed': return '❌';
      default: return '○';
    }
  }

  // Listeners
  bridge.on('core/planStarted', (payload: PlanPayload) => {
    renderPlanBoard(payload);
  });

  bridge.on('core/planStepUpdated', (payload: { stepId: string; status: PlanStep['status'] }) => {
    updateStep(payload);
  });

  return {
    renderPlanBoard,
    updateStep
  };
}
