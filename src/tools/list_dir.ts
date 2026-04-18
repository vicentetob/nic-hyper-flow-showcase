import * as vscode from 'vscode';
import { resolveWorkspacePath, getCanonizedWorkspaceRootSync, canonizePath } from './utils';
import { ExecuteToolOptions } from './types';

type Entry = { name: string; type: 'dir' | 'file'; path: string };

type ListDirArgs = {
  path?: string;
  recursive?: boolean;        // default false
  maxDepth?: number;          // default 2 (only if recursive)
  maxEntries?: number;        // default 400
  cursor?: string;            // for pagination
  relative?: boolean;         // default true
  output?: 'json' | 'lines';  // default 'lines'
  includeFiles?: boolean;     // default true
  includeDirs?: boolean;      // default true
  ignoreDirs?: string[];      // override/extend
};

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', 'build', '.vscode', '.dart_tool', '.idea'
]);

function isJarvisLogFileName(name: string) {
  const lowerName = String(name || '').toLowerCase();
  return lowerName === 'jarvis_i_o.md' || lowerName === 'nic_debug.md' || lowerName === 'pkb_v2.jsonl' || lowerName === 'pkb.jsonl' || lowerName === 'assets_registry.json';
}


function normalizePath(p: string) {
  return canonizePath(p || '');
}

function makeRelative(workspaceRoot: string, absPath: string) {
  const root = normalizePath(workspaceRoot).replace(/\/+$/, '');
  const p = normalizePath(absPath);
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

/**
 * BFS com limite de profundidade, limite de entradas e paginação simples.
 * Retorna "cursor" como índice do array de tarefas (fila) serializado.
 */
async function listDirectoryControlled(
  rootUri: vscode.Uri,
  workspaceRoot: string,
  args: Required<Pick<ListDirArgs,
    'recursive' | 'maxDepth' | 'maxEntries' | 'relative' | 'output' | 'includeFiles' | 'includeDirs'
  >> & { ignoreDirs: Set<string>; cursor?: string }
): Promise<{ items: Entry[]; truncated: boolean; nextCursor?: string }> {
  const items: Entry[] = [];
  let truncated = false;

  // fila de diretórios para explorar (uri, depth)
  let queue: Array<{ uri: vscode.Uri; depth: number }> = [{ uri: rootUri, depth: 0 }];

  // se cursor existir, restaurar posição (paginação simples)
  // cursor = JSON.stringify({ qi: number }) onde qi é o índice inicial na fila
  if (args.cursor) {
    try {
      const parsed = JSON.parse(args.cursor);
      if (typeof parsed?.qi === 'number' && parsed.qi >= 0) {
        queue = queue.slice(parsed.qi);
      }
    } catch {
      // cursor inválido -> ignora
    }
  }

  // Se não for recursivo: só lista 1 nível e acabou.
  const effectiveMaxDepth = args.recursive ? args.maxDepth : 0;

  // BFS
  for (let i = 0; i < queue.length; i++) {
    const { uri, depth } = queue[i];

    if (items.length >= args.maxEntries) {
      truncated = true;
      // cursor aponta pro próximo item da fila a processar
      const qi = (args.cursor ? 0 : i); // se já foi sliceado, i já é relativo
      return { items, truncated, nextCursor: JSON.stringify({ qi }) };
    }

    if (depth > effectiveMaxDepth) {
      continue;
    }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch (err: any) {
      // ignora erros de permissão
      continue;
    }

    for (const [name, fileType] of entries) {
      if (items.length >= args.maxEntries) {
        truncated = true;
        const qi = (args.cursor ? 0 : i);
        return { items, truncated, nextCursor: JSON.stringify({ qi }) };
      }

      const isDir = fileType === vscode.FileType.Directory;
      if (isDir && args.ignoreDirs.has(name)) {
        continue;
      }
      if (!isDir && isJarvisLogFileName(name)) {
        continue;
      }

      const childUri = vscode.Uri.joinPath(uri, name);
      const abs = normalizePath(childUri.fsPath);
      const p = args.relative ? makeRelative(workspaceRoot, abs) : abs;

      if ((isDir && args.includeDirs) || (!isDir && args.includeFiles)) {
        items.push({ name, type: isDir ? 'dir' : 'file', path: p });
      }

      if (args.recursive && isDir && depth < effectiveMaxDepth) {
        queue.push({ uri: childUri, depth: depth + 1 });
      }
    }

    // Se não recursivo, sai após processar a raiz (depth 0)
    if (!args.recursive) {
      break;
    }
  }

  return { items, truncated, nextCursor: undefined };
}

export async function executeListDir(
  rawArgs: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const args = rawArgs as ListDirArgs;

  // Usa workspace root canonizado (Git root se disponível)
  const workspaceRoot = getCanonizedWorkspaceRootSync(options.workspaceFolder);
  const workspaceUri = options.workspaceFolder.uri;

  // defaults econômicos
  const recursive = args.recursive === true;         // default false
  const maxDepth = Number.isFinite(args.maxDepth) ? Math.max(0, args.maxDepth!) : 2;
  const maxEntries = Number.isFinite(args.maxEntries) ? Math.max(1, args.maxEntries!) : 400;
  const relative = args.relative !== false;          // default true
  const output: 'json' | 'lines' = args.output === 'json' ? 'json' : 'lines';
  const includeFiles = args.includeFiles !== false;  // default true
  const includeDirs = args.includeDirs !== false;    // default true

  const ignoreDirs = new Set(DEFAULT_IGNORE_DIRS);
  if (Array.isArray(args.ignoreDirs)) {
    for (const d of args.ignoreDirs) {
      ignoreDirs.add(String(d));
    }
  }

  // IMPORTANTÍSSIMO: path vazio NÃO lista tudo recursivo.
  // Ele lista só o 1º nível da raiz (e pronto).
  const targetPath = args.path;
  const uri = (!targetPath || targetPath === '.' || targetPath === './')
    ? workspaceUri
    : resolveWorkspacePath(options.workspaceFolder, targetPath);

  // Verificação de sanidade: o caminho existe e é um diretório?
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (!(stat.type & vscode.FileType.Directory)) {
      // Se for um arquivo, talvez o usuário queria listar o diretório pai? 
      // Mas por padrão, list_dir deve falhar se não for diretório.
      throw new Error(`O caminho especificado não é um diretório: ${targetPath}`);
    }
  } catch (err: any) {
    if (err.code === 'FileNotFound' || err.message?.includes('EntryNotFound')) {
      throw new Error(`Diretório não encontrado: ${targetPath}`);
    }
    throw err;
  }

  const { items, truncated, nextCursor } = await listDirectoryControlled(uri, workspaceRoot, {
    recursive,
    maxDepth,
    maxEntries,
    relative,
    output,
    includeFiles,
    includeDirs,
    ignoreDirs,
    cursor: args.cursor
  });

  // Calcula o path relativo do diretório listado para exibição na UI
  const listedPath = relative 
    ? makeRelative(workspaceRoot, normalizePath(uri.fsPath))
    : normalizePath(uri.fsPath);
  const displayPath = listedPath || '.';

  if (output === 'json') {
    return { items, truncated, nextCursor, path: displayPath };
  }

  // 'lines' é MUITO mais barato em tokens:
  // "dir  src/features/chat"
  // "file src/main.ts"
  const lines = items.map(e => `${e.type}  ${e.path}`);
  return { lines, truncated, nextCursor, path: displayPath };
}

