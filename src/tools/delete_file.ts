import * as vscode from 'vscode';
import { resolveWorkspacePath } from './utils';
import { ExecuteToolOptions } from './types';

export async function executeDeleteFile(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const targetPath = args.path;
  if (!targetPath) {
    throw new Error('delete_file requer args.path');
  }

  const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);
  
  // 🔒 Bloqueia deleção de arquivos protegidos
  const fileName = uri.fsPath.split(/[/\\]/).pop()?.toLowerCase();
  const forbiddenFiles = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
  if (fileName && forbiddenFiles.includes(fileName)) {
    throw new Error(`Acesso negado: o arquivo ${fileName} é um arquivo de sistema protegido e não pode ser deletado.`);
  }
  
  try {
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    return { 
      path: uri.fsPath.replace(/\\/g, '/'),
      deleted: true
    };
  } catch (err: any) {
    // Se arquivo não existe, não é erro crítico
    if ((err as any).code === 'FileNotFound') {
      return {
        path: uri.fsPath.replace(/\\/g, '/'),
        deleted: false,
        message: 'Arquivo não encontrado'
      };
    }
    throw new Error(`Falha ao deletar "${targetPath}": ${err.message}`);
  }
}





