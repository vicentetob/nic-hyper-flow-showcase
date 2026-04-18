import * as diff from 'diff';
import { normalizeLineEndings } from './utils';

export type PatchContextWindow = {
  /** 1-based, inclusive */
  startLine: number;
  /** 1-based, inclusive */
  endLine: number;
  /** Lines before the changed region (from the *post-patch* file) */
  before: string[];
  /** Lines inside the changed region (from the *post-patch* file) */
  changed: string[];
  /** Lines after the changed region (from the *post-patch* file) */
  after: string[];
  /** Convenience: `before + changed + after` joined by '\n' */
  snippet: string;
};

function splitLinesNoTrailingEmpty(text: string): string[] {
  const normalized = normalizeLineEndings(text ?? '');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function countLines(chunk: string): number {
  return splitLinesNoTrailingEmpty(chunk).length;
}

function computeChangedNewLineRange(beforeText: string, afterText: string): { startLine: number; endLine: number } {
  const before = normalizeLineEndings(beforeText ?? '');
  const after = normalizeLineEndings(afterText ?? '');

  const parts = diff.diffLines(before, after);
  let newLine = 1;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const p of parts) {
    const n = countLines(p.value);
    if (p.added) {
      if (n > 0) {
        min = Math.min(min, newLine);
        max = Math.max(max, newLine + n - 1);
      } else {
        min = Math.min(min, newLine);
        max = Math.max(max, newLine);
      }
      newLine += n;
      continue;
    }

    if (p.removed) {
      // Deletion happens at the current insertion point in the new file.
      min = Math.min(min, newLine);
      max = Math.max(max, newLine);
      continue;
    }

    newLine += n;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    // Fallback for unexpected diff edge cases.
    return { startLine: 1, endLine: 1 };
  }

  if (max < min) return { startLine: min, endLine: min };
  return { startLine: min, endLine: max };
}

function buildContextWindow(
  afterText: string,
  changedRange: { startLine: number; endLine: number },
  radius: number
): PatchContextWindow {
  const lines = splitLinesNoTrailingEmpty(afterText);
  const total = Math.max(1, lines.length);

  const startLine = Math.max(1, changedRange.startLine);
  const endLine = Math.max(startLine, changedRange.endLine);

  const start = Math.max(1, startLine - radius);
  const end = Math.min(total, endLine + radius);

  const before = lines.slice(start - 1, Math.max(start - 1, startLine - 1));
  const changed = lines.slice(startLine - 1, Math.min(total, endLine));
  const after = lines.slice(Math.min(total, endLine), end);

  const snippet = [...before, ...changed, ...after].join('\n');

  return { startLine: start, endLine: end, before, changed, after, snippet };
}

export function buildPatchFeedback(args: {
  path: string;
  beforeText: string;
  afterText: string;
  diffContextLines?: number;
  windowRadius?: number;
}): { diff: string; context: PatchContextWindow } | null {
  const before = normalizeLineEndings(args.beforeText ?? '');
  const after = normalizeLineEndings(args.afterText ?? '');

  if (before === after) return null;

  const diffText = diff
    .createTwoFilesPatch(
      `a/${(args.path ?? '').replace(/\\/g, '/')}`,
      `b/${(args.path ?? '').replace(/\\/g, '/')}`,
      before,
      after,
      '',
      '',
      { context: Math.max(0, Number(args.diffContextLines ?? 0)) } // Reduzido de 3 para 0 para evitar linhas de contexto não editadas
    )
    .trimEnd();

  const changedRange = computeChangedNewLineRange(before, after);
  const context = buildContextWindow(after, changedRange, Math.max(0, Number(args.windowRadius ?? 6)));

  return { diff: diffText, context };
}

