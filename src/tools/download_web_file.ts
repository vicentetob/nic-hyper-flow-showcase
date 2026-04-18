import * as path from 'path';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import { ExecuteToolOptions } from './types';
import { resolveWorkspacePath, writeFileBytesSafe, writeFileSafe } from './utils';
import { stripHtmlToText } from './web_search';

interface DownloadItem {
  url: string;
  path: string;
  mode?: string;
}

interface DownloadProgress {
  url: string;
  path: string;
  loaded: number;
  total: number;
  percentage: number;
  status: 'pending' | 'downloading' | 'saving' | 'done' | 'error';
  error?: string;
}

/**
 * Tool: download_web_file
 * Baixa um ou múltiplos documentos da web e salva em arquivos dentro do workspace.
 *
 * Args:
 * - url: string (obrigatório se files não for fornecido)
 * - path: string (obrigatório se files não for fornecido)
 * - files: array de {url, path, mode?} (opcional, para múltiplos downloads)
 * - maxBytes: number (opcional, padrão 1000000)
 * - mode: "raw" | "text" | "binary" (opcional; "text" limpa HTML -> texto; "binary" grava bytes; padrão "raw")
 *
 * Retorno:
 * - Se um arquivo: {url, path, bytes, contentType, saved, preview?, sha256?}
 * - Se múltiplos: {results: [...], total: {...}, summary: {...}}
 */
export async function executeDownloadWebFile(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  // Suporta múltiplos downloads via array 'files' ou download único via 'url' e 'path'
  const files = args.files;
  let downloadItems: DownloadItem[] = [];

  if (files && Array.isArray(files)) {
    // Múltiplos downloads
    downloadItems = files.map((f: any) => ({
      url: String(f.url ?? '').trim(),
      path: String(f.path ?? '').trim(),
      mode: f.mode ? String(f.mode).trim().toLowerCase() : undefined,
    }));
    // Filtra itens válidos
    downloadItems = downloadItems.filter(item => item.url && item.path);
    if (downloadItems.length === 0) {
      throw new Error('download_web_file: array "files" vazio ou inválido');
    }
  } else {
    // Download único (compatibilidade retroativa)
    const url = String(args.url ?? '').trim();
    const targetPath = String(args.path ?? '').trim();
    if (!url) throw new Error('download_web_file requer args.url ou args.files');
    if (!targetPath) throw new Error('download_web_file requer args.path ou args.files');
    downloadItems = [{ url, path: targetPath, mode: args.mode ? String(args.mode).trim().toLowerCase() : undefined }];
  }

  // Se houver apenas um arquivo, mantém comportamento original (retorna objeto único)
  if (downloadItems.length === 1) {
    return await downloadSingleFile(downloadItems[0], args, options);
  }

  // Múltiplos downloads em paralelo com barras de progresso
  return await downloadMultipleFiles(downloadItems, args, options);
}

