import fetch from 'node-fetch';
import { ExecuteToolOptions } from './types';

interface WikipediaSearchResult {
  ns: number;
  title: string;
  pageid: number;
  size: number;
  wordcount: number;
  snippet: string;
  timestamp: string;
}

interface WikipediaPageResult {
  pageid: number;
  ns: number;
  title: string;
  extract?: string;
}

/**
 * Realiza busca na Wikipedia (list=search)
 */
export async function searchWikipedia(query: string, lang: string, limit: number): Promise<WikipediaSearchResult[]> {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    format: 'json',
    srlimit: String(limit)
  });

  const response = await fetch(`${endpoint}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  return data.query?.search || [];
}

/**
 * Obtém o conteúdo de uma página (prop=extracts)
 * - Por padrão pega o texto introdutório (exintro).
 * - Se full=true, tenta pegar o extrato mais completo (sem exintro).
 */
async function getPageContent(title: string, lang: string, full: boolean): Promise<WikipediaPageResult | null> {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: 'true',
    titles: title,
    format: 'json',
    redirects: '1'
  });

  if (!full) params.set('exintro', 'true');

  const response = await fetch(`${endpoint}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  const pages = data.query?.pages;
  if (!pages) return null;

  const pageId = Object.keys(pages)[0];
  if (pageId === '-1') return null;

  return pages[pageId];
}

/** Remove tags HTML do snippet e “desentorta” whitespace */
function cleanText(s: any): string {
  const raw = String(s ?? '');
  return raw
    .replace(/<[^>]+>/g, '')          // remove tags html
    .replace(/&quot;/g, '"')          // entidades comuns (mínimo útil)
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Monta URL humana da página */
function pageUrl(lang: string, title: string): string {
  // Wikipedia usa _ no título na URL
  const t = title.replace(/ /g, '_');
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t)}`;
}

/** Limita tamanho do texto para economizar tokens (mas mantendo “bastante info”) */
function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

/**
 * Tool: wikipedia
 * Retorna APENAS texto corrido (string), mas com bastante informação.
 *
 * Args:
 * - query: string (obrigatório)
 * - lang: string (default 'pt')
 * - limit: number 1..10 (default 3)
 * - fullContent: boolean (default false) => se true, traz mais texto do artigo top1 (não só intro)
 * - maxChars: number (default 6000) => cap do conteúdo retornado em caracteres (anti-token-bomb)
 */
export async function executeWikipedia(
  args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<string> {
  const query = String(args.query || '').trim();
  const lang = String(args.lang || 'pt').trim() || 'pt';
  const limit = Math.max(1, Math.min(10, Number(args.limit) || 3));
  const fullContent = Boolean(args.fullContent);
  const maxChars = Math.max(800, Math.min(20000, Number(args.maxChars) || 6000));

  if (!query) {
    // Texto corrido também no erro (pra bater com teu “contrato”)
    return 'Erro: parâmetro "query" é obrigatório para a tool wikipedia.';
  }

  try {
    const searchResults = await searchWikipedia(query, lang, limit);

    if (!searchResults.length) {
      return `Wikipedia: nenhuma página encontrada para "${query}" (lang=${lang}, limit=${limit}).`;
    }

    // Sempre pega conteúdo do top1 para enriquecer (texto corrido “com bastante info”),
    // mas respeita maxChars e o flag fullContent.
    const top = searchResults[0];
    const content = await getPageContent(top.title, lang, fullContent);

    const topTitle = top.title;
    const topUrl = pageUrl(lang, topTitle);

    const topSnippet = cleanText(top.snippet);
    const extract = cleanText(content?.extract || '');
    const extractTrimmed = extract ? truncate(extract, maxChars) : 'Conteúdo não disponível.';

    const header =
      `Wikipedia (lang=${lang}) — consulta: "${query}". ` +
      `Melhor correspondência: "${topTitle}" (pageid=${top.pageid}). ` +
      `URL: ${topUrl}.`;

    const snippetPart = topSnippet ? `Trecho do resultado: ${topSnippet}.` : '';

    const contentLabel = fullContent
      ? 'Conteúdo (mais completo, texto plano):'
      : 'Introdução (texto plano):';

    // “Relacionados” (sem duplicar o top)
    const related = searchResults.slice(1);

    let relatedPart = '';
    if (related.length) {
      const relatedLines = related
        .map((r, i) => {
          const rTitle = r.title;
          const rUrl = pageUrl(lang, rTitle);
          const rSnippet = cleanText(r.snippet);
          const rSnippetShort = rSnippet ? ` — ${truncate(rSnippet, 180)}` : '';
          return `${i + 1}) ${rTitle} (pageid=${r.pageid}) — ${rUrl}${rSnippetShort}`;
        })
        .join(' | ');
      relatedPart = `Resultados relacionados (${related.length}): ${relatedLines}.`;
    } else {
      relatedPart = 'Nenhum resultado relacionado adicional dentro do limite informado.';
    }

    // Texto corrido único
    const out =
      `${header} ` +
      `${snippetPart} ` +
      `${contentLabel} ${extractTrimmed} ` +
      `${relatedPart}`;

    return out.replace(/\s+/g, ' ').trim();

  } catch (error: any) {
    return `Wikipedia: erro ao consultar "${query}" (lang=${lang}, limit=${limit}, fullContent=${fullContent}). Detalhe: ${String(error?.message || error)}.`;
  }
}
