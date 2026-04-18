import * as fs from 'fs';
import * as path from 'path';
import { ExecuteToolOptions } from './types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Posicao =
  | 'inicio'
  | 'final'
  | 'apos_imports'
  | `antes_de_simbolo:${string}`
  | `apos_simbolo:${string}`;

interface CopyPasteSymbolArgs {
  operacao:  'mover' | 'copiar';
  origem: {
    arquivo: string;
    simbolo: string;
  };
  destino: {
    arquivo:  string;
    posicao:  Posicao;
  };
}

interface SuccessResult {
  sucesso:        true;
  operacao:       'movido' | 'copiado';
  simbolo:        string;
  de:             string;
  para:           string;
  posicao:        string;
  linhas_movidas: number;
}

interface FailResult {
  sucesso:    false;
  erro:       string;
  simbolo?:   string;
  arquivo?:   string;
  sugestoes?: string[];
}

type Result = SuccessResult | FailResult;

// ─── Parser de símbolo ────────────────────────────────────────────────────────
// Encontra o início e fim de um símbolo top-level num arquivo.
// Suporta: function X, const X =, class X, async function X,
//          export function X, export const X, export default function X,
//          export class X, interface X, type X, enum X

const SYMBOL_PATTERNS = [
  // function declaration (com ou sem export/async/default)
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
  // const/let/var arrow ou atribuição
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)/,
  // class
  /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/,
  // interface
  /^(?:export\s+)?interface\s+(\w+)/,
  // type alias
  /^(?:export\s+)?type\s+(\w+)\s*=/,
  // enum
  /^(?:export\s+)?enum\s+(\w+)/,
];

interface SymbolRange {
  name:      string;
  startLine: number; // 0-based
  endLine:   number; // 0-based, inclusive
  // linhas de comentário/decorator acima do símbolo que fazem parte dele
  leadingStart: number;
}

function findSymbol(lines: string[], symbolName: string): SymbolRange | null {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    let matched = false;
    for (const pattern of SYMBOL_PATTERNS) {
      const m = trimmed.match(pattern);
      if (m && m[1] === symbolName) { matched = true; break; }
    }
    if (!matched) continue;

    // Encontrou o início — agora acha o fim pelo balanceamento de chaves/parênteses
    const endLine = findSymbolEnd(lines, i);
    if (endLine === -1) continue; // símbolo malformado, tenta próxima ocorrência

    // Pega linhas de comentário/JSDoc/decorator acima
    const leadingStart = findLeadingLines(lines, i);

    return { name: symbolName, startLine: i, endLine, leadingStart };
  }
  return null;
}

function findSymbolEnd(lines: string[], startLine: number): number {
  let braces   = 0;
  let parens   = 0;
  let inString: '"' | "'" | '`' | null = null;
  let foundOpen = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch   = line[j];
      const prev = j > 0 ? line[j - 1] : '';

      // Gerencia strings
      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }

      // Ignora comentários de linha
      if (ch === '/' && line[j + 1] === '/') break;

      if (ch === '{') { braces++; foundOpen = true; }
      if (ch === '}') { braces--; }
      if (ch === '(') { parens++; }
      if (ch === ')') { parens--; }

      // Símbolo terminou
      if (foundOpen && braces === 0 && parens === 0) return i;
    }

    // Símbolo de uma linha sem chaves (ex: const X = 1;  ou  type X = string;)
    if (!foundOpen && i > startLine) {
      // Se a linha termina com ; e não abriu chaves, é um símbolo de linha única
    }
    if (!foundOpen && i === startLine && !lines[i].includes('{') && !lines[i].includes('(')) {
      return i;
    }
  }

  return foundOpen ? lines.length - 1 : startLine;
}

function findLeadingLines(lines: string[], symbolStart: number): number {
  let i = symbolStart - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*/') ||
      trimmed.startsWith('@') ||       // decorators
      trimmed === ''
    ) {
      i--;
    } else {
      break;
    }
  }
  // Não inclui linhas em branco no leading (apenas comentários/decorators)
  let start = i + 1;
  while (start < symbolStart && lines[start].trim() === '') start++;
  return start;
}

// ─── Fuzzy suggestions ───────────────────────────────────────────────────────

function findSymbolNames(lines: string[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    for (const pattern of SYMBOL_PATTERNS) {
      const m = trimmed.match(pattern);
      if (m?.[1]) { names.push(m[1]); break; }
    }
  }
  return names;
}

function fuzzyMatch(target: string, candidates: string[]): string[] {
  const t = target.toLowerCase();
  return candidates
    .filter(c => c.toLowerCase().includes(t) || t.includes(c.toLowerCase()))
    .slice(0, 5);
}

// ─── Cálculo de posição de inserção ──────────────────────────────────────────

function resolveInsertPosition(
  lines:    string[],
  posicao:  Posicao
): number | FailResult {

  if (posicao === 'inicio') return 0;
  if (posicao === 'final')  return lines.length;

  if (posicao === 'apos_imports') {
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('import{') || trimmed.startsWith('require(')) {
        lastImport = i;
      }
    }
    // Insere depois da linha em branco seguinte ao último import
    if (lastImport === -1) return 0;
    let pos = lastImport + 1;
    while (pos < lines.length && lines[pos].trim() === '') pos++;
    return pos;
  }

  if (posicao.startsWith('antes_de_simbolo:') || posicao.startsWith('apos_simbolo:')) {
    const isAntes  = posicao.startsWith('antes_de_simbolo:');
    const refName  = posicao.split(':')[1];
    const refSym   = findSymbol(lines, refName);
    if (!refSym) {
      const all        = findSymbolNames(lines);
      const sugestoes  = fuzzyMatch(refName, all);
      return {
        sucesso:   false,
        erro:      'simbolo_referencia_nao_encontrado',
        simbolo:   refName,
        sugestoes,
      };
    }
    return isAntes ? refSym.leadingStart : refSym.endLine + 1;
  }

  return { sucesso: false, erro: `posicao_invalida: ${posicao}` };
}

// ─── Resolve caminho ──────────────────────────────────────────────────────────

function resolvePath(filePath: string, options: ExecuteToolOptions): string {
  if (path.isAbsolute(filePath)) return filePath;
  try {
    const wf = options?.workspaceFolder as any;
    const root = wf?.uri?.fsPath ?? wf?.fsPath ?? (typeof wf === 'string' ? wf : process.cwd());
    return path.join(root, filePath);
  } catch {
    return path.join(process.cwd(), filePath);
  }
}

// ─── TOOL principal ───────────────────────────────────────────────────────────

export async function executeCopyAndPasteSymbol(
  args:    Record<string, any>,
  options: ExecuteToolOptions
): Promise<Result> {

  const { operacao, origem, destino } = args as CopyPasteSymbolArgs;

  if (!operacao || !origem?.arquivo || !origem?.simbolo || !destino?.arquivo || !destino?.posicao) {
    return { sucesso: false, erro: 'parametros_obrigatorios_ausentes: operacao, origem.arquivo, origem.simbolo, destino.arquivo, destino.posicao' };
  }

  const origemPath  = resolvePath(origem.arquivo,  options);
  const destinoPath = resolvePath(destino.arquivo, options);

  // Lê arquivos
  let origemLines:  string[];
  let destinoLines: string[];
  try {
    origemLines  = fs.readFileSync(origemPath,  'utf-8').split(/\r?\n/);
  } catch {
    return { sucesso: false, erro: 'arquivo_origem_nao_encontrado', arquivo: origem.arquivo };
  }
  try {
    destinoLines = fs.existsSync(destinoPath)
      ? fs.readFileSync(destinoPath, 'utf-8').split(/\r?\n/)
      : [];
  } catch {
    return { sucesso: false, erro: 'erro_ao_ler_arquivo_destino', arquivo: destino.arquivo };
  }

  // Encontra símbolo na origem
  const sym = findSymbol(origemLines, origem.simbolo);
  if (!sym) {
    const all       = findSymbolNames(origemLines);
    const sugestoes = fuzzyMatch(origem.simbolo, all);
    return { sucesso: false, erro: 'simbolo_nao_encontrado', simbolo: origem.simbolo, arquivo: origem.arquivo, sugestoes };
  }

  // Extrai bloco (leading + símbolo)
  const bloco = origemLines.slice(sym.leadingStart, sym.endLine + 1);

  // Resolve posição no destino
  const insertPos = resolveInsertPosition(destinoLines, destino.posicao);
  if (typeof insertPos !== 'number') return insertPos; // é FailResult

  // ── Snapshots para rollback atômico ──────────────────────────────────────
  const origemSnap  = origemLines.join('\n');
  const destinoSnap = destinoLines.join('\n');

  try {
    // Monta arquivo destino com bloco inserido
    const newDestino = [
      ...destinoLines.slice(0, insertPos),
      '',
      ...bloco,
      '',
      ...destinoLines.slice(insertPos),
    ].join('\n').replace(/\n{3,}/g, '\n\n'); // colapsa triplas linhas em branco

    // Se mover, remove da origem
    let newOrigem: string | null = null;
    if (operacao === 'mover') {
      const removedLines = [
        ...origemLines.slice(0, sym.leadingStart),
        ...origemLines.slice(sym.endLine + 1),
      ].join('\n').replace(/\n{3,}/g, '\n\n');
      newOrigem = removedLines;
    }

    // Escreve destino
    fs.writeFileSync(destinoPath, newDestino, 'utf-8');

    // Escreve origem (se mover)
    if (newOrigem !== null) {
      fs.writeFileSync(origemPath, newOrigem, 'utf-8');
    }

    return {
      sucesso:        true,
      operacao:       operacao === 'mover' ? 'movido' : 'copiado',
      simbolo:        origem.simbolo,
      de:             origem.arquivo,
      para:           destino.arquivo,
      posicao:        destino.posicao,
      linhas_movidas: bloco.length,
    };

  } catch (err: any) {
    // Rollback
    try { fs.writeFileSync(origemPath,  origemSnap,  'utf-8'); } catch { /* ignora */ }
    try { fs.writeFileSync(destinoPath, destinoSnap, 'utf-8'); } catch { /* ignora */ }
    return { sucesso: false, erro: `erro_ao_escrever_arquivos: ${err.message}` };
  }
}