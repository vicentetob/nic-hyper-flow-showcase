import * as path from 'path';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { URL } from 'url';
import { ExecuteToolOptions } from './types';
import { resolveWorkspacePath, writeFileBytesSafe, writeFileSafe } from './utils';

interface DownloadSiteAssetsArgs {
  url: string;
  include?: string[];
  exclude?: string[];
  max_depth?: number;
  max_files?: number;
  timeout_ms?: number;
  user_agent?: string;
  preserve_structure?: boolean;
}

interface AssetInfo {
  url: string;
  local_path: string;
  type: string;
  size: number;
  status: 'pending' | 'downloading' | 'saved' | 'skipped' | 'error';
  error?: string;
  content_type?: string;
}

/**
 * Tool: download_site_assets
 * Clona assets de um site (HTML, CSS, JS, imagens, PDFs, etc.)
 * 
 * Args:
 * - url: string (URL raiz do site)
 * - include: string[] (tipos a incluir: 'html', 'css', 'js', 'images', 'pdf', 'fonts', 'videos', 'audios', padrão: todos)
 * - exclude: string[] (tipos a excluir)
 * - max_depth: number (profundidade máxima, padrão: 3)
 * - max_files: number (número máximo de arquivos, padrão: 100)
 * - timeout_ms: number (timeout por requisição, padrão: 15000)
 * - user_agent: string (user agent personalizado)
 * - preserve_structure: boolean (preserva estrutura de pastas, padrão: true)
 * 
 * Output:
 * {
 *   "status": "completed",
 *   "stats": {
 *     "total": 45,
 *     "saved": 40,
 *     "skipped": 3,
 *     "errors": 2,
 *     "total_size": 12345678
 *   },
 *   "assets": [
 *     {
 *       "url": "https://exemplo.com/style.css",
 *       "local_path": "exemplo.com/style.css",
 *       "type": "css",
 *       "size": 1234,
 *       "status": "saved"
 *     }
 *   ],
 *   "directory": "/caminho/do/workspace/exemplo.com/"
 * }
 */