async function downloadSingleFile(
    item: DownloadItem,
    args: Record<string, any>,
    options: ExecuteToolOptions
  ): Promise<any> {
    const url = item.url;
    const targetPath = item.path;
  
    const maxBytes = Math.max(10_000, Math.min(5_000_000, Number.isFinite(Number(args.maxBytes)) ? Math.floor(Number(args.maxBytes)) : 1_000_000));
    const mode = item.mode ?? String(args.mode ?? 'raw').trim().toLowerCase(); // raw | text | binary
  
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'User-Agent': 'Jarvis/1.0 (+VSCode Extension)',
        },
        redirect: 'follow',
      });
  
      const contentType = String(resp.headers.get('content-type') ?? '');
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`download_web_file falhou: HTTP ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
  
      const total = Number(resp.headers.get('content-length'));
      const chunks: Buffer[] = [];
      let downloaded = 0;
      let lastNotify = 0;
  
      if (options.notify) {
        options.notify(`Download de ${path.basename(targetPath)} iniciado...`);
      }
  
      for await (const chunk of resp.body) {
        const bufferChunk = chunk as Buffer;
        downloaded += bufferChunk.length;
        chunks.push(bufferChunk);
        
        const now = Date.now();
        if (options.notify && (now - lastNotify > 200)) { // notify every 200ms
          const percentage = total > 0 ? Math.round((downloaded / total) * 100) : -1;
          if (percentage >= 0) {
              options.notify(`Download de ${path.basename(targetPath)}: ${percentage}%`);
          } else {
              options.notify(`Download de ${path.basename(targetPath)}: ${Math.round(downloaded/1024)}KB`);
          }
          lastNotify = now;
        }
      }

      if (options.notify) {
        options.notify(`Download de ${path.basename(targetPath)} concluído`);
      }
  
      const buf = Buffer.concat(chunks);
      const clipped = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  
      const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);
  
      // Garante diretório pai
      const parentDir = path.dirname(uri.fsPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));
  
      // Detecta se é conteúdo binário (imagens, PDFs, etc)
      const isBinaryContent = mode === 'binary' || 
        contentType.toLowerCase().includes('image/') ||
        contentType.toLowerCase().includes('application/pdf') ||
        contentType.toLowerCase().includes('application/octet-stream') ||
        contentType.toLowerCase().includes('video/') ||
        contentType.toLowerCase().includes('audio/') ||
        contentType.toLowerCase().includes('application/zip') ||
        contentType.toLowerCase().includes('application/x-');
  
      if (isBinaryContent || mode === 'binary') {
        const bytes = Buffer.from(clipped);
        await writeFileBytesSafe(uri, bytes);
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        return {
          url,
          path: uri.fsPath.replace(/\\/g, '/'),
          bytes: bytes.byteLength,
          contentType,
          saved: true,
          sha256,
          truncated: buf.byteLength > maxBytes,
        };
      } else {
        let text = Buffer.from(clipped).toString('utf8');
        if (mode === 'text') {
          // Se veio HTML, transforma em texto mais legível
          if (String(contentType).toLowerCase().includes('html')) {
            text = stripHtmlToText(text);
          } else {
            text = text.trim();
          }
          text += '\n';
        }
        await writeFileSafe(uri, text);
        const preview = text.length > 400 ? text.slice(0, 400) + '\n…(truncado)…' : text;
        return {
          url,
          path: uri.fsPath.replace(/\\/g, '/'),
          bytes: text.length,
          contentType,
          saved: true,
          preview,
          truncated: buf.byteLength > maxBytes,
        };
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      throw new Error(msg);
    }
}

async function downloadMultipleFiles(
  items: DownloadItem[],
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const maxBytes = Math.max(10_000, Math.min(5_000_000, Number.isFinite(Number(args.maxBytes)) ? Math.floor(Number(args.maxBytes)) : 1_000_000));

  // Estado de progresso para cada arquivo
  const progress: Map<string, DownloadProgress> = new Map();
  items.forEach((item, index) => {
    progress.set(item.url, {
      url: item.url,
      path: item.path,
      loaded: 0,
      total: 0,
      percentage: 0,
      status: 'pending',
    });
  });

  let lastProgressUpdate = 0;
  const PROGRESS_UPDATE_INTERVAL = 200; // Atualiza progresso a cada 200ms

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  function renderProgressBar(percentage: number, width: number = 30): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
  }

  function updateProgressDisplay(): void {
    const now = Date.now();
    if (now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL) return;
    lastProgressUpdate = now;

    // Calcula progresso geral
    let totalLoaded = 0;
    let totalSize = 0;
    let doneCount = 0;
    let errorCount = 0;

    progress.forEach(p => {
      totalLoaded += p.loaded;
      if (p.total > 0) {
        totalSize += p.total;
      }
      if (p.status === 'done') doneCount++;
      if (p.status === 'error') errorCount++;
    });

    const overallPercentage = totalSize > 0 ? (totalLoaded / totalSize) * 100 : 0;

    // Monta o bloco de progresso
    const progressLines: string[] = [];
    
    // Barra de progresso geral
    progressLines.push(`📥 Downloads em paralelo: ${doneCount + errorCount}/${items.length} concluídos`);
    progressLines.push(`   ${renderProgressBar(overallPercentage)} ${Math.round(overallPercentage)}% | ${formatBytes(totalLoaded)}/${totalSize > 0 ? formatBytes(totalSize) : '?'}`);
    progressLines.push(''); // linha em branco

    // Barras de progresso individuais
    items.forEach((item, index) => {
      const p = progress.get(item.url)!;
      const fileName = path.basename(p.path);
      const statusIcon = 
        p.status === 'done' ? '✅' :
        p.status === 'error' ? '❌' :
        p.status === 'saving' ? '💾' :
        p.status === 'downloading' ? '⬇️' :
        '⏳';

      const progressInfo = p.total > 0 
        ? `${renderProgressBar(p.percentage)} ${Math.round(p.percentage)}% | ${formatBytes(p.loaded)}/${formatBytes(p.total)}`
        : `${renderProgressBar(0)} ${formatBytes(p.loaded)}`;

      progressLines.push(`   ${statusIcon} [${index + 1}] ${fileName.padEnd(30)} ${progressInfo}`);
      if (p.error) {
        progressLines.push(`      ⚠️ ${p.error.substring(0, 60)}`);
      }
    });

    // Mostra/atualiza o progresso
    // Como OutputChannel não suporta limpar linhas, sempre adiciona novas
    // O usuário pode acompanhar o progresso pelo scroll
    progressLines.forEach(line => {
      options.outputChannel.appendLine(line);
    });
    options.outputChannel.appendLine('');

    // Garante que o output channel está visível
    options.outputChannel.show(true);

    // Notifica via callback se disponível
    if (options.notify) {
      options.notify(`Downloads: ${doneCount + errorCount}/${items.length} | ${Math.round(overallPercentage)}%`);
    }
  }

  // Inicia downloads em paralelo
  options.outputChannel.appendLine(`\n🚀 Iniciando download de ${items.length} arquivo(s) em paralelo...\n`);

  const downloadPromises = items.map(async (item, index) => {
    const url = item.url;
    const targetPath = item.path;
    const mode = item.mode ?? String(args.mode ?? 'raw').trim().toLowerCase();
    const prog = progress.get(url)!;

    try {
      prog.status = 'downloading';
      updateProgressDisplay();

      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: '*/*',
            'User-Agent': 'Jarvis/1.0 (+VSCode Extension)',
          },
          redirect: 'follow',
        });

        const contentType = String(resp.headers.get('content-type') ?? '');
        const contentLength = resp.headers.get('content-length');
        
        if (contentLength) {
          prog.total = parseInt(contentLength, 10);
        }

        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }

        const chunks: Buffer[] = [];
        for await (const chunk of resp.body) {
            const bufferChunk = chunk as Buffer;
            prog.loaded += bufferChunk.length;
            chunks.push(bufferChunk);
            if (prog.total > 0) {
                prog.percentage = (prog.loaded / prog.total) * 100;
            }
            updateProgressDisplay();
        }
        const buf = Buffer.concat(chunks);
        
        if (prog.total > 0) {
            prog.percentage = 100;
            prog.loaded = prog.total;
        }
        updateProgressDisplay();
        
        const clipped = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;

        prog.status = 'saving';
        updateProgressDisplay();

        const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);

        // Garante diretório pai
        const parentDir = path.dirname(uri.fsPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));

        // Detecta se é conteúdo binário
        const isBinaryContent = mode === 'binary' || 
          contentType.toLowerCase().includes('image/') ||
          contentType.toLowerCase().includes('application/pdf') ||
          contentType.toLowerCase().includes('application/octet-stream') ||
          contentType.toLowerCase().includes('video/') ||
          contentType.toLowerCase().includes('audio/') ||
          contentType.toLowerCase().includes('application/zip') ||
          contentType.toLowerCase().includes('application/x-');

        let result: any;

        if (isBinaryContent || mode === 'binary') {
          const bytes = Buffer.from(clipped);
          await writeFileBytesSafe(uri, bytes);
          const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
          result = {
            url,
            path: uri.fsPath.replace(/\\/g, '/'),
            bytes: bytes.byteLength,
            contentType,
            saved: true,
            sha256,
            truncated: buf.byteLength > maxBytes,
          };
        } else {
          let text = Buffer.from(clipped).toString('utf8');
          if (mode === 'text') {
            if (String(contentType).toLowerCase().includes('html')) {
              text = stripHtmlToText(text);
            } else {
              text = text.trim();
            }
            text += '\n';
          }
          await writeFileSafe(uri, text);
          const preview = text.length > 400 ? text.slice(0, 400) + '\n…(truncado)…' : text;
          result = {
            url,
            path: uri.fsPath.replace(/\\/g, '/'),
            bytes: text.length,
            contentType,
            saved: true,
            preview,
            truncated: buf.byteLength > maxBytes,
          };
        }

        prog.status = 'done';
        updateProgressDisplay();

        return result;
      } catch (err: any) {
        throw err;
      }
    } catch (err: any) {
      prog.status = 'error';
      prog.error = err?.message ?? String(err);
      updateProgressDisplay();
      return {
        url,
        path: targetPath,
        saved: false,
        error: prog.error,
      };
    }
  });

  // Aguarda todos os downloads terminarem
  const results = await Promise.all(downloadPromises);

  // Exibe resultado final
  const successCount = results.filter(r => r.saved).length;
  const errorCount = results.filter(r => !r.saved).length;
  const totalBytes = results.reduce((sum, r) => sum + (r.bytes || 0), 0);

  options.outputChannel.appendLine(`\n✅ Downloads concluídos: ${successCount} sucesso, ${errorCount} erro(s)`);
  options.outputChannel.appendLine(`   Total baixado: ${formatBytes(totalBytes)}\n`);

  return {
    results,
    total: {
      files: items.length,
      success: successCount,
      errors: errorCount,
      totalBytes,
    },
    summary: {
      status: errorCount === 0 ? 'success' : (successCount > 0 ? 'partial' : 'failed'),
      message: errorCount === 0 
        ? `Todos os ${successCount} arquivo(s) foram baixados com sucesso`
        : `${successCount} de ${items.length} arquivo(s) baixados com sucesso`,
    },
  };
}