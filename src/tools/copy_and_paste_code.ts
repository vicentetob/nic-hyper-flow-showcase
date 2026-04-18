import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveWorkspacePath } from './utils';
import { ExecuteToolOptions } from './types';

// ==========================================
// 🔥 TRUE SEMANTIC PATCH - NIC HYPER FLOW
//
// ✅ OBRIGATÓRIO: em sucesso (sem dry_run) retorna applied_diff do que foi aplicado.
// ✅ Match robusto: normaliza EOL + remove invisíveis + ignora whitespace entre tokens (DEFAULT).
// ✅ Auto-fallback: tenta match “forte” primeiro; se falhar tenta fuzzy automaticamente.
// ✅ insert simplificado: replacement_text + insert_at_line auto quando faltar âncora final.
// ✅ auto scope: se não vier contexto_final, tenta achar fechamento por balanceamento de chaves.
// ✅ Indent: smart_indent default true; dedent_on_move default true (new_file + recortar).
// ✅ Erros acionáveis: prova do porquê falhou (snippet real + mini-diff).
// ==========================================

type Mode = 'new_file' | 'insert';
type WhitespaceMode = 'strict' | 'normalize' | 'ignore_between_tokens';

interface SemanticPatchArgs {
  mode: Mode;

  // ORIGEM (extração)
  arquivo_origem?: string;
  contexto_inicial?: string;
  contexto_final?: string;

  // ORIGEM (direta)
  replacement_text?: string;

  // Limita linhas usadas das âncoras (topo)
  linhas_contexto?: number;

  // Destinos
  arquivo_destino?: string; // new_file
  arquivo_alvo?: string; // insert
  contexto_alvo_inicial?: string;
  contexto_alvo_final?: string;

  // flags opcionais (o modelo NÃO precisa mandar na maioria dos casos)
  recortar: boolean;
  dry_run?: boolean;

  // tuning (quase sempre suprimidos do modelo)
  fuzzy_match?: boolean; // se undefined -> auto-fallback interno
  whitespace_mode?: WhitespaceMode; // se undefined -> default interno ignore_between_tokens
  auto_find_scope?: boolean; // se undefined -> auto (true quando contexto_final faltar)
  auto_find_scope_alvo?: boolean; // se undefined -> auto (true quando contexto_alvo_final faltar e não for insert_at_line)
  insert_at_line?: boolean; // se undefined -> auto (true quando faltar alvo_final e não auto_scope_alvo)
  smart_indent?: boolean; // default true
  dedent_on_move?: boolean; // default true (quando new_file + recortar)
}

interface PatchResult {
  success: boolean;
  message: string;

  linhas_movidas?: number;
  bytes_movidos?: number;

  arquivo_origem_modificado?: boolean;
  arquivo_destino_criado?: boolean;

  preview?: string;
  warnings?: string[];

  // ✅ SEMPRE em sucesso (exceto dry_run)
  applied_diff?: string;

  match_info?: {
    linha_inicial?: number;
    linha_final?: number;
    match_exato?: boolean;
    score_inicial?: number;
    score_final?: number;
    anchor_inicial_linhas?: number;
    anchor_final_linhas?: number;
  };

  debug?: {
    details?: string;
    hint?: string;
    snippet?: string;
    mini_diff?: string;
  };
}

// ==========================================
// 🧠 IO + EOL normalization
// ==========================================

function detectEol(s: string): '\r\n' | '\n' {
  return s.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeEolToLF(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

async function readTextPreserveEol(filePath: string): Promise<{ raw: string; lf: string; eol: '\r\n' | '\n' }> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return { raw, lf: normalizeEolToLF(raw), eol: detectEol(raw) };
}

async function writeTextPreserveEol(filePath: string, lfContent: string, eol: '\r\n' | '\n'): Promise<void> {
  const out = eol === '\n' ? lfContent : lfContent.replace(/\n/g, '\r\n');
  await fs.writeFile(filePath, out, 'utf-8');
}

// ==========================================
// 🔍 Robust matching (invisíveis + whitespace)
// ==========================================

function stripInvisibles(s: string): string {
  return s
    .replace(/\u00A0/g, ' ') // NBSP
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width
}

function normalizeForMatch(line: string, mode: WhitespaceMode): string {
  let s = stripInvisibles(line);

  if (mode === 'strict') {
    return normalizeEolToLF(s);
  }

  // normalize whitespace
  s = s.replace(/\t/g, ' ').trim().replace(/\s+/g, ' ');

  if (mode === 'normalize') return s;

  // ignore_between_tokens (DEFAULT):
  // remove whitespace around tokens so "class A {" matches "class A{"
  s = s
    .replace(/\s*([{}()[\];,.:=<>+\-/*%!?&|^~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

function calcularSimilaridade(linhaArquivo: string, linhaAncora: string, whitespaceMode: WhitespaceMode): number {
  const a = normalizeForMatch(linhaArquivo, whitespaceMode).toLowerCase();
  const b = normalizeForMatch(linhaAncora, whitespaceMode).toLowerCase();
  if (a === b) return 1.0;

  const limpaA = a.replace(/[{};,()]/g, '');
  const limpaB = b.replace(/[{};,()]/g, '');
  if (limpaA === limpaB) return 0.96;

  if (limpaA.includes(limpaB) || limpaB.includes(limpaA)) {
    const menor = Math.min(limpaA.length, limpaB.length);
    const maior = Math.max(limpaA.length, limpaB.length);
    return menor / maior;
  }

  const w1 = new Set(limpaA.split(/\s+/).filter(Boolean));
  const w2 = new Set(limpaB.split(/\s+/).filter(Boolean));
  const comum = [...w1].filter((w) => w2.has(w) && w.length > 2).length;
  const total = Math.max(w1.size, w2.size) || 1;
  return comum > 0 ? comum / total : 0;
}

function prepararAncora(contexto: string, maxLines?: number): string[] {
  const raw = normalizeEolToLF(stripInvisibles(contexto)).split('\n');

  // trim de âncora: remove vazias no começo/fim, preserva vazias internas
  let start = 0;
  while (start < raw.length && raw[start].trim() === '') start++;
  let end = raw.length - 1;
  while (end >= 0 && raw[end].trim() === '') end--;

  const trimmed = start <= end ? raw.slice(start, end + 1) : [''];

  if (!maxLines || maxLines <= 0) return trimmed;
  return trimmed.slice(0, Math.max(1, maxLines));
}

type MatchBloco = {
  linha: number;
  score: number; // média
  exato: boolean;
  anchorLen: number;
};

function buscarBlocoContiguo(
  linhasArquivo: string[],
  anchorLines: string[],
  iniciarEm: number,
  fuzzy: boolean,
  thresholdMedia: number,
  whitespaceMode: WhitespaceMode
): MatchBloco | null {
  const anchorLen = anchorLines.length;
  if (anchorLen === 0) return null;

  if (anchorLen === 1) {
    const alvo = normalizeForMatch(anchorLines[0], whitespaceMode);
    let melhor: MatchBloco | null = null;

    for (let i = iniciarEm; i < linhasArquivo.length; i++) {
      const ln = normalizeForMatch(linhasArquivo[i], whitespaceMode);

      if (!fuzzy) {
        if (ln === alvo) return { linha: i, score: 1.0, exato: true, anchorLen: 1 };
        continue;
      }

      const s = calcularSimilaridade(linhasArquivo[i], anchorLines[0], whitespaceMode);
      if (s >= thresholdMedia) {
        if (!melhor || s > melhor.score) melhor = { linha: i, score: s, exato: s === 1.0, anchorLen: 1 };
      }
    }
    return melhor;
  }

  let melhorMatch: MatchBloco | null = null;

  for (let i = iniciarEm; i <= linhasArquivo.length - anchorLen; i++) {
    let scoreTotal = 0;
    let exato = true;

    for (let j = 0; j < anchorLen; j++) {
      const a = anchorLines[j];
      const b = linhasArquivo[i + j];

      if (!fuzzy) {
        if (normalizeForMatch(a, whitespaceMode) !== normalizeForMatch(b, whitespaceMode)) {
          scoreTotal = 0;
          exato = false;
          break;
        }
        scoreTotal += 1.0;
      } else {
        const s = calcularSimilaridade(b, a, whitespaceMode);
        scoreTotal += s;
        if (s < 1.0) exato = false;
      }
    }

    if (scoreTotal === 0) continue;

    const media = scoreTotal / anchorLen;

    if (!fuzzy) return { linha: i, score: 1.0, exato: true, anchorLen };

    if (media >= thresholdMedia) {
      if (!melhorMatch || media > melhorMatch.score) melhorMatch = { linha: i, score: media, exato, anchorLen };
    }
  }

  return melhorMatch;
}

// ==========================================
// 🧾 Error proof (acionável)
// ==========================================

function getSnippetLines(linhas: string[], from: number, count: number): string {
  const start = Math.max(0, from);
  const end = Math.min(linhas.length, start + count);
  const out: string[] = [];
  for (let i = start; i < end; i++) out.push(`${String(i + 1).padStart(4)} | ${linhas[i]}`);
  return out.join('\n');
}

function firstDiffIndex(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  if (a.length !== b.length) return n;
  return -1;
}

function buildMiniDiff(fileLine: string, anchorLine: string, whitespaceMode: WhitespaceMode): string {
  const fa = normalizeForMatch(fileLine, whitespaceMode);
  const an = normalizeForMatch(anchorLine, whitespaceMode);
  const idx = firstDiffIndex(fa, an);
  const caret = idx >= 0 ? ' '.repeat(Math.min(idx, 120)) + '^' : '(sem divergência detectada)';
  return [
    '--- file(normalized)',
    fa.length > 160 ? fa.slice(0, 160) + '…' : fa,
    '+++ anchor(normalized)',
    an.length > 160 ? an.slice(0, 160) + '…' : an,
    '    diff',
    caret
  ].join('\n');
}

function findClosestStartLine(
  linhasArquivo: string[],
  anchorFirstLine: string,
  whitespaceMode: WhitespaceMode
): { linha: number; score: number } | null {
  let bestLine = -1;
  let bestScore = 0;

  for (let i = 0; i < linhasArquivo.length; i++) {
    const s = calcularSimilaridade(linhasArquivo[i], anchorFirstLine, whitespaceMode);
    if (s > bestScore) {
      bestScore = s;
      bestLine = i;
    }
  }

  if (bestLine < 0) return null;
  return { linha: bestLine, score: bestScore };
}

class MatchError extends Error {
  public kind:
    | 'ORIGEM_INICIAL_NAO_ENCONTRADO'
    | 'ORIGEM_FINAL_NAO_ENCONTRADO'
    | 'ALVO_INICIAL_NAO_ENCONTRADO'
    | 'ALVO_FINAL_NAO_ENCONTRADO'
    | 'ESCOPO_NAO_ENCONTRADO'
    | 'VALIDACAO';

  public details?: string;
  public hint?: string;
  public snippet?: string;
  public miniDiff?: string;

  constructor(
    kind: MatchError['kind'],
    message: string,
    extra?: { details?: string; hint?: string; snippet?: string; miniDiff?: string }
  ) {
    super(message);
    this.kind = kind;
    this.details = extra?.details;
    this.hint = extra?.hint;
    this.snippet = extra?.snippet;
    this.miniDiff = extra?.miniDiff;
  }
}

// ==========================================
// 🔫 Auto scope (brace balance) ignoring strings/comments
// ==========================================

function findMatchingBraceLine(linhas: string[], startLine: number): number | null {
  let depth = 0;
  let sawFirstOpen = false;

  let inSQuote = false;
  let inDQuote = false;
  let inTmpl = false;
  let inLineComment = false;
  let inBlockComment = false;

  const isEscaped = (str: string, idx: number) => idx > 0 && str[idx - 1] === '\\';

  for (let i = startLine; i < linhas.length; i++) {
    const line = linhas[i];
    inLineComment = false;

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = j + 1 < line.length ? line[j + 1] : '';

      if (!inSQuote && !inDQuote && !inTmpl) {
        if (!inBlockComment && !inLineComment && ch === '/' && next === '/') {
          inLineComment = true;
          break;
        }
        if (!inBlockComment && ch === '/' && next === '*') {
          inBlockComment = true;
          j++;
          continue;
        }
        if (inBlockComment && ch === '*' && next === '/') {
          inBlockComment = false;
          j++;
          continue;
        }
      }

      if (inBlockComment || inLineComment) continue;

      if (!inDQuote && !inTmpl && ch === "'" && !isEscaped(line, j)) {
        inSQuote = !inSQuote;
        continue;
      }
      if (!inSQuote && !inTmpl && ch === '"' && !isEscaped(line, j)) {
        inDQuote = !inDQuote;
        continue;
      }
      if (!inSQuote && !inDQuote && ch === '`' && !isEscaped(line, j)) {
        inTmpl = !inTmpl;
        continue;
      }

      if (inSQuote || inDQuote || inTmpl) continue;

      if (ch === '{') {
        depth++;
        sawFirstOpen = true;
      } else if (ch === '}') {
        if (sawFirstOpen) depth--;
        if (sawFirstOpen && depth === 0) return i;
      }
    }
  }

  return null;
}

// ==========================================
// 🧩 Indent helpers
// ==========================================

function getIndentOfLine(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0] : '';
}

function dedentBlock(contentLF: string): string {
  const lines = normalizeEolToLF(contentLF).split('\n');
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return contentLF;

  let min = Infinity;
  for (const l of nonEmpty) min = Math.min(min, getIndentOfLine(l).length);

  if (!isFinite(min) || min <= 0) return contentLF;

  return lines.map((l) => (l.trim() === '' ? l : l.slice(min))).join('\n');
}

function reindentBlockToTarget(contentLF: string, targetIndent: string): string {
  const ded = dedentBlock(contentLF);
  const lines = normalizeEolToLF(ded).split('\n');
  return lines.map((l) => (l.trim() === '' ? l : targetIndent + l)).join('\n');
}

function inferTargetIndent(linhasArquivo: string[], insertionLine: number, anchorLine: number): string {
  for (let i = insertionLine; i < Math.min(linhasArquivo.length, insertionLine + 6); i++) {
    if (linhasArquivo[i].trim() !== '') return getIndentOfLine(linhasArquivo[i]);
  }
  return getIndentOfLine(linhasArquivo[anchorLine] ?? '');
}

// ==========================================
// 🧾 Diff (simples, sempre correto)
// - 1 hunk cobrindo tudo (pode ser grande, mas prova “o que mudou”)
// ==========================================

type DiffOp = { type: 'equal' | 'insert' | 'delete'; line: string };

function myersDiffLines(a: string[], b: string[]): DiffOp[] {
  const N = a.length;
  const M = b.length;
  const max = N + M;

  const v = new Map<number, number>();
  v.set(1, 0);

  const trace: Map<number, number>[] = [];

  for (let d = 0; d <= max; d++) {
    const vNew = new Map<number, number>();

    for (let k = -d; k <= d; k += 2) {
      let x: number;

      if (k === -d) {
        x = v.get(k + 1) ?? 0;
      } else if (k === d) {
        x = (v.get(k - 1) ?? 0) + 1;
      } else {
        const down = v.get(k + 1) ?? 0;
        const right = (v.get(k - 1) ?? 0) + 1;
        x = right > down ? right : down;
      }

      let y = x - k;

      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      vNew.set(k, x);

      if (x >= N && y >= M) {
        trace.push(vNew);
        return backtrack(a, b, trace);
      }
    }

    trace.push(vNew);
    v.clear();
    for (const [k, val] of vNew.entries()) v.set(k, val);
  }

  return [];
}

function backtrack(a: string[], b: string[], trace: Map<number, number>[]): DiffOp[] {
  let x = a.length;
  let y = b.length;
  const ops: DiffOp[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: a[x - 1] });
      x--;
      y--;
    }

    if (d === 0) break;

    if (x === prevX) {
      ops.push({ type: 'insert', line: b[y - 1] });
      y--;
    } else {
      ops.push({ type: 'delete', line: a[x - 1] });
      x--;
    }
  }

  return ops.reverse();
}

function truncateDiffMiddle(ops: DiffOp[]): DiffOp[] {
  const result: DiffOp[] = [];
  let currentEqualBlock: DiffOp[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'equal') {
      currentEqualBlock.push(op);
    } else {
      // Se tivermos um bloco de iguais pendente, processamos ele
      if (currentEqualBlock.length > 0) {
        if (currentEqualBlock.length <= 8) {
          result.push(...currentEqualBlock);
        } else {
          // Trunca: 4 do começo, sinalizador, 4 do fim
          result.push(...currentEqualBlock.slice(0, 4));
          result.push({ type: 'equal', line: `... (${currentEqualBlock.length - 8} linhas omitidas) ...` });
          result.push(...currentEqualBlock.slice(-4));
        }
        currentEqualBlock = [];
      }
      result.push(op);
    }
  }

  // Bloco final de iguais
  if (currentEqualBlock.length > 0) {
    if (currentEqualBlock.length <= 8) {
      result.push(...currentEqualBlock);
    } else {
      result.push(...currentEqualBlock.slice(0, 4));
      result.push({ type: 'equal', line: `... (${currentEqualBlock.length - 8} linhas omitidas) ...` });
      result.push(...currentEqualBlock.slice(-4));
    }
  }

  return result;
}

function toUnifiedDiff(fileLabel: string, beforeLF: string, afterLF: string): string {
  const a = normalizeEolToLF(beforeLF).split('\n');
  const b = normalizeEolToLF(afterLF).split('\n');

  // quick equality
  if (beforeLF === afterLF) return '';

  const ops = myersDiffLines(a, b);
  if (!ops.some((op) => op.type !== 'equal')) return '';

  // Trunca blocos de contexto (iguais) muito longos para economizar tokens do modelo
  const truncatedOps = truncateDiffMiddle(ops);

  const out: string[] = [];
  out.push(`--- a/${fileLabel}`);
  out.push(`+++ b/${fileLabel}`);
  out.push(`@@ -1,${a.length} +1,${b.length} @@`);

  for (const op of truncatedOps) {
    if (op.type === 'equal') {
      if (op.line.startsWith('... (')) out.push(` ${op.line}`);
      else out.push(` ${op.line}`);
    } else if (op.type === 'delete') {
      out.push(`-${op.line}`);
    } else {
      out.push(`+${op.line}`);
    }
  }

  return out.join('\n');
}

// ==========================================
// 🧠 Core ops: extração + inserção
// ==========================================

type MatchAttempt = {
  fuzzy: boolean;
  whitespaceMode: WhitespaceMode;
  threshold: number;
  label: string;
};

function buildAttempts(userWhitespace?: WhitespaceMode, userFuzzy?: boolean): MatchAttempt[] {
  const ws = userWhitespace ?? 'ignore_between_tokens';

  // FORÇADO: sempre usa fuzzy = true
  const base: MatchAttempt[] = [];

  base.push({
    fuzzy: true,
    whitespaceMode: ws,
    threshold: 0.88,
    label: `forced(fuzzy=true, ws=${ws})`
  });

  // Fallback adicional para garantir matching
  if (ws !== 'normalize') {
    base.push({ fuzzy: true, whitespaceMode: 'normalize', threshold: 0.88, label: 'fallback(fuzzy=true, ws=normalize)' });
  }

  return base;
}

async function extrairBlocoSemanticoComFallback(params: {
  caminhoArquivo: string;
  contextoInicial: string;
  contextoFinal?: string;
  linhasContexto?: number;
  userWhitespace?: WhitespaceMode;
  userFuzzy?: boolean;
  autoFindScope: boolean;
}): Promise<{
  conteudo: string;
  linhaInicio: number;
  linhaFim: number;
  matchInicial: { exato: boolean; score: number; anchorLen: number };
  matchFinal: { exato: boolean; score: number; anchorLen: number };
  warnings: string[];
}> {
  const { caminhoArquivo, contextoInicial, contextoFinal, linhasContexto, userWhitespace, userFuzzy, autoFindScope } = params;

  const { lf } = await readTextPreserveEol(caminhoArquivo);
  const linhas = lf.split('\n');

  const anchorIni = prepararAncora(contextoInicial, linhasContexto);
  const anchorFim = contextoFinal ? prepararAncora(contextoFinal, linhasContexto) : null;

  const attempts = buildAttempts(userWhitespace, userFuzzy);
  const warnings: string[] = [];

  for (const att of attempts) {
    const matchIni = buscarBlocoContiguo(linhas, anchorIni, 0, att.fuzzy, att.threshold, att.whitespaceMode);
    if (!matchIni) continue;

    if (matchIni.score < 1.0) warnings.push(`⚠️  Match aproximado no contexto inicial (${att.label}) score ${(matchIni.score * 100).toFixed(1)}%`);

    if (autoFindScope) {
      const endLine = findMatchingBraceLine(linhas, matchIni.linha);
      if (endLine == null) {
        throw new MatchError(
          'ESCOPO_NAO_ENCONTRADO',
          `auto_find_scope=true mas não encontrei o fechamento "}" correspondente após a linha ${matchIni.linha + 1}.`,
          {
            hint: 'Garanta que o contexto_inicial contenha (ou esteja próximo de) um "{".',
            snippet: getSnippetLines(linhas, Math.max(0, matchIni.linha - 2), 14)
          }
        );
      }

      const linhaInicio = matchIni.linha + matchIni.anchorLen;
      const linhaFim = endLine - 1;

      if (linhaFim < linhaInicio) {
        throw new MatchError('ESCOPO_NAO_ENCONTRADO', `Escopo calculado inválido (fim antes do início).`, {
          snippet: getSnippetLines(linhas, Math.max(0, matchIni.linha - 2), 14)
        });
      }

      return {
        conteudo: linhas.slice(linhaInicio, linhaFim + 1).join('\n'),
        linhaInicio,
        linhaFim,
        matchInicial: { exato: matchIni.exato && matchIni.score === 1.0, score: matchIni.score, anchorLen: matchIni.anchorLen },
        matchFinal: { exato: true, score: 1.0, anchorLen: 1 },
        warnings
      };
    }

    if (!anchorFim) {
      throw new MatchError('VALIDACAO', 'contexto_final é obrigatório quando auto_find_scope=false');
    }

    const startAfterIni = matchIni.linha + matchIni.anchorLen;
    const matchFim = buscarBlocoContiguo(linhas, anchorFim, startAfterIni, att.fuzzy, att.threshold, att.whitespaceMode);
    if (!matchFim) {
      // tentativa falhou no final: tenta próxima configuração (fallback)
      continue;
    }

    if (matchFim.score < 1.0) warnings.push(`⚠️  Match aproximado no contexto final (${att.label}) score ${(matchFim.score * 100).toFixed(1)}%`);

    const linhaInicio = matchIni.linha + matchIni.anchorLen;
    const linhaFim = matchFim.linha - 1;

    if (linhaFim < linhaInicio) {
      throw new MatchError(
        'VALIDACAO',
        `Contexto final está antes do inicial – não há conteúdo entre âncoras.`,
        { snippet: getSnippetLines(linhas, Math.max(0, matchIni.linha - 2), 16) }
      );
    }

    return {
      conteudo: linhas.slice(linhaInicio, linhaFim + 1).join('\n'),
      linhaInicio,
      linhaFim,
      matchInicial: { exato: matchIni.exato && matchIni.score === 1.0, score: matchIni.score, anchorLen: matchIni.anchorLen },
      matchFinal: { exato: matchFim.exato && matchFim.score === 1.0, score: matchFim.score, anchorLen: matchFim.anchorLen },
      warnings
    };
  }

  // Se chegou aqui, não achou o início NEM em fuzzy: devolve prova
  const closest = findClosestStartLine(linhas, anchorIni[0] ?? '', userWhitespace ?? 'ignore_between_tokens');
  const hint = closest
    ? `Mais próximo: linha ${closest.linha + 1} (score ${(closest.score * 100).toFixed(
        1
      )}%). Aumente a âncora (2-5 linhas) ou copie exatamente do arquivo.`
    : 'Tente fornecer uma âncora mais longa (2-5 linhas) copiada do arquivo.';

  const snippet = closest ? getSnippetLines(linhas, Math.max(0, closest.linha - 2), 10) : getSnippetLines(linhas, 0, 12);
  const miniDiff = closest && anchorIni[0] ? buildMiniDiff(linhas[closest.linha], anchorIni[0], userWhitespace ?? 'ignore_between_tokens') : undefined;

  throw new MatchError('ORIGEM_INICIAL_NAO_ENCONTRADO', `Contexto inicial não encontrado em ${path.basename(caminhoArquivo)}.`, {
    hint,
    snippet,
    miniDiff,
    details: `anchor_first_line="${(anchorIni[0] ?? '').slice(0, 160)}"`
  });
}

async function removerBloco(caminhoArquivo: string, linhaInicio: number, linhaFim: number): Promise<void> {
  const { lf, eol } = await readTextPreserveEol(caminhoArquivo);
  const linhas = lf.split('\n');
  const novasLinhas = [...linhas.slice(0, linhaInicio), ...linhas.slice(linhaFim + 1)];
  await writeTextPreserveEol(caminhoArquivo, novasLinhas.join('\n'), eol);
}

async function inserirEntreAncorasComFallback(params: {
  caminhoArquivo: string;
  contextoInicial: string;
  contextoFinal?: string;
  conteudoParaInserir: string;
  linhasContexto?: number;
  userWhitespace?: WhitespaceMode;
  userFuzzy?: boolean;
  smartIndent: boolean;
  autoFindScopeAlvo: boolean;
}): Promise<void> {
  const { caminhoArquivo, contextoInicial, contextoFinal, conteudoParaInserir, linhasContexto, userWhitespace, userFuzzy, smartIndent, autoFindScopeAlvo } =
    params;

  const { lf, eol } = await readTextPreserveEol(caminhoArquivo);
  const linhas = lf.split('\n');

  const anchorIni = prepararAncora(contextoInicial, linhasContexto);
  const anchorFim = contextoFinal ? prepararAncora(contextoFinal, linhasContexto) : null;

  const attempts = buildAttempts(userWhitespace, userFuzzy);

  for (const att of attempts) {
    const matchIni = buscarBlocoContiguo(linhas, anchorIni, 0, att.fuzzy, att.threshold, att.whitespaceMode);
    if (!matchIni) continue;

    const iniEnd = matchIni.linha + matchIni.anchorLen - 1;
    const insertStartLine = iniEnd + 1;

    let fimStartLine: number | null = null;

    if (autoFindScopeAlvo) {
      const endLine = findMatchingBraceLine(linhas, matchIni.linha);
      if (endLine == null) {
        throw new MatchError('ESCOPO_NAO_ENCONTRADO', `auto_find_scope_alvo=true mas não encontrei o fechamento "}" no alvo.`, {
          snippet: getSnippetLines(linhas, Math.max(0, matchIni.linha - 2), 14)
        });
      }
      fimStartLine = endLine;
    } else {
      if (!anchorFim) throw new MatchError('VALIDACAO', 'contexto_alvo_final é obrigatório quando auto_find_scope_alvo=false');
      const startAfterIni = matchIni.linha + matchIni.anchorLen;
      const matchFim = buscarBlocoContiguo(linhas, anchorFim, startAfterIni, att.fuzzy, att.threshold, att.whitespaceMode);
      if (!matchFim) continue;
      fimStartLine = matchFim.linha;
    }

    let inserir = normalizeEolToLF(conteudoParaInserir);
    if (smartIndent) {
      const targetIndent = inferTargetIndent(linhas, insertStartLine, matchIni.linha);
      inserir = reindentBlockToTarget(inserir, targetIndent);
    }
    const inserirLinhas = inserir.split('\n');

    const novasLinhas = [...linhas.slice(0, iniEnd + 1), ...inserirLinhas, ...linhas.slice(fimStartLine)];
    await writeTextPreserveEol(caminhoArquivo, novasLinhas.join('\n'), eol);
    return;
  }

  // prova do erro (inicial)
  const closest = findClosestStartLine(linhas, anchorIni[0] ?? '', userWhitespace ?? 'ignore_between_tokens');
  throw new MatchError('ALVO_INICIAL_NAO_ENCONTRADO', `Contexto inicial do alvo não encontrado em ${path.basename(caminhoArquivo)}.`, {
    hint: closest ? `Mais próximo: linha ${closest.linha + 1}` : 'Tente aumentar a âncora (2-5 linhas).',
    snippet: closest ? getSnippetLines(linhas, Math.max(0, closest.linha - 2), 10) : getSnippetLines(linhas, 0, 12),
    miniDiff: closest && anchorIni[0] ? buildMiniDiff(linhas[closest.linha], anchorIni[0], userWhitespace ?? 'ignore_between_tokens') : undefined
  });
}

async function inserirAbaixoDaAncoraComFallback(params: {
  caminhoArquivo: string;
  contextoInicial: string;
  conteudoParaInserir: string;
  linhasContexto?: number;
  userWhitespace?: WhitespaceMode;
  userFuzzy?: boolean;
  smartIndent: boolean;
}): Promise<void> {
  const { caminhoArquivo, contextoInicial, conteudoParaInserir, linhasContexto, userWhitespace, userFuzzy, smartIndent } = params;

  const { lf, eol } = await readTextPreserveEol(caminhoArquivo);
  const linhas = lf.split('\n');

  const anchorIni = prepararAncora(contextoInicial, linhasContexto);
  const attempts = buildAttempts(userWhitespace, userFuzzy);

  for (const att of attempts) {
    const matchIni = buscarBlocoContiguo(linhas, anchorIni, 0, att.fuzzy, att.threshold, att.whitespaceMode);
    if (!matchIni) continue;

    const afterAnchorLine = matchIni.linha + matchIni.anchorLen;

    let inserir = normalizeEolToLF(conteudoParaInserir);
    if (smartIndent) {
      const targetIndent = inferTargetIndent(linhas, afterAnchorLine, matchIni.linha);
      inserir = reindentBlockToTarget(inserir, targetIndent);
    }
    const inserirLinhas = inserir.split('\n');

    const novasLinhas = [...linhas.slice(0, afterAnchorLine), ...inserirLinhas, ...linhas.slice(afterAnchorLine)];
    await writeTextPreserveEol(caminhoArquivo, novasLinhas.join('\n'), eol);
    return;
  }

  const closest = findClosestStartLine(linhas, anchorIni[0] ?? '', userWhitespace ?? 'ignore_between_tokens');
  throw new MatchError('ALVO_INICIAL_NAO_ENCONTRADO', `Âncora do alvo não encontrada em ${path.basename(caminhoArquivo)}.`, {
    hint: closest ? `Mais próximo: linha ${closest.linha + 1}` : 'Tente aumentar a âncora (2-5 linhas).',
    snippet: closest ? getSnippetLines(linhas, Math.max(0, closest.linha - 2), 10) : getSnippetLines(linhas, 0, 12),
    miniDiff: closest && anchorIni[0] ? buildMiniDiff(linhas[closest.linha], anchorIni[0], userWhitespace ?? 'ignore_between_tokens') : undefined
  });
}

// ==========================================
// 🎨 Preview (leve)
// ==========================================

function gerarPreviewHeader(origem: string, destino: string, recortar: boolean): string {
  return [
    '═══════════════════════════════════════════',
    '📋 SEMANTIC PATCH PREVIEW',
    '═══════════════════════════════════════════',
    '',
    `--- ${origem} ${recortar ? '[SERÁ REMOVIDO]' : '[SERÁ MANTIDO]'}`,
    `+++ ${destino} [SERÁ CRIADO/ATUALIZADO]`,
    '═══════════════════════════════════════════'
  ].join('\n');
}

// ==========================================
// 🚀 EXECUTOR PRINCIPAL
// ==========================================

export async function executeCopyAndPasteCode(args: any, options: ExecuteToolOptions): Promise<PatchResult> {
  const params = args as SemanticPatchArgs;
  const warnings: string[] = [];

  // Defaults fortes (modelo não precisa mandar)
  const dryRun = params.dry_run ?? false;
  const smartIndent = params.smart_indent ?? true;
  const dedentOnMove = params.dedent_on_move ?? true;

  const userWhitespace = params.whitespace_mode; // opcional (default interno)
  const userFuzzy = params.fuzzy_match ?? true; // sempre true por padrão
  const linhasContexto = params.linhas_contexto;

  try {
    if (!params.mode) throw new MatchError('VALIDACAO', 'Parâmetro mode é obrigatório (new_file | insert)');
    if (params.mode !== 'new_file' && params.mode !== 'insert') throw new MatchError('VALIDACAO', `Mode inválido: ${params.mode}`);
    if (typeof params.recortar !== 'boolean') throw new MatchError('VALIDACAO', 'Parâmetro recortar é obrigatório (true/false)');

    const usingReplacement = typeof params.replacement_text === 'string';
    const workspace = options.workspaceFolder;

    const diffs: string[] = [];

    // Heurística de auto-scope:
    // - se contexto_final NÃO veio, auto_find_scope default vira true
    const autoFindScope = params.auto_find_scope ?? (!usingReplacement && !!params.contexto_inicial && !params.contexto_final);
    // Para alvo: se contexto_alvo_final não veio e não for insert_at_line, auto scope alvo pode virar true
    const autoFindScopeAlvo =
      params.auto_find_scope_alvo ??
      (!!params.contexto_alvo_inicial && !params.contexto_alvo_final && (params.insert_at_line ?? false) === false);

    // Heurística de insert_at_line:
    // - se não veio alvo_final e não auto_scope_alvo, assume insert_at_line=true (simplifica pro modelo)
    const inferInsertAtLine =
      params.insert_at_line ??
      (params.mode === 'insert' && !!params.contexto_alvo_inicial && !params.contexto_alvo_final && !autoFindScopeAlvo);

    // ==========================================
    // MODE: NEW_FILE
    // ==========================================
    if (params.mode === 'new_file') {
      if (!params.arquivo_destino) throw new MatchError('VALIDACAO', 'arquivo_destino é obrigatório no mode=new_file');

      const destinoUri = resolveWorkspacePath(workspace, params.arquivo_destino);
      const destinoPath = destinoUri.fsPath;

      const beforeDestinoRaw = await fs.readFile(destinoPath, 'utf-8').catch(() => '');
      const beforeDestinoLF = normalizeEolToLF(beforeDestinoRaw);

      let conteudoNovoLF: string;

      // Para diff de origem caso recortar
      let origemPath: string | null = null;
      let beforeOrigemLF: string | null = null;

      let match_info: PatchResult['match_info'] | undefined;

      if (usingReplacement) {
        conteudoNovoLF = normalizeEolToLF(params.replacement_text!);
        if (params.recortar && dedentOnMove) conteudoNovoLF = dedentBlock(conteudoNovoLF);
      } else {
        if (!params.arquivo_origem || !params.contexto_inicial) {
          throw new MatchError(
            'VALIDACAO',
            'Para extrair do arquivo: forneça arquivo_origem + contexto_inicial e (contexto_final OU omita para auto_find_scope).'
          );
        }

        const origemUri = resolveWorkspacePath(workspace, params.arquivo_origem);
        origemPath = origemUri.fsPath;

        try {
          await fs.access(origemPath);
        } catch {
          throw new MatchError('VALIDACAO', `Arquivo de origem não encontrado: ${params.arquivo_origem}`);
        }

        beforeOrigemLF = (await readTextPreserveEol(origemPath)).lf;

        const resultado = await extrairBlocoSemanticoComFallback({
          caminhoArquivo: origemPath,
          contextoInicial: params.contexto_inicial,
          contextoFinal: params.contexto_final,
          linhasContexto,
          userWhitespace,
          userFuzzy,
          autoFindScope
        });

        warnings.push(...resultado.warnings);

        conteudoNovoLF = resultado.conteudo;
        if (params.recortar && dedentOnMove) conteudoNovoLF = dedentBlock(conteudoNovoLF);

        match_info = {
          linha_inicial: resultado.linhaInicio,
          linha_final: resultado.linhaFim,
          match_exato: resultado.matchInicial.exato && resultado.matchFinal.exato,
          score_inicial: resultado.matchInicial.score,
          score_final: resultado.matchFinal.score,
          anchor_inicial_linhas: resultado.matchInicial.anchorLen,
          anchor_final_linhas: resultado.matchFinal.anchorLen
        };
      }

      const preview = gerarPreviewHeader(usingReplacement ? '(replacement_text)' : params.arquivo_origem!, params.arquivo_destino, params.recortar);

      if (dryRun) {
        return {
          success: true,
          message: '🔍 DRY-RUN: Nenhuma mudança aplicada',
          preview,
          warnings,
          linhas_movidas: conteudoNovoLF.split('\n').length,
          bytes_movidos: conteudoNovoLF.length,
          match_info
        };
      }

      await fs.mkdir(path.dirname(destinoPath), { recursive: true });

      // preserva EOL do destino se já existia
      const destinoEol: '\r\n' | '\n' = beforeDestinoRaw.includes('\r\n') ? '\r\n' : '\n';
      await writeTextPreserveEol(destinoPath, conteudoNovoLF, destinoEol);

      // recortar: remove origem (somente quando origem é arquivo)
      if (params.recortar && !usingReplacement && origemPath && beforeOrigemLF != null) {
        const resultado = await extrairBlocoSemanticoComFallback({
          caminhoArquivo: origemPath,
          contextoInicial: params.contexto_inicial!,
          contextoFinal: params.contexto_final,
          linhasContexto,
          userWhitespace,
          userFuzzy,
          autoFindScope
        });

        await removerBloco(origemPath, resultado.linhaInicio, resultado.linhaFim);

        const afterOrigemLF = (await readTextPreserveEol(origemPath)).lf;
        const dOrigem = toUnifiedDiff(params.arquivo_origem!, beforeOrigemLF, afterOrigemLF);
        if (dOrigem) diffs.push(dOrigem);
      }

      const afterDestinoLF = (await readTextPreserveEol(destinoPath)).lf;
      const dDestino = toUnifiedDiff(params.arquivo_destino, beforeDestinoLF, afterDestinoLF);
      if (dDestino) diffs.push(dDestino);

      const applied = diffs.join('\n\n') || `--- a/${params.arquivo_destino}\n+++ b/${params.arquivo_destino}\n@@ (no changes) @@`;

      return {
        success: true,
        message: `✅ Semantic patch aplicado: ${params.recortar ? 'MOVIDO' : 'COPIADO'} ${conteudoNovoLF.split('\n').length} linhas`,
        linhas_movidas: conteudoNovoLF.split('\n').length,
        bytes_movidos: conteudoNovoLF.length,
        arquivo_origem_modificado: params.recortar && !usingReplacement,
        arquivo_destino_criado: true,
        warnings,
        preview,
        match_info,
        applied_diff: applied
      };
    }

    // ==========================================
    // MODE: INSERT
    // ==========================================
    if (params.mode === 'insert') {
      if (!params.arquivo_alvo) throw new MatchError('VALIDACAO', 'arquivo_alvo é obrigatório no mode=insert');
      if (!params.contexto_alvo_inicial) throw new MatchError('VALIDACAO', 'contexto_alvo_inicial é obrigatório no mode=insert');

      const alvoUri = resolveWorkspacePath(workspace, params.arquivo_alvo);
      const alvoPath = alvoUri.fsPath;

      try {
        await fs.access(alvoPath);
      } catch {
        throw new MatchError('VALIDACAO', `Arquivo alvo não encontrado: ${params.arquivo_alvo}`);
      }

      const beforeAlvoLF = (await readTextPreserveEol(alvoPath)).lf;

      // Conteúdo para inserir
      let conteudoLF: string;

      // Para diff da origem caso recortar
      let origemPath: string | null = null;
      let beforeOrigemLF: string | null = null;

      let match_info: PatchResult['match_info'] | undefined;

      if (usingReplacement) {
        conteudoLF = normalizeEolToLF(params.replacement_text!);
      } else {
        if (!params.arquivo_origem || !params.contexto_inicial) {
          throw new MatchError(
            'VALIDACAO',
            'Para inserir via extração: forneça arquivo_origem + contexto_inicial e (contexto_final OU omita para auto_find_scope).'
          );
        }

        const origemUri = resolveWorkspacePath(workspace, params.arquivo_origem);
        origemPath = origemUri.fsPath;

        try {
          await fs.access(origemPath);
        } catch {
          throw new MatchError('VALIDACAO', `Arquivo de origem não encontrado: ${params.arquivo_origem}`);
        }

        beforeOrigemLF = (await readTextPreserveEol(origemPath)).lf;

        const resultado = await extrairBlocoSemanticoComFallback({
          caminhoArquivo: origemPath,
          contextoInicial: params.contexto_inicial,
          contextoFinal: params.contexto_final,
          linhasContexto,
          userWhitespace,
          userFuzzy,
          autoFindScope
        });

        warnings.push(...resultado.warnings);
        conteudoLF = resultado.conteudo;

        match_info = {
          linha_inicial: resultado.linhaInicio,
          linha_final: resultado.linhaFim,
          match_exato: resultado.matchInicial.exato && resultado.matchFinal.exato,
          score_inicial: resultado.matchInicial.score,
          score_final: resultado.matchFinal.score,
          anchor_inicial_linhas: resultado.matchInicial.anchorLen,
          anchor_final_linhas: resultado.matchFinal.anchorLen
        };
      }

      // Validação do modo de insert resolvido
      if (!inferInsertAtLine) {
        // insert clássico: precisa alvo_final OU auto scope alvo
        if (!params.contexto_alvo_final && !autoFindScopeAlvo) {
          // aqui a heurística já teria ligado insert_at_line,
          // mas se o usuário FORÇOU insert_at_line=false e não deu final, erro:
          throw new MatchError(
            'VALIDACAO',
            'Insert clássico exige contexto_alvo_final OU auto_find_scope_alvo=true. (Ou remova insert_at_line=false para usar insert_at_line automático.)'
          );
        }
      }

      const preview = gerarPreviewHeader(usingReplacement ? '(replacement_text)' : params.arquivo_origem!, params.arquivo_alvo, params.recortar);

      if (dryRun) {
        return {
          success: true,
          message: '🔍 DRY-RUN: Nenhuma mudança aplicada',
          preview,
          warnings,
          linhas_movidas: conteudoLF.split('\n').length,
          bytes_movidos: conteudoLF.length,
          match_info
        };
      }

      // Aplica no alvo
      if (inferInsertAtLine) {
        await inserirAbaixoDaAncoraComFallback({
          caminhoArquivo: alvoPath,
          contextoInicial: params.contexto_alvo_inicial,
          conteudoParaInserir: conteudoLF,
          linhasContexto,
          userWhitespace,
          userFuzzy,
          smartIndent
        });
      } else {
        await inserirEntreAncorasComFallback({
          caminhoArquivo: alvoPath,
          contextoInicial: params.contexto_alvo_inicial,
          contextoFinal: params.contexto_alvo_final,
          conteudoParaInserir: conteudoLF,
          linhasContexto,
          userWhitespace,
          userFuzzy,
          smartIndent,
          autoFindScopeAlvo
        });
      }

      // recortar: remove origem (somente quando origem é arquivo)
      if (params.recortar && !usingReplacement && origemPath && beforeOrigemLF != null) {
        const resultado = await extrairBlocoSemanticoComFallback({
          caminhoArquivo: origemPath,
          contextoInicial: params.contexto_inicial!,
          contextoFinal: params.contexto_final,
          linhasContexto,
          userWhitespace,
          userFuzzy,
          autoFindScope
        });

        await removerBloco(origemPath, resultado.linhaInicio, resultado.linhaFim);

        const afterOrigemLF = (await readTextPreserveEol(origemPath)).lf;
        const dOrigem = toUnifiedDiff(params.arquivo_origem!, beforeOrigemLF, afterOrigemLF);
        if (dOrigem) diffs.push(dOrigem);
      }

      const afterAlvoLF = (await readTextPreserveEol(alvoPath)).lf;
      const dAlvo = toUnifiedDiff(params.arquivo_alvo, beforeAlvoLF, afterAlvoLF);
      if (dAlvo) diffs.push(dAlvo);

      const applied = diffs.join('\n\n') || `--- a/${params.arquivo_alvo}\n+++ b/${params.arquivo_alvo}\n@@ (no changes) @@`;

      return {
        success: true,
        message: `✅ Semantic patch aplicado: ${params.recortar ? 'MOVIDO' : 'COPIADO'} ${conteudoLF.split('\n').length} linhas`,
        linhas_movidas: conteudoLF.split('\n').length,
        bytes_movidos: conteudoLF.length,
        arquivo_origem_modificado: params.recortar && !usingReplacement,
        arquivo_destino_criado: false,
        warnings,
        preview,
        match_info,
        applied_diff: applied
      };
    }

    throw new MatchError('VALIDACAO', `Mode inválido: ${params.mode}`);
  } catch (err: any) {
    if (err instanceof MatchError) {
      return {
        success: false,
        message: `❌ ${err.message}`,
        warnings,
        debug: {
          details: err.details,
          hint: err.hint,
          snippet: err.snippet,
          mini_diff: err.miniDiff
        }
      };
    }

    return {
      success: false,
      message: `❌ Erro inesperado: ${String(err?.message ?? err)}`,
      warnings,
      debug: {
        details: typeof err?.stack === 'string' ? err.stack.slice(0, 2000) : undefined,
        hint: 'Tente fornecer âncoras maiores (2-5 linhas) copiadas do arquivo. Se estiver usando insert clássico, verifique o contexto_alvo_final.'
      }
    };
  }
}
