/**
 * Thinking Feature - Render de thinking bubbles
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, createEl } from '../../../../shared/dom/qs';
import { renderMarkdownInto } from '../../../../shared/utils/markdown';

export interface ThinkingServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  scrollToBottom?: (smooth?: boolean) => void;
}

export function initThinking(services: ThinkingServices) {
  const { bridge, store, scrollToBottom } = services;
  const chatFeed = $('chat-feed');

  if (!chatFeed) {
    console.warn('[Thinking] chat-feed element not found');
    return;
  }

  let isCreatingWaitingBubble = false;

  const defaultScrollToBottom = (smooth = false) => {
    if (scrollToBottom) {
      scrollToBottom(smooth);
    } else if (chatFeed) {
      chatFeed.scrollTo({
        top: chatFeed.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  function showWaitingBubble() {
    const existingBubble = document.getElementById("waiting-bubble");
    if (existingBubble) return;
    
    if (isCreatingWaitingBubble) return;
    
    const runningTools = document.querySelectorAll('.tool-card.running');
    if (runningTools.length > 0) return;
    
    isCreatingWaitingBubble = true;
    hideWaitingBubble();
    
    const bubble = createEl('div', { class: 'waiting-bubble', id: 'waiting-bubble' });
    bubble.innerHTML = `
      <span class="thinking-icon">💭</span>
      <span class="thinking-text">Thinking</span>
      <div class="dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    `;
    
    if (chatFeed) {
      // Simplesmente adicionar no final do chatFeed - isso garante que apareça depois de tudo
      chatFeed.appendChild(bubble);
      defaultScrollToBottom(true);
    }
    
    setTimeout(() => {
      isCreatingWaitingBubble = false;
    }, 50);
  }

  function hideWaitingBubble() {
    const bubble = document.getElementById("waiting-bubble");
    if (bubble) {
      bubble.style.animation = "fadeOutSlide 0.2s ease-out";
      setTimeout(() => {
        bubble.remove();
        isCreatingWaitingBubble = false;
      }, 200);
    } else {
      isCreatingWaitingBubble = false;
    }
  }

  function checkAndRemoveWaitingBubbleIfNeeded() {
    const bubble = document.getElementById("waiting-bubble");
    if (!bubble || !chatFeed) return;
    
    const bubbleIndex = Array.from(chatFeed.children).indexOf(bubble);
    if (bubbleIndex < 0) return;
    
    for (let i = bubbleIndex + 1; i < chatFeed.children.length; i++) {
      const nextEl = chatFeed.children[i];
      
      if (nextEl.classList.contains('tool-card')) {
        hideWaitingBubble();
        return;
      }
      
      if (nextEl.classList.contains('patch-widget-preview')) {
        hideWaitingBubble();
        return;
      }
      
      if (nextEl.classList.contains('message')) {
        const nextContent = nextEl.querySelector('.message-content') as HTMLElement;
        if (nextContent && nextContent.style.display !== 'none' && 
            nextContent.textContent && nextContent.textContent.trim().length > 0) {
          hideWaitingBubble();
          return;
        }
      }
    }
  }

  function clearAllThinkingBubbles() {
    document.querySelectorAll(".thinking-bubble").forEach((b) => b.remove());
  }

  function updateThinkingBubble(messageEl: HTMLElement, text: string, isStreaming: boolean) {
    let bubble = messageEl.querySelector(".thinking-bubble") as HTMLElement;
    
    if (!bubble) {
      if (!text && !isStreaming) return;

      bubble = createEl('div', { class: 'thinking-bubble' });
      bubble.innerHTML = `
        <div class="thinking-header">
          <span class="thinking-icon">💭</span>
          <span class="thinking-label">Pensamento</span>
          <span class="thinking-arrow">▼</span>
        </div>
        <div class="thinking-content"></div>
      `;
      
      // Inserir no início da mensagem para ficar antes do texto da resposta
      if (messageEl.firstChild) {
        messageEl.insertBefore(bubble, messageEl.firstChild);
      } else {
        messageEl.appendChild(bubble);
      }
      
      const header = bubble.querySelector(".thinking-header") as HTMLElement;
      if (header) {
        header.onclick = () => {
          bubble.classList.toggle("open");
        };
      }
    }

    const contentEl = bubble.querySelector(".thinking-content") as HTMLElement;
    const labelEl = bubble.querySelector(".thinking-label") as HTMLElement;
    const iconEl = bubble.querySelector(".thinking-icon") as HTMLElement;

    if (contentEl) {
      renderMarkdownInto(contentEl, text);
    }

    if (isStreaming && contentEl) {
      contentEl.scrollTop = contentEl.scrollHeight;
    }
    
    if (isStreaming) {
      if (labelEl) labelEl.textContent = "Pensando...";
      if (iconEl) iconEl.style.animation = "pulse 1s infinite";
      if (!bubble.classList.contains("open")) bubble.classList.add("open");
      bubble.style.display = "";
    } else {
      if (labelEl) labelEl.textContent = "Pensamento";
      if (iconEl) iconEl.style.animation = "";
      
      if (!text || text.trim().length === 0) {
        bubble.remove();
      }
    }
  }

  // Função auxiliar para reposicionar o thinking bubble no final
  function repositionWaitingBubble() {
    const bubble = document.getElementById("waiting-bubble");
    if (!chatFeed) return;
    
    if (bubble) {
      // Se a bolha existe, apenas mover para o final
      chatFeed.appendChild(bubble);
    } else {
      // Se a bolha não existe mas ainda está esperando, recriar
      const state = store.getState();
      const runningTools = document.querySelectorAll('.tool-card.running');
      if (state.isStreaming && runningTools.length === 0) {
        showWaitingBubble();
      }
    }
  }

  // Handlers
  bridge.on('core/assistantDelta', () => {
    hideWaitingBubble();
  });

  bridge.on('core/streamingFinished', () => {
    hideWaitingBubble();
  });

  bridge.on('core/toolStart', () => {
    // Não limpa mais as bolhas ao iniciar tool, para que persistam na mensagem
    // clearAllThinkingBubbles();
  });

  bridge.on('core/commandPreview', () => {
    setTimeout(() => {
      checkAndRemoveWaitingBubbleIfNeeded();
    }, 50);
  });

  bridge.on('core/toolResult', () => {
    setTimeout(() => {
      checkAndRemoveWaitingBubbleIfNeeded();
      
      const runningTools = document.querySelectorAll('.tool-card.running');
      if (runningTools.length === 0) {
        const bubble = document.getElementById("waiting-bubble");
        if (!bubble) {
          showWaitingBubble();
        } else {
          repositionWaitingBubble();
        }
      }
    }, 100);
  });

  // Reposicionar ou recriar o thinking bubble quando o histórico for carregado
  bridge.on('core/historyLoaded', () => {
    // Usar requestAnimationFrame para garantir que o DOM foi renderizado
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        repositionWaitingBubble();
      });
    });
  });

  return {
    showWaitingBubble,
    hideWaitingBubble,
    clearAllThinkingBubbles,
    updateThinkingBubble,
    checkAndRemoveWaitingBubbleIfNeeded,
    destroy: () => {
      clearAllThinkingBubbles();
      hideWaitingBubble();
    }
  };
}
