import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { URL } from 'url';
import { ExecuteToolOptions } from './types';

interface CrawlSiteArgs {
  url: string;
  max_depth?: number;
  same_domain_only?: boolean;
  timeout_ms?: number;
  user_agent?: string;
}

interface CrawlResult {
  url: string;
  depth: number;
  status: number;
  contentType?: string;
  links: string[];
  error?: string;
}

/**
 * Tool: crawl_site
 * Mapeia todas as URLs internas de um site seguindo links <a href>
 * 
 * Args:
 * - url: string (URL raiz para começar o crawling)
 * - max_depth: number (profundidade máxima, padrão: 5)
 * - same_domain_only: boolean (se true, só segue links do mesmo domínio, padrão: true)
 * - timeout_ms: number (timeout por requisição em ms, padrão: 10000)
 * - user_agent: string (user agent personalizado)
 * 
 * Output:
 * {
 *   "urls": ["/", "/docs", "/docs/api", "/assets/manual.pdf"],
 *   "stats": {
 *     "total_pages": 10,
 *     "total_links": 45,
 *     "unique_urls": 25,
 *     "max_depth_reached": 3
 *   },
 *   "errors": []
 * }
 */
export async function executeCrawlSite(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const params: CrawlSiteArgs = {
    url: String(args.url ?? '').trim(),
    max_depth: Math.max(1, Math.min(10, Number(args.max_depth ?? 5))),
    same_domain_only: Boolean(args.same_domain_only ?? true),
    timeout_ms: Math.max(1000, Math.min(60000, Number(args.timeout_ms ?? 10000))),
    user_agent: String(args.user_agent ?? 'Jarvis-Crawler/1.0 (+VSCode Extension)'),
  };

  if (!params.url) {
    throw new Error('crawl_site requer uma URL válida no parâmetro "url"');
  }

  // Valida a URL
  let baseUrl: URL;
  try {
    baseUrl = new URL(params.url);
  } catch (err) {
    throw new Error(`URL inválida: ${params.url}`);
  }

  const visited = new Set<string>();
  const toVisit: Array<{ url: string; depth: number }> = [{ url: params.url, depth: 0 }];
  const results: CrawlResult[] = [];
  const allUrls: string[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  // Configuração do fetch
  const fetchOptions = {
    method: 'GET',
    headers: {
      'User-Agent': params.user_agent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow' as const,
    timeout: params.timeout_ms,
  };

  // Função para normalizar URLs
  function normalizeUrl(url: string, base: URL): string {
    try {
      const parsed = new URL(url, base);
      
      // Remove fragmentos (#)
      parsed.hash = '';
      
      // Remove query strings? (opcional, comentado por enquanto)
      // parsed.search = '';
      
      return parsed.href;
    } catch {
      return url;
    }
  }

  // Função para extrair links de HTML
  function extractLinksFromHtml(html: string, base: URL): string[] {
    const links: string[] = [];
    
    // Expressões regulares simples para extrair href e src
    const hrefRegex = /href=["']([^"']+)["']/gi;
    const srcRegex = /src=["']([^"']+)["']/gi;
    
    let match;
    
    // Extrai href
    while ((match = hrefRegex.exec(html)) !== null) {
      const link = match[1].trim();
      if (link && !link.startsWith('javascript:') && !link.startsWith('mailto:')) {
        links.push(link);
      }
    }
    
    // Extrai src
    while ((match = srcRegex.exec(html)) !== null) {
      const link = match[1].trim();
      if (link && !link.startsWith('javascript:') && !link.startsWith('data:')) {
        links.push(link);
      }
    }
    
    // Normaliza URLs
    return links.map(link => normalizeUrl(link, base));
  }

  // Função para verificar se uma URL está no mesmo domínio
  function isSameDomain(url: string, baseDomain: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === baseDomain;
    } catch {
      return false;
    }
  }

  // Loop principal de crawling
  while (toVisit.length > 0) {
    const current = toVisit.shift()!;
    
    if (visited.has(current.url)) {
      continue;
    }
    
    if (current.depth > (params.max_depth || 5)) {
      continue;
    }
    
    visited.add(current.url);
    
    try {
      // Notifica progresso
      if (options.notify) {
        options.notify(`Crawling: ${current.url} (depth: ${current.depth})`);
      }
      
      const response = await fetch(current.url, {
        method: 'GET',
        headers: {
          'User-Agent': params.user_agent || 'Jarvis-Crawler/1.0 (+VSCode Extension)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow' as const,
      });
      const contentType = response.headers.get('content-type') || '';
      const result: CrawlResult = {
        url: current.url,
        depth: current.depth,
        status: response.status,
        contentType,
        links: [],
      };
      
      if (response.ok && contentType.includes('text/html')) {
        const html = await response.text();
        const links = extractLinksFromHtml(html, new URL(current.url));
        result.links = links;
        
        // Adiciona novas URLs para visitar
        for (const link of links) {
          if (!visited.has(link)) {
            // Filtra por domínio se necessário
            if (!params.same_domain_only || isSameDomain(link, baseUrl.hostname)) {
              toVisit.push({ url: link, depth: current.depth + 1 });
            }
          }
        }
        
        // Adiciona à lista de URLs
        allUrls.push(current.url);
      }
      
      results.push(result);
      
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      errors.push({ url: current.url, error: errorMsg });
      
      results.push({
        url: current.url,
        depth: current.depth,
        status: 0,
        error: errorMsg,
        links: [],
      });
    }
    
    // Pequena pausa para não sobrecarregar o servidor
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Remove duplicatas e ordena
  const uniqueUrls = Array.from(new Set(allUrls)).sort();
  
  // Estatísticas
  const stats = {
    total_pages: results.length,
    total_links: results.reduce((sum, r) => sum + r.links.length, 0),
    unique_urls: uniqueUrls.length,
    max_depth_reached: Math.max(...results.map(r => r.depth)),
    errors_count: errors.length,
  };

  return {
    urls: uniqueUrls,
    stats,
    errors: errors.slice(0, 10), // Limita a 10 erros no output
    _raw_results: results.slice(0, 50), // Inclui primeiros 50 resultados para debug
  };
}