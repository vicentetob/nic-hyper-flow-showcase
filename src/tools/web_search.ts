import { ExecuteToolOptions } from './types';
import { CredentialsManager } from '../core/credentials';

type WebSearchItem = { title: string; url: string; description: string; source?: string };
type WebSearchPagePreview = { url: string; status: number; title?: string; contentPreview?: string; error?: string };

/** Exportado para testes offline e uso por download_web_file.ts */
export function stripHtmlToText(html: string): string {
  let s = String(html ?? '');
  // Remove scripts/styles
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Quebras básicas
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, '\n');
  // Remove tags restantes
  s = s.replace(/<[^>]+>/g, ' ');
  // Decodificação mínima
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Normaliza espaços e linhas
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Limpa a query preservando operadores de busca.
 * Operadores suportados: site:, filetype:, ext:, intitle:, inbody:, inpage:, 
 * lang:, loc:, +, -, "", AND, OR, NOT
 */
function cleanSearchQuery(query: string): string {
  // Preserva a query original se contiver operadores conhecidos
  const hasOperators = /\b(site|filetype|ext|intitle|inbody|inpage|lang|loc):|["+-]|\b(AND|OR|NOT)\b/.test(query);
  
  if (hasOperators) {
    // Apenas normaliza espaços múltiplos, preservando operadores
    return query.replace(/\s+/g, ' ').trim();
  }
  
  // Para queries simples, remove apenas pontuação final desnecessária
  let cleaned = query.replace(/[¿¡]+/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function toBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }
  return Boolean(val);
}

async function localSerperSearch(
  apiKey: string, 
  query: string, 
  limit: number,
  country?: string,
  searchLang?: string
): Promise<WebSearchItem[]> {
  const url = 'https://google.serper.dev/search';
  
  const body: any = {
    q: query,
    num: limit,
  };

  if (country) body.gl = country;
  if (searchLang) body.hl = searchLang;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 
      'X-API-KEY': apiKey, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) return [];

  const data: any = await resp.json();
  return (data.organic || []).map((r: any) => ({
    title: r.title,
    url: r.link,
    description: r.snippet,
    source: 'Serper'
  }));
}

async function localWikipediaSearch(query: string, limit: number): Promise<WebSearchItem[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${limit}`;
  
  const resp = await fetch(url);
  if (!resp.ok) return [];

  const data: any = await resp.json();
  return (data.query?.search || []).map((r: any) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
    description: stripHtmlToText(r.snippet),
    source: 'Wikipedia'
  }));
}

/**
 * Tool de pesquisa web (AGORA SERVER-SIDE).
 */
export async function executeWebSearch(
  args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<any> {
  const query = cleanSearchQuery(String(args.query ?? args.QUERY ?? args.Query ?? '').trim());

  const queriesRaw = args.queries ?? args.QUERIES ?? args.Queries;
  const queries: string[] = Array.isArray(queriesRaw)
    ? queriesRaw.map((q: any) => cleanSearchQuery(String(q ?? '').trim())).filter(Boolean)
    : [];

  const limitRaw = args.limit ?? args.LIMIT ?? args.Limit;
  const limit = Math.max(1, Math.min(10, Number.isFinite(Number(limitRaw)) ? Math.floor(Number(limitRaw)) : 5));

  const timeoutMsRaw = args.timeoutMs ?? args.TIMEOUTMS ?? args.TimeoutMs;
  const timeoutMs = Math.max(1000, Math.min(30_000, Number.isFinite(Number(timeoutMsRaw)) ? Math.floor(Number(timeoutMsRaw)) : 10_000));

  const fetchPagesRaw = args.fetchPages ?? args.fetch_pages ?? args.FETCHPAGES ?? args.FetchPages;
  const fetchPages = toBool(fetchPagesRaw);

  const maxPagesRaw = args.maxPages ?? args.max_pages ?? args.MAXPAGES ?? args.MaxPages;
  const maxPages = Math.max(0, Math.min(5, Number.isFinite(Number(maxPagesRaw)) ? Math.floor(Number(maxPagesRaw)) : Math.min(limit, 3)));

  const maxPageCharsRaw = args.maxPageChars ?? args.max_page_chars ?? args.MAXPAGECHARS ?? args.MaxPageChars;
  const maxPageChars = Math.max(200, Math.min(10_000, Number.isFinite(Number(maxPageCharsRaw)) ? Math.floor(Number(maxPageCharsRaw)) : 2000));

  const debugRaw = args.debug ?? args.DEBUG ?? args.Debug;
  const debug = toBool(debugRaw);

  // Novos parâmetros avançados
  const country = String(args.country ?? args.COUNTRY ?? '').trim().toLowerCase() || undefined;
  const searchLang = String(args.searchLang ?? args.search_lang ?? args.SEARCHLANG ?? '').trim().toLowerCase() || undefined;
  const freshness = String(args.freshness ?? args.FRESHNESS ?? '').trim().toLowerCase() || undefined;

  const effectiveQueries = (queries.length ? queries : (query ? [query] : [])).slice(0, 10);

  if (effectiveQueries.length === 0) {
    return { query: '', queries: [], provider: 'none', results: [] };
  }

  // ✅ Pesquisa Local
  const credentials = CredentialsManager.getInstance();
  const serperKey = await credentials.getSecret('apiKey:serper');

  let results: WebSearchItem[] = [];
  let provider = 'none';

  for (const q of effectiveQueries) {
    let queryResults: WebSearchItem[] = [];
    if (serperKey) {
      queryResults = await localSerperSearch(serperKey, q, limit, country, searchLang);
      provider = 'Serper';
    }

    // Fallback para Wikipedia se não houver chave Serper ou não houver resultados
    if (queryResults.length === 0) {
      queryResults = await localWikipediaSearch(q, limit);
      provider = provider === 'none' ? 'Wikipedia' : provider;
    }

    results.push(...queryResults);
  }

  // Deduplicação por URL
  const uniqueResults = Array.from(new Map(results.map(item => [item.url, item])).values()).slice(0, limit);

  return {
    query: effectiveQueries[0],
    queries: effectiveQueries,
    provider,
    results: uniqueResults,
    success: true
  };
}