export async function executeDownloadSiteAssets(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const params: DownloadSiteAssetsArgs = {
    url: String(args.url ?? '').trim(),
    include: Array.isArray(args.include) ? args.include.map((i: any) => String(i).toLowerCase()) : undefined,
    exclude: Array.isArray(args.exclude) ? args.exclude.map((e: any) => String(e).toLowerCase()) : undefined,
    max_depth: Math.max(1, Math.min(10, Number(args.max_depth ?? 3))),
    max_files: Math.max(1, Math.min(1000, Number(args.max_files ?? 100))),
    timeout_ms: Math.max(1000, Math.min(60000, Number(args.timeout_ms ?? 15000))),
    user_agent: String(args.user_agent ?? 'Jarvis-Asset-Downloader/1.0 (+VSCode Extension)'),
    preserve_structure: Boolean(args.preserve_structure ?? true),
  };

  if (!params.url) {
    throw new Error('download_site_assets requer uma URL válida no parâmetro "url"');
  }

  // Valida a URL
  let baseUrl: URL;
  try {
    baseUrl = new URL(params.url);
  } catch (err) {
    throw new Error(`URL inválida: ${params.url}`);
  }

  // Tipos de arquivo e seus mapeamentos
  const typeMappings: Record<string, string[]> = {
    html: ['text/html', 'application/xhtml+xml'],
    css: ['text/css'],
    js: ['application/javascript', 'text/javascript', 'application/x-javascript'],
    images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/bmp'],
    pdf: ['application/pdf'],
    fonts: ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/x-font-ttf', 'application/x-font-otf'],
    videos: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
    audios: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
    json: ['application/json'],
    xml: ['application/xml', 'text/xml'],
    txt: ['text/plain'],
  };

  // Determina quais tipos incluir
  const allTypes = Object.keys(typeMappings);
  let includedTypes: Set<string>;
  
  if (params.include && params.include.length > 0) {
    includedTypes = new Set(params.include.filter((t: string) => allTypes.includes(t)));
  } else {
    includedTypes = new Set(allTypes);
  }
  
  // Remove tipos excluídos
  if (params.exclude && params.exclude.length > 0) {
    params.exclude.forEach((t: string) => includedTypes.delete(t));
  }

  // Estado do download
  const visitedUrls = new Set<string>();
  const assets: AssetInfo[] = [];
  const queue: Array<{ url: string; depth: number; localPath: string }> = [];
  const errors: Array<{ url: string; error: string }> = [];
  
  // Diretório base para salvar
  const baseDomain = baseUrl.hostname;
  const baseDir = params.preserve_structure ? baseDomain : 'downloaded_assets';
  const baseUri = resolveWorkspacePath(options.workspaceFolder, baseDir);
  
  // Cria diretório base
  await vscode.workspace.fs.createDirectory(baseUri);

  // Configuração do fetch
  const fetchOptions = {
    method: 'GET',
    headers: {
      'User-Agent': params.user_agent || 'Jarvis-Asset-Downloader/1.0 (+VSCode Extension)',
      'Accept': '*/*',
    },
    redirect: 'follow' as const,
  };

  // Função para determinar tipo do asset baseado no content-type ou extensão
  function getAssetType(contentType: string, url: string): string {
    // Primeiro tenta pelo content-type
    for (const [type, mimeTypes] of Object.entries(typeMappings)) {
      if (mimeTypes.some(mime => contentType.includes(mime))) {
        return type;
      }
    }
    
    // Fallback pela extensão da URL
    const ext = path.extname(url).toLowerCase().slice(1);
    const extToType: Record<string, string> = {
      'html': 'html', 'htm': 'html',
      'css': 'css',
      'js': 'js', 'mjs': 'js',
      'jpg': 'images', 'jpeg': 'images', 'png': 'images', 'gif': 'images', 
      'webp': 'images', 'svg': 'images', 'ico': 'images', 'bmp': 'images',
      'pdf': 'pdf',
      'woff': 'fonts', 'woff2': 'fonts', 'ttf': 'fonts', 'otf': 'fonts',
      'mp4': 'videos', 'webm': 'videos', 'ogg': 'videos', 'mov': 'videos',
      'mp3': 'audios', 'wav': 'audios',
      'json': 'json',
      'xml': 'xml',
      'txt': 'txt',
    };
    
    return extToType[ext] || 'other';
  }

  // Função para normalizar caminho local
  function getLocalPath(url: string, assetType: string): string {
    try {
      const urlObj = new URL(url);
      let filePath = urlObj.pathname;
      
      // Se for a raiz, usa index.html
      if (filePath === '/' || filePath === '') {
        filePath = '/index.html';
      }
      
      // Remove query strings e fragmentos
      filePath = filePath.split('?')[0].split('#')[0];
      
      // Se preserve_structure for false, organiza por tipo
      if (!params.preserve_structure) {
        const fileName = path.basename(filePath) || 'index.html';
        return path.join(assetType, fileName);
      }
      
      // Preserva estrutura completa
      return filePath;
    } catch {
      // Fallback: usa hash da URL como nome
      const hash = require('crypto').createHash('md5').update(url).digest('hex').slice(0, 8);
      const ext = assetType === 'html' ? '.html' : '.bin';
      return path.join(assetType, `file_${hash}${ext}`);
    }
  }

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

  // Adiciona URL inicial à fila
  queue.push({ url: params.url, depth: 0, localPath: '/' });

  // Loop principal de processamento
  while (queue.length > 0 && assets.length < (params.max_files || 100)) {
    const current = queue.shift()!;
    
    if (visitedUrls.has(current.url)) {
      continue;
    }
    
    if (current.depth > (params.max_depth || 3)) {
      continue;
    }
    
    visitedUrls.add(current.url);
    
    // Notifica progresso
    if (options.notify) {
      options.notify(`Processando: ${current.url} (${assets.length}/${params.max_files || 100} arquivos)`);
    }
    
    try {
      const response = await fetch(current.url, {
        method: 'GET',
        headers: {
          'User-Agent': params.user_agent || 'Nic Hyper Flow-Asset-Downloader/1.0 (+VSCode Extension)',
          'Accept': '*/*',
        },
        redirect: 'follow' as const,
      });
      const contentType = response.headers.get('content-type') || '';
      const contentLength = response.headers.get('content-length');
      const size = contentLength ? parseInt(contentLength, 10) : 0;
      
      const assetType = getAssetType(contentType, current.url);
      
      // Verifica se o tipo está incluído
      if (!includedTypes.has(assetType)) {
        assets.push({
          url: current.url,
          local_path: getLocalPath(current.url, assetType),
          type: assetType,
          size,
          status: 'skipped',
          content_type: contentType,
        });
        continue;
      }
      
      // Determina caminho local
      const localPath = getLocalPath(current.url, assetType);
      const fullLocalPath = path.join(baseDir, localPath);
      const uri = resolveWorkspacePath(options.workspaceFolder, fullLocalPath);
      
      // Garante diretório pai
      const parentDir = path.dirname(uri.fsPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));
      
      // Lê o conteúdo
      const buffer = await response.arrayBuffer();
      const byteArray = new Uint8Array(buffer);
      
      // Salva o arquivo
      if (assetType === 'html' || assetType === 'css' || assetType === 'js' || 
          assetType === 'txt' || assetType === 'json' || assetType === 'xml') {
        // Salva como texto
        const text = new TextDecoder().decode(byteArray);
        await writeFileSafe(uri, text);
        
        // Se for HTML, extrai links para continuar o crawling
        if (assetType === 'html' && current.depth < (params.max_depth || 3)) {
          const links = extractLinksFromHtml(text, new URL(current.url));
          for (const link of links) {
            if (!visitedUrls.has(link) && assets.length < (params.max_files || 100)) {
              queue.push({ 
                url: link, 
                depth: current.depth + 1, 
                localPath: getLocalPath(link, getAssetType('', link)) 
              });
            }
          }
        }
      } else {
        // Salva como binário
        await writeFileBytesSafe(uri, Buffer.from(byteArray));
      }
      
      assets.push({
        url: current.url,
        local_path: fullLocalPath,
        type: assetType,
        size: byteArray.length,
        status: 'saved',
        content_type: contentType,
      });
      
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      errors.push({ url: current.url, error: errorMsg });
      
      assets.push({
        url: current.url,
        local_path: getLocalPath(current.url, 'error'),
        type: 'error',
        size: 0,
        status: 'error',
        error: errorMsg,
      });
    }
    
    // Pequena pausa para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Calcula estatísticas
  const savedAssets = assets.filter(a => a.status === 'saved');
  const skippedAssets = assets.filter(a => a.status === 'skipped');
  const errorAssets = assets.filter(a => a.status === 'error');
  const totalSize = savedAssets.reduce((sum, a) => sum + a.size, 0);

  const stats = {
    total: assets.length,
    saved: savedAssets.length,
    skipped: skippedAssets.length,
    errors: errorAssets.length,
    total_size: totalSize,
    by_type: {} as Record<string, number>,
  };

  // Conta por tipo
  for (const asset of savedAssets) {
    stats.by_type[asset.type] = (stats.by_type[asset.type] || 0) + 1;
  }

  return {
    status: assets.length >= (params.max_files || 100) ? 'max_files_reached' : 'completed',
    stats,
    assets: assets.slice(0, 50), // Retorna apenas os primeiros 50 para não sobrecarregar
    directory: baseUri.fsPath.replace(/\\\\/g, '/'),
    errors: errors.slice(0, 10),
    _total_processed: visitedUrls.size,
    _queue_remaining: queue.length,
  };
}