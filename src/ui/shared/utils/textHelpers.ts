/**
 * Helpers de processamento de texto para mensagens
 *
 * ✅ IMPORTANTE:
 * - stripThinkingForDisplay remove thinking só se a UI mandar esconder
 * - trimIncompleteThinkingBlock ajuda no streaming
 */

export function stripThinkingForDisplay(text: string): string {
  if (!text) return "";

  // ✅ Por padrão, o Nic Hyper Flow mantém o <thinking> visível.
  // A UI pode desabilitar via flag global: window.__NHF_HIDE_THINKING__ = true
  // (fallback: localStorage "nhf.hideThinking" = "1").
  const w: any = globalThis as any;
  const hideFromWindow = !!w?.__NHF_HIDE_THINKING__;

  const hideFromStorage = (() => {
    try {
      return (w?.localStorage?.getItem?.("nhf.hideThinking") ?? "") === "1";
    } catch {
      return false;
    }
  })();

  const shouldHide = hideFromWindow || hideFromStorage;

  if (!shouldHide) {
    return String(text);
  }

  let out = String(text);

  // Remove thinking blocks para exibição (case-insensitive)
  // Inclui thinking, reasoning, thought, think e redacted_reasoning
  const thinkingRegex =
    /<(?:thinking|reasoning|thought|think|redacted_reasoning)\b[^>]*>[\s\S]*?(?:<\/(?:thinking|reasoning|thought|think|redacted_reasoning)>|$)/gi;

  out = out.replace(thinkingRegex, "");
  return out.trim();
}

export function hasMeaningfulText(text: string | null | undefined): boolean {
  return !!(text && String(text).trim().length > 0);
}

/**
 * Remove HTML tags from a string
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  // Simple regex to strip HTML tags
  return html.replace(/<[^>]*>?/gm, "");
}

/**
 * Remove thinking blocks incompletos do final do texto (durante streaming)
 * Exemplos: "<", "<think", "<thinki", "<thinkin", "<thinking", etc.
 * Retorna o texto cortado antes do thinking block incompleto
 */
export function trimIncompleteThinkingBlock(text: string): string {
  if (!text) return text;

  // Encontra o último '<' no texto
  const lastLessThan = text.lastIndexOf("<");
  if (lastLessThan === -1) return text;

  const afterLessThan = text.substring(lastLessThan);

  // Se não tem '>' depois do '<' e não é closing tag, é incompleto
  if (!afterLessThan.includes(">") && !afterLessThan.startsWith("</")) {
    const lowerAfter = afterLessThan.toLowerCase();

    const thinkingPrefixes = ["<think", "<reason", "<thought", "<redacted_reasoning"];

    const isThinkingLike =
      thinkingPrefixes.some((p) => lowerAfter.startsWith(p)) || lowerAfter === "<";

    if (isThinkingLike) {
      return text.substring(0, lastLessThan);
    }
  }

  return text;
}

