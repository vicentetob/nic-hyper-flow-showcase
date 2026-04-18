/**
 * Sidebar Feature - Sidebar de chats
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, createEl } from '../../../../shared/dom/qs';

export interface SidebarServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
}

export function initSidebar(services: SidebarServices) {
  const { bridge, store } = services;
  const sidebar = $('sidebar');
  const menuButton = $('menu-button');
  const newChatButton = $('new-chat-button');
  const chatList = $('chat-list');

  if (!sidebar) {
    console.warn('[Sidebar] sidebar element not found');
    return;
  }

  // Criar overlay para fechar sidebar
  const overlay = createEl('div', { class: 'sidebar-overlay' });
  overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); backdrop-filter:blur(2px); z-index:250; display:none;";
  document.body.appendChild(overlay);

  function toggleSidebar() {
    if (!sidebar) return;
    const isActive = sidebar.classList.toggle("active");
    overlay.style.display = isActive ? "block" : "none";
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove("active");
    overlay.style.display = "none";
  }

  if (menuButton) {
    menuButton.addEventListener("click", toggleSidebar);
  }
  
  overlay.addEventListener("click", closeSidebar);

  if (newChatButton) {
    newChatButton.addEventListener("click", () => {
      bridge.post('ui/newChat');
      closeSidebar();
    });
  }

  function renderChatList(chats: any[], currentId: string | null) {
    if (!chatList) return;
    
    chatList.innerHTML = "";
    chats.forEach((chat) => {
      const li = createEl('li', { class: 'chat-item' });
      if (chat.chatId === currentId) li.classList.add("active");
      li.textContent = chat.title || "Conversa sem título";
      li.title = "Right click to edit or delete";
      
      li.onclick = () => {
        const state = store.getState();
        if (chat.chatId !== state.selectedChatId) {
          bridge.post('ui/switchChat', { chatId: chat.chatId });
        }
        closeSidebar();
      };

      li.oncontextmenu = (e: MouseEvent) => {
        e.preventDefault();
        bridge.post('ui/chatContextMenu', { 
          chatId: chat.chatId, 
          title: chat.title 
        });
      };

      chatList.appendChild(li);
    });
  }

  // Handler para atualizar lista quando chats mudarem
  bridge.on('core/chatList', (payload: any) => {
    if (payload.chats && payload.currentChatId !== undefined) {
      renderChatList(payload.chats, payload.currentChatId);
      store.setState({ selectedChatId: payload.currentChatId });
    }
  });

  return {
    toggleSidebar,
    closeSidebar,
    renderChatList,
    destroy: () => {
      overlay.remove();
    }
  };
}
