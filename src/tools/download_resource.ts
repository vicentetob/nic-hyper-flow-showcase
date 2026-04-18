import * as path from 'path';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import { ExecuteToolOptions } from './types';
import { resolveWorkspacePath, writeFileBytesSafe, writeFileSafe } from './utils';

interface DownloadResourceArgs {
  url: string;
  save_as?: string;
  max_bytes?: number;
  timeout_ms?: number;
}

/**
 * Tool: download_resource
 * Baixa um arquivo específico da web e salva localmente
 * 
 * Args:
 * - url: string (URL direta do arquivo)
 * - save_as: string (nome do arquivo para salvar, opcional - será inferido da URL se não fornecido)
 * - max_bytes: number (tamanho máximo em bytes, padrão: 10MB)
 * - timeout_ms: number (timeout em ms, padrão: 30000)
 * 
 * Output:
 * {
 *   "status": "ok",
 *   "file": "manual.pdf",
 *   "size": 2345678,
 *   "content_type": "application/pdf",
 *   "path": "/caminho/completo/manual.pdf",
 *   "sha256": "abc123...",
 *   "saved": true
 * }
 */
export async function executeDownloadResource(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const params: DownloadResourceArgs = {
    url: String(args.url ?? '').trim(),
    save_as: args.save_as ? String(args.save_as).trim() : undefined,
    max_bytes: Math.max(1024, Math.min(100 * 1024 * 1024, Number(args.max_bytes ?? 10 * 1024 * 1024))), // 10MB padrão
    timeout_ms: Math.max(1000, Math.min(120000, Number(args.timeout_ms ?? 30000))),
  };

  if (!params.url) {
    throw new Error('download_resource requer uma URL válida no parâmetro "url"');
  }

  // Determina o nome do arquivo
  let filename = params.save_as;
  if (!filename) {
    try {
      const urlObj = new URL(params.url);
      const pathname = urlObj.pathname;
      filename = path.basename(pathname) || 'downloaded_file';
      
      // Se não tiver extensão, tenta inferir do content-type
      if (!path.extname(filename)) {
        // Será ajustado depois com base no content-type
        filename = 'downloaded_file';
      }
    } catch {
      filename = 'downloaded_file';
    }
  }

  // Garante que o filename é seguro
  filename = filename.replace(/[<>:"/\\|?*]/g, '_');

  try {
    // Notifica início do download
    if (options.notify) {
      options.notify(`Iniciando download: ${filename}`);
    }

    // Faz a requisição
    const response = await fetch(params.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Jarvis-Downloader/1.0 (+VSCode Extension)',
        'Accept': '*/*',
      },
      redirect: 'follow' as const,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

    // Ajusta extensão do arquivo baseado no content-type se necessário
    if (!path.extname(filename)) {
      const ext = getExtensionFromContentType(contentType);
      if (ext) {
        filename += ext;
      }
    }

    // Resolve o caminho no workspace
    const uri = resolveWorkspacePath(options.workspaceFolder, filename);
    
    // Garante diretório pai
    const parentDir = path.dirname(uri.fsPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));

    // Lê o conteúdo com limite de tamanho
    const chunks: Buffer[] = [];
    let downloaded = 0;
    
    if (options.notify && totalSize > 0) {
      options.notify(`Download: 0% (0/${Math.round(totalSize/1024)}KB)`);
    }

    for await (const chunk of response.body) {
      const bufferChunk = chunk as Buffer;
      downloaded += bufferChunk.length;
      chunks.push(bufferChunk);

      // Notifica progresso a cada 10% ou 1MB
      if (options.notify && totalSize > 0) {
        const percentage = Math.round((downloaded / totalSize) * 100);
        if (percentage % 10 === 0 || downloaded % (1024 * 1024) === 0) {
          options.notify(`Download: ${percentage}% (${Math.round(downloaded/1024)}/${Math.round(totalSize/1024)}KB)`);
        }
      }

      // Verifica limite de tamanho
      if (downloaded > (params.max_bytes || 10 * 1024 * 1024)) {
        throw new Error(`Arquivo excede limite máximo de ${params.max_bytes || 10 * 1024 * 1024} bytes`);
      }
    }

    const buffer = Buffer.concat(chunks);
    
    // Verifica se é conteúdo binário
    const isBinary = isBinaryContentType(contentType);
    
    let fileSize: number;
    let sha256Hash: string;

    if (isBinary) {
      // Salva como binário
      await writeFileBytesSafe(uri, buffer);
      fileSize = buffer.byteLength;
      sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    } else {
      // Salva como texto
      const text = buffer.toString('utf8');
      await writeFileSafe(uri, text);
      fileSize = text.length;
      sha256Hash = crypto.createHash('sha256').update(text).digest('hex');
    }

    // Notifica conclusão
    if (options.notify) {
      options.notify(`Download concluído: ${filename} (${formatBytes(fileSize)})`);
    }

    return {
      status: 'ok',
      file: filename,
      size: fileSize,
      content_type: contentType,
      path: uri.fsPath.replace(/\\\\/g, '/'),
      sha256: sha256Hash,
      saved: true,
      url: params.url,
    };

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    if (options.notify) {
      options.notify(`Erro no download: ${errorMsg}`);
    }
    throw new Error(`download_resource falhou: ${errorMsg}`);
  }
}

// Funções auxiliares
function getExtensionFromContentType(contentType: string): string {
  const mappings: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/html': '.html',
    'text/css': '.css',
    'application/javascript': '.js',
    'application/json': '.json',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
  };

  for (const [type, ext] of Object.entries(mappings)) {
    if (contentType.includes(type)) {
      return ext;
    }
  }

  return '';
}

function isBinaryContentType(contentType: string): boolean {
  const binaryTypes = [
    'image/',
    'audio/',
    'video/',
    'application/pdf',
    'application/zip',
    'application/x-',
    'application/octet-stream',
    'application/vnd.',
  ];

  return binaryTypes.some(type => contentType.includes(type));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}