import * as fs from 'fs';
import * as path from 'path';
import {
  resolveWorkspacePath,
  readFileSafe,
  makeRelativeToWorkspaceRoot
} from './utils';
import { ExecuteToolOptions } from './types';

async function executeReadFileExactRange(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const targetPath = args.path;
  if (!targetPath) {
    throw new Error('read_multiple_files requires each file object to include path');
  }

  const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);

  let fileExists = fs.existsSync(uri.fsPath);
  if (!fileExists) {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 50));
      if (fs.existsSync(uri.fsPath)) {
        fileExists = true;
        break;
      }
    }
  }

  if (!fileExists) {
    throw new Error(
      `File not found: "${targetPath}" (workspace: ${options.workspaceFolder.uri.fsPath})`
    );
  }

  const stats = fs.statSync(uri.fsPath);
  if (stats.isDirectory()) {
    throw new Error(
      `The specified path is a directory, not a file: "${targetPath}". Use list_dir instead.`
    );
  }

  const fileName = path.basename(uri.fsPath).toLowerCase();
  const forbiddenFiles = new Set([
    'jarvis_i_o.md',
    'nic_debug.md',
    'pkb_v2.jsonl',
    '.vscodeignore',
    'pkb.jsonl',
    'assets_registry.json'
  ]);

  if (forbiddenFiles.has(fileName)) {
    throw new Error(
      `Access denied: the file "${fileName}" cannot be read by the model.`
    );
  }

  const imageExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.bmp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.avif', '.pdf'
  ]);

  const ext = path.extname(uri.fsPath).toLowerCase();
  if (imageExtensions.has(ext)) {
    throw new Error(
      'Access denied: image or pdf files cannot be read with read_multiple_files. Use get_image or read_pdf_ref instead.'
    );
  }

  const rawContent = await readFileSafe(uri);
  const allLines = rawContent.split(/\r?\n/);
  const totalLines = allLines.length;

  let from = 1;
  let to = totalLines;

  const startLineArg = args.startLine !== undefined ? parseInt(args.startLine, 10) : NaN;
  const endLineArg = args.endLine !== undefined ? parseInt(args.endLine, 10) : NaN;
  const isRangeRequest = !Number.isNaN(startLineArg) || !Number.isNaN(endLineArg);

  if (isRangeRequest) {
    from = Number.isNaN(startLineArg)
      ? 1
      : Math.max(1, Math.floor(startLineArg));
    to = Number.isNaN(endLineArg)
      ? totalLines
      : Math.min(totalLines, Math.floor(endLineArg));

    if (from > to) {
      to = from;
    }
  }

  const MAX_ALLOWED_LINES = 10005;
  const AUTO_CHUNK_SIZE = 10000;
  let systemWarning = '';
  const requestedCount = to - from + 1;

  if (requestedCount > MAX_ALLOWED_LINES) {
    to = Math.min(totalLines, from + AUTO_CHUNK_SIZE - 1);
    systemWarning +=
      `\n[SYSTEM NOTIFICATION: Large file (${totalLines} lines). Showing lines ${from}-${to}. Continue reading in chunks of 10,000 lines.]`;
  }

  const slicedLines = allLines.slice(from - 1, to);
  const relativePath = makeRelativeToWorkspaceRoot(options.workspaceFolder, uri.fsPath);

  const result: any = {
    path: relativePath,
    content: slicedLines.join('\n'),
    startLine: from,
    endLine: to,
    totalLines
  };

  if (systemWarning) {
    result.systemWarning = systemWarning;
  }

  return result;
}

/**
 * Tool: read_multiple_files
 * 
 * Responsabilidades:
 * - Ler múltiplos arquivos de uma vez.
 * - Suporta leitura de intervalos de linhas para cada arquivo.
 * - Respeita ranges exatos sem expansão automática de janela.
 */
export async function executeReadMultipleFiles(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const files = args.files;
  if (!files || !Array.isArray(files)) {
    throw new Error('read_multiple_files requires args.files as an array of objects');
  }

  if (files.length === 0) {
    return {
      files: [],
      results: []
    };
  }

  const MAX_FILES = 20;
  const effectiveFiles = files.slice(0, MAX_FILES);

  const results = await Promise.all(
    effectiveFiles.map(async (fileObj: any) => {
      const path = typeof fileObj === 'string' ? fileObj : fileObj.path;
      const startLine = typeof fileObj === 'string' ? undefined : fileObj.startLine;
      const endLine = typeof fileObj === 'string' ? undefined : fileObj.endLine;

      if (!path) {
        return { error: 'Missing path in file object', success: false };
      }

      try {
        const fileResult = await executeReadFileExactRange({ path, startLine, endLine }, options);
        return { ...fileResult, success: true };
      } catch (error: any) {
        return {
          path,
          error: error.message || String(error),
          success: false
        };
      }
    })
  );

  return {
    files: results.map(r => r.path || 'unknown').filter(Boolean),
    results
  };
}
