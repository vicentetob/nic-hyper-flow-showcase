import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as vscode from 'vscode';
import { ExecuteToolOptions } from './types';
import { getCanonizedWorkspaceRootSync, canonizePath, makeRelativeToWorkspaceRoot } from './utils';

const execAsync = promisify(exec);

function isJarvisLogPath(p: string) {
  const fileName = String(p || '').split('/').pop()?.toLowerCase();
  const forbiddenFiles = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
  return forbiddenFiles.includes(fileName || '');
}

export async function executeGitStatus(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  try {
    // Usa workspace root canonizado (Git root se disponível)
    const workspaceRoot = getCanonizedWorkspaceRootSync(options.workspaceFolder);
    
    const { stdout } = await execAsync('git status --porcelain', {
      cwd: workspaceRoot,
      timeout: 5000
    });
    
    const lines = stdout.split('\n').filter(l => l.trim());
    const modified: string[] = [];
    const untracked: string[] = [];
    const staged: string[] = [];
    
    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3).trim();
      // Converte para path relativo ao workspace root canonizado
      const absolute = canonizePath(path.join(workspaceRoot, file));
      const relative = makeRelativeToWorkspaceRoot(options.workspaceFolder, absolute);

      // 🔒 Não retornar jarvis_i_o.md nos resultados das tools
      if (isJarvisLogPath(relative)) {
        continue;
      }
      
      if (status.includes('M')) {
        modified.push(relative);
      }
      if (status.includes('A')) {
        staged.push(relative);
      }
      if (status.includes('?')) {
        untracked.push(relative);
      }
    }
    
    return {
      modified,
      untracked,
      staged,
      hasChanges: lines.length > 0
    };
  } catch (err: any) {
    throw new Error(`Falha ao executar git status: ${err.message}`);
  }
}




