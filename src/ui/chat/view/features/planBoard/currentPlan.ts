import { $ } from '../../../../shared/dom/qs';
import { getBridge } from '../../../../shared/webview/bridge';

type Bridge = ReturnType<typeof getBridge>;

interface PlanStep {
    description: string;
    completed: boolean;
}

interface Plan {
    description: string;
    steps: PlanStep[];
    status: 'active' | 'completed' | 'aborted';
}

export function initCurrentPlanView(services: { bridge: Bridge; scrollToBottom?: (smooth?: boolean) => void }) {
    const { bridge, scrollToBottom } = services;
    const chatFeed = $('chat-feed');

    function renderPlan(plan: Plan | null) {
        if (!chatFeed) return;

        // Remove plano anterior se existir
        const existing = document.querySelector('.current-plan-container');
        if (existing) existing.remove();

        if (!plan) return;

        const container = document.createElement('div');
        const isCompact = true; // Sempre compacto - feedback do criador Tobias
        container.className = `current-plan-container ${plan.status} ${isCompact ? 'compact' : ''}`;
        
        const completedCount = plan.steps.filter(s => s.completed).length;
        const progress = Math.round((completedCount / plan.steps.length) * 100);

        container.innerHTML = `
            <div class="current-plan-header">
                <div class="current-plan-info">
                    <span class="current-plan-icon">📋</span>
                    <span class="current-plan-title">Plano de Ação</span>
                </div>
                <div class="current-plan-progress-badge">${progress}%</div>
            </div>
            <div class="current-plan-description">${plan.description}</div>
            <div class="current-plan-steps">
                ${plan.steps.map((step, idx) => `
                    <div class="current-plan-step ${step.completed ? 'done' : ''}">
                        <div class="step-checkbox">${step.completed ? '✓' : ''}</div>
                        <div class="step-content">
                            <span class="step-index">${idx + 1}.</span>
                            <span class="step-desc">${step.description}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="current-plan-footer">
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${progress}%"></div>
                </div>
            </div>
        `;

        chatFeed.appendChild(container);
        if (scrollToBottom) scrollToBottom(true);
    }

    // Listeners
    bridge.on('PLAN_UPDATED', (payload: { plan: Plan | null }) => {
        
        renderPlan(payload.plan);
    });
}
