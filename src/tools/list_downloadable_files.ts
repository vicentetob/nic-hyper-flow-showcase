import { URL } from 'url';
import { ExecuteToolOptions } from './types';

interface ListDownloadableFilesArgs {
  url: string;
  extensions?: string[];
  max_depth?: number;
  timeout_ms?: number;
  user_agent?: string;
  include_patterns?: string[];
  exclude_patterns?: string[];
}

interface FileInfo {
  url: string;
  filename: string;
  extension: string;
  size?: number;
  content_type?: string;
  last_modified?: string;
}

/**
 * Tool: list_downloadable_files
 * Lista arquivos baixáveis de um site por extensão ou padrão
 * 
 * Args:
 * - url: string (URL raiz do site)
 * - extensions: string[] (extensões a buscar, ex: ["pdf", "zip", "docx"], padrão: comuns)
 * - max_depth: number (profundidade máxima, padrão: 2)
 * - timeout_ms: number (timeout por requisição, padrão: 10000)
 * - user_agent: string (user agent personalizado)
 * - include_patterns: string[] (padrões regex para incluir)
 * - exclude_patterns: string[] (padrões regex para excluir)
 * 
 * Output:
 * {
 *   "files": [
 *     {
 *       "url": "https://exemplo.com/manual.pdf",
 *       "filename": "manual.pdf",
 *       "extension": "pdf",
 *       "size": 2345678,
 *       "content_type": "application/pdf"
 *     }
 *   ],
 *   "stats": {
 *     "total": 15,
 *     "by_extension": { "pdf": 5, "zip": 3, "docx": 7 },
 *     "total_size": 123456789
 *   }
 * }
 */
