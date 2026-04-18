import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { canonizePath, getCanonizedWorkspaceRootSync } from './utils';
import { ExecuteToolOptions } from './types';

const execAsync = promisify(exec);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Severity = 'error' | 'warning' | 'info' | 'help' | 'convention' | 'refactor';

type ParsedLintError = {
  file: string;
  line: number;
  column?: number;
  severity: Severity | string;
  code?: string;
  message: string;
};

type ParseLintArgs = {
  lintOutput?: string; // Mantido para compatibilidade, mas prioridade será API VS Code
  useTerminalFallback?: boolean; // Se true, força uso do terminal (comportamento antigo)

  debug?: boolean; 
  debugMaxChars?: number; 

  returnFormat?: 'compact' | 'full' | 'summary' | 'detailed'; 

  maxTotal?: number; 
  maxPerFile?: number; 

  includeUnusedWarnings?: boolean; 
  
  /** Se true, ignora erros em arquivos que não existem mais no disco (ghost errors). Default: true. */
  ignoreGhostErrors?: boolean;

  /** Delay em ms para aguardar a atualização da API de diagnósticos. Padrão: 500ms. */
  delayMs?: number;
};

function normalizePath(p: string): string {
  return canonizePath(p || '').trim();
}

/**
 * Converte severidade do VS Code para nossa string
 */
function mapSeverity(sev: vscode.DiagnosticSeverity): Severity {
  switch (sev) {
    case vscode.DiagnosticSeverity.Error: return 'error';
    case vscode.DiagnosticSeverity.Warning: return 'warning';
    case vscode.DiagnosticSeverity.Information: return 'info';
    case vscode.DiagnosticSeverity.Hint: return 'info';
    default: return 'warning';
  }
}

/**
 * Obtém erros diretamente da API de linguagens do VS Code (aba "Problems")
 */
function getVscodeDiagnostics(workspaceRoot: string, ignoreGhostErrors: boolean = true): ParsedLintError[] {
  const allDiagnostics = vscode.languages.getDiagnostics();
  const errors: ParsedLintError[] = [];

  for (const [uri, diagnostics] of allDiagnostics) {
    // Filtra apenas arquivos dentro do workspace atual ou abertos
    // (A verificação simples de string inclusion funciona bem para a maioria dos casos de path absoluto)
    const fsPath = uri.fsPath; // Path do sistema operacional
    
    // Normaliza paths para comparação
    const normFsPath = normalizePath(fsPath);
    const normRoot = normalizePath(workspaceRoot);

    // Se não estiver dentro do workspace, ignoramos (salvo se for um arquivo solto aberto, 
    // mas o foco aqui é o projeto).
    // Usamos 'startsWith' para checar hierarquia.
    if (!normFsPath.startsWith(normRoot)) {
      continue;
    }

    // Graceful Linter: Verifica se o arquivo ainda existe no disco
    if (ignoreGhostErrors && !fs.existsSync(fsPath)) {
      continue;
    }

    for (const diag of diagnostics) {
      // Extrai código (pode ser string, number ou objeto)
      let codeStr: string | undefined;
      if (typeof diag.code === 'string' || typeof diag.code === 'number') {
        codeStr = String(diag.code);
      } else if (typeof diag.code === 'object' && diag.code?.value) {
        codeStr = String(diag.code.value);
      }

      errors.push({
        file: fsPath, // Será relativizado depois no filterAndGroup
        line: diag.range.start.line + 1, // VS Code é 0-based, convertemos para 1-based
        column: diag.range.start.character + 1, // VS Code é 0-based
        severity: mapSeverity(diag.severity),
        message: diag.message,
        code: codeStr
      });
    }
  }

  return errors;
}

/**
 * Filtro agressivo (mantido da versão original para consistência)
 */
function filterAndGroup(
  all: ParsedLintError[],
  includeUnusedWarnings: boolean,
  maxTotal: number,
  maxPerFile: number,
  options: ExecuteToolOptions,
  workspaceRoot: string
) {
  const criticalCodes = new Set([
    'creation_with_non_type',
    'undefined_method',
    'undefined_class',
    'undefined_function',
    'undefined_identifier',
    'non_constant_case_expression',
    'missing_required_param',
    'argument_type_not_assignable',
    'invalid_assignment',
    'return_of_invalid_type',
    'const_initialized_with_non_constant_value',
    'not_initialized_non_nullable_instance_field',
    'expected_token',
    'missing_identifier',
    'unexpected_token'
  ]);

  const ignoredCodes = new Set([
    'deprecated_member_use',
    'deprecated_member_use_from_same_package',
    'prefer_const_constructors',
    'prefer_const_literals_to_create_immutables',
    'prefer_final_fields',
    'avoid_print',
    'prefer_single_quotes',
    'unnecessary_this',
    'sort_constructors_first',
    'avoid_init_to_null',
    'use_key_in_widget_constructors',
    'library_private_types_in_public_api'
  ]);

  const ignoredMsgSnippets = [
    'deprecated',
    'withopacity',
    'withvalues',
    'precision loss',
    'prefer ',
    'avoid ',
    'unnecessary',
    'sort ',
    'library_private'
  ];

  const unusedSnippets = [
    'declared but not used',
    'unused variable',
    'unused function',
    'never used',
    'assigned but never used',
    'defined but never used',
    'is never used',
    'unused parameter',
    'unused import',
    'no-unused-vars',
    'unused_element',
    'unused_field',
    'unused_local_variable',
    'dead_code'
  ];

  const byFile: Record<string, { critical: ParsedLintError[]; unused: ParsedLintError[] }> = {};

  const isCritical = (e: ParsedLintError) => {
    const sev = String(e.severity || '').toLowerCase();
    if (sev === 'error') return true;
    const code = String(e.code || '').toLowerCase();
    for (const cc of criticalCodes) if (code.includes(cc)) return true;
    return false;
  };

  const isIgnored = (e: ParsedLintError) => {
    // Nunca ignore erros críticos
    const sev = String(e.severity || '').toLowerCase();
    if (sev === 'error') return false;

    const code = String(e.code || '').toLowerCase();
    for (const ic of ignoredCodes) if (code.includes(ic)) return true;

    const msg = String(e.message || '').toLowerCase();
    for (const s of ignoredMsgSnippets) if (msg.includes(s)) return true;

    return false;
  };

  const isUnused = (e: ParsedLintError) => {
    const msg = String(e.message || '').toLowerCase();
    const code = String(e.code || '').toLowerCase();
    for (const s of unusedSnippets) {
      if (msg.includes(s) || code.includes(s)) return true;
    }
    return false;
  };

  const add = (kind: 'critical' | 'unused', e: ParsedLintError) => {
    const f = e.file || 'unknown';
    if (!byFile[f]) byFile[f] = { critical: [], unused: [] };
    const bucket = byFile[f][kind];
    if (maxPerFile > 0 && bucket.length >= maxPerFile) return;
    bucket.push(e);
  };

  let totalKept = 0;
  let totalCritical = 0;
  let totalUnused = 0;
  let totalIgnored = 0;
  let totalOtherDropped = 0;
  
  for (const e of all) {
    if (maxTotal > 0 && totalKept >= maxTotal) break;

    const sev = String(e.severity || '').toLowerCase();
    
    // Normaliza e resolve path relativo ao workspace root
    let filePath = normalizePath(e.file);
    
    // Se o path é absoluto e está dentro do workspace, converte para relativo
    if (path.isAbsolute(filePath)) {
      const relative = path.relative(workspaceRoot, filePath);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        filePath = canonizePath(relative);
      } else {
        filePath = canonizePath(filePath);
      }
    }
    
    const normalized: ParsedLintError = {
      file: filePath,
      line: Number.isFinite(e.line) ? e.line : 0,
      column: Number.isFinite(e.column as number) ? e.column : undefined,
      severity: (sev as any) || 'warning',
      code: e.code ? String(e.code) : undefined,
      message: String(e.message || '').trim()
    };

    if (!normalized.file || normalized.line <= 0) continue;
    if (isIgnored(normalized)) {
      totalIgnored++;
      continue;
    }

    if (isCritical(normalized)) {
      add('critical', normalized);
      totalCritical++;
      totalKept++;
      continue;
    }

    if (includeUnusedWarnings && (sev === 'warning' || sev === 'info') && isUnused(normalized)) {
      add('unused', normalized);
      totalUnused++;
      totalKept++;
      continue;
    }

    totalOtherDropped++;
  }

  // sugestões de ranges (±10)
  const lineRangeSuggestions: Record<string, { minLine: number; maxLine: number; errorCount: number }> = {};
  for (const [file, buckets] of Object.entries(byFile)) {
    const lines = [...buckets.critical, ...buckets.unused].map(x => x.line).filter(l => l > 0);
    if (!lines.length) continue;
    const min = Math.max(1, Math.min(...lines) - 10);
    const max = Math.max(...lines) + 10;
    lineRangeSuggestions[file] = { minLine: min, maxLine: max, errorCount: lines.length };
  }

  const totalFiles = Object.keys(byFile).length;

  let summary: string;
  if (totalCritical > 0) {
    summary = `${totalCritical} erro(s) crítico(s)`;
    if (totalUnused > 0) summary += ` e ${totalUnused} aviso(s) de código não usado`;
    summary += ` em ${totalFiles} arquivo(s)`;
  } else if (totalUnused > 0) {
    summary = `${totalUnused} aviso(s) de código não usado em ${totalFiles} arquivo(s)`;
  } else {
    if (all.length > 0) {
      summary = `Nenhum erro crítico encontrado ✓ (diagnósticos detectados via VS Code: ${all.length}, ignorados: ${totalIgnored}, não listados: ${totalOtherDropped})`;
    } else {
      summary = 'Nenhum erro encontrado (VS Code Diagnostics vazio) ✓';
    }
  }
  
  summary += ' (linhas são 1-based, igual editores e unified diff)';

  return {
    byFile,
    lineRangeSuggestions,
    totals: { totalCritical, totalUnused, totalFiles, totalKept },
    summary
  };
}

function limitResultSize(result: any, maxLength: number = 1800): any {
  const toStr = (x: any) => JSON.stringify(x);
  if (toStr(result).length <= maxLength) return result;

  const copy = JSON.parse(JSON.stringify(result));

  if (copy.detailed && typeof copy.detailed === 'string') {
    const overhead = toStr({ ...copy, detailed: '' }).length;
    const available = maxLength - overhead - 20; // margem de segurança
    if (available > 100) {
      copy.detailed = copy.detailed.substring(0, available) + '\n\n... [TRUNCATED] ...';
      return copy;
    }
  }

  if (copy.files) {
    for (let i = copy.files.length - 1; i >= 0; i--) {
      copy.files = copy.files.slice(0, i);
      if (toStr(copy).length <= maxLength) return copy;
    }
    delete copy.files;
    if (toStr(copy).length <= maxLength) return copy;
  }

  if (copy.byFile) {
    const keys = Object.keys(copy.byFile);
    for (let i = keys.length - 1; i >= 0; i--) {
      delete copy.byFile[keys[i]];
      if (toStr(copy).length <= maxLength) return copy;
    }
    delete copy.byFile;
    if (toStr(copy).length <= maxLength) return copy;
  }

  if (copy.ranges) {
    for (let i = copy.ranges.length - 1; i >= 0; i--) {
      copy.ranges = copy.ranges.slice(0, i);
      if (toStr(copy).length <= maxLength) return copy;
    }
    delete copy.ranges;
    if (toStr(copy).length <= maxLength) return copy;
  }

  return {
    summary: result?.summary ?? 'Lint retornou muitos dados (truncado).',
    totals: result?.totals
  };
}

type CompactItem = [0 | 1, number, number, string, string?];
type CompactFileEntry = [string, CompactItem[]];
type CompactRangeEntry = [string, number, number, number];

