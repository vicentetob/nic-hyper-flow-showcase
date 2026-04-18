/**
 * Subscription Warning Feature - Alerta discreto quando a cota acaba
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { createEl } from '../../../../shared/dom/qs';

export interface SubscriptionWarningServices {
  bridge: ReturnType<typeof getBridge>;
}

export function initSubscriptionWarning(services: SubscriptionWarningServices) {
  
  const { bridge } = services;
  const chatFeed = document.getElementById('chat-feed');
  

  function showSubscriptionRequired(url: string | undefined) {
    
    
    // Remove warning anterior se existir
    const existing = document.querySelector('.subscription-warning-banner');
    if (existing) existing.remove();

    const warningDiv = createEl('div', { class: 'subscription-warning-banner' });
    
    warningDiv.innerHTML = `
      <div class="subscription-warning-content">
        <span class="subscription-warning-icon">💎</span>
        <span class="subscription-warning-text">Your free quota has been used up. Please subscribe to continue using Nic Assist.</span>
        <div class="subscription-warning-actions">
          ${url ? `<button class="subscription-warning-btn primary" id="sub-btn-now">Subscribe now</button>` : ''}
          <button class="subscription-warning-close">×</button>
        </div>
      </div>
    `;

    // Usa o #app como container principal para garantir position: absolute relativo à janela/app
    const appContainer = document.getElementById('app') || document.body;
    appContainer.appendChild(warningDiv);
    

    // Animação de entrada
    setTimeout(() => warningDiv.classList.add('show'), 10);

    const closeBtn = warningDiv.querySelector('.subscription-warning-close');
    const subBtn = warningDiv.querySelector('#sub-btn-now');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        warningDiv.classList.remove('show');
        setTimeout(() => warningDiv.remove(), 300);
      });
    }

    if (subBtn && url) {
      subBtn.addEventListener('click', () => {
        // Usa o bridge para abrir link externo de forma segura
        bridge.post('ui/openExternal', { url });
      });
    }
    
    // Auto-remove após 30 segundos se o usuário não interagir
    setTimeout(() => {
      if (document.body.contains(warningDiv)) {
        warningDiv.classList.remove('show');
        setTimeout(() => warningDiv.remove(), 300);
      }
    }, 30000);
  }

  // Permite disparo client-side (mesmo estilo do VisionWarning)
  (window as any).showSubscriptionRequired = showSubscriptionRequired;

  // Escuta o evento vindo da extensão
  bridge.on('core/subscriptionRequired', (payload: any) => {
    const url = payload?.upgradeUrl || payload?.upgrade_url;
    showSubscriptionRequired(url);
  });

  return {
    showSubscriptionRequired,
    destroy: () => {
      document.querySelectorAll('.subscription-warning-banner').forEach(el => el.remove());
      try {
        if ((window as any).showSubscriptionRequired === showSubscriptionRequired) {
          delete (window as any).showSubscriptionRequired;
        }
      } catch {}
    }
  };
}
