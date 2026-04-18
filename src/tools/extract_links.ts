import { ExecuteToolOptions } from './types';

interface ExtractLinksArgs {
  html: string;
  base_url?: string;
  filter_types?: string[];
  include_assets?: boolean;
  include_iframes?: boolean;
}

interface ExtractedLink {
  url: string;
  type: 'link' | 'asset' | 'iframe' | 'download';
  attribute: 'href' | 'src' | 'data-src' | 'download';
  text?: string;
}

/**
 * Tool: extract_links
 * Extrai links, assets e downloads de HTML cru
 * 
 * Args:
 * - html: string (conteúdo HTML)
 * - base_url: string (URL base para resolver links relativos, opcional)
 * - filter_types: string[] (tipos a incluir: 'link', 'asset', 'iframe', 'download', padrão: todos)
 * - include_assets: boolean (incluir assets como img, script, link, padrão: true)
 * - include_iframes: boolean (incluir iframes, padrão: true)
 * 
 * Output:
 * {
 *   "links": [
 *     "https://exemplo.com/file1.pdf",
 *     "https://exemplo.com/assets/app.js"
 *   ],
 *   "detailed": [
 *     {
 *       "url": "https://exemplo.com/file1.pdf",
 *       "type": "download",
 *       "attribute": "href"
 *     }
 *   ],
 *   "stats": {
 *     "total": 25,
 *     "by_type": { "link": 10, "asset": 8, "iframe": 2, "download": 5 }
 *   }
 * }
 */
export async function executeExtractLinks(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const params: ExtractLinksArgs = {
    html: String(args.html ?? ''),
    base_url: args.base_url ? String(args.base_url).trim() : undefined,
    filter_types: Array.isArray(args.filter_types) 
      ? args.filter_types.map((t: any) => String(t).toLowerCase())
      : undefined,
    include_assets: Boolean(args.include_assets ?? true),
    include_iframes: Boolean(args.include_iframes ?? true),
  };

  if (!params.html.trim()) {
    throw new Error('extract_links requer conteúdo HTML no parâmetro "html"');
  }

  // Tipos permitidos
  const allowedTypes = new Set(['link', 'asset', 'iframe', 'download']);
  let filterSet: Set<string> | null = null;
  
  if (params.filter_types && params.filter_types.length > 0) {
    filterSet = new Set(params.filter_types.filter((t: string) => allowedTypes.has(t)));
  }

  // Função para normalizar URL
  function normalizeUrl(url: string, baseUrl?: string): string {
    if (!url.trim()) return '';
    
    // Remove espaços
    url = url.trim();
    
    // Ignora protocolos especiais
    if (url.startsWith('javascript:') || 
        url.startsWith('mailto:') || 
        url.startsWith('tel:') ||
        url.startsWith('#') ||
        url.startsWith('data:')) {
      return '';
    }
    
    // Se for URL relativa e tiver base_url, resolve
    if (baseUrl && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('//')) {
      try {
        // Remove query strings e fragmentos para normalização
        const cleanUrl = url.split('#')[0].split('?')[0];
        
        // Se base_url termina com / e url começa com /, remove um /
        let base = baseUrl;
        if (base.endsWith('/') && url.startsWith('/')) {
          base = base.slice(0, -1);
        } else if (!base.endsWith('/') && !url.startsWith('/') && url !== '') {
          base = base + '/';
        }
        
        return base + cleanUrl;
      } catch {
        return url;
      }
    }
    
    return url;
  }

  // Extrai links usando regex (abordagem simples mas eficaz)
  const extracted: ExtractedLink[] = [];
  
  // Regex para diferentes tipos de atributos
  const patterns = [
    // Links: <a href="...">
    { 
      regex: /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, 
      type: 'link' as const, 
      attribute: 'href' as const,
      enabled: !filterSet || filterSet.has('link')
    },
    
    // Downloads: <a href="..." download>
    { 
      regex: /<a\s+[^>]*href=["']([^"']+)["'][^>]*\s+download[^>]*>/gi, 
      type: 'download' as const, 
      attribute: 'href' as const,
      enabled: !filterSet || filterSet.has('download')
    },
    
    // Imagens: <img src="...">
    { 
      regex: /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, 
      type: 'asset' as const, 
      attribute: 'src' as const,
      enabled: params.include_assets && (!filterSet || filterSet.has('asset'))
    },
    
    // Scripts: <script src="...">
    { 
      regex: /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, 
      type: 'asset' as const, 
      attribute: 'src' as const,
      enabled: params.include_assets && (!filterSet || filterSet.has('asset'))
    },
    
    // Stylesheets: <link href="..." rel="stylesheet">
    { 
      regex: /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi, 
      type: 'asset' as const, 
      attribute: 'href' as const,
      enabled: params.include_assets && (!filterSet || filterSet.has('asset'))
    },
    
    // Iframes: <iframe src="...">
    { 
      regex: /<iframe\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, 
      type: 'iframe' as const, 
      attribute: 'src' as const,
      enabled: params.include_iframes && (!filterSet || filterSet.has('iframe'))
    },
    
    // Data-src (lazy loading): <img data-src="...">
    { 
      regex: /<(img|iframe)\s+[^>]*data-src=["']([^"']+)["'][^>]*>/gi, 
      type: 'asset' as const, 
      attribute: 'data-src' as const,
      enabled: params.include_assets && (!filterSet || filterSet.has('asset'))
    },
    
    // Links com atributo download explícito
    { 
      regex: /<a\s+[^>]*download=["']([^"']+)["'][^>]*>/gi, 
      type: 'download' as const, 
      attribute: 'download' as const,
      enabled: !filterSet || filterSet.has('download')
    },
  ];

  // Processa cada padrão
  for (const pattern of patterns) {
    if (!pattern.enabled) continue;
    
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    
    while ((match = regex.exec(params.html)) !== null) {
      // O grupo de captura pode estar em posições diferentes dependendo do regex
      const url = match[1] || match[2];
      if (url) {
        const normalized = normalizeUrl(url, params.base_url);
        if (normalized) {
          extracted.push({
            url: normalized,
            type: pattern.type,
            attribute: pattern.attribute,
          });
        }
      }
    }
  }

  // Remove duplicatas mantendo a primeira ocorrência
  const uniqueLinks: ExtractedLink[] = [];
  const seenUrls = new Set<string>();
  
  for (const link of extracted) {
    if (!seenUrls.has(link.url)) {
      seenUrls.add(link.url);
      uniqueLinks.push(link);
    }
  }

  // Estatísticas
  const stats = {
    total: uniqueLinks.length,
    by_type: {
      link: uniqueLinks.filter(l => l.type === 'link').length,
      asset: uniqueLinks.filter(l => l.type === 'asset').length,
      iframe: uniqueLinks.filter(l => l.type === 'iframe').length,
      download: uniqueLinks.filter(l => l.type === 'download').length,
    }
  };

  // Lista simples de URLs
  const urlList = uniqueLinks.map(l => l.url);

  return {
    links: urlList,
    detailed: uniqueLinks,
    stats,
    _raw_html_length: params.html.length,
    _extracted_count: extracted.length,
    _unique_count: uniqueLinks.length,
  };
}