export async function executeParseLintErrors(rawArgs: Record<string, any>, options: ExecuteToolOptions): Promise<any> {
  const args = rawArgs as ParseLintArgs;

  // Adiciona um delay para dar tempo à API do VS Code de atualizar os diagnósticos
  // após uma possível modificação de arquivo no mesmo ciclo.
  const delay = args.delayMs ?? 2000;
  if (delay > 0) {
    options.outputChannel.appendLine(`🩺 parse_lint_errors: Aguardando ${delay}ms para sincronização de diagnósticos...`);
    await sleep(delay);
  }

  // Forçamos 'detailed' internamente para que o modelo sempre receba as mensagens completas dos erros,
  // independentemente do que foi solicitado ou do padrão original.
  const returnFormat = 'detailed' as any;
  const includeUnusedWarnings = args.includeUnusedWarnings !== false;
  const ignoreGhostErrors = args.ignoreGhostErrors !== false; // Default: true
  const maxTotal = Number.isFinite(args.maxTotal) ? Math.max(0, args.maxTotal!) : 200;
  const maxPerFile = Number.isFinite(args.maxPerFile) ? Math.max(0, args.maxPerFile!) : 80;

  const workspaceRoot = getCanonizedWorkspaceRootSync(options.workspaceFolder);
  
  // MODO 1: VS CODE API (Padrão)
  // Obtém diagnósticos diretamente do VS Code
  let parsedErrors: ParsedLintError[] = getVscodeDiagnostics(workspaceRoot, ignoreGhostErrors);
  
  // Se não encontrou erros na API e o usuário pediu fallback explicitamente ou passou lintOutput
  if (parsedErrors.length === 0 && (args.useTerminalFallback || args.lintOutput)) {
    // Se quiser manter suporte a parse de texto puro (fallback), teria que reincluir 
    // a função parseLintOutput antiga aqui. 
    // Como a ideia é migrar para a API, vamos assumir que se a API está vazia, o projeto está limpo.
    // Mas se o usuário passou lintOutput manualmente (ex: output de CI), ele espera parse.
    // Para simplificar e focar na performance, por enquanto vamos apenas logar se houver fallback solicitado sem output.
    if (args.lintOutput) {
       options.outputChannel.appendLine('⚠️ parse_lint_errors: parse de texto bruto (lintOutput) foi depreciado em favor da API nativa. Resultados podem estar incompletos se baseados apenas no texto.');
    }
  }

  options.outputChannel.appendLine(`🔍 Lint (VS Code API): encontrou ${parsedErrors.length} diagnósticos brutos.`);

  const grouped = filterAndGroup(parsedErrors, includeUnusedWarnings, maxTotal, maxPerFile, options, workspaceRoot);

  // Formatação de saída (igual à original)
  if (returnFormat === 'summary') {
    const totalsArr: [number, number, number, number] = [
      grouped.totals.totalCritical,
      grouped.totals.totalUnused,
      grouped.totals.totalFiles,
      grouped.totals.totalKept
    ];
    const ranges: CompactRangeEntry[] = [];
    for (const [file, r] of Object.entries(grouped.lineRangeSuggestions)) {
      ranges.push([file, r.minLine, r.maxLine, r.errorCount]);
    }
    return limitResultSize({ summary: grouped.summary, totals: totalsArr, ranges }, 1800);
  }

  if (returnFormat === 'compact') {
    const totalsArr: [number, number, number, number] = [
      grouped.totals.totalCritical,
      grouped.totals.totalUnused,
      grouped.totals.totalFiles,
      grouped.totals.totalKept
    ];
    const files: CompactFileEntry[] = [];
    for (const [file, buckets] of Object.entries(grouped.byFile)) {
      const items: CompactItem[] = [];
      for (const e of buckets.critical) items.push([0, e.line, e.column ?? 0, e.message, e.code]);
      for (const e of buckets.unused) items.push([1, e.line, e.column ?? 0, e.message, e.code]);
      files.push([file, items]);
    }
    const ranges: CompactRangeEntry[] = [];
    for (const [file, r] of Object.entries(grouped.lineRangeSuggestions)) {
      ranges.push([file, r.minLine, r.maxLine, r.errorCount]);
    }
    return limitResultSize({ summary: grouped.summary, totals: totalsArr, files, ranges }, 1800);
  }

  if (returnFormat === 'detailed') {
    const totalsArr: [number, number, number, number] = [
      grouped.totals.totalCritical,
      grouped.totals.totalUnused,
      grouped.totals.totalFiles,
      grouped.totals.totalKept
    ];
    
    let detailedOutput = `🔍 LINT SUMMARY: ${grouped.summary}\n\n`;
    
    for (const [file, buckets] of Object.entries(grouped.byFile)) {
      detailedOutput += `📄 File: ${file}\n`;
      
      if (buckets.critical.length > 0) {
        detailedOutput += `  Critical Errors:\n`;
        buckets.critical.forEach(e => {
          detailedOutput += `    - [L${e.line}:${e.column ?? 0}] [${e.code ?? 'no-code'}] ${e.message}\n`;
        });
      }
      
      // Warnings e Infos não são listados detalhadamente, apenas contabilizados no sumário.
      detailedOutput += `\n`;
    }

    const ranges: CompactRangeEntry[] = [];
    for (const [file, r] of Object.entries(grouped.lineRangeSuggestions)) {
      ranges.push([file, r.minLine, r.maxLine, r.errorCount]);
    }

    return limitResultSize({ 
      summary: grouped.summary, 
      totals: totalsArr, 
      detailed: detailedOutput.trim(),
      ranges 
    }, 10000); // Detailed permite mais espaço para descrições completas
  }

  // Full
  const fullErrors: ParsedLintError[] = [];
  const fullByFile: Record<string, ParsedLintError[]> = {};
  for (const [file, buckets] of Object.entries(grouped.byFile)) {
    const arr = [...buckets.critical, ...buckets.unused];
    fullByFile[file] = arr;
    fullErrors.push(...arr);
  }
  const ranges: CompactRangeEntry[] = [];
  for (const [file, r] of Object.entries(grouped.lineRangeSuggestions)) {
    ranges.push([file, r.minLine, r.maxLine, r.errorCount]);
  }

  return limitResultSize({
    summary: grouped.summary,
    totals: [
      grouped.totals.totalCritical,
      grouped.totals.totalUnused,
      grouped.totals.totalFiles,
      grouped.totals.totalKept
    ],
    errors: fullErrors,
    byFile: fullByFile,
    ranges
  }, 1800);
}