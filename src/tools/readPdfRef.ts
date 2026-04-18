import * as vscode from 'vscode';
import { makeRelativeToWorkspaceRoot } from './utils';
import { ExecuteToolOptions } from './types';

type ReadPdfResult = {
  success: boolean;
  path?: string;          // relative path
  pages?: number[];       // pages returned
  pageStart?: number;
  pageEnd?: number;
  text?: string;          // merged cleaned text
  perPage?: Array<{ page: number; text: string }>;
  truncated?: boolean;
  warning?: string;
  error?: string;
};

type PdfCacheEntry = {
  key: string; // absPath|size|mtime
  pages: string[]; // index 0 => page 1
};

const PDF_CACHE = new Map<string, PdfCacheEntry>();

function normalizePath(p: string): string {
  return String(p || '').replace(/\\/g, '/');
}

function clampInt(n: any, min: number, max: number): number {
  const v = Number.isFinite(n) ? Number(n) : NaN;
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function parsePdfRef(refRaw: any): { path?: string; page?: number; pageStart?: number; pageEnd?: number } {
  const ref = String(refRaw || '').trim();
  // Formats supported:
  // 1) pdf:relative/path.pdf#p:118
  // 2) pdf:relative/path.pdf#p:118-120
  // 3) pdf:relative/path.pdf#ps:10#pe:12
  if (!ref.startsWith('pdf:')) return {};
  const withoutPrefix = ref.slice('pdf:'.length);

  const [pathPart, ...frags] = withoutPrefix.split('#');
  const out: any = { path: normalizePath(pathPart) };

  for (const frag of frags) {
    const f = frag.trim();
    if (f.startsWith('p:')) {
      const v = f.slice(2).trim();
      if (v.includes('-')) {
        const [a, b] = v.split('-').map(x => x.trim());
        const ps = parseInt(a, 10);
        const pe = parseInt(b, 10);
        if (Number.isFinite(ps) && Number.isFinite(pe)) {
          out.pageStart = ps;
          out.pageEnd = pe;
        }
      } else {
        const p = parseInt(v, 10);
        if (Number.isFinite(p)) out.page = p;
      }
    } else if (f.startsWith('ps:')) {
      const ps = parseInt(f.slice(3).trim(), 10);
      if (Number.isFinite(ps)) out.pageStart = ps;
    } else if (f.startsWith('pe:')) {
      const pe = parseInt(f.slice(3).trim(), 10);
      if (Number.isFinite(pe)) out.pageEnd = pe;
    }
  }

  return out;
}

function cleanWhitespace(s: string): string {
  return (s || '')
    .replace(/\u00ad/g, '')      // soft hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLinesLoose(s: string): string[] {
  // Keep “line-ish” units so header/footer detection works
  return (s || '')
    .split(/\r?\n|(?<=[.!?;:])\s+/g)
    .map(x => x.trim())
    .filter(Boolean);
}

function stripRepeatedHeaderFooter(perPageText: string[]): string[] {
  // Heurística simples: pega primeiras/últimas N linhas por página e remove as que repetem em >= 60%
  const N = 2;
  const total = perPageText.length;
  if (total <= 2) return perPageText;

  const normalizeKey = (x: string) =>
    cleanWhitespace(x).toLowerCase()
      .replace(/\d+/g, '#')
      .replace(/[^\p{L}\p{N}\s#]+/gu, '')
      .trim();

  const topCounts = new Map<string, number>();
  const botCounts = new Map<string, number>();

  const tops: string[][] = [];
  const bots: string[][] = [];

  for (const page of perPageText) {
    const lines = splitLinesLoose(page);
    const top = lines.slice(0, N);
    const bot = lines.slice(Math.max(0, lines.length - N));

    tops.push(top);
    bots.push(bot);

    for (const t of top) {
      const k = normalizeKey(t);
      if (!k) continue;
      topCounts.set(k, (topCounts.get(k) ?? 0) + 1);
    }
    for (const b of bot) {
      const k = normalizeKey(b);
      if (!k) continue;
      botCounts.set(k, (botCounts.get(k) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(total * 0.6);

  const topBan = new Set<string>();
  const botBan = new Set<string>();

  for (const [k, c] of topCounts.entries()) if (c >= threshold) topBan.add(k);
  for (const [k, c] of botCounts.entries()) if (c >= threshold) botBan.add(k);

  if (topBan.size === 0 && botBan.size === 0) return perPageText;

  const cleaned: string[] = [];

  for (let i = 0; i < perPageText.length; i++) {
    const lines = splitLinesLoose(perPageText[i]);

    for (let idx = 0; idx < lines.length; idx++) {
      const k = normalizeKey(lines[idx]);
      const isTopZone = idx < N;
      const isBotZone = idx >= lines.length - N;

      if (isTopZone && topBan.has(k)) {
        lines[idx] = '';
        continue;
      }
      if (isBotZone && botBan.has(k)) {
        lines[idx] = '';
        continue;
      }
    }

    cleaned.push(lines.filter(Boolean).join('\n'));
  }

  return cleaned;
}

async function loadPdfPagesText(
  file: vscode.Uri,
  stat: vscode.FileStat,
  opts: { maxBytes: number; maxPages: number; maxCharsPerPage: number }
): Promise<{ pages: string[]; warning?: string }> {
  const abs = file.fsPath;
  const cacheKey = `${abs}|${stat.size}|${stat.mtime}`;
  const cached = PDF_CACHE.get(abs);
  if (cached && cached.key === cacheKey) return { pages: cached.pages };

  if (stat.size > opts.maxBytes) {
    return { pages: [], warning: `PDF ignorado por tamanho (${stat.size} bytes > maxBytes).` };
  }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  // Buffer maior = menos chance de estourar com PDF grande
  const maxBuffer = Math.min(
    120 * 1024 * 1024,
    Math.max(10 * 1024 * 1024, (opts.maxPages * opts.maxCharsPerPage * 3))
  );

  // Python script robusto com fallback de engines + saída ASCII (não explode cp1252)
  const pythonScript = `# -*- coding: utf-8 -*-
import sys, json, re, traceback, warnings

warnings.filterwarnings("ignore")

def _force_utf8_stdout():
    try:
        # Python 3.7+
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_force_utf8_stdout()

def _clean_text(s: str) -> str:
    if not s:
        return ""
    # remove NUL e controla whitespace sem destruir total layout
    s = s.replace("\\x00", "")
    s = s.replace("\\u0000", "")
    return s

def _truncate(s: str, max_chars: int) -> str:
    if max_chars and len(s) > max_chars:
        return s[:max_chars]
    return s

def extract_with_pymupdf(pdf_path: str, max_pages: int, max_chars_per_page: int):
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    total_pages = doc.page_count
    pages_to_read = min(total_pages, max_pages)
    out_pages = []
    for i in range(pages_to_read):
        page = doc.load_page(i)
        text = page.get_text("text") or ""
        text = _clean_text(text)
        # não compacta tudo em uma linha aqui; mantém quebras pra header/footer
        out_pages.append(_truncate(text, max_chars_per_page))
    doc.close()
    return out_pages, total_pages

def extract_with_pdfplumber(pdf_path: str, max_pages: int, max_chars_per_page: int):
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        pages_to_read = min(total_pages, max_pages)
        out_pages = []
        for i in range(pages_to_read):
            page = pdf.pages[i]
            try:
                text = page.extract_text(x_tolerance=2, y_tolerance=2) or ""
            except Exception:
                text = page.extract_text() or ""
            text = _clean_text(text)
            out_pages.append(_truncate(text, max_chars_per_page))
        return out_pages, total_pages

def extract_with_pypdf(pdf_path: str, max_pages: int, max_chars_per_page: int):
    try:
        from pypdf import PdfReader
    except Exception:
        from PyPDF2 import PdfReader  # fallback antigo
    reader = PdfReader(pdf_path)
    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")  # tenta senha vazia
        except Exception:
            pass
    total_pages = len(reader.pages)
    pages_to_read = min(total_pages, max_pages)
    out_pages = []
    for i in range(pages_to_read):
        page = reader.pages[i]
        text = ""
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        text = _clean_text(text)
        out_pages.append(_truncate(text, max_chars_per_page))
    return out_pages, total_pages

def extract_pdf_text(pdf_path: str, max_pages: int, max_chars_per_page: int):
    engines = []
    # Ordem: melhor/mais robusto primeiro
    engines.append(("pymupdf", extract_with_pymupdf))
    engines.append(("pdfplumber", extract_with_pdfplumber))
    engines.append(("pypdf", extract_with_pypdf))

    warnings_list = []
    last_err = None

    for name, fn in engines:
        try:
            pages, total = fn(pdf_path, max_pages, max_chars_per_page)
            # Aceita mesmo vazio, mas tenta fallback se tudo vier vazio/whitespace
            joined = "".join(pages).strip()
            if not joined and name != engines[-1][0]:
                warnings_list.append(f"{name}: extração retornou vazio; tentando fallback.")
                continue
            return {
                "ok": True,
                "engine": name,
                "pages": pages,
                "total_pages": total,
                "pages_read": len(pages),
                "warnings": warnings_list,
                "error": None,
            }
        except Exception as e:
            last_err = e
            warnings_list.append(f"{name}: falhou ({type(e).__name__}: {e}).")
            continue

    # Tudo falhou
    missing = []
    w_str = " ".join(warnings_list).lower()
    if "pymupdf" in w_str or "fitz" in w_str: missing.append("pymupdf")
    if "pdfplumber" in w_str: missing.append("pdfplumber")
    if "pypdf" in w_str: missing.append("pypdf")

    return {
        "ok": False,
        "engine": None,
        "pages": [],
        "total_pages": 0,
        "pages_read": 0,
        "warnings": warnings_list,
        "error": (str(last_err) if last_err else "Unknown error"),
        "suggestion": f"Instale as dependências necessárias executando: pip install {' '.join(missing) if missing else 'pymupdf'}",
        "missing_dependencies": missing if missing else ["pymupdf"],
        "trace": traceback.format_exc(),
    }

if __name__ == "__main__":
    pdf_path = sys.argv[1]
    max_pages = int(sys.argv[2])
    max_chars = int(sys.argv[3])

    result = extract_pdf_text(pdf_path, max_pages, max_chars)

    # IMPORTANTÍSSIMO: saída ASCII-only (evita cp1252 morrer), JSON parser do Node reconstrói Unicode ok
    print(json.dumps(result, ensure_ascii=True))
`;

  const tempDir = os.tmpdir();
  const tempScriptPath = path.join(tempDir, `pdf_extract_${Date.now()}_${Math.random().toString(16).slice(2)}.py`);

  try {
    fs.writeFileSync(tempScriptPath, pythonScript, 'utf8');

    const tryRuntimes: Array<{ cmd: string; argsPrefix: string[] }> = [
      { cmd: 'python', argsPrefix: ['-X', 'utf8'] },
      { cmd: 'python3', argsPrefix: ['-X', 'utf8'] },
      { cmd: 'py', argsPrefix: ['-3', '-X', 'utf8'] },
    ];

    let stdout = '';
    let stderr = '';
    let lastErr: any = null;

    for (const rt of tryRuntimes) {
      try {
        const res = await execFileAsync(
          rt.cmd,
          [...rt.argsPrefix, tempScriptPath, abs, String(opts.maxPages), String(opts.maxCharsPerPage)],
          {
            maxBuffer,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            windowsHide: true
          }
        );
        stdout = res.stdout ?? '';
        stderr = res.stderr ?? '';
        lastErr = null;
        break;
      } catch (e: any) {
        lastErr = e;
      }
    }

    if (lastErr) {
      return { pages: [], warning: `Falha ao executar Python (python/python3/py). Erro: ${lastErr?.message || lastErr}` };
    }

    if (stderr && String(stderr).trim()) {
      console.warn('Python stderr:', String(stderr));
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(String(stdout || '').trim());
    } catch (e: any) {
      return { pages: [], warning: `Python retornou JSON inválido. stdout: ${(String(stdout || '')).slice(0, 1000)}` };
    }

    if (!parsed?.ok) {
      const msg = parsed?.error ? String(parsed.error) : 'Erro desconhecido no extrator de PDF.';
      const warn = Array.isArray(parsed?.warnings) ? parsed.warnings.join(' | ') : '';
      return { pages: [], warning: `Erro no Python: ${msg}${warn ? ` | ${warn}` : ''}` };
    }

    const pages: string[] = Array.isArray(parsed.pages) ? parsed.pages : [];
    let warning: string | undefined;

    if (parsed.total_pages && parsed.total_pages > opts.maxPages) {
      warning = `PDF truncado: ${parsed.total_pages} páginas, limite ${opts.maxPages}.`;
    }

    // Check for truncation within pages
    for (let i = 0; i < pages.length; i++) {
      if ((pages[i] || '').length >= opts.maxCharsPerPage) {
        warning = warning ?? `PDF truncado: texto por página limitado a ${opts.maxCharsPerPage} chars.`;
        break;
      }
    }

    // Engine + warnings ajudam debug (sem quebrar retorno)
    if (Array.isArray(parsed.warnings) && parsed.warnings.length) {
      const extra = `[engine=${parsed.engine}] ${parsed.warnings.join(' | ')}`;
      warning = warning ? `${warning} | ${extra}` : extra;
    } else if (parsed.engine) {
      const extra = `[engine=${parsed.engine}]`;
      warning = warning ? `${warning} | ${extra}` : extra;
    }

    PDF_CACHE.set(abs, { key: cacheKey, pages });
    return { pages, warning };

  } catch (error: any) {
    return { pages: [], warning: `Erro ao carregar PDF via Python: ${error?.message || error}` };
  } finally {
    try { fs.unlinkSync(tempScriptPath); } catch {}
  }
}

export async function executeReadPdfRef(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<ReadPdfResult> {
  try {
    // Inputs:
    // - ref: pdf:<relpath>#p:118 or pdf:<relpath>#p:118-120
    // - OR path + page/pageStart/pageEnd
    const parsed = parsePdfRef(args.ref);

    const rawPath = parsed.path ?? (typeof args.path === 'string' ? args.path : '');
    const relPath = normalizePath(rawPath).trim();

    if (!relPath) {
      return { success: false, error: 'Missing "path" or valid "ref".' };
    }

    const page = parsed.page ?? (args.page != null ? parseInt(String(args.page), 10) : undefined);
    let pageStart = parsed.pageStart ?? (args.pageStart != null ? parseInt(String(args.pageStart), 10) : undefined);
    let pageEnd = parsed.pageEnd ?? (args.pageEnd != null ? parseInt(String(args.pageEnd), 10) : undefined);

    const expandPages = clampInt(args.expandPages, 0, 10);

    // Defaults (safe)
    const maxBytes = clampInt(args.maxPdfBytes, 1 * 1024 * 1024, 20 * 1024 * 1024);
    const maxPages = clampInt(args.maxPdfPages, 1, 400);
    const maxCharsPerPage = clampInt(args.maxPdfCharsPerPage, 800, 60_000);

    // Resolve file in workspace
    const workspaceRoot = options.workspaceFolder.uri;
    const fileUri = vscode.Uri.joinPath(workspaceRoot, relPath);

    const stat = await vscode.workspace.fs.stat(fileUri);

    // Decide range
    if (page != null && Number.isFinite(page)) {
      pageStart = page;
      pageEnd = page;
    }
    if (pageStart == null || pageEnd == null) {
      // Default: first page only (but safe)
      pageStart = 1;
      pageEnd = 1;
    }
    pageStart = Math.max(1, pageStart);
    pageEnd = Math.max(pageStart, pageEnd);

    // Apply expansion
    pageStart = Math.max(1, pageStart - expandPages);
    pageEnd = pageEnd + expandPages;

    // Load full pages (cached) up to maxPages and slice what we need
    const loaded = await loadPdfPagesText(fileUri, stat, { maxBytes, maxPages, maxCharsPerPage });

    if (!loaded.pages || loaded.pages.length === 0) {
      return {
        success: false,
        path: relPath,
        error: loaded.warning || 'Failed to read PDF or PDF had no extractable text.'
      };
    }

    const totalAvailable = loaded.pages.length;
    const effectiveEnd = Math.min(pageEnd, totalAvailable);
    const effectiveStart = Math.min(pageStart, effectiveEnd);

    const slice = loaded.pages.slice(effectiveStart - 1, effectiveEnd);

    // Remove repeated header/footer “within the slice”
    const cleanedPages = stripRepeatedHeaderFooter(slice).map(cleanWhitespace);

    const perPage = cleanedPages.map((t, idx) => ({
      page: effectiveStart + idx,
      text: t
    }));

    // Merge as readable block
    const merged = perPage
      .map(p => `--- PAGE ${p.page} ---\n${p.text}`)
      .join('\n\n');

    const result: ReadPdfResult = {
      success: true,
      path: makeRelativeToWorkspaceRoot(options.workspaceFolder, fileUri.fsPath),
      pages: perPage.map(p => p.page),
      pageStart: effectiveStart,
      pageEnd: effectiveEnd,
      perPage,
      text: merged,
      truncated: !!loaded.warning,
      warning: loaded.warning
    };

    return result;
  } catch (e: any) {
    return { success: false, error: String(e?.message || e || 'Unknown error') };
  }
}