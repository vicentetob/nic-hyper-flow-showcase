import * as vscode from 'vscode';
import * as fs from 'fs';
import { ExecuteToolOptions } from './types';
import { resolveWorkspacePath, readFileSafe, writeFileSafe, normalizeLineEndings } from './utils';

export type BatchOperationType = 'patch_file' | 'create' | 'replace' | 'delete';

export interface BatchOperation {
  type: BatchOperationType;
  path: string;
  exact_match?: string;
  content?: string;
  occurrence?: number;
}

export interface BatchOperationResult {
  index: number;
  type: BatchOperationType;
  path: string;
  success: boolean;
  modified?: boolean;
  error?: string;
  rolledBack?: boolean;
  diff?: string;
}

export interface ApplyPatchBatchResult {
  transactionId: string;
  success: boolean;
  appliedCount: number;
  failedCount: number;
  rolledBackCount: number;
  operations: BatchOperationResult[];
  error?: string;
}

interface FileSnapshot {
  path: string;
  existed: boolean;
  content: string | null;
}

async function snapshotFile(
  workspaceFolder: vscode.WorkspaceFolder,
  filePath: string
): Promise<FileSnapshot> {
  const uri = resolveWorkspacePath(workspaceFolder, filePath);
  const existed = fs.existsSync(uri.fsPath);
  let content: string | null = null;
  if (existed) {
    try { content = await readFileSafe(uri); } catch { content = null; }
  }
  return { path: filePath, existed, content };
}

async function restoreSnapshot(
  workspaceFolder: vscode.WorkspaceFolder,
  snapshot: FileSnapshot
): Promise<void> {
  const uri = resolveWorkspacePath(workspaceFolder, snapshot.path);
  if (!snapshot.existed) {
    try { fs.unlinkSync(uri.fsPath); } catch { /* ignore */ }
  } else if (snapshot.content !== null) {
    await writeFileSafe(uri, snapshot.content);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) { return 0; }
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) { break; }
    count++;
    from = idx + Math.max(1, needle.length);
  }
  return count;
}

function indexOfNth(haystack: string, needle: string, occurrence: number): number {
  if (!needle) { return -1; }
  let idx = -1;
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    idx = haystack.indexOf(needle, from);
    if (idx === -1) { return -1; }
    from = idx + Math.max(1, needle.length);
  }
  return idx;
}

async function applyOperation(
  op: BatchOperation,
  workspaceFolder: vscode.WorkspaceFolder,
  options: ExecuteToolOptions
): Promise<{ modified: boolean; added?: number; removed?: number; diff?: string }> {
  const uri = resolveWorkspacePath(workspaceFolder, op.path);

  switch (op.type) {
    case 'patch_file': {
      if (!op.exact_match) { throw new Error(`patch_file requer exact_match`); }
      if (op.content === undefined) { throw new Error(`patch_file requer content (replacement)`); }
      const raw = await readFileSafe(uri);
      const content = normalizeLineEndings(raw);
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const total = countOccurrences(content, op.exact_match);
      if (total === 0) { throw new Error(`exact_match não encontrado em "${op.path}"`); }
      const occ = op.occurrence ?? 0;
      if (occ >= total) { throw new Error(`occurrence ${occ} fora do range (total: ${total})`); }
      const idx = indexOfNth(content, op.exact_match, occ);
      if (idx === -1) { throw new Error(`Falha ao localizar exact_match em "${op.path}"`); }
      const after =
        content.slice(0, idx) +
        normalizeLineEndings(op.content) +
        content.slice(idx + op.exact_match.length);
      const final = eol === '\r\n' ? after.replace(/\n/g, '\r\n') : after;
      
      const modified = after !== content;
      
      if (modified) {
        await writeFileSafe(uri, final);
      }
      
      let added = 0;
      let removed = 0;
      let diffContext = '';
      
      if (modified) {
        // dynamic import of diff
        const diff = await import('diff');
        const diffResult = diff.diffLines(content, after);
        for (const part of diffResult) {
          if (part.added) {
            added += part.count || 1;
          } else if (part.removed) {
            removed += part.count || 1;
          }
        }
        
        // build the diff context for UI
        const { buildPatchFeedback } = await import('./patch_feedback.js');
        const feedback = buildPatchFeedback({ path: op.path, beforeText: content, afterText: after });
        if (feedback && feedback.diff) {
            diffContext = feedback.diff;
        }
      }

      return { modified, added, removed, diff: diffContext };
    }

    case 'create': {
      if (op.content === undefined) { throw new Error(`create requer content`); }
      const dir = uri.fsPath.replace(/[/\\][^/\\]+$/, '');
      fs.mkdirSync(dir, { recursive: true });
      await writeFileSafe(uri, op.content);
      return { modified: true };
    }

    case 'replace': {
      if (op.content === undefined) { throw new Error(`replace requer content`); }
      await writeFileSafe(uri, op.content);
      return { modified: true };
    }

    case 'delete': {
      if (!fs.existsSync(uri.fsPath)) { throw new Error(`Arquivo não encontrado: "${op.path}"`); }
      fs.unlinkSync(uri.fsPath);
      return { modified: true };
    }

    default:
      throw new Error(`Tipo de operação desconhecido: ${(op as any).type}`);
  }
}

export async function executeApplyPatchBatch(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<ApplyPatchBatchResult> {
  const operations: BatchOperation[] = args.operations ?? [];
  const rollbackOnFailure: boolean = args.rollbackOnFailure !== false;
  const dryRun: boolean = args.dryRun === true;
  const transactionId: string = args.transactionId ?? `batch-${Date.now()}`;

  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error(`apply_patch_batch requer pelo menos uma operação em "operations"`);
  }

  const results: BatchOperationResult[] = [];
  const snapshots: FileSnapshot[] = [];
  let failedIndex = -1;

  if (dryRun) {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      results.push({ index: i, type: op.type, path: op.path, success: true, modified: false });
    }
    return { transactionId, success: true, appliedCount: 0, failedCount: 0, rolledBackCount: 0, operations: results };
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    if (rollbackOnFailure) {
      try {
        const snap = op.type === 'create'
          ? { path: op.path, existed: false, content: null }
          : await snapshotFile(options.workspaceFolder, op.path);
        snapshots.push(snap);
      } catch {
        snapshots.push({ path: op.path, existed: false, content: null });
      }
    }

    try {
      const result = await applyOperation(op, options.workspaceFolder, options);
      results.push({ index: i, type: op.type, path: op.path, success: true, modified: result.modified, diff: result.diff });
      
      if (result.modified && result.added !== undefined && result.removed !== undefined) {
        options.sidebarProvider?.notifyFileModified?.(op.path, 'modified', result.added, result.removed);
      }
    } catch (err: any) {
      failedIndex = i;
      results.push({ index: i, type: op.type, path: op.path, success: false, error: err?.message ?? String(err) });
      break;
    }
  }

  let rolledBackCount = 0;
  if (failedIndex !== -1 && rollbackOnFailure) {
    const appliedSnapshots = snapshots.slice(0, failedIndex);
    for (let j = appliedSnapshots.length - 1; j >= 0; j--) {
      try {
        await restoreSnapshot(options.workspaceFolder, appliedSnapshots[j]);
        results[j].rolledBack = true;
        rolledBackCount++;
      } catch (rollbackErr: any) {
        results[j].error = (results[j].error ?? '') + ` | Rollback falhou: ${rollbackErr?.message}`;
      }
    }
  }

  const appliedCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const overallSuccess = failedCount === 0;

  return {
    transactionId,
    success: overallSuccess,
    appliedCount,
    failedCount,
    rolledBackCount,
    operations: results,
    ...(overallSuccess ? {} : { error: `Operação ${failedIndex} falhou. ${rolledBackCount} operações revertidas.` }),
  };
}

