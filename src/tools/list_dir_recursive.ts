import * as vscode from 'vscode';
import { resolveWorkspacePath, getCanonizedWorkspaceRootSync, canonizePath } from './utils';
import { ExecuteToolOptions } from './types';

type FileTreeItem = {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileTreeItem[];
};

type ListDirRecursiveArgs = {
  path?: string;
  maxDepth?: number;
  exclude?: string[];
  includeHidden?: boolean;
  maxFiles?: number;
};

const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  '__pycache__',
  'venv',
  '.venv',
  'out',
  '.vscode',
  '.dart_tool',
  '.idea'
];

const IMPORTANT_HIDDEN_FILES = ['.env.example', '.gitignore', '.eslintrc', '.env'];

function normalizePath(p: string) {
  return canonizePath(p || '');
}

function makeRelative(workspaceRoot: string, absPath: string) {
  const root = normalizePath(workspaceRoot).replace(/\/+$/, '');
  const p = normalizePath(absPath);
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

// Helper para converter a árvore em string compacta (redução de tokens)
function formatToCompactTree(root: FileTreeItem): string {
  let output = '';

  function processNode(node: FileTreeItem, depth: number) {
    const indent = '  '.repeat(depth);
    const isDir = node.type === 'directory';
    const suffix = isDir ? '/' : '';
    
    // Adiciona linha atual
    output += `${indent}${node.name}${suffix}\n`;

    if (node.children && node.children.length > 0) {
      // Ordena: diretórios primeiro, depois arquivos (alfabético)
      const sortedChildren = [...node.children].sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      });

      for (const child of sortedChildren) {
        processNode(child, depth + 1);
      }
    }
  }

  // O root é processado com profundidade 0
  processNode(root, 0);
  return output.trim();
}

export async function executeListDirRecursive(
  rawArgs: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const args = rawArgs as ListDirRecursiveArgs;

  const workspaceRoot = getCanonizedWorkspaceRootSync(options.workspaceFolder);
  const workspaceUri = options.workspaceFolder.uri;

  const maxDepth = Number.isFinite(args.maxDepth) ? args.maxDepth! : 5;
  const maxFiles = Number.isFinite(args.maxFiles) ? args.maxFiles! : 1000;
  const includeHidden = args.includeHidden === true;
  const exclude = new Set(args.exclude || DEFAULT_EXCLUDE);

  const targetPath = args.path || '.';
  const rootUri = (targetPath === '.' || targetPath === './')
    ? workspaceUri
    : resolveWorkspacePath(options.workspaceFolder, targetPath);

  // ─────────────────────────────────────────────────────────────────────────────
  // SECURITY: Validate that resolved path is inside the workspace (no path traversal)
  // ─────────────────────────────────────────────────────────────────────────────
  const resolvedPath = normalizePath(rootUri.fsPath);
  const normalizedWorkspaceRoot = normalizePath(workspaceRoot);
  
  // Check if resolved path is inside workspace (must start with workspace root)
  if (!resolvedPath.startsWith(normalizedWorkspaceRoot)) {
    throw new Error(
      `Acesso negado: o caminho "${targetPath}" resolve para fora do workspace do projeto. ` +
      `Apenas caminhos dentro de "${normalizedWorkspaceRoot}" são permitidos.`
    );
  }

  let fileCount = 0;

  async function traverse(currentUri: vscode.Uri, depth: number): Promise<FileTreeItem[] | null> {
    if (depth > maxDepth || fileCount > maxFiles) return null;

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(currentUri);
    } catch (err) {
      return null;
    }

    const items: FileTreeItem[] = [];

    for (const [name, fileType] of entries) {
      if (fileCount > maxFiles) break;

      // Filtrar ocultos
      if (!includeHidden && name.startsWith('.')) {
        if (!IMPORTANT_HIDDEN_FILES.includes(name)) {
          continue;
        }
      }

      // Filtrar excluídos
      if (exclude.has(name)) {
        continue;
      }

      fileCount++;
      const childUri = vscode.Uri.joinPath(currentUri, name);
      const absPath = normalizePath(childUri.fsPath);
      const relPath = makeRelative(workspaceRoot, absPath);

      if (fileType === vscode.FileType.Directory) {
        const children = await traverse(childUri, depth + 1);
        items.push({
          name,
          type: 'directory',
          path: relPath,
          children: children || []
        });
      } else {
        items.push({
          name,
          type: 'file',
          path: relPath
        });
      }
    }

    return items;
  }

  try {
    const stat = await vscode.workspace.fs.stat(rootUri);
    if (!(stat.type & vscode.FileType.Directory)) {
      throw new Error(`O caminho especificado não é um diretório: ${targetPath}`);
    }
  } catch (err: any) {
    if (err.code === 'FileNotFound' || err.message?.includes('EntryNotFound')) {
      throw new Error(`Diretório não encontrado: ${targetPath}`);
    }
    throw err;
  }

  const absRootPath = normalizePath(rootUri.fsPath);
  const relRootPath = makeRelative(workspaceRoot, absRootPath);

  const rootItem: FileTreeItem = {
    name: targetPath === '.' ? (workspaceRoot.split('/').pop() || 'root') : (targetPath.split('/').pop() || 'root'),
    path: relRootPath || '.',
    type: 'directory',
    children: (await traverse(rootUri, 0)) || []
  };

  // Aqui convertemos a árvore para string compacta
  const compactStructure = formatToCompactTree(rootItem);

  return {
    structure: compactStructure,
    fileCount,
    truncated: fileCount > maxFiles
  };
}
