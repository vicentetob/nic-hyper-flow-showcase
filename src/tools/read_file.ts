import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveWorkspacePath,
  readFileSafe,
  makeRelativeToWorkspaceRoot
} from './utils';
import { ExecuteToolOptions } from './types';

/**
 * Tool: read_file
 *
 * Responsibilities:
 * - Safely read text files
 * - Handle FS latency and race conditions
 * - Respect context/token limits
 * - Prevent access to sensitive or binary files
 * - Be multi-root and VS Code Web safe
 */
export async function executeReadFile(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const targetPath = args.path;
  if (!targetPath) {
    throw new Error('read_file requires args.path');
  }

  // Always resolve paths relative to the selected workspace folder
  const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);

  // =====================================================
  // Verify-Before-Act (handles FS latency / race conditions)
  // =====================================================
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

  // =====================================================
  // Security: blocked sensitive files
  // =====================================================
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

  // =====================================================
  // Security: block images / binary content
  // =====================================================
  const imageExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.bmp', '.svg', '.ico', '.tiff', '.tif' ,'.heic', '.avif','.pdf'
  ]);

  const ext = path.extname(uri.fsPath).toLowerCase();
  if (imageExtensions.has(ext)) {
    throw new Error(
      'Access denied: image or pdf files cannot be read with read_file. Use get_image or read_pdf_ref instead.'
    );
  }

  // =====================================================
  // Special file: .vscodeignore
  // =====================================================
  // IMPORTANT:
  // - May not exist
  // - Not required in a workspace
  // - Intended for build/publish time, not runtime logic
  // - Must NEVER crash the extension
  const isVSCodeIgnore = fileName === '.vscodeignore';

  try {
    let rawContent = '';

    if (isVSCodeIgnore) {
      // Defensive handling: optional file
      if (fs.existsSync(uri.fsPath)) {
        rawContent = await readFileSafe(uri);
      } else {
        rawContent = '';
      }
    } else {
      rawContent = await readFileSafe(uri);
    }

    const allLines = rawContent.split(/\r?\n/);
    const totalLines = allLines.length;

    // =====================================================
    // Range handling
    // =====================================================
    let from = 1;
    let to = totalLines;
    let systemWarning = '';

    const MIN_READ_LINES = 20;

    const startLineArg = args.startLine ? parseInt(args.startLine, 10) : NaN;
    const endLineArg = args.endLine ? parseInt(args.endLine, 10) : NaN;

    const isRangeRequest =
      !Number.isNaN(startLineArg) || !Number.isNaN(endLineArg);

    if (isRangeRequest) {
      from = Number.isNaN(startLineArg)
        ? 1
        : Math.max(1, Math.floor(startLineArg));
      to = Number.isNaN(endLineArg)
        ? totalLines
        : Math.min(totalLines, Math.floor(endLineArg));

      if (from > to) to = from;
    }

    // =====================================================
    // Minimum context window expansion - SEMPRE forçar mínimo de 60 linhas
    // =====================================================
    if (totalLines <= MIN_READ_LINES) {
      from = 1;
      to = totalLines;

      if (isRangeRequest) {
        systemWarning +=
          `\n[SYSTEM NOTIFICATION: Small file (${totalLines} lines). Full content is shown.]`;
      }
    } else {
      // SEMPRE garantir pelo menos MIN_READ_LINES, mesmo sem range request
      const requestedCount = to - from + 1;
      
      if (requestedCount < MIN_READ_LINES) {
        const center = Math.floor((from + to) / 2);
        const half = Math.floor(MIN_READ_LINES / 2);

        let newFrom = center - half;
        let newTo = newFrom + MIN_READ_LINES - 1;

        if (newFrom < 1) {
          newFrom = 1;
          newTo = MIN_READ_LINES;
        }

        if (newTo > totalLines) {
          newTo = totalLines;
          newFrom = totalLines - MIN_READ_LINES + 1;
        }

        from = newFrom;
        to = newTo;

        systemWarning +=
          `\n[SYSTEM NOTIFICATION: Read window expanded to ${MIN_READ_LINES} lines for better context.]`;
      }
    }

    // =====================================================
    // Hard maximum limit
    // =====================================================
    const MAX_ALLOWED_LINES = 10005;
    const AUTO_CHUNK_SIZE = 10000;

    let requestedCount = to - from + 1;

    if (requestedCount > MAX_ALLOWED_LINES) {
      to = Math.min(totalLines, from + AUTO_CHUNK_SIZE - 1);

      systemWarning +=
        `\n[SYSTEM NOTIFICATION: Large file (${totalLines} lines). Showing lines ${from}-${to}. Continue reading in chunks of 10,000 lines.]`;
    }

    // =====================================================
    // Final slice
    // =====================================================
    const slicedLines = allLines.slice(from - 1, to);

    const relativePath = makeRelativeToWorkspaceRoot(
      options.workspaceFolder,
      uri.fsPath
    );

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
  } catch (err: any) {
    throw new Error(
      `Failed to read file "${targetPath}": ${err?.message ?? err}`
    );
  }
}
