import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/**
 * Calcula hash MD5 de uma string
 */
export function calculateHash(content: string): string {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

/**
 * Normaliza quebras de linha para garantir consistência
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Canoniza um path: normaliza e converte para forward slashes
 * Garante consistência em todos os sistemas operacionais
 */
export function canonizePath(filePath: string): string {
  if (!filePath) return filePath;
  return path.normalize(filePath).replace(/\\/g, '/');
}

/**
 * Detecta o Git root dentro de um diretório (ou retorna null se não encontrar)
 * Procura recursivamente para cima até encontrar .git
 */
async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.normalize(startPath);
  const root = path.parse(current).root;
  
  while (current !== root) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return canonizePath(current);
    }
    current = path.dirname(current);
  }
  
  return null;
}

/**
 * Obtém o workspace root canonizado:
 * - Se houver Git root dentro do workspace, usa o Git root
 * - Caso contrário, usa o workspace folder
 * 
 * Isso garante que todos os paths sejam resolvidos a partir do mesmo root,
 * especialmente importante em monorepos onde o Git root pode estar acima do workspace folder.
 */
export async function getCanonizedWorkspaceRoot(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<string> {
  const workspacePath = canonizePath(workspaceFolder.uri.fsPath);
  
  // Tenta encontrar Git root
  const gitRoot = await findGitRoot(workspaceFolder.uri.fsPath);
  
  if (gitRoot) {
    // Verifica se o Git root está dentro ou contém o workspace
    const workspaceNormalized = workspacePath.toLowerCase();
    const gitRootNormalized = gitRoot.toLowerCase();
    
    // Se Git root contém workspace, usa Git root
    if (workspaceNormalized.startsWith(gitRootNormalized + '/') || workspaceNormalized === gitRootNormalized) {
      return gitRoot;
    }
    
    // Se workspace contém Git root, usa workspace (Git root é subdiretório)
    if (gitRootNormalized.startsWith(workspaceNormalized + '/')) {
      return workspacePath;
    }
  }
  
  // Fallback: usa workspace folder
  return workspacePath;
}

/**
 * Versão síncrona (cache) para evitar múltiplas chamadas assíncronas
 * Cache por workspace folder URI
 */
const workspaceRootCache = new Map<string, string>();

/**
 * Limpa o cache do workspace root
 * Útil quando o workspace muda ou há problemas de cache
 */
export function clearWorkspaceRootCache(): void {
  workspaceRootCache.clear();
}

/**
 * Valida se o cache para um workspace ainda está válido
 * Verifica se o diretório cacheado ainda existe
 */
function validateCache(cacheKey: string, cachedPath: string): boolean {
  // Valida se o diretório ainda existe
  try {
    const stat = fs.statSync(cachedPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function getCanonizedWorkspaceRootSync(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const cacheKey = workspaceFolder.uri.toString();
  const cached = workspaceRootCache.get(cacheKey);
  
  // Valida cache se existir
  if (cached) {
    if (validateCache(cacheKey, cached)) {
      return cached;
    } else {
      // Cache inválido, remove e recalculaa
      workspaceRootCache.delete(cacheKey);
    }
  }
  
  // Versão síncrona: tenta encontrar .git de forma síncrona
  const workspacePath = canonizePath(workspaceFolder.uri.fsPath);
  let current = path.normalize(workspaceFolder.uri.fsPath);
  const root = path.parse(current).root;
  
  while (current !== root) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      const gitRoot = canonizePath(current);
      const workspaceNormalized = workspacePath.toLowerCase();
      const gitRootNormalized = gitRoot.toLowerCase();
      
      // Se Git root contém workspace, usa Git root
      if (workspaceNormalized.startsWith(gitRootNormalized + '/') || workspaceNormalized === gitRootNormalized) {
        workspaceRootCache.set(cacheKey, gitRoot);
        return gitRoot;
      }
      
      // Se workspace contém Git root, usa workspace
      if (gitRootNormalized.startsWith(workspaceNormalized + '/')) {
        workspaceRootCache.set(cacheKey, workspacePath);
        return workspacePath;
      }
    }
    current = path.dirname(current);
  }
  
  workspaceRootCache.set(cacheKey, workspacePath);
  return workspacePath;
}

/**
 * Converte um path absoluto para relativo ao workspace root canonizado
 * Retorna o path canonizado (com forward slashes)
 */
export function makeRelativeToWorkspaceRoot(
  workspaceFolder: vscode.WorkspaceFolder,
  absolutePath: string
): string {
  const workspaceRoot = getCanonizedWorkspaceRootSync(workspaceFolder);
  const absPath = canonizePath(absolutePath);
  const relative = path.relative(workspaceRoot, absPath);
  
  // Se está dentro do workspace, retorna relativo canonizado
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return canonizePath(relative);
  }
  
  // Se está fora do workspace, retorna absoluto canonizado
  return absPath;
}

/**
 * Garante que todos os diretórios parentes existam, criando-os recursivamente se necessário.
 * Esta função cria todos os diretórios intermediários do caminho até o diretório pai do arquivo.
 * 
 * IMPORTANTE: Esta função cria diretórios silenciosamente (não reporta na UI) para evitar
 * poluição visual com operações intermediárias. Apenas a criação do arquivo final é reportada.
 */
export async function ensureParentDirectory(uri: vscode.Uri) {
  const targetDir = path.dirname(uri.fsPath);
  
  // Se o diretório já existe, não precisa fazer nada
  try {
    const dirUri = vscode.Uri.file(targetDir);
    await vscode.workspace.fs.stat(dirUri);
    return; // Diretório já existe
  } catch {
    // Diretório não existe, precisa criar recursivamente
  }
  
  // Usa fs.mkdir recursivo do Node.js como fallback mais confiável
  // O VSCode API não suporta criação recursiva nativamente
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
  } catch (err: any) {
    // Se falhar, tenta criar manualmente nível por nível
    if (err.code !== 'EEXIST') {
      // Fallback: cria manualmente cada nível
      const parts = targetDir.split(path.sep).filter(Boolean);
      let currentPath = '';
      
      // Preserva a raiz do caminho (C: no Windows ou / no Unix)
      if (targetDir.startsWith(path.sep)) {
        currentPath = path.sep;
      } else if (targetDir.match(/^[A-Z]:/i)) {
        // Windows: preserva unidade
        currentPath = parts[0];
        parts.shift();
      }
      
      // Cria cada diretório incrementalmente
      for (const part of parts) {
        currentPath = path.join(currentPath, part);
        const dirUri = vscode.Uri.file(currentPath);
        try {
          await vscode.workspace.fs.createDirectory(dirUri);
        } catch (createErr: any) {
          if (createErr.code !== 'FileExists' && createErr.code !== 'EEXIST') {
            throw createErr;
          }
        }
      }
    }
  }
}

