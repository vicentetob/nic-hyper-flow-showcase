/**
 * Attachments Feature - Gerenciamento de anexos
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';
import { $, createEl } from '../../../../shared/dom/qs';

/**
 * Obtém a URL da imagem de um attachment
 * Suporta: data URLs (Base64), webview URIs, ou fallback para storagePath
 * Para imagens grandes sem URL imediata, retorna um placeholder
 */
function getAttachmentImageUrl(attachment: any): string {
  if (!attachment || attachment.type !== 'image') {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMyRjJGMkYiLz48cGF0aCBkPSJNNjUgNDVINTVWMzVINDU0NVY1NUg1NVY2NUg2NVY1NUg3NVY0NUg2NVY0NVpNNTAgNjBDNDQuNSA2MCA0MCA1NS41IDQwIDUwQzQwIDQ0LjUgNDQuNSA0MCA1MCA0MEM1NSA0MCA2MCA0NC41IDYwIDUwQzYwIDU1LjUgNTUgNjAgNTAgNjBaIiBmaWxsPSIjODA4MDgwIi8+PC9zdmc+'; // Placeholder cinza
  }

  // 1. Se tem data URL (Base64) - para imagens pequenas
  if (attachment.data && typeof attachment.data === 'string') {
    return attachment.data;
  }

  // 2. Se tem webviewUri (já convertida pela extensão)
  if (attachment.webviewUri && typeof attachment.webviewUri === 'string') {
    return attachment.webviewUri;
  }

  // 3. Se tem storagePath mas não tem webviewUri (extensão não converteu)
  if (attachment.storagePath) {
    console.warn('[Attachments] Attachment has storagePath but no webviewUri, using placeholder:', attachment.storagePath);
  }

  // 4. Placeholder para imagens não carregáveis
  return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMyRjJGMkYiLz48cGF0aCBkPSJNNjUgNDVINTVWMzVINDU0NVY1NUg1NVY2NUg2NVY1NUg3NVY0NUg2NVY0NVpNNTAgNjBDNDQuNSA2MCA0MCA1NS41IDQwIDUwQzQwIDQ0LjUgNDQuNSA0MCA1MCA0MEM1NSA0MCA2MCA0NC41IDYwIDUwQzYwIDU1LjUgNTUgNjAgNTAgNjBaIiBmaWxsPSIjODA4MDgwIi8+PC9zdmc+';
}

export interface AttachmentsServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
  onVisionWarning?: () => void;
}

export function initAttachments(services: AttachmentsServices) {
  const { bridge, store, onVisionWarning } = services;
  const attachmentPreview = $('attachment-preview-container');
  const fileInput = $<HTMLInputElement>('file-input');
  const attachButton = $('attach-button');
  const userInput = $<HTMLTextAreaElement>('user-input');

  if (!attachmentPreview) {
    console.warn('[Attachments] attachment-preview-container not found');
    return;
  }

  function clearAttachments() {
    store.setState({ attachmentsDraft: [] });
    if (!attachmentPreview) return;
    attachmentPreview.innerHTML = "";
    attachmentPreview.classList.add("hidden");
  }

  function addAttachment(file: File) {
    const state = store.getState();
    
    
    if (onVisionWarning) {
      onVisionWarning();
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const attachment = {
        type: "image",
        mimeType: file.type || "image/png",
        data: (e.target as FileReader).result as string,
        name: file.name || "image",
      };
      
      const currentAttachments = state.attachmentsDraft || [];
      store.setState({ attachmentsDraft: [...currentAttachments, attachment] });
      // NOTA: renderAttachmentPreview é chamado automaticamente pelo subscribe do store
    };
    reader.readAsDataURL(file);
  }

  function renderAttachmentPreview(attachment: any) {
    if (!attachmentPreview) return;

    const imageUrl = getAttachmentImageUrl(attachment);
    attachmentPreview.classList.remove("hidden");

    const div = createEl('div', { class: 'attachment-preview' });
    div.innerHTML = `
      <img src="${imageUrl}" />
      <button class="remove-btn" title="Remover">×</button>
    `;

    const btn = div.querySelector(".remove-btn") as HTMLButtonElement;
    if (btn) {
      btn.onclick = () => {
        const state = store.getState();
        const currentAttachments = state.attachmentsDraft || [];
        const filtered = currentAttachments.filter((a: any) => a !== attachment);
        store.setState({ attachmentsDraft: filtered });
        div.remove();
        if (filtered.length === 0) {
          attachmentPreview.classList.add("hidden");
        }
      };
    }

    attachmentPreview.appendChild(div);
  }

  // File input handler
  if (attachButton && fileInput) {
    attachButton.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        Array.from(files).forEach((file) => {
          if (file.type.startsWith("image/")) {
            addAttachment(file);
          }
        });
      }
      (e.target as HTMLInputElement).value = "";
    });
  }

  // Paste handler no textarea
  if (userInput) {
    userInput.addEventListener("paste", (e: ClipboardEvent) => {
      const state = store.getState();
      

      const dt = e.clipboardData;
      if (!dt || !dt.items) {
        
        return;
      }

      
      
      Array.from(dt.items).forEach((item) => {
        
        if (item && item.type && item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          
          if (file) addAttachment(file);
        }
      });
    });
  }

  // Sincroniza preview com store
  store.subscribe((state) => {
    if (!attachmentPreview) return;
    
    const attachments = state.attachmentsDraft || [];
    if (attachments.length === 0) {
      attachmentPreview.innerHTML = "";
      attachmentPreview.classList.add("hidden");
    } else {
      // Renderiza todos os anexos
      attachmentPreview.innerHTML = "";
      attachments.forEach((att: any) => {
        renderAttachmentPreview(att);
      });
    }
  });

  return {
    addAttachment,
    clearAttachments,
    destroy: () => {
      // Cleanup
    }
  };
}