export async function executeListDownloadableFiles(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const params: ListDownloadableFilesArgs = {
    url: String(args.url ?? '').trim(),
    extensions: Array.isArray(args.extensions) 
      ? args.extensions.map((e: any) => String(e).toLowerCase().replace(/^\./, ''))
      : ['pdf', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'json', 'xml'],
    max_depth: Math.max(1, Math.min(5, Number(args.max_depth ?? 2))),
    timeout_ms: Math.max(1000, Math.min(60000, Number(args.timeout_ms ?? 10000))),
    user_agent: String(args.user_agent ?? 'Jarvis-File-Lister/1.0 (+VSCode Extension)'),
    include_patterns: Array.isArray(args.include_patterns) 
      ? args.include_patterns.map((p: any) => String(p))
      : undefined,
    exclude_patterns: Array.isArray(args.exclude_patterns) 
      ? args.exclude_patterns.map((p: any) => String(p))
      : undefined,
  };

  if (!params.url) {
    throw new Error('list_downloadable_files requer uma URL válida no parâmetro "url"');
  }

  // Valida a URL
  let baseUrl: URL;
  try {
    baseUrl = new URL(params.url);
  } catch (err) {
    throw new Error(`URL inválida: ${params.url}`);
  }

  // Conjunto de extensões para busca rápida
  const extensionSet = new Set(params.extensions);
  
  // Compila padrões regex se fornecidos
  let includeRegexes: RegExp[] = [];
  let excludeRegexes: RegExp[] = [];
  
  if (params.include_patterns && params.include_patterns.length > 0) {
    includeRegexes = params.include_patterns
      .map((pattern: string) => {
        try {
          return new RegExp(pattern, 'i');
        } catch {
          return null;
        }
      })
      .filter((r: RegExp | null): r is RegExp => r !== null);
  }
  
  if (params.exclude_patterns && params.exclude_patterns.length > 0) {
    excludeRegexes = params.exclude_patterns
      .map((pattern: string) => {
        try {
          return new RegExp(pattern, 'i');
        } catch {
          return null;
        }
      })
      .filter((r: RegExp | null): r is RegExp => r !== null);
  }

  // Estado da busca
  const visitedUrls = new Set<string>();
  const files: FileInfo[] = [];
  const queue: Array<{ url: string; depth: number }> = [];
  const errors: Array<{ url: string; error: string }> = [];

  // Configuração do fetch
  const fetchOptions = {
    method: 'GET',
    headers: {
      'User-Agent': params.user_agent || 'Jarvis-File-Lister/1.0 (+VSCode Extension)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow' as const,
  };

  // Função para extrair links de HTML
  function extractLinksFromHtml(html: string, base: URL): string[] {
    const links: string[] = [];
    const patterns = [
      /href=["']([^"']+)["']/gi,
      /src=["']([^"']+)["']/gi,
      /data-src=["']([^"']+)["']/gi,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const link = match[1].trim();
        if (link && !link.startsWith('javascript:') && !link.startsWith('mailto:') && !link.startsWith('#')) {
          try {
            const resolved = new URL(link, base).href;
            links.push(resolved);
          } catch {
            // Ignora URLs inválidas
          }
        }
      }
    }
    
    return links;
  }

  // Função para verificar se uma URL corresponde aos critérios
  function isFileOfInterest(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const filename = pathname.split('/').pop() || '';
      
      // Verifica extensão
      const extension = filename.split('.').pop() || '';
      if (extensionSet.has(extension)) {
        return true;
      }
      
      // Verifica padrões de inclusão
      if (includeRegexes.length > 0) {
        const matchesInclude = includeRegexes.some(regex => regex.test(url) || regex.test(filename));
        if (!matchesInclude) {
          return false;
        }
      }
      
      // Verifica padrões de exclusão
      if (excludeRegexes.length > 0) {
        const matchesExclude = excludeRegexes.some(regex => regex.test(url) || regex.test(filename));
        if (matchesExclude) {
          return false;
        }
      }
      
      // Se não há padrões de inclusão específicos, retorna false
      // (só queremos arquivos com extensões específicas ou que correspondam a include_patterns)
      return includeRegexes.length > 0;
      
    } catch {
      return false;
    }
  }

  // Função para obter informações do arquivo via HEAD request
  async function getFileInfo(url: string): Promise<FileInfo | null> {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        method: 'HEAD',
      });
      
      if (!response.ok) {
        return null;
      }
      
      const contentType = response.headers.get('content-type') || '';
      const contentLength = response.headers.get('content-length');
      const lastModified = response.headers.get('last-modified');
      
      const urlObj = new URL(url);
      const filename = urlObj.pathname.split('/').pop() || 'file';
      const extension = filename.split('.').pop()?.toLowerCase() || '';
      
      return {
        url,
        filename,
        extension,
        size: contentLength ? parseInt(contentLength, 10) : undefined,
        content_type: contentType,
        last_modified: lastModified || undefined,
      };
      
    } catch {
      return null;
    }
  }

  // Adiciona URL inicial à fila
  queue.push({ url: params.url, depth: 0 });

  // Loop principal de busca
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (visitedUrls.has(current.url)) {
      continue;
    }
    
    if (current.depth > (params.max_depth || 2)) {
      continue;
    }
    
    visitedUrls.add(current.url);
    
    // Notifica progresso
    if (options.notify && visitedUrls.size % 10 === 0) {
      options.notify(`Buscando arquivos: ${visitedUrls.size} páginas, ${files.length} arquivos encontrados`);
    }
    
    try {
      const response = await fetch(current.url, {
        method: 'GET',
        headers: {
          'User-Agent': params.user_agent || 'Jarvis-File-Lister/1.0 (+VSCode Extension)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow' as const,
      });
      const contentType = response.headers.get('content-type') || '';
      
      if (response.ok && contentType.includes('text/html')) {
        const html = await response.text();
        const links = extractLinksFromHtml(html, new URL(current.url));
        
        // Processa cada link
        for (const link of links) {
          if (!visitedUrls.has(link)) {
            // Verifica se é um arquivo de interesse
            if (isFileOfInterest(link)) {
              const fileInfo = await getFileInfo(link);
              if (fileInfo) {
                files.push(fileInfo);
                
                // Notifica quando encontra arquivo
                if (options.notify && files.length % 5 === 0) {
                  options.notify(`Encontrado: ${fileInfo.filename} (${files.length} arquivos)`);
                }
              }
            } else if (current.depth < (params.max_depth || 2)) {
              // Se não for arquivo, adiciona à fila para continuar busca
              queue.push({ url: link, depth: current.depth + 1 });
            }
          }
        }
      }
      
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      errors.push({ url: current.url, error: errorMsg });
    }
    
    // Pequena pausa para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Calcula estatísticas
  const stats = {
    total: files.length,
    by_extension: {} as Record<string, number>,
    total_size: 0,
    pages_crawled: visitedUrls.size,
    errors: errors.length,
  };

  // Agrupa por extensão e calcula tamanho total
  for (const file of files) {
    stats.by_extension[file.extension] = (stats.by_extension[file.extension] || 0) + 1;
    if (file.size) {
      stats.total_size += file.size;
    }
  }

  // Ordena arquivos por tamanho (maiores primeiro)
  const sortedFiles = [...files].sort((a, b) => (b.size || 0) - (a.size || 0));

  return {
    files: sortedFiles.slice(0, 100), // Limita a 100 arquivos no output
    stats,
    errors: errors.slice(0, 10),
    _search_params: {
      extensions: Array.from(extensionSet),
      max_depth: params.max_depth,
      include_patterns: params.include_patterns,
      exclude_patterns: params.exclude_patterns,
    },
  };
}