/**
 * Helpers de renderização de markdown
 */

declare const marked: any;

export function renderMarkdownInto(el: HTMLElement | null, markdownText: string): void {
  if (!el) return;

  // Garantia: evita mostrar markup cru caso o parser ainda não tenha carregado.
  // Re-renderiza assim que o marked estiver disponível (race condition comum em webviews).
  const mdText = markdownText ?? "";
  el.setAttribute?.("data-md", String(mdText));

  if (typeof marked !== "undefined") {
    try {
      el.innerHTML = `<div class="md">${marked.parse(String(mdText))}</div>`;
    } catch (e) {
      console.error("Marked error:", e);
      el.textContent = String(mdText);
    }
    return;
  }

  el.textContent = String(mdText);

  // Retry curto (até ~1.5s): marked carregado via script e pode chegar depois.
  if (!(el as any).__mdRetryScheduled) {
    (el as any).__mdRetryScheduled = true;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (typeof marked !== "undefined") {
        clearInterval(timer);
        (el as any).__mdRetryScheduled = false;
        const saved = el.getAttribute?.("data-md") || "";
        try {
          el.innerHTML = `<div class="md">${(marked as any).parse(String(saved))}</div>`;
        } catch (e) {
          console.error("Marked error:", e);
          el.textContent = String(saved);
        }
      } else if (tries >= 10) {
        clearInterval(timer);
        (el as any).__mdRetryScheduled = false;
      }
    }, 150);
  }
}
