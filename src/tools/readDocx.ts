import * as vscode from 'vscode';
import { makeRelativeToWorkspaceRoot } from './utils';
import { ExecuteToolOptions } from './types';

type ReadDocxResult = {
  success: boolean;
  path?: string;          // relative path
  text?: string;          // extracted text
  warning?: string;
  error?: string;
};

type DocxCacheEntry = {
  key: string; // absPath|size|mtime
  text: string;
};

const DOCX_CACHE = new Map<string, DocxCacheEntry>();

function normalizePath(p: string): string {
  return String(p || '').replace(/\\/g, '/');
}

function clampInt(n: any, min: number, max: number): number {
  const v = Number.isFinite(n) ? Number(n) : NaN;
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

async function loadDocxText(
  file: vscode.Uri,
  stat: vscode.FileStat,
  opts: { maxBytes: number }
): Promise<{ text: string; warning?: string }> {
  const abs = file.fsPath;
  const cacheKey = `${abs}|${stat.size}|${stat.mtime}`;
  const cached = DOCX_CACHE.get(abs);
  
  if (cached && cached.key === cacheKey) {
    return { text: cached.text };
  }

  if (stat.size > opts.maxBytes) {
    return { text: '', warning: `DOCX ignorado por tamanho (${stat.size} bytes > maxBytes).` };
  }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  const maxBuffer = 50 * 1024 * 1024; // 50MB buffer

  const pythonScript = `# -*- coding: utf-8 -*-
import sys, json, traceback, warnings

warnings.filterwarnings("ignore")

def _force_utf8_stdout():
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_force_utf8_stdout()

def extract_docx_text(docx_path):
    try:
        from docx import Document
        from docx.text.paragraph import Paragraph
        from docx.table import Table

        doc = Document(docx_path)
        full_text = []
        
        # Tentativa de ler na ordem
        for element in doc.element.body:
            if element.tag.endswith('p'):
                p = Paragraph(element, doc)
                txt = p.text.strip()
                if txt:
                    full_text.append(txt)
            elif element.tag.endswith('tbl'):
                t = Table(element, doc)
                for row in t.rows:
                    row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if row_text:
                        full_text.append(" | ".join(row_text))
        
        # Fallback se a iteração complexa falhou
        if not full_text:
            for para in doc.paragraphs:
                if para.text.strip():
                    full_text.append(para.text)
            for table in doc.tables:
                for row in table.rows:
                    row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if row_text:
                        full_text.append(" | ".join(row_text))

        text = "\\n\\n".join(full_text)
            
        return {
            "ok": True,
            "text": text,
            "error": None
        }
    except ImportError:
        return {
            "ok": False,
            "error": "Biblioteca 'python-docx' não encontrada no ambiente.",
            "suggestion": "Instale a dependência necessária executando: pip install python-docx",
            "missing_dependency": "python-docx"
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc()
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Argumentos insuficientes."}))
        sys.exit(1)
    
    path_arg = sys.argv[1]
    
    result = extract_docx_text(path_arg)
    print(json.dumps(result, ensure_ascii=True))
`;

  const tempDir = os.tmpdir();
  const tempScriptPath = path.join(tempDir, `docx_extract_${Date.now()}.py`);

  try {
    fs.writeFileSync(tempScriptPath, pythonScript, 'utf8');

    const tryRuntimes = [
      { cmd: 'python', args: ['-X', 'utf8'] },
      { cmd: 'python3', args: ['-X', 'utf8'] },
      { cmd: 'py', args: ['-3', '-X', 'utf8'] }
    ];

    let stdout = '';
    let lastErr: any = null;

    for (const rt of tryRuntimes) {
      try {
        const res = await execFileAsync(
          rt.cmd,
          [...rt.args, tempScriptPath, abs],
          { maxBuffer, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true }
        );
        stdout = res.stdout;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (lastErr) {
      return { text: '', warning: `Falha ao executar Python: ${lastErr.message || lastErr}` };
    }

    let parsed: any;
    try {
        parsed = JSON.parse(stdout.trim());
    } catch (e) {
        return { text: '', warning: `Erro ao processar saída do extrator: ${stdout.slice(0, 500)}` };
    }
    
    if (!parsed.ok) {
      return { text: '', warning: `Erro no extrator: ${parsed.error}` };
    }

    DOCX_CACHE.set(abs, { key: cacheKey, text: parsed.text });
    return { text: parsed.text };

  } catch (e: any) {
    return { text: '', warning: `Erro: ${e.message}` };
  } finally {
    try { fs.unlinkSync(tempScriptPath); } catch {}
  }
}

export async function executeReadDocx(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<ReadDocxResult> {
  try {
    const relPath = normalizePath(args.path || '').trim();
    if (!relPath) return { success: false, error: 'Caminho do arquivo ausente.' };

    const maxBytes = clampInt(args.maxDocxBytes, 1 * 1024 * 1024, 20 * 1024 * 1024);

    const workspaceRoot = options.workspaceFolder.uri;
    const fileUri = vscode.Uri.joinPath(workspaceRoot, relPath);
    const stat = await vscode.workspace.fs.stat(fileUri);

    const result = await loadDocxText(fileUri, stat, { maxBytes });

    return {
      success: true,
      path: makeRelativeToWorkspaceRoot(options.workspaceFolder, fileUri.fsPath),
      text: result.text,
      warning: result.warning
    };
  } catch (e: any) {
      return { success: false, error: e.message || String(e) };
  }
}