export async function readFileSafe(uri: vscode.Uri): Promise<string> {
  const content = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(content).toString('utf8');
}

// 🔒 Lock por arquivo para garantir escritas estritamente sequenciais por path.
// Isso evita condições de corrida quando múltiplas operações tentam escrever o mesmo arquivo.
const fileWriteLocks = new Map<string, Promise<void>>();

export async function writeFileSafe(uri: vscode.Uri, content: string) {
  const key = canonizePath(uri.fsPath).toLowerCase();
  const previous = fileWriteLocks.get(key) ?? Promise.resolve();

  const next = previous
    .catch(() => {
      // Não bloqueia a fila se uma escrita anterior falhou
    })
    .then(async () => {
      await ensureParentDirectory(uri);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      // Confirma no filesystem antes de liberar o lock (garante que a próxima escrita veja o arquivo atualizado)
      await vscode.workspace.fs.stat(uri);
    })
    .finally(() => {
      // Libera o lock apenas se ainda for o último da fila
      if (fileWriteLocks.get(key) === next) {
        fileWriteLocks.delete(key);
      }
    });

  fileWriteLocks.set(key, next);
  await next;
}

export async function writeFileBytesSafe(uri: vscode.Uri, content: Uint8Array) {
  const key = canonizePath(uri.fsPath).toLowerCase();
  const previous = fileWriteLocks.get(key) ?? Promise.resolve();

  const next = previous
    .catch(() => {
      // Não bloqueia a fila se uma escrita anterior falhou
    })
    .then(async () => {
      await ensureParentDirectory(uri);
      await vscode.workspace.fs.writeFile(uri, content);
      // Confirma no filesystem antes de liberar o lock (garante que a próxima escrita veja o arquivo atualizado)
      await vscode.workspace.fs.stat(uri);
    })
    .finally(() => {
      // Libera o lock apenas se ainda for o último da fila
      if (fileWriteLocks.get(key) === next) {
        fileWriteLocks.delete(key);
      }
    });

  fileWriteLocks.set(key, next);
  await next;
}

