/**
 * Edit Modal Feature - Modal para editar mensagens (time travel)
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $ } from '../../../../shared/dom/qs';

export interface EditModalServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
}

export function initEditModal(services: EditModalServices) {
  const { bridge, store } = services;
  const modal = $('time-travel-modal');
  const confirmRewind = $('confirm-rewind');
  const cancelRewind = $('cancel-rewind');
  const userInput = $<HTMLTextAreaElement>('user-input');

  if (!modal || !confirmRewind || !cancelRewind) {
    console.warn('[EditModal] Required elements not found');
    return;
  }

  function openEditModal(msgId: string, currentText: string) {
    if (!modal) return;
    
    store.setState({ 
      pendingEditMsgId: msgId, 
      pendingEditText: currentText 
    });
    
    if (userInput) {
      userInput.value = currentText;
      userInput.focus();
    }
    
    modal.classList.remove("hidden");
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add("hidden");
    store.setState({ 
      pendingEditMsgId: null, 
      pendingEditText: null 
    });
    if (userInput) {
      userInput.value = "";
    }
  }

  if (confirmRewind) {
    confirmRewind.addEventListener("click", () => {
      const state = store.getState();
      if (state.pendingEditMsgId && state.pendingEditText) {
        bridge.post('ui/editMessage', {
          msgId: state.pendingEditMsgId,
          newText: userInput?.value || state.pendingEditText,
        });

        const chatFeed = $('chat-feed');
        if (chatFeed) {
          chatFeed.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-secondary); font-style:italic;">⏳ Viajando no tempo...</div>';
        }

        closeModal();
        if (userInput) {
          userInput.value = "";
        }
      }
    });
  }

  if (cancelRewind) {
    cancelRewind.addEventListener("click", closeModal);
  }

  // Exporta função para ser chamada por messages feature
  (window as any).openEditModal = openEditModal;

  return {
    openEditModal,
    closeModal,
    destroy: () => {
      // Cleanup
    }
  };
}
