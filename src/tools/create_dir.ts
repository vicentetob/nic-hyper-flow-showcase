import * as vscode from 'vscode';
import { resolveWorkspacePath } from './utils';
import { ExecuteToolOptions } from './types';

export async function executeCreateDir(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const targetPath = args.path;
  if (!targetPath) {
    throw new Error('create_dir requer args.path');
  }

  const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);
  
  try {
    await vscode.workspace.fs.createDirectory(uri);
    return { 
      path: uri.fsPath.replace(/\\/g, '/'),
      created: true
    };
  } catch (err: any) {
    // Se o diretório já existe, não é erro
    if ((err as any).code === 'FileExists') {
      return {
        path: uri.fsPath.replace(/\\/g, '/'),
        created: false,
        message: 'Diretório já existe'
      };
    }
    throw new Error(`Falha ao criar diretório "${targetPath}": ${err.message}`);
  }
}




