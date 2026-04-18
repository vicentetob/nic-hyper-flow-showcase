import * as vscode from 'vscode';
import * as diff from 'diff';
import { JarvisEdit } from './types';
import { resolveWorkspacePath, readFileSafe, writeFileSafe, normalizeLineEndings } from './utils';
import { buildPatchFeedback, PatchContextWindow } from './patch_feedback';

type PatchFileSpec = {
  file_path: string;      // caminho completo/relativo dentro do workspace (vamos usar edit.path como fallback)
  exact_match: string;    // texto EXATO a ser encontrado (inclui whitespace)
  replacement: string;    // substituição completa
  occurrence?: number;    // opcional: se não for único, qual ocorrência aplicar (0 = primeira)
  require_unique?: boolean; // default true: falha se houver mais de 1 ocorrência (quando occurrence não fornecido)
};

function detectPreferredEol(raw: string): '\n' | '\r\n' {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function indexOfNth(haystack: string, needle: string, occurrence: number): number {
  if (!needle) return -1;
  if (occurrence <= 0) return haystack.indexOf(needle);
  let idx = -1;
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    from = idx + Math.max(1, needle.length);
  }
  return idx;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + Math.max(1, needle.length);
  }
  return count;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLineIndex(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = lineStarts[mid];
    if (v === offset) return mid;
    if (v < offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, lo - 1);
}

function sliceContextWindow(
  text: string,
  startOffset: number,
  endOffset: number,
  beforeLines: number,
  afterLines: number
): { start: number; end: number } {
  const lineStarts = computeLineStarts(text);
  const startLine = offsetToLineIndex(lineStarts, startOffset);
  const endLine = offsetToLineIndex(lineStarts, Math.max(startOffset, endOffset));

  const winStartLine = Math.max(0, startLine - beforeLines);
  const winEndLine = Math.min(lineStarts.length - 1, endLine + afterLines);

  const start = lineStarts[winStartLine] ?? 0;
  const end = lineStarts[winEndLine + 1] ?? text.length;
  return { start, end };
}

export async function applyPatchFile(
  edit: JarvisEdit,
  workspaceFolder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel,
  sidebarProvider?: any
): Promise<{
  applied: boolean;
  modified: boolean;
  path: string;
  diff?: string;
  context?: PatchContextWindow;
}> {
  const spec = (edit as any).patchFile as PatchFileSpec;

  // Compat: se o caller ainda usa edit.path como "file_path"
  const pathFromEdit = edit.path;
  const filePath = spec?.file_path || pathFromEdit;

  if (!filePath) {
    throw new Error(`PATCH_FILE requer file_path (ou edit.path).`);
  }
  if (!spec?.exact_match && spec?.exact_match !== '') {
    throw new Error(`PATCH_FILE requer exact_match.`);
  }
  if (spec?.replacement === undefined) {
    throw new Error(`PATCH_FILE requer replacement (pode ser string vazia).`);
  }
  if (!spec.exact_match) {
    // Evita operações perigosas tipo "match vazio" que trocariam tudo
    throw new Error(`PATCH_FILE: exact_match não pode ser vazio.`);
  }

  const targetUri = resolveWorkspacePath(workspaceFolder, filePath);

  // Mesma política de segurança do teu patch
  const forbiddenFiles = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
  const fileName = targetUri.fsPath.split(/[/\\]/).pop()?.toLowerCase();
  if (fileName && forbiddenFiles.includes(fileName)) {
    throw new Error(`Acesso negado ao arquivo ${fileName}.`);
  }

  const raw = await readFileSafe(targetUri);
  const preferredEol = detectPreferredEol(raw);

  // Normaliza pra operar sempre com \n (determinístico)
  const content = normalizeLineEndings(raw);

  const occ = spec.occurrence;
  const requireUnique = spec.require_unique !== false; // default true

  // Validação de unicidade (padrão mais seguro)
  const total = countOccurrences(content, spec.exact_match);

  if (total === 0) {
    throw new Error(`PATCH_FILE: exact_match não encontrado no arquivo.`);
  }

  if (occ === undefined || occ === null) {
    if (requireUnique && total !== 1) {
      throw new Error(
        `PATCH_FILE: exact_match não é único (ocorrências: ${total}). ` +
        `Forneça occurrence para escolher qual substituir, ou defina require_unique=false.`
      );
    }
  } else {
    if (occ < 0) {
      throw new Error(`PATCH_FILE: occurrence inválido (${occ}).`);
    }
    if (occ >= total) {
      throw new Error(`PATCH_FILE: occurrence ${occ} fora do range (ocorrências: ${total}).`);
    }
  }

  // Localiza índice alvo
  const targetIdx = indexOfNth(content, spec.exact_match, occ ?? 0);
  if (targetIdx === -1) {
    // Teoricamente impossível se total>0, mas mantém robustez
    throw new Error(`PATCH_FILE: falha ao localizar exact_match (índice -1).`);
  }

  const beforeText = content;
  const afterText =
    content.slice(0, targetIdx) +
    spec.replacement +
    content.slice(targetIdx + spec.exact_match.length);

  const modified = afterText !== beforeText;

  if (modified) {
    // Restaura EOL original do arquivo
    const finalText = preferredEol === '\r\n' ? afterText.replace(/\n/g, '\r\n') : afterText;
    await writeFileSafe(targetUri, finalText);

    // Calcula linhas adicionadas/removidas
    let added = 0;
    let removed = 0;
    
    // Usa diff para calcular linhas adicionadas/removidas
    const diffResult = diff.diffLines(beforeText, afterText);
    
    for (const part of diffResult) {
      if (part.added) {
        added += part.count || 1;
      } else if (part.removed) {
        removed += part.count || 1;
      }
    }

    sidebarProvider?.notifyFileModified?.(filePath, 'modified', added, removed);
    sidebarProvider?.postSystemMessage?.(`✅ PATCH_FILE aplicado: ${filePath}`);
  }

  const feedback = modified
    ? buildPatchFeedback({ path: filePath, beforeText, afterText })
    : null;

  output.appendLine(`✅ PATCH_FILE: ${filePath}`);

  return {
    applied: true,
    modified,
    path: filePath,
    diff: feedback?.diff,
    context: feedback?.context,
  };
}
