import fetch from "node-fetch";

/**
 * READ_URL v2 (NicHyperFlow)
 * - Retorna texto limpo + índice de links (para o modelo conseguir “clicar”)
 * - Resolve links relativos
 * - Deduplica links
 * - Tenta detectar “botões” via <a class="btn..."> e alguns onclick simples
 *
 * Observação: páginas que dependem de JS (SPA) podem vir “vazias” via fetch.
 */

const DEFAULT_MAX_TEXT_CHARS = 140_000;
const DEFAULT_MAX_LINKS = 80;
const DEFAULT_TIMEOUT_MS = 30_000;

type ReturnFormat = "text" | "json" | "both";

type LinkItem = {
  id: number;
  text: string;
  href: string;
  isButtonLike?: boolean;
  source?: "a" | "button_onclick" | "other";
};

type ReadUrlResult = {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  statusText: string;
  contentType?: string;
  title?: string;
  text: string;
  links: LinkItem[];
  warnings: string[];
  truncated: boolean;
};

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp)) return "";
  if (cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

/**
 * Decodifica entidades HTML básicas e numéricas.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
    "&copy;": "©",
    "&reg;": "®",
    "&euro;": "€",
    "&pound;": "£",
    "&yen;": "¥",
    "&cent;": "¢",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&laquo;": "«",
    "&raquo;": "»",
  };

  return text.replace(/&[a-zA-Z0-9#]+;/g, (match) => {
    if (entities[match]) return entities[match];

    // Hexadecimal: &#x1F600;
    if (match.startsWith("&#x") || match.startsWith("&#X")) {
      const raw = match.slice(3, -1);
      const cp = parseInt(raw, 16);
      const ch = safeFromCodePoint(cp);
      return ch || match;
    }

    // Decimal: &#169;
    if (match.startsWith("&#")) {
      const raw = match.slice(2, -1);
      const cp = parseInt(raw, 10);
      const ch = safeFromCodePoint(cp);
      return ch || match;
    }

    return match;
  });
}

/**
 * Normaliza o texto para um formato limpo e legível.
 */
function normalizeToPlainText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n") // remove espaços no fim das linhas
    .replace(/\n{3,}/g, "\n\n") // mais de 2 quebras vira 2
    .replace(/[ \t]{2,}/g, " ") // múltiplos espaços
    .trim();
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const t = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, " "));
  const norm = normalizeToPlainText(t);
  return norm || undefined;
}

function isLikelyButtonLike(text: string, classOrRole: string): boolean {
  const t = (text || "").trim().toLowerCase();
  const cr = (classOrRole || "").toLowerCase();
  if (cr.includes("btn") || cr.includes("button") || cr.includes("cta") || cr.includes("primary")) return true;
  if (cr.includes("role=button") || cr.includes("role=\"button\"")) return true;
  if (["entrar", "login", "começar", "comece", "assinar", "comprar", "continuar", "next", "próximo", "prosseguir"].includes(t))
    return true;
  return false;
}

function resolveUrlMaybe(baseUrl: string, href: string): string | undefined {
  const h = (href || "").trim();
  if (!h) return undefined;
  if (h === "#" || h.startsWith("javascript:") || h.startsWith("mailto:") || h.startsWith("tel:")) return undefined;
  try {
    const u = new URL(h, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * Extrai links <a href="..."> do HTML (regex) e alguns onclick simples.
 * (Sem DOM/headless, SPA pode não ter links no HTML.)
 */
function extractLinksFromHtml(html: string, baseUrl: string, maxLinks: number): LinkItem[] {
  const raw: Array<Omit<LinkItem, "id">> = [];

  // --- <a ... href="..."> ---
  // Captura href e também tenta pegar texto interno em casos simples.
  const aRegex = /<a\b([^>]*?)href\s*=\s*(['"])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = aRegex.exec(html)) && raw.length < maxLinks * 3) {
    const preAttrs = m[1] || "";
    const hrefRaw = m[3] || "";
    const postAttrs = m[4] || "";
    const inner = m[5] || "";

    const href = resolveUrlMaybe(baseUrl, decodeHtmlEntities(hrefRaw));
    if (!href) continue;

    const classMatch = (preAttrs + " " + postAttrs).match(/\bclass\s*=\s*(['"])(.*?)\1/i);
    const roleMatch = (preAttrs + " " + postAttrs).match(/\brole\s*=\s*(['"])(.*?)\1/i);
    const ariaMatch =
      (preAttrs + " " + postAttrs).match(/\baria-label\s*=\s*(['"])(.*?)\1/i) ||
      (preAttrs + " " + postAttrs).match(/\btitle\s*=\s*(['"])(.*?)\1/i);

    // Texto “humano”: aria-label > innerText
    const innerText = normalizeToPlainText(
      decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))
    );

    const label = normalizeToPlainText(
      decodeHtmlEntities((ariaMatch?.[2] || "").trim())
    );

    const text = (label || innerText || "link").slice(0, 200);

    const classOrRole = [
      classMatch ? `class=${classMatch[2]}` : "",
      roleMatch ? `role=${roleMatch[2]}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    raw.push({
      text,
      href,
      isButtonLike: isLikelyButtonLike(text, classOrRole),
      source: "a",
    });
  }

  // --- <button onclick="location.href='...'" ...> ---
  // Heurística: tenta achar URLs em onclick comuns.
  const btnRegex = /<button\b([^>]*?)onclick\s*=\s*(['"])([\s\S]*?)\2([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((m = btnRegex.exec(html)) && raw.length < maxLinks * 3) {
    const onclick = m[3] || "";
    const inner = m[5] || "";

    // Procura padrões comuns de navegação
    const candidates: string[] = [];
    const patterns = [
      /location\.href\s*=\s*['"]([^'"]+)['"]/i,
      /window\.location\.href\s*=\s*['"]([^'"]+)['"]/i,
      /document\.location\s*=\s*['"]([^'"]+)['"]/i,
      /location\s*=\s*['"]([^'"]+)['"]/i,
      /open\s*\(\s*['"]([^'"]+)['"]/i,
    ];
    for (const p of patterns) {
      const mm = onclick.match(p);
      if (mm?.[1]) candidates.push(mm[1]);
    }

    const innerText = normalizeToPlainText(decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")));
    const text = (innerText || "button").slice(0, 200);

    for (const c of candidates) {
      const href = resolveUrlMaybe(baseUrl, decodeHtmlEntities(c));
      if (!href) continue;
      raw.push({
        text,
        href,
        isButtonLike: true,
        source: "button_onclick",
      });
    }
  }

  // Dedup por href (mantém o “melhor” texto)
  const byHref = new Map<string, Omit<LinkItem, "id">>();
  for (const item of raw) {
    const key = item.href;
    const prev = byHref.get(key);
    if (!prev) {
      byHref.set(key, item);
      continue;
    }
    // Preferir texto mais informativo e/ou button-like
    const prevScore = (prev.isButtonLike ? 2 : 0) + (prev.text?.length || 0) / 50;
    const newScore = (item.isButtonLike ? 2 : 0) + (item.text?.length || 0) / 50;
    if (newScore > prevScore) byHref.set(key, item);
  }

  const arr = Array.from(byHref.values());

  // Ordena: button-like primeiro, depois por texto
  arr.sort((a, b) => {
    const ab = (b.isButtonLike ? 1 : 0) - (a.isButtonLike ? 1 : 0);
    if (ab !== 0) return ab;
    return (b.text?.length || 0) - (a.text?.length || 0);
  });

  // Limita e numera
  return arr.slice(0, maxLinks).map((x, i) => ({ id: i + 1, ...x }));
}

/**
 * Extrai texto do HTML usando regex (fallback “sem DOM”).
 */
function extractTextFromHtml(html: string): string {
  let text = html;

  // 1) tenta body
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) text = bodyMatch[1];

  // 2) remove blocos não-conteúdo (inclui script/style/noscript etc.)
  const blockRemove = ["script", "style", "noscript", "svg", "canvas", "iframe", "head"];
  for (const tag of blockRemove) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    text = text.replace(re, " ");
  }

  // remove self-closing comuns
  text = text.replace(/<(meta|link)\b[^>]*\/?>/gi, " ");

  // 3) tags de bloco viram newline
  const blockTags = ["p", "div", "br", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "article", "section", "blockquote"];
  const openRe = new RegExp(`<(${blockTags.join("|")})\\b[^>]*>`, "gi");
  const closeRe = new RegExp(`<\\/(${blockTags.join("|")})>`, "gi");
  text = text.replace(openRe, "\n");
  text = text.replace(closeRe, "\n");

  // 4) remove resto das tags
  text = text.replace(/<[^>]+>/g, " ");

  // 5) decode entidades e normaliza
  text = decodeHtmlEntities(text);
  return normalizeToPlainText(text);
}

function formatResultAsText(r: ReadUrlResult, includeText: boolean, includeLinks: boolean): string {
  const lines: string[] = [];
  lines.push(`URL: ${r.url}`);
  if (r.finalUrl && r.finalUrl !== r.url) lines.push(`FINAL_URL: ${r.finalUrl}`);
  lines.push(`STATUS: ${r.status} ${r.statusText}`);
  if (r.title) lines.push(`TITLE: ${r.title}`);
  if (r.contentType) lines.push(`CONTENT_TYPE: ${r.contentType}`);
  if (r.truncated) lines.push(`TRUNCATED: true`);
  if (r.warnings.length) {
    lines.push(`WARNINGS:`);
    for (const w of r.warnings) lines.push(`- ${w}`);
  }

  if (includeLinks) {
    lines.push("");
    lines.push(`--- LINKS (${r.links.length}) ---`);
    for (const l of r.links) {
      const badge = l.isButtonLike ? " [BTN]" : "";
      lines.push(`[${l.id}]${badge} ${l.text} -> ${l.href}`);
    }
  }

  if (includeText) {
    lines.push("");
    lines.push(`--- TEXT ---`);
    lines.push(r.text || "");
  }

  return lines.join("\n");
}

/**
 * Lê uma URL e retorna texto + links em formato configurável.
 */
export async function readUrl(url: string, opts?: {
  maxTextChars?: number;
  maxLinks?: number;
  timeoutMs?: number;
  returnFormat?: ReturnFormat;
  includeLinksInTextMode?: boolean; // se returnFormat="text", incluir links?
  debug?: boolean;
}): Promise<string> {
  const maxTextChars = opts?.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const maxLinks = opts?.maxLinks ?? DEFAULT_MAX_LINKS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const returnFormat: ReturnFormat = opts?.returnFormat ?? "both";
  const includeLinksInTextMode = opts?.includeLinksInTextMode ?? true;

  const warnings: string[] = [];

  if (!url || typeof url !== "string") {
    return "Erro: parâmetro 'url' inválido.";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Erro: URL deve começar com http:// ou https://";
    }
  } catch {
    return "Erro: URL malformada.";
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res: any;
  let html = "";
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "NicHyperFlow/1.0 (+readUrl v2)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    });

    const contentType = String(res.headers?.get?.("content-type") || "");
    const isHtml = contentType.toLowerCase().includes("text/html") || contentType.toLowerCase().includes("application/xhtml+xml");

    if (!res.ok) {
      clearTimeout(t);
      return `FALHA: Não foi possível carregar a página (Status ${res.status}: ${res.statusText})`;
    }

    if (!isHtml) {
      warnings.push(`Conteúdo não parece HTML (content-type=${contentType || "desconhecido"}). Vou tentar extrair texto mesmo assim.`);
    }

    html = await res.text();
  } catch (err: any) {
    clearTimeout(t);
    const msg = err?.name === "AbortError"
      ? `Timeout após ${timeoutMs}ms`
      : (err?.message || String(err));
    return `ERRO ao ler URL: ${msg}`;
  } finally {
    clearTimeout(t);
  }

  const finalUrl: string = res?.url || url;
  const contentType: string | undefined = res?.headers?.get?.("content-type") || undefined;

  const title = extractTitle(html);
  const links = extractLinksFromHtml(html, finalUrl, maxLinks);

  let text = extractTextFromHtml(html);

  if (!text || text.length < 50) {
    warnings.push("Conteúdo muito curto ou vazio. A página pode depender de JavaScript para renderização, ter bloqueio anti-bot, ou exigir login.");
  }

  let truncated = false;
  if (text.length > maxTextChars) {
    text = text.slice(0, maxTextChars);
    truncated = true;
  }

  const result: ReadUrlResult = {
    url,
    finalUrl,
    ok: true,
    status: res.status,
    statusText: res.statusText,
    contentType,
    title,
    text,
    links,
    warnings,
    truncated,
  };

  if (returnFormat === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (returnFormat === "text") {
    // por padrão, inclui links em modo texto (pra navegar)
    return formatResultAsText(result, true, includeLinksInTextMode);
  }

  // both: header+links+texto (mais “clicável”)
  return formatResultAsText(result, true, true);
}

/**
 * Executor da tool READ_URL para o NicHyperFlow.
 */
export async function executeReadUrl(args: {
  url: string;
  returnFormat?: ReturnFormat; // "text" | "json" | "both"
  maxTextChars?: number;
  maxLinks?: number;
  timeoutMs?: number;
  debug?: boolean;
}): Promise<string> {
  const { url, returnFormat, maxTextChars, maxLinks, timeoutMs, debug } = args || ({} as any);

  if (!url) {
    return "Erro: parâmetro 'url' é obrigatório para a tool read_url.";
  }

  return await readUrl(url, {
    returnFormat: returnFormat ?? "both",
    maxTextChars,
    maxLinks,
    timeoutMs,
    debug,
    includeLinksInTextMode: true,
  });
}