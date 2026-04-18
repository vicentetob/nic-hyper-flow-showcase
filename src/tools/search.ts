import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { readFileSafe, makeRelativeToWorkspaceRoot } from './utils';
import { ExecuteToolOptions } from './types';

// ✅ PDF text extraction (requires: npm i pdfjs-dist)
// Using dynamic import to handle ES module in CommonJS context

type SearchMatch = { path: string; line: number; preview: string };

type CompactSearchResult = {
  // igual “estilo list_dir_recursive”
  structure: string;
  fileCount: number;      // arquivos únicos tocados (matches + fileNameMatches)
  matchCount: number;     // ocorrências em conteúdo (linhas / unidades)
  fileNameMatchCount: number; // hits por nome de arquivo
  truncated: boolean;

  // Conteúdo formatado da PKB (limpo, sem JSON)
  pkb_content?: string;
  // Dados estruturados da PKB (para processamento programático)
  pkb_entries?: any[];

  // metadados de debug/compat
  query?: string;
  queries?: string[];
  warning?: string;

  // opcional: modo “raw” (se args.raw === true)
  matches?: SearchMatch[];
  fileMatches?: string[];
  results?: Array<{
    query: string;
    structure: string;
    fileCount: number;
    matchCount: number;
    fileNameMatchCount: number;
    truncated: boolean;
    warning?: string;
    matches?: SearchMatch[];
    fileMatches?: string[];
  }>;
};

function normalizeQueryList(args: Record<string, any>): string[] {
  const terms: string[] = [];
  const q = typeof args.query === 'string' ? args.query : (args.query != null ? String(args.query) : '');
  if (q.trim()) terms.push(q.trim());

  const queriesRaw = args.queries;
  if (Array.isArray(queriesRaw)) {
    for (const item of queriesRaw) {
      const s = typeof item === 'string' ? item : (item != null ? String(item) : '');
      if (s.trim()) terms.push(s.trim());
    }
  } else if (typeof queriesRaw === 'string') {
    const raw = queriesRaw.trim();
    if (raw) {
      // Suporte ao "text protocol": parseArgs transforma listas em string.
      // Aceita:
      // - Linha única separada por vírgula: "a, b, c"
      // - Lista por linhas (incluindo "- termo"): "\n- a\n- b\n"
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const candidates = lines.length <= 1 ? raw.split(',') : lines;
      for (const c of candidates) {
        const cleaned = String(c).trim().replace(/^- \s*/, '');
        if (cleaned) terms.push(cleaned);
      }
    }
  }

  // Dedup preservando ordem
  const seen = new Set<string>();
  const unique = terms.filter(t => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  // Hard cap para evitar abuso / payload enorme
  return unique.slice(0, 10);
}

function buildMatcherForQuery(queryText: string, args: Record<string, any>): (line: string) => boolean {
  if (args.isRegex) {
    const rawFlags = String(args.flags ?? '');
    let flags = rawFlags;
    if (!args.caseSensitive && !flags.includes('i')) flags += 'i';
    const regex = new RegExp(queryText, flags);
    return (line) => regex.test(line);
  }

  const isCaseSensitive = args.caseSensitive ?? false;
  const isWholeWord = args.wholeWord ?? false;

  if (isCaseSensitive && !isWholeWord) {
    // Busca literal rápida
    return (line) => line.includes(queryText);
  }

  const escaped = queryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = escaped;
  if (isWholeWord) {
    // Melhora Whole Word: só aplica boundary \b se a borda for um caractere de palavra (\w).
    // Isso evita que buscas por termos com caracteres especiais (ex: "m/px") falhem se o usuário ativar wholeWord.
    const startBoundary = /^\w/.test(queryText) ? '\\b' : '';
    const endBoundary = /\w$/.test(queryText) ? '\\b' : '';
    pattern = `${startBoundary}${pattern}${endBoundary}`;
  }
  const flags = isCaseSensitive ? '' : 'i';
  const regex = new RegExp(pattern, flags);
  return (line) => regex.test(line);
}

// =========================
// Compact formatter (estilo list_dir_recursive)
// =========================
// ===========================
// Memory search (substitui PKB)
// ===========================
const MEMORY_FILE_PATH = '.nic-hyper-flow/memory.json';

function searchMemoryEntries(workspacePath: string, queryText: string): Array<{category: string; key: string; value: any; score: number}> {
  if (!queryText.trim()) { return []; }
  const memoryFile = path.join(workspacePath, MEMORY_FILE_PATH);
  if (!fs.existsSync(memoryFile)) { return []; }
  try {
    const raw = fs.readFileSync(memoryFile, 'utf-8');
    const store = JSON.parse(raw);
    const queryLower = queryText.toLowerCase();
    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 2);
    const results: Array<{category: string; key: string; value: any; score: number}> = [];

    for (const category of ['task', 'project', 'user'] as const) {
      const cat = store[category] ?? {};
      for (const [key, value] of Object.entries(cat)) {
        const text = `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`.toLowerCase();
        let score = 0;
        for (const token of queryTokens) {
          if (text.includes(token)) { score += 1; }
        }
        if (text.includes(queryLower)) { score += 2; }
        if (score > 0) { results.push({ category, key, value, score }); }
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  } catch {
    return [];
  }
}

function formatMemoryResults(results: Array<{category: string; key: string; value: any; score: number}>): string {
  if (!results || results.length === 0) { return ''; }
  const output = results.map((r, i) => {
    const valueStr = typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2);
    return `[MEMORY ${i + 1}] [${r.category.toUpperCase()}] ${r.key}\nVALUE: ${valueStr}\n${'-'.repeat(40)}`;
  }).join('\n');
  return `=== MEMORY INSIGHTS ===\n${output}`;
}

type GroupInfo = {
  fileNameHit: boolean;
  lineHits: Array<{ line: number; preview: string }>;
  fileType?: 'text' | 'pdf';
};

function formatCompactSearchStructure(
  grouped: Map<string, GroupInfo>,
  options?: {
    maxLinesPerFile?: number;
    maxPreviewChars?: number;
    showLineNumbers?: boolean;
  }
): { structure: string; fileCount: number; matchCount: number; fileNameMatchCount: number } {
  const maxLinesPerFile = Math.max(1, Number(options?.maxLinesPerFile ?? 20));
  const maxPreviewChars = Math.max(40, Number(options?.maxPreviewChars ?? 180));
  const showLineNumbers = options?.showLineNumbers !== false;

  const files = Array.from(grouped.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

  let out = '';
  let fileCount = 0;
  let matchCount = 0;
  let fileNameMatchCount = 0;

  for (const [path, info] of files) {
    const hasAny = info.fileNameHit || (info.lineHits?.length ?? 0) > 0;
    if (!hasAny) continue;

    fileCount += 1;
    if (info.fileNameHit) fileNameMatchCount += 1;

    // Header do arquivo
    const suffixes: string[] = [];
    if (info.fileType === 'pdf') suffixes.push('pdf');
    if (info.fileNameHit) suffixes.push('name');
    const suffix = suffixes.length ? `  [${suffixes.join('][')}]` : '';

    out += `${path}${suffix}\n`;

    const hits = (info.lineHits || []).slice().sort((a, b) => a.line - b.line);

    // linhas (limitadas)
    const limited = hits.slice(0, maxLinesPerFile);
    for (const h of limited) {
      matchCount += 1;
      const p = (h.preview || '').trim().slice(0, maxPreviewChars);
      if (showLineNumbers) {
        out += `  L${h.line}: ${p}\n`;
      } else {
        out += `  ${p}\n`;
      }
    }

    // se cortou linhas por arquivo
    if (hits.length > limited.length) {
      out += `  … +${hits.length - limited.length} ocorrências\n`;
    }
  }

  return {
    structure: out.trim(),
    fileCount,
    matchCount,
    fileNameMatchCount
  };
}

// =========================
// HARD FILTER (node_modules etc.)
// =========================
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache',
  '__pycache__', 'venv', '.venv', 'out', '.vscode', '.dart_tool', '.idea',
  '.turbo', '.gradle', 'bin', 'obj', 'lib/generated'
]);

const normalizePath = (p: string) => p.replace(/\\/g, '/');

const shouldExcludePath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();

  // fast path (principal)
  if (
    normalized.includes('/node_modules/') ||
    normalized.endsWith('/node_modules') ||
    normalized.startsWith('node_modules/')
  ) return true;

  // checa segmentos
  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    if (EXCLUDE_DIRS.has(seg)) return true;
  }
  return false;
};

function isPdfPath(p: string): boolean {
  return normalizePath(p).toLowerCase().endsWith('.pdf');
}

function clampInt(n: any, min: number, max: number): number {
  const v = Number.isFinite(n) ? Number(n) : NaN;
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

// Fallback to internal search method because findTextInFiles is proposed/missing in this types version

// =========================
// PDF extraction (paged) + cache
// =========================
type PdfCacheEntry = {
  key: string; // absPath|size|mtime
  pages: string[]; // 1-based pages stored at index 0..N-1
  truncated: boolean;
  warning?: string;
};

const PDF_CACHE = new Map<string, PdfCacheEntry>();

async function extractPdfTextByPage(
  file: vscode.Uri,
  stat: vscode.FileStat,
  opts: {
    maxPdfBytes: number;
    maxPdfPages: number;
    maxCharsPerPage: number;
    normalizeWhitespace: boolean;
  }
): Promise<PdfCacheEntry | null> {
  // size gate
  if (stat.size > opts.maxPdfBytes) {
    return {
      key: '',
      pages: [],
      truncated: true,
      warning: `PDF ignorado por tamanho (${stat.size} bytes > maxPdfBytes).`
    };
  }

  const absPath = file.fsPath;
  const key = `${absPath}|${stat.size}|${stat.mtime}`;
  const cached = PDF_CACHE.get(absPath);
  if (cached && cached.key === key) return cached;

  try {
    const buf = await vscode.workspace.fs.readFile(file);
    // Dynamic import for ES module compatibility
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = (pdfjsLib as any).getDocument({ data: buf });
    const pdf = await loadingTask.promise;

    const numPages = Math.min(pdf.numPages || 0, opts.maxPdfPages);
    const pages: string[] = [];

    let truncated = false;
    let warning: string | undefined;

    for (let p = 1; p <= numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      const items = (content.items || []) as Array<{ str?: string }>;
      let text = items.map(it => it.str ?? '').join(' ');

      // Normalize whitespace
      if (opts.normalizeWhitespace) {
        text = text
          .replace(/\s+/g, ' ')
          .replace(/\u00ad/g, '') // soft hyphen
          .trim();
      } else {
        text = text.trim();
      }

      if (text.length > opts.maxCharsPerPage) {
        text = text.slice(0, opts.maxCharsPerPage);
        truncated = true;
      }

      pages.push(text);
    }

    if (pdf.numPages > opts.maxPdfPages) {
      truncated = true;
      warning = `PDF truncado: ${pdf.numPages} páginas, limite ${opts.maxPdfPages}.`;
    }

    const entry: PdfCacheEntry = { key, pages, truncated, warning };
    PDF_CACHE.set(absPath, entry);
    return entry;
  } catch {
    return null;
  }
}

// Quebra texto em unidades “buscáveis” curtas (evita “linha gigante”)
function splitIntoSearchUnits(text: string, maxUnitLen: number): string[] {
  const t = (text || '').trim();
  if (!t) return [];

  // primeiro quebra por quebras e pontuação comum
  const rough = t
    .split(/[\r\n]+|(?<=[.!?;:])\s+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const part of rough) {
    if (part.length <= maxUnitLen) {
      out.push(part);
      continue;
    }
    // se ainda ficou grande, corta em blocos
    for (let i = 0; i < part.length; i += maxUnitLen) {
      out.push(part.slice(i, i + maxUnitLen).trim());
    }
  }
  return out.filter(Boolean);
}

export async function executeSearch(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<CompactSearchResult> {
  const queries = normalizeQueryList(args);
  const queryText = String(args.query ?? (queries.length > 0 ? queries[0] : ''));

  const rawMode = args.raw === true; // se quiser ainda receber arrays (debug/compat)
  const maxLinesPerFile = Number.isFinite(args.maxLinesPerFile) ? Math.max(1, Number(args.maxLinesPerFile)) : 20;
  const maxPreviewChars = Number.isFinite(args.maxPreviewChars) ? Math.max(40, Number(args.maxPreviewChars)) : 180;

  // PDF knobs (safe defaults)
  const maxPdfBytes = clampInt(args.maxPdfBytes, 1 * 1024 * 1024, 20 * 1024 * 1024); // default 1MB..20MB
  const maxPdfPages = clampInt(args.maxPdfPages, 1, 300); // default 1..300
  const maxPdfCharsPerPage = clampInt(args.maxPdfCharsPerPage, 500, 50_000); // default 500..50k
  const pdfNormalizeWhitespace = args.pdfNormalizeWhitespace !== false;

  // Memória persistente em paralelo
  const memoryPromise = (async () => {
    try {
      if (!queryText.trim()) { return []; }
      return searchMemoryEntries(options.workspaceFolder.uri.fsPath, queryText);
    } catch {
      return [];
    }
  })();

  if (queries.length === 0) {
    const memoryResults = await memoryPromise;
    return {
      query: queryText,
      structure: '',
      fileCount: 0,
      matchCount: 0,
      fileNameMatchCount: 0,
      truncated: false,
      pkb_content: formatMemoryResults(memoryResults),
      pkb_entries: memoryResults
    };
  }

  const isMulti = queries.length > 1;
  const firstQuery = queries[0];

  const MAX_RESULT_LENGTH = Number.isFinite(args.maxResultChars)
    ? Math.max(200, Number(args.maxResultChars))
    : 100000;
  let currentLength = 0;
  let limitHit = false;

  const maxResultsPerQuery = Number.isFinite(args.maxResults)
    ? Math.max(1, Number(args.maxResults))
    : Math.min(1000, options.searchMaxResults || 1000);

  const maxTotalResults = Number.isFinite(args.maxTotalResults)
    ? Math.max(1, Number(args.maxTotalResults))
    : Math.min(2000, maxResultsPerQuery * queries.length);

  let totalResults = 0;

  const pathBase = typeof args.path === 'string' && args.path.trim() ? args.path.trim().replace(/\\/g, '/') : '';
  const includeDefault = String(args.include ?? '').trim() || '**/*';
  const include =
    pathBase && (includeDefault === '**/*' || includeDefault === '')
      ? `${pathBase.replace(/\/+$/g, '')}/**/*`
      : includeDefault;

  const excludeGlob =
    typeof args.exclude === 'string' && args.exclude.trim()
      ? args.exclude
      : '**/{node_modules,.git,dist,build,.next,coverage,.cache,__pycache__,venv,.venv,out,.vscode,.dart_tool,.idea,.turbo,.gradle,bin,obj,lib/generated}/**,**/jarvis_i_o.md,**/nic_debug.md,**/pkb_v2.jsonl,**/pkb.jsonl,**/assets_registry.json,**/*.min.js,**/*.map';

  const includePattern = new vscode.RelativePattern(options.workspaceFolder, include);
  const filesAll = await vscode.workspace.findFiles(includePattern, excludeGlob);

  // ✅ hard filter final
  const files = filesAll.filter(f => !shouldExcludePath(f.fsPath));

  // matchers
  const matchers: Array<{ query: string; match: (line: string) => boolean }> = [];
  for (const q of queries) {
    try {
      matchers.push({ query: q, match: buildMatcherForQuery(q, args) });
    } catch {
      throw new Error(`Regex inválida: ${q}`);
    }
  }

  // agrupadores compactos por query
  const groupedPerQuery = new Map<string, Map<string, GroupInfo>>();
  const perQueryLimitHit = new Map<string, boolean>();

  for (const q of queries) {
    groupedPerQuery.set(q, new Map());
    perQueryLimitHit.set(q, false);
  }

  // raw (opcional)
  const rawMatchesSingle: SearchMatch[] = [];
  const rawFileMatchesSingle: string[] = [];
  const rawMatchesMulti = new Map<string, SearchMatch[]>();
  const rawFileMatchesMulti = new Map<string, string[]>();
  for (const q of queries) {
    rawMatchesMulti.set(q, []);
    rawFileMatchesMulti.set(q, []);
  }

  // Estimativa rápida de tamanho (evita JSON.stringify caro por match)
  const pushAnySize = (payload: any) => {
    const size = (payload.q?.length || 0) + (payload.f?.length || payload.path?.length || 0) + (payload.preview?.length || 0) + 50;
    if (currentLength + size > MAX_RESULT_LENGTH) {
      limitHit = true;
      return false;
    }
    currentLength += size;
    return true;
  };

  const ensureGroupEntry = (q: string, relPath: string, fileType: 'text' | 'pdf'): GroupInfo => {
    const g = groupedPerQuery.get(q);
    if (!g) return { fileNameHit: false, lineHits: [], fileType };
    const entry = g.get(relPath) || { fileNameHit: false, lineHits: [] as Array<{ line: number; preview: string }>, fileType };
    // preserve strongest signal
    entry.fileType = entry.fileType || fileType;
    g.set(relPath, entry);
    return entry;
  };

  const addFileNameHit = (q: string, relPath: string, fileType: 'text' | 'pdf') => {
    const entry = ensureGroupEntry(q, relPath, fileType);
    entry.fileNameHit = true;
  };

  const addLineHit = (q: string, m: SearchMatch, fileType: 'text' | 'pdf') => {
    const entry = ensureGroupEntry(q, m.path, fileType);
    entry.lineHits.push({ line: m.line, preview: m.preview });
  };

  // Concurrency: PDFs são caros. Limite menor reduz GC pressure sem impacto perceptível no tempo total.
  // 1) Match in file NAMES (Fast, memory-only)
  for (const file of files) {
    if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) {
      limitHit = true;
      break;
    }
    const relativePath = makeRelativeToWorkspaceRoot(options.workspaceFolder, file.fsPath);
    if (shouldExcludePath(relativePath)) continue;
    const fileType: 'text' | 'pdf' = isPdfPath(relativePath) ? 'pdf' : 'text';

    for (const { query, match } of matchers) {
      if (match(relativePath)) {
        if (totalResults >= maxTotalResults) { limitHit = true; break; }

        const g = groupedPerQuery.get(query)!;
        const currentHits = (g.get(relativePath)?.lineHits.length ?? 0) + (g.get(relativePath)?.fileNameHit ? 1 : 0);
        if (currentHits >= maxResultsPerQuery) {
          perQueryLimitHit.set(query, true);
          limitHit = true;
          continue;
        }

        const okSize = pushAnySize({ q: query, f: relativePath, t: 'name' });
        if (!okSize) break;

        addFileNameHit(query, relativePath, fileType);
        if (rawMode) {
          if (!isMulti) rawFileMatchesSingle.push(relativePath);
          else rawFileMatchesMulti.get(query)!.push(relativePath);
        }
        totalResults += 1;
      }
    }
  }

  // 2) Match in TEXT file CONTENTS
  // Reading sequentially/in small batches to avoid IO pressure heuristics (Max 2 concurrency)
  const textFiles = files.filter(f => !isPdfPath(f.fsPath));
  const TEXT_CONCURRENCY = 2;

  for (let i = 0; i < textFiles.length; i += TEXT_CONCURRENCY) {
    if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) {
      limitHit = true;
      break;
    }
    const batch = textFiles.slice(i, i + TEXT_CONCURRENCY);

    await Promise.all(batch.map(async (file) => {
      if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) return;
      const relativePath = makeRelativeToWorkspaceRoot(options.workspaceFolder, file.fsPath);
      if (shouldExcludePath(relativePath)) return;

      try {
        const stat = await vscode.workspace.fs.stat(file);
        if (stat.size > 2 * 1024 * 1024) return; // Ignore large files in text search to preserve memory

        const content = await readFileSafe(file);
        if (!content) return;

        const lines = content.split(/\r?\n/);
        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
          if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) return;
          const text = lines[lineNumber];
          if (text.length > 5000) continue;

          for (const { query, match } of matchers) {
            if (!match(text)) continue;

            const g = groupedPerQuery.get(query)!;
            const entry = g.get(relativePath);
            const used = (entry?.lineHits.length ?? 0) + (entry?.fileNameHit ? 1 : 0);
            if (used >= maxResultsPerQuery) {
              perQueryLimitHit.set(query, true);
              limitHit = true;
              continue;
            }

            if (totalResults >= maxTotalResults) { limitHit = true; return; }

            const m: SearchMatch = { path: relativePath, line: lineNumber + 1, preview: text.trim() };
            const okSize = pushAnySize({ q: query, ...m });
            if (!okSize) return;

            addLineHit(query, m, 'text');
            if (rawMode) {
              if (!isMulti) rawMatchesSingle.push(m);
              else rawMatchesMulti.get(query)!.push(m);
            }
            totalResults += 1;
          }
        }
      } catch {
        // Fallback gracefully
      }
    }));
  }

  // 3) Match in PDF CONTENTS (Slow, IO intensive - Concurrency reduced to 2)
  const pdfFiles = files.filter(f => isPdfPath(f.fsPath));
  const CONCURRENCY_LIMIT = 2;

  for (let i = 0; i < pdfFiles.length; i += CONCURRENCY_LIMIT) {
    if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) {
      limitHit = true;
      break;
    }

    const batch = pdfFiles.slice(i, i + CONCURRENCY_LIMIT);

    await Promise.all(batch.map(async (file) => {
      if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) return;

      const relativePath = makeRelativeToWorkspaceRoot(options.workspaceFolder, file.fsPath);
      if (shouldExcludePath(relativePath)) return;

      try {
        const stat = await vscode.workspace.fs.stat(file);
        const pdfEntry = await extractPdfTextByPage(file, stat, {
          maxPdfBytes, maxPdfPages, maxCharsPerPage: maxPdfCharsPerPage, normalizeWhitespace: pdfNormalizeWhitespace
        });

        if (!pdfEntry) return;

        const maxUnitLen = 1800;
        for (let pageIdx = 0; pageIdx < pdfEntry.pages.length; pageIdx++) {
          if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) return;

          const pageNum = pageIdx + 1;
          const pageText = pdfEntry.pages[pageIdx] || '';
          if (!pageText.trim()) continue;

          const units = splitIntoSearchUnits(pageText, maxUnitLen);

          for (const unit of units) {
            if (limitHit || totalResults >= maxTotalResults || currentLength >= MAX_RESULT_LENGTH) return;
            if (!unit || unit.length > 2000) continue;

            for (const { query, match } of matchers) {
              if (!match(unit)) continue;

              const g = groupedPerQuery.get(query)!;
              const entry = g.get(relativePath);
              const used = (entry?.lineHits.length ?? 0) + (entry?.fileNameHit ? 1 : 0);
              if (used >= maxResultsPerQuery) {
                perQueryLimitHit.set(query, true);
                limitHit = true;
                continue;
              }

              if (totalResults >= maxTotalResults) { limitHit = true; return; }

              const m: SearchMatch = { path: relativePath, line: pageNum, preview: unit.trim() };
              const okSize = pushAnySize({ q: query, ...m });
              if (!okSize) return;

              addLineHit(query, m, 'pdf');
              if (rawMode) {
                if (!isMulti) rawMatchesSingle.push(m);
                else rawMatchesMulti.get(query)!.push(m);
              }
              totalResults += 1;
            }
          }
        }
      } catch {
        // Ignora erros no PDF
      }
    }));
  }

  const memoryResults = await memoryPromise;
  const pkb_content = formatMemoryResults(memoryResults);

  // =========================
  // Output compacto (parecido com list_dir_recursive)
  // =========================
  if (!isMulti) {
    const grouped = groupedPerQuery.get(firstQuery)!;

    const formatted = formatCompactSearchStructure(grouped, {
      maxLinesPerFile,
      maxPreviewChars,
      showLineNumbers: true
    });

    const out: CompactSearchResult = {
      query: firstQuery,
      structure: formatted.structure,
      fileCount: formatted.fileCount,
      matchCount: formatted.matchCount,
      fileNameMatchCount: formatted.fileNameMatchCount,
      truncated: limitHit,
      pkb_content,
      pkb_entries: memoryResults,
      warning: limitHit ? 'Limite de resultados atingido. Pode haver mais ocorrências.' : undefined
    };

    if (rawMode) {
      out.matches = rawMatchesSingle;
      out.fileMatches = rawFileMatchesSingle;
    }

    return out;
  }

  const results = queries.map((q) => {
    const grouped = groupedPerQuery.get(q)!;
    const formatted = formatCompactSearchStructure(grouped, {
      maxLinesPerFile,
      maxPreviewChars,
      showLineNumbers: true
    });

    const qLimitHit = perQueryLimitHit.get(q) ?? false;

    const r: any = {
      query: q,
      structure: formatted.structure,
      fileCount: formatted.fileCount,
      matchCount: formatted.matchCount,
      fileNameMatchCount: formatted.fileNameMatchCount,
      truncated: qLimitHit,
      warning: qLimitHit ? 'Limite de resultados atingido para este termo. Pode haver mais ocorrências.' : undefined
    };

    if (rawMode) {
      r.matches = rawMatchesMulti.get(q) ?? [];
      r.fileMatches = rawFileMatchesMulti.get(q) ?? [];
    }

    return r;
  });

  return {
    queries,
    results,
    structure: '', // (vazio no multi; a UI usa results[].structure)
    fileCount: results.reduce((acc, r) => acc + (r.fileCount || 0), 0),
    matchCount: results.reduce((acc, r) => acc + (r.matchCount || 0), 0),
    fileNameMatchCount: results.reduce((acc, r) => acc + (r.fileNameMatchCount || 0), 0),
    truncated: limitHit,
    pkb_content,
    pkb_entries: memoryResults,
    warning: limitHit ? 'Limites atingidos (total e/ou por termo). Pode haver mais ocorrências.' : undefined
  };
}
