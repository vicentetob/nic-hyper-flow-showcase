/**
 * Patch Widget - Widget independente para exibir previews de comandos PATCH/REPLACE/CREATE
 */

(function () {
  "use strict";

  // Estado global do widget (gerenciado por previewId)
  const stateMap = new Map(); // previewId -> { lastRenderAt, scheduled, latestPayload, preEl, codeEl, ... }
  const previewsMap = new Map(); // previewId -> { el, headerEl, bodyEl }
  
  // Instância única do vscode API (acquireVsCodeApi só pode ser chamado uma vez por webview)
  let globalVscodeInstance = null;
  
  // Tenta obter a instância do vscode do bridge singleton se disponível
  function getVscodeInstance() {
    // Primeiro tenta usar o bridge singleton se já estiver disponível
    if (window.__bridge && typeof window.__bridge.getVscode === 'function') {
      const vscodeFromBridge = window.__bridge.getVscode();
      if (vscodeFromBridge) {
        
        return vscodeFromBridge;
      }
    }
    
    // Se não, usa nossa instância global
    if (!globalVscodeInstance) {
      globalVscodeInstance = acquireVsCodeApi();
      
    }
    
    return globalVscodeInstance;
  }

  function isLikelyUnifiedDiff(text) {
    const s = String(text || "");
    const isDiff = /\n@@\s*-/m.test(s) || /^@@\s*-/m.test(s) || s.includes('@@ -') || s.includes('+++') || s.includes('---');
    
    return isDiff;
  }

  function extractFirstChangePositionFromUnifiedDiff(diffText) {
    
    const lines = String(diffText || "").split(/\r?\n/);
    

    let currentNewLine = 0;
    let hunkNewStart = 0;
    let hunkOldStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = String(rawLine ?? "");
      
      if (i < 10) { // Log apenas as primeiras 10 linhas para debug
        
      }

      // Ignore file headers / meta (igual ao DiffDecorationManager)
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("\\")) continue;
      if (line.startsWith("===")) continue;

      if (line.startsWith("@@")) {
        
        // Usar a mesma regex do DiffDecorationManager que sabemos que funciona
        const match = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
        if (match) {
          hunkOldStart = parseInt(match[1], 10) || 0;
          hunkNewStart = parseInt(match[3], 10) || 0;
          currentNewLine = hunkNewStart;
          
        }
        continue;
      }

      if (!currentNewLine) continue;

      const firstChar = line[0];
      const content = line.slice(1);

      // Prioridade 1: Linha adicionada (+)
      if (firstChar === "+") {
        const nonWsIdx = content.search(/\S/);
        const col = nonWsIdx >= 0 ? nonWsIdx + 1 : 1;
        
        return { line: currentNewLine, column: col };
      }
      
      // Prioridade 2: Linha removida (-) - vai para a linha onde seria inserida
      if (firstChar === "-") {
        const nonWsIdx = content.search(/\S/);
        const col = nonWsIdx >= 0 ? nonWsIdx + 1 : 1;
        
        return { line: currentNewLine, column: col };
      }

      // Linha inalterada (espaço)
      if (firstChar === " ") {
        currentNewLine += 1;
      }
    }

    
    // Fallback: início do hunk é melhor que linha 1
    if (hunkNewStart > 0) {
      
      return { line: hunkNewStart, column: 1 };
    }
    
    
    return null;
  }

  // Gera HTML com <span> por linha, contendo data-line/data-column.
  // A posição é do lado "novo" do diff.
  function buildInteractiveDiffHtml(diffText, lang) {
    const lines = String(diffText || "").split(/\r?\n/);

    let currentNewLine = 0;
    let currentOldLine = 0;
    let hunkNewStart = 0;
    let hunkOldStart = 0;

    const out = [];

    for (const rawLine of lines) {
      const line = String(rawLine ?? "");
      const firstChar = line[0] || " ";

      if (line.startsWith("@@")) {
        const m = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
        if (m) {
          hunkOldStart = parseInt(m[1], 10) || 0;
          hunkNewStart = parseInt(m[3], 10) || 0;
          currentOldLine = hunkOldStart;
          currentNewLine = hunkNewStart;
        }
        out.push(
          `<span class="pw-diff-line pw-diff-hunk" data-line="${currentNewLine || 1}" data-column="1">${escapeHtml(
            line
          )}</span>`
        );
        continue;
      }

      // IMPORTANTE: Se não começou o hunk ainda, mas a linha parece um diff (+ ou -)
      // forçamos o início do processamento para não cair no bloco "meta" incolor
      if (!currentNewLine && (firstChar === '+' || firstChar === '-')) {
        currentNewLine = 1; 
      }

      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("===") || line.startsWith("\\")) {
        out.push(
          `<span class="pw-diff-line pw-diff-meta" data-line="${currentNewLine || 1}" data-column="1">${escapeHtml(
            line
          )}</span>`
        );
        continue;
      }

      if (!currentNewLine) {
        out.push(`<span class="pw-diff-line pw-diff-meta" data-line="1" data-column="1">${escapeHtml(line)}</span>`);
        continue;
      }

      const content = line.slice(1);
      const nonWsIdx = content.search(/\S/);
      const column = nonWsIdx >= 0 ? nonWsIdx + 1 : 1;

      let css = "pw-diff-ctx";
      let dataLine = currentNewLine;

      if (firstChar === "+") {
        css = "pw-diff-add";
        dataLine = currentNewLine;
        currentNewLine += 1;
      } else if (firstChar === "-") {
        css = "pw-diff-del";
        dataLine = currentNewLine;
        currentOldLine += 1;
      } else {
        css = "pw-diff-ctx";
        dataLine = currentNewLine;
        currentOldLine += 1;
        currentNewLine += 1;
      }

      const highlightedContent = applySyntaxHighlight(content, lang);

      out.push(
        `<span class="pw-diff-line ${css}" data-line="${dataLine}" data-column="${column}"><span class="pw-diff-prefix">${escapeHtml(firstChar)}</span>${highlightedContent}</span>`
      );
    }

    return out.join("\n");
  }

  /**
   * Extrai path, linha e coluna de um card e abre o arquivo
   */
  function openFromCardAnchor(cardEl) {
    
    const p = cardEl?.getAttribute?.("data-path");
    
    if (!p) {
      
      return;
    }

    const lineAttr = cardEl.getAttribute("data-line");
    const colAttr = cardEl.getAttribute("data-column");
    

    const line = lineAttr ? parseInt(lineAttr, 10) : undefined;
    const column = colAttr ? parseInt(colAttr, 10) : undefined;

    // postOpenFile será definida dentro de createPatchWidget e passada como closure
    
    if (typeof window.__patchWidgetPostOpenFile === 'function') {
      
      window.__patchWidgetPostOpenFile(p, line, column);
    } else {
      
    }
  }

  /**
   * Anexa listeners de navegação (clique e teclado) a um header de preview
   */
  function attachHeaderNavigationListeners(headerEl, cardEl) {
    // Remove listeners antigos primeiro (usando removeEventListener seria ideal,
    // mas como não temos referência, vamos adicionar novos - o browser gerencia múltiplos)
    
    // Clique no HEADER: abre no ponto onde o patch começa
    headerEl.addEventListener("click", (ev) => {
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel).trim()) return;
      openFromCardAnchor(cardEl);
    });

    // Enter/Espaço no header também abre
    headerEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openFromCardAnchor(cardEl);
      }
    });
    
    return headerEl;
  }

  /**
   * Inicializa o widget e retorna as funções públicas
   */
  function createPatchWidget(config) {
    const { containerEl, onScrollToBottom, scrollToBottomFn } = config || {};

    if (!containerEl) {
      
      return null;
    }

    function postOpenFile(path, line, column) {
      
      try {
        // Obtém a instância do vscode (do bridge singleton ou cria uma nova)
        const vscode = getVscodeInstance();
        
        const payload = { path: String(path) };
        if (Number.isFinite(line) && line > 0) payload.line = line;
        if (Number.isFinite(column) && column > 0) payload.column = column;
        
        vscode.postMessage({ type: "ui/openFile", payload });
        
      } catch (error) {
        
      }
    }

    // Expõe postOpenFile para openFromCardAnchor
    window.__patchWidgetPostOpenFile = postOpenFile;

    /**
     * Renderiza ou atualiza um preview de comando
     * @param {Object} payload - Dados do preview
     * @param {HTMLElement} [targetContainer] - Container opcional para renderizar (usado durante renderHistory)
     */
    function renderPreview(payload, targetContainer) {
      try {
        const { id, commandType, path, content, isComplete } = payload || {};

        if (!id) {
          console.warn("[PatchWidget] renderPreview: id é obrigatório. Payload recebido:", payload);
          return;
        }

        const container = targetContainer || containerEl;

        // ✅ VERIFICAÇÃO CRÍTICA: Se já existe um preview
        if (previewsMap.has(id)) {
          const existingPreview = previewsMap.get(id);
          
          // Se o elemento existe
          if (existingPreview && existingPreview.el) {
             // Se passamos um container explícito (ex: fragmento de histórico) e o elemento não está nele, movemos!
             if (container && existingPreview.el.parentElement !== container) {
                 container.appendChild(existingPreview.el);
             }
             
             if (existingPreview.el.isConnected || targetContainer || existingPreview.el.parentElement) {
                // Está conectado ou acabou de ser movido/anexado
             } else {
                // Desconectado e sem container destino - limpa para recriar
                previewsMap.delete(id);
                stateMap.delete(id);
             }
          } else {
            previewsMap.delete(id);
            stateMap.delete(id);
          }
        }

        // Estado interno por preview
        let prevState = stateMap.get(id);
        if (!prevState) {
          prevState = {
            lastRenderAt: 0,
            scheduled: false,
            latestPayload: null,
            preEl: null,
            codeEl: null,
            lastLen: 0,
            lastForceAt: 0,
            lastHighlightAt: 0,
            lastHighlightedLen: 0,
          };
          stateMap.set(id, prevState);
        }

        prevState.latestPayload = { id, commandType, path, content, isComplete };

        const now = Date.now();
        const minIntervalMs = 50; // ~20fps
        const minCharsDelta = 32;
        const forceRenderEveryMs = 150;

        // Se já está completo e já existe conectado, não atualiza mais
        if (previewsMap.has(id)) {
          const preview = previewsMap.get(id);
          if (preview && preview.el && (preview.el.isConnected || targetContainer)) {
            if (preview.el.classList.contains("complete") && isComplete) {
              // Preview já completo e conectado - não precisa atualizar
              return;
            }
          }
        }

        // Cria novo preview se não existir
        const isNewPreview = !previewsMap.has(id);
        if (isNewPreview) {
          const div = document.createElement("div");
          div.className = "patch-widget-preview";
          div.setAttribute("data-preview-id", id);
          div.setAttribute("data-complete", isComplete ? "true" : "false");
          if (isComplete) div.classList.add("complete");

          // Metadata para navegação
          if (path) div.setAttribute("data-path", String(path));

          const header = document.createElement("div");
          header.className = "patch-widget-header";
          header.setAttribute("role", "button");
          header.setAttribute("tabindex", "0");
          header.title = "Open file at patch location";

          const body = document.createElement("div");
          body.className = "patch-widget-body";

          // Estrutura fixa para permitir atualização incremental sem reflow pesado
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          pre.appendChild(code);
          body.appendChild(pre);

          div.appendChild(header);
          div.appendChild(body);
          container.appendChild(div);

          // ✅ Clique no HEADER: abre SEMPRE no ponto onde o patch começa (data-line/data-column do card)
          // Usa a função centralizada para anexar listeners
          attachHeaderNavigationListeners(header, div);

          // ✅ Clique em LINHA do DIFF: abre naquela linha/coluna
          // (e evita cair no clique do card/qualquer outro)
          body.addEventListener("click", (ev) => {
            const sel = window.getSelection && window.getSelection();
            if (sel && String(sel).trim()) return;

            const p = div.getAttribute("data-path");
            if (!p) return;

            const lineTarget = ev?.target?.closest?.(".pw-diff-line");
            if (!lineTarget) return;

            ev.preventDefault();
            ev.stopPropagation();

            const lineAttr = lineTarget.getAttribute("data-line");
            const colAttr = lineTarget.getAttribute("data-column");
            const line = lineAttr ? parseInt(lineAttr, 10) : undefined;
            const column = colAttr ? parseInt(colAttr, 10) : undefined;

            postOpenFile(p, line, column);
          });

          previewsMap.set(id, { el: div, headerEl: header, bodyEl: body });

          // guarda refs no state
          prevState.preEl = pre;
          prevState.codeEl = code;
          stateMap.set(id, prevState);

          requestAnimationFrame(() => {
            if (scrollToBottomFn) scrollToBottomFn(true);
            else if (onScrollToBottom) onScrollToBottom();
          });
        }

        const preview = previewsMap.get(id);
        if (!preview) return;

        // Atualiza metadata de navegação em todo render
        if (preview.el) {
          if (path) {
            preview.el.setAttribute("data-path", String(path));
            
          }

          // Só calcula âncora se for diff; se não for diff, mantém a âncora anterior (se houver)
          const text = String(content || "");
          
          
          if (isLikelyUnifiedDiff(text)) {
            
            const pos = extractFirstChangePositionFromUnifiedDiff(text);
            if (pos && pos.line) {
              preview.el.setAttribute("data-line", String(pos.line));
              preview.el.setAttribute("data-column", String(pos.column || 1));
              
            } else {
              // fallback mínimo
              preview.el.setAttribute("data-line", "1");
              preview.el.setAttribute("data-column", "1");
              
            }
          } else {
            
            // Se não tiver âncora definida ainda, define 1:1 (pra header click funcionar sempre)
            if (!preview.el.getAttribute("data-line")) {
              preview.el.setAttribute("data-line", "1");
              
            }
            if (!preview.el.getAttribute("data-column")) {
              preview.el.setAttribute("data-column", "1");
              
            }
          }
        }

        // throttle render
        const nextLen = String(content || "").length;
        const grewBy = Math.max(0, nextLen - (prevState.lastLen || 0));
        const timeSinceRender = now - (prevState.lastRenderAt || 0);
        const timeSinceForce = now - (prevState.lastForceAt || 0);

        const shouldRenderNow =
          isComplete || grewBy >= minCharsDelta || timeSinceForce >= forceRenderEveryMs || timeSinceRender >= minIntervalMs;

        if (!shouldRenderNow) {
          if (!prevState.scheduled) {
            prevState.scheduled = true;
            requestAnimationFrame(() => {
              prevState.scheduled = false;
              renderPreview(prevState.latestPayload);
            });
          }
          return;
        }

        prevState.lastRenderAt = now;
        if (timeSinceForce >= forceRenderEveryMs) prevState.lastForceAt = now;
        prevState.lastLen = nextLen;

        // Header (sempre compacto)
        const escapedPath = path ? escapeHtml(String(path)) : "";
        const isCurrentlyComplete = preview.el.classList.contains("complete");
        const isError = preview.el.classList.contains("error");
        
        // Formatação do nome do comando para visualização amigável
        let displayCommandType = String(commandType || "PATCH").toUpperCase();
        if (displayCommandType === "APPLY_PATCH_BATCH") {
          displayCommandType = "PATCH BATCH";
        } else {
          displayCommandType = displayCommandType.replace(/_/g, " ");
        }
        
        let statusText = "✍️ writing...";
        if (isCurrentlyComplete || isComplete) {
          if (isError) statusText = "❌ error";
          else if (isCurrentlyComplete) statusText = "✅ completed";
          else statusText = "⌛ executing...";
        }

        const currentHeaderContent = preview.headerEl.innerHTML;
        const newHeaderContent = `
          <span class="patch-widget-icon">${getCommandIcon(commandType)}</span>
          <span class="patch-widget-type">${escapeHtml(displayCommandType)}</span>
          ${escapedPath ? `<span class="patch-widget-path" title="${escapedPath}">${escapedPath}</span>` : ""}
          <span class="patch-widget-status">${statusText}</span>
          <button class="patch-widget-toggle" title="Expandir/Recolher preview"></button>
        `;

        if (currentHeaderContent !== newHeaderContent) {
          preview.headerEl.innerHTML = newHeaderContent;
          
          // Re-adiciona listener do botão de toggle após re-renderizar o header
          const toggleBtn = preview.headerEl.querySelector('.patch-widget-toggle');
          if (toggleBtn) {
            // Adiciona listener ao botão de toggle
            toggleBtn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation(); // Impede de abrir o arquivo ao clicar no toggle
              preview.el.classList.toggle('expanded');
            });
          }
          
          // Re-attacha listeners de navegação no header
          attachHeaderNavigationListeners(preview.headerEl, preview.el);
        }

        // Limite de preview (ring buffer): durante streaming mant 00e9m apenas o final do texto.
        // Isso evita reflow gigante e evita tamb 00e9m a instabilidade visual de "head+tail" mudando a cada delta.
        const maxPreviewChars = 120_000;
        let displayContent = String(content || "");
        if (displayContent.length > maxPreviewChars) {
          displayContent = displayContent.slice(-maxPreviewChars);
        }

        const lang = getLanguageFromPath(path) || "text";
        const codeEl = prevState.codeEl || preview.bodyEl.querySelector("pre > code");
        if (!codeEl) return;

        // Otimização: muda classe sem reflow desnecessário
        if (!codeEl.className || !codeEl.className.includes(`language-${lang}`)) {
          codeEl.className = `language-${lang}`;
        }

        const currentTextContent = codeEl.textContent || "";
        const contentChanged = displayContent.trim() !== currentTextContent.trim();

        if (!displayContent.trim()) {
          if (currentTextContent !== "Generating code...") codeEl.textContent = "Generating code...";
          return;
        }

        // --- Streaming ---
        // Regra: durante streaming renderiza APENAS texto (sem syntax highlight / sem diff interativo)
        // para manter performance e evitar inconsist eancia visual. O card continua aparecendo imediatamente.
        if (!isComplete) {
          if (!contentChanged) return;

          const prevContentLength = currentTextContent.length;
          const newContentLength = displayContent.length;
          const contentGrew = newContentLength > prevContentLength;
          const grewByLocal = Math.max(0, newContentLength - prevContentLength);
          const isFirstRender = prevContentLength === 0 || currentTextContent === "Generating code...";

          // Evita HTML antigo (highlight/diff) durante stream
          codeEl.className = "language-text";
          codeEl.textContent = displayContent;

          // Auto-scroll (stick-to-bottom): segue o streaming somente quando o usu e1rio est e1 no fundo.
          // Isso evita "briga" quando o usu e1rio sobe para ler.
          if (isNewPreview || isFirstRender || (contentGrew && grewByLocal > 5)) {
            requestAnimationFrame(() => {
              if (isNewPreview || isFirstRender) {
                if (scrollToBottomFn) scrollToBottomFn(true);
                else if (onScrollToBottom) onScrollToBottom();
              }

              const thresholdPx = 200; // Aumentado de 80 para 200px para evitar que a rolagem perca durante streaming rápido
              const bodyScrollHeight = preview.bodyEl.scrollHeight;
              const bodyScrollTop = preview.bodyEl.scrollTop;
              const bodyClientHeight = preview.bodyEl.clientHeight;
              const distanceFromBottom = bodyScrollHeight - bodyScrollTop - bodyClientHeight;
              const shouldStick = isFirstRender || distanceFromBottom <= thresholdPx;

              if (shouldStick) {
                // scrollTop atualizado ap f3s o layout finalizar
                preview.bodyEl.scrollTop = preview.bodyEl.scrollHeight;
                if (isNewPreview && scrollToBottomFn) scrollToBottomFn(true);
              }
            });
          }

          return;
        }

        // --- Completo ---
        if (contentChanged || !codeEl.innerHTML || codeEl.innerHTML === codeEl.textContent) {
          let contentToHighlight = displayContent;

          // decodifica se vier escapado
          if (
            contentToHighlight.includes("&quot;") ||
            contentToHighlight.includes("&#39;") ||
            contentToHighlight.includes("&lt;") ||
            contentToHighlight.includes("&gt;")
          ) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = contentToHighlight;
            contentToHighlight = tempDiv.textContent || tempDiv.innerText || contentToHighlight;
          }

          const isDiff = isLikelyUnifiedDiff(contentToHighlight);
          if (isDiff) {
            codeEl.className = "language-diff";
            codeEl.innerHTML = buildInteractiveDiffHtml(contentToHighlight, lang);
          } else {
            const highlightedCode = applySyntaxHighlight(contentToHighlight, lang);
            codeEl.innerHTML = highlightedCode;
          }

          requestAnimationFrame(() => {
            preview.bodyEl.scrollTop = preview.bodyEl.scrollHeight;
            if (scrollToBottomFn) scrollToBottomFn(true);
            else if (onScrollToBottom) onScrollToBottom();
          });
        }
      } catch (error) {
        
      }
    }

    /**
     * Marca um preview como concluído (OK/FAIL) — usado quando a tool termina.
     */
    function markComplete(id, ok) {
      try {
        const preview = previewsMap.get(id);
        if (!preview || !preview.el) return;

        preview.el.classList.add("complete");
        preview.el.setAttribute("data-complete", "true");
        if (ok === false) {
          preview.el.classList.add("error");
          preview.el.setAttribute("data-ok", "false");
        } else {
          preview.el.classList.remove("error");
          preview.el.setAttribute("data-ok", "true");
        }

        const headerStatusEl = preview.headerEl?.querySelector?.(".patch-widget-status");
        if (headerStatusEl) {
          headerStatusEl.textContent = ok === false ? "❌ erro" : "✅ concluído";
        }

        requestAnimationFrame(() => {
          preview.bodyEl.scrollTop = preview.bodyEl.scrollHeight;
          if (scrollToBottomFn) scrollToBottomFn(true);
          else if (onScrollToBottom) onScrollToBottom();
        });
      } catch (err) {
        
      }
    }

    function removePreview(id) {
      const preview = previewsMap.get(id);
      if (preview && preview.el) preview.el.remove();
      previewsMap.delete(id);
      stateMap.delete(id);
    }

    function clearAll() {
      previewsMap.forEach((preview) => {
        if (preview.el) preview.el.remove();
      });
      previewsMap.clear();
      stateMap.clear();
    }

    function preservePreviews() {
      const preserved = [];
      previewsMap.forEach((preview, id) => {
        if (preview && preview.el && preview.el.parentNode) {
          preview.el.parentNode.removeChild(preview.el);
          preserved.push({ id, preview });
        }
      });
      return preserved;
    }

    function restorePreviews(preserved) {
      if (!preserved || !Array.isArray(preserved)) return;
      preserved.forEach(({ id, preview }) => {
        if (preview && preview.el) {
          containerEl.appendChild(preview.el);
          previewsMap.set(id, preview);
        }
      });
    }

    function getAllPreviews() {
      return Array.from(previewsMap.keys());
    }

    return {
      renderPreview,
      markComplete,
      removePreview,
      clearAll,
      preservePreviews,
      restorePreviews,
      getAllPreviews,
    };
  }

  // Funções auxiliares privadas

  function getCommandIcon(commandType) {
    const icons = {
      PATCH: "🔧",
      REPLACE: "🔄",
      CREATE: "✨",
      DELETE: "🗑️",
      RANGE_PATCH: "📝",
      CONTEXT_PATCH: "🎯",
      APPLY_PATCH_BATCH: "📦",
    };
    return icons[commandType] || "📄";
  }

  function getLanguageFromPath(path) {
    if (!path) return "text";
    const ext = path.split(".").pop().toLowerCase();
    const langMap = {
      js: "javascript",
      ts: "typescript",
      tsx: "typescript",
      jsx: "javascript",
      py: "python",
      rb: "ruby",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      go: "go",
      rs: "rust",
      php: "php",
      html: "html",
      css: "css",
      json: "json",
      xml: "xml",
      md: "markdown",
      sh: "bash",
      yaml: "yaml",
      yml: "yaml",
      dart: "dart",
    };
    return langMap[ext] || "text";
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Syntax highlighting básico estilo VSCode
  function applySyntaxHighlight(code, lang) {
    if (!code || typeof code !== "string") return "";

    let cleanCode = code;
    if (code.includes("&quot;") || code.includes("&#39;") || code.includes("&lt;") || code.includes("&gt;")) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = code;
      cleanCode = tempDiv.textContent || tempDiv.innerText || code;
    }

    let escaped = escapeHtml(cleanCode);

    const keywords = {
      dart: [
        "import",
        "export",
        "class",
        "extends",
        "implements",
        "abstract",
        "final",
        "const",
        "var",
        "void",
        "static",
        "async",
        "await",
        "return",
        "if",
        "else",
        "for",
        "while",
        "switch",
        "case",
        "break",
        "continue",
        "try",
        "catch",
        "throw",
        "new",
        "this",
        "super",
        "true",
        "false",
        "null",
        "late",
        "required",
        "override",
        "Widget",
        "State",
        "BuildContext",
        "setState",
      ],
      typescript: [
        "import",
        "export",
        "from",
        "class",
        "extends",
        "implements",
        "interface",
        "type",
        "const",
        "let",
        "var",
        "function",
        "async",
        "await",
        "return",
        "if",
        "else",
        "for",
        "while",
        "switch",
        "case",
        "break",
        "continue",
        "try",
        "catch",
        "throw",
        "new",
        "this",
        "super",
        "true",
        "false",
        "null",
        "undefined",
        "public",
        "private",
        "protected",
        "static",
        "readonly",
      ],
      javascript: [
        "import",
        "export",
        "from",
        "class",
        "extends",
        "const",
        "let",
        "var",
        "function",
        "async",
        "await",
        "return",
        "if",
        "else",
        "for",
        "while",
        "switch",
        "case",
        "break",
        "continue",
        "try",
        "catch",
        "throw",
        "new",
        "this",
        "super",
        "true",
        "false",
        "null",
        "undefined",
      ],
      python: [
        "import",
        "from",
        "class",
        "def",
        "async",
        "await",
        "return",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "try",
        "except",
        "raise",
        "with",
        "as",
        "True",
        "False",
        "None",
        "self",
        "lambda",
        "pass",
        "break",
        "continue",
        "and",
        "or",
        "not",
        "in",
        "is",
      ],
    };

    const types = {
      dart: ["String", "int", "double", "bool", "List", "Map", "Set", "Future", "Stream", "dynamic", "Object", "Function", "Iterable", "num"],
      typescript: ["string", "number", "boolean", "any", "void", "never", "unknown", "object", "Array", "Promise", "Record", "Partial", "Required"],
      javascript: ["Array", "Object", "String", "Number", "Boolean", "Promise", "Map", "Set"],
      python: ["str", "int", "float", "bool", "list", "dict", "set", "tuple", "None"],
    };

    const langKeywords = keywords[lang] || keywords.typescript;
    const langTypes = types[lang] || types.typescript;

    // Strings
    escaped = escaped.replace(/(&quot;[^&]*&quot;|&#39;[^&]*&#39;|'[^']*'|"[^"]*")/g, '<span class="tok-string">$1</span>');

    // Comentários
    escaped = escaped.replace(/(\/\/.*$)/gm, '<span class="tok-comment">$1</span>');
    escaped = escaped.replace(/(#.*$)/gm, '<span class="tok-comment">$1</span>');

    // Números
    escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-number">$1</span>');

    // Keywords
    langKeywords.forEach((kw) => {
      const regex = new RegExp(`\\b(${kw})\\b(?![^<]*>)`, "g");
      escaped = escaped.replace(regex, '<span class="tok-keyword">$1</span>');
    });

    // Types
    langTypes.forEach((t) => {
      const regex = new RegExp(`\\b(${t})\\b(?![^<]*>)`, "g");
      escaped = escaped.replace(regex, '<span class="tok-type">$1</span>');
    });

    // Nomes de funções/métodos
    escaped = escaped.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\((?![^<]*>)/g, '<span class="tok-fn">$1</span>(');

    // Decorators/annotations (@)
    escaped = escaped.replace(/(@\w+)(?![^<]*>)/g, '<span class="tok-annotation">$1</span>');

    return escaped;
  }

  // Exporta a factory function globalmente
  window.PatchWidget = createPatchWidget;

  
})();
