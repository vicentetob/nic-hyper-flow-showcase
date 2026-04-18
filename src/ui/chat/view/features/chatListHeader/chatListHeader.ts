/**
 * Chat List Header Feature - Dropdown do header + new chat
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, createEl } from '../../../../shared/dom/qs';

export interface ChatListHeaderServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  onNewChat?: () => void;
  onClearUI?: () => void;
}

export function initChatListHeader(services: ChatListHeaderServices) {
  const { bridge, store, onNewChat, onClearUI } = services;
  const chatDropdown = $<HTMLSelectElement>('chat-dropdown');
  const newChatButtonHeader = $('new-chat-button-header');
  const settingsButton = $('settings-button');
  const connectPhoneButton = $('connect-phone-button');

  function updateChatDropdown(chats: any[], currentChatId: string | null) {
    if (!chatDropdown) return;

    chatDropdown.innerHTML = "";
    
    chats.forEach((chat) => {
      const option = createEl('option', { value: chat.chatId });
      option.textContent = chat.title || "Conversa sem título";
      if (chat.chatId === currentChatId) {
        option.selected = true;
      }
      chatDropdown.appendChild(option);
    });
  }

  // Chat dropdown - selecionar chat existente
  if (chatDropdown) {
    chatDropdown.addEventListener("change", (e: Event) => {
      const chatId = (e.target as HTMLSelectElement).value;
      if (chatId) {
        bridge.post('ui/switchChat', { chatId });
      }
    });
  }

  // Botão novo chat no header
  if (newChatButtonHeader) {
    newChatButtonHeader.addEventListener("click", () => {
      try {
        if ((newChatButtonHeader as HTMLElement).dataset.busy === '1') return;
        (newChatButtonHeader as HTMLElement).dataset.busy = '1';

        newChatButtonHeader.classList.add('is-busy');

        if (onClearUI) {
          onClearUI();
        }

        const chatFeed = $('chat-feed');
        if (chatFeed) {
          chatFeed.replaceChildren();
          const placeholder = createEl('div');
          placeholder.style.cssText = 'padding:40px; text-align:center; color:var(--text-secondary); font-style:italic;';
          placeholder.textContent = 'Creating new chat...';
          chatFeed.appendChild(placeholder);
        }

        store.setState({ isStreaming: false });

        requestAnimationFrame(() => {
          bridge.post('ui/newChat');
        });
      } finally {
        setTimeout(() => {
          (newChatButtonHeader as HTMLElement).dataset.busy = '0';
          newChatButtonHeader.classList.remove('is-busy');
        }, 800);
      }
    });
  }

  // Botão de configurações no header
  if (settingsButton) {
    settingsButton.addEventListener("click", () => {
      bridge.post('ui/openSettings');
    });
  }

  // Botão de conectar telefone no header
  if (connectPhoneButton) {
    connectPhoneButton.addEventListener("click", () => {
      bridge.post('ui/openRemoteControl');
    });
  }

  // Handler para atualizar dropdown quando lista de chats mudar
  bridge.on('core/chatList', (payload: any) => {
    if (payload.chats && payload.currentChatId !== undefined) {
      updateChatDropdown(payload.chats, payload.currentChatId);
      store.setState({ selectedChatId: payload.currentChatId });
    }
  });

  return {
    updateChatDropdown,
    destroy: () => {
      // Cleanup
    }
  };
}