function assertValidTargetPath(targetPath: string) {
  const normalized = targetPath.replace(/\\/g, '/').trim();

  // erros comuns de parser/modelo (ex.: "filePath," / "path:")
  if (!normalized) throw new Error('Path vazio fornecido');
  if (/[,，]\s*$/.test(normalized)) {
    throw new Error(`Path inválido (vírgula no final): "${targetPath}"`);
  }

  const lower = normalized.toLowerCase();
  if (lower === 'filepath' || lower === 'path') {
    throw new Error(`Path inválido (placeholder): "${targetPath}"`);
  }

  // impede "path:" e "filePath," colados
  if (lower.endsWith('path:') || lower.endsWith('filepath:')) {
    throw new Error(`Path inválido (termina com ':'): "${targetPath}"`);
  }
}

/**
 * LÓGICA SIMPLIFICADA E ROBUSTA DE RESOLUÇÃO DE PATHS
 *
 * Regras claras:
 * 1. Se é absoluto E existe → usa direto
 * 2. Se é relativo ao workspace (não começa com . ou ..) → resolve do workspace root
 * 3. Se começa com ./ ou ../ → resolve do arquivo ativo
 * 4. Testa candidatos comuns do monorepo
 */
export function resolveWorkspacePath(
  workspaceFolder: vscode.WorkspaceFolder,
  targetPath: string
): vscode.Uri {
  if (!targetPath || !targetPath.trim()) {
    throw new Error('Path vazio fornecido');
  }

  assertValidTargetPath(targetPath);

  // Usa workspace root canonizado (Git root se disponível)
  const workspaceRoot = getCanonizedWorkspaceRootSync(workspaceFolder);
  const normalized = canonizePath(targetPath);

  // 1) CAMINHO ABSOLUTO
  if (path.isAbsolute(normalized)) {
    const absolutePath = canonizePath(normalized);

    // Se existe, usa direto
    if (fs.existsSync(absolutePath)) {
      return vscode.Uri.file(absolutePath);
    }

    // Se não existe mas está dentro do workspace, converte para relativo
    const relative = canonizePath(path.relative(workspaceRoot, absolutePath));
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      // Tenta resolver como relativo ao workspace
      const fromWorkspace = canonizePath(path.join(workspaceRoot, relative));
      if (fs.existsSync(fromWorkspace)) {
        return vscode.Uri.file(fromWorkspace);
      }
    }

    // Caminho absoluto que não existe → retorna mesmo assim (pode ser para criar)
    return vscode.Uri.file(absolutePath);
  }

  // 2) CAMINHO RELATIVO COM ./ OU ../
  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    const activeEditor = vscode.window.activeTextEditor;

    if (activeEditor && activeEditor.document.uri.scheme === 'file') {
      const activeDir = path.dirname(activeEditor.document.uri.fsPath);
      const resolved = canonizePath(path.join(activeDir, normalized));

      if (fs.existsSync(resolved)) {
        return vscode.Uri.file(resolved);
      }
    }

    // Fallback: remove o ./ e trata como relativo ao workspace
    const withoutDot = normalized.replace(/^\.\/?/, '');
    return resolveWorkspacePath(workspaceFolder, withoutDot);
  }

  // 3) CAMINHO RELATIVO AO WORKSPACE (sem ./ ou ../)
  // Primeiro tenta direto do workspace root (mais comum)
  const directPath = canonizePath(path.join(workspaceRoot, normalized));

  // Se existe, retorna imediatamente
  if (fs.existsSync(directPath)) {
    return vscode.Uri.file(directPath);
  }

  // Se não existe, tenta candidatos de monorepo (para compatibilidade)
  const candidates: string[] = [
    path.join(workspaceRoot, 'jarvis_vscode_extension', normalized),
    path.join(workspaceRoot, 'jarvis_vscode_extension', 'src', normalized),
    path.join(workspaceRoot, 'jarvis_dev_server', normalized),
    path.join(workspaceRoot, 'jarvis_dev_server', 'src', normalized)
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = canonizePath(candidate);
    if (fs.existsSync(normalizedCandidate)) {
      return vscode.Uri.file(normalizedCandidate);
    }
  }

  // 4) FALLBACK: workspace root + path (mesmo que não exista - pode ser para criar)
  // Isso garante que caminhos relativos simples sempre funcionem
  return vscode.Uri.file(directPath);
}