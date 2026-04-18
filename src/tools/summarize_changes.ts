import { promisify } from 'util';
import { exec } from 'child_process';
import { ExecuteToolOptions } from './types';
import { getCanonizedWorkspaceRootSync } from './utils';

const execAsync = promisify(exec);

const FORBIDDEN_FILES = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.vsix', '.woff', '.ttf', '.eot', '.mp4', '.mp3', '.zip', '.tar', '.gz']);

function isBinaryOrForbidden(filePath: string): boolean {
  const name = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  if (FORBIDDEN_FILES.includes(name)) { return true; }
  const ext = '.' + name.split('.').pop();
  return BINARY_EXTS.has(ext);
}

interface FileStat {
  path: string;
  status: string; // M, A, D, R, ?
  added: number;
  removed: number;
  diff?: string;
}

async function runGit(cmd: string, cwd: string, timeoutMs = 8000): Promise<string> {
  const { stdout } = await execAsync(cmd, { cwd, timeout: timeoutMs });
  return stdout;
}

export async function executeSummarizeChanges(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const rootPath = getCanonizedWorkspaceRootSync(options.workspaceFolder);
  const base: string = args.base ?? 'HEAD';           // comparar contra HEAD ou branch/commit
  const includeDiff: boolean = args.includeDiff !== false; // default true
  const maxDiffCharsPerFile: number = args.maxDiffCharsPerFile ?? 3000;
  const maxFiles: number = args.maxFiles ?? 30;

  // ── 1. Verifica se é repo git ─────────────────────────────────────────────
  try {
    await runGit('git rev-parse --git-dir', rootPath, 2000);
  } catch {
    return { error: 'Não é um repositório git ou git não está disponível.' };
  }

  // ── 2. Status dos arquivos modificados ────────────────────────────────────
  let statusOutput = '';
  try {
    // Staged + unstaged
    statusOutput = await runGit(`git diff --name-status ${base}`, rootPath);
    // Adiciona untracked
    const untracked = await runGit('git ls-files --others --exclude-standard', rootPath);
    if (untracked.trim()) {
      for (const f of untracked.trim().split('\n')) {
        if (f.trim()) { statusOutput += `\n?\t${f.trim()}`; }
      }
    }
  } catch (err: any) {
    return { error: `Falha ao obter status: ${err?.message}` };
  }

  const fileStats: FileStat[] = [];
  const lines = statusOutput.trim().split('\n').filter(Boolean);

  for (const line of lines.slice(0, maxFiles)) {
    const parts = line.split('\t');
    const status = parts[0]?.trim() ?? '?';
    const filePath = parts[parts.length - 1]?.trim() ?? '';
    if (!filePath || isBinaryOrForbidden(filePath)) { continue; }

    const stat: FileStat = { path: filePath, status, added: 0, removed: 0 };

    // ── 3. Stat de linhas por arquivo ─────────────────────────────────────
    try {
      const numstat = await runGit(`git diff --numstat ${base} -- "${filePath}"`, rootPath);
      const m = numstat.trim().match(/^(\d+|-)\s+(\d+|-)/);
      if (m) {
        stat.added = m[1] === '-' ? 0 : parseInt(m[1], 10);
        stat.removed = m[2] === '-' ? 0 : parseInt(m[2], 10);
      }
    } catch { /* skip */ }

    // ── 4. Diff compacto por arquivo ──────────────────────────────────────
    if (includeDiff && status !== '?') {
      try {
        const fileDiff = await runGit(`git diff ${base} -- "${filePath}"`, rootPath);
        if (fileDiff.trim()) {
          stat.diff = fileDiff.length > maxDiffCharsPerFile
            ? fileDiff.slice(0, maxDiffCharsPerFile) + `\n... [truncado — ${fileDiff.length} chars total]`
            : fileDiff;
        }
      } catch { /* skip */ }
    }

    fileStats.push(stat);
  }

  // ── 5. Totais ─────────────────────────────────────────────────────────────
  const totalAdded = fileStats.reduce((s, f) => s + f.added, 0);
  const totalRemoved = fileStats.reduce((s, f) => s + f.removed, 0);
  const modified = fileStats.filter(f => f.status === 'M').map(f => f.path);
  const added = fileStats.filter(f => f.status === 'A' || f.status === '?').map(f => f.path);
  const deleted = fileStats.filter(f => f.status === 'D').map(f => f.path);
  const renamed = fileStats.filter(f => f.status.startsWith('R')).map(f => f.path);

  // ── 6. Último commit ──────────────────────────────────────────────────────
  let lastCommit: any = null;
  try {
    const log = await runGit('git log -1 --pretty=format:"%H|%s|%an|%ar"', rootPath);
    const [hash, subject, author, when] = log.replace(/^"|"$/g, '').split('|');
    lastCommit = { hash: hash?.slice(0, 8), subject, author, when };
  } catch { /* sem commits */ }

  return {
    base,
    lastCommit,
    summary: {
      totalFiles: fileStats.length,
      totalAdded,
      totalRemoved,
      modified,
      added,
      deleted,
      renamed,
    },
    files: fileStats,
    truncated: lines.length > maxFiles,
  };
}

