import * as vscode from 'vscode';
import { resolveWorkspacePath } from './utils';
import { ExecuteToolOptions } from './types';

export async function executeMoveFile(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const fromPath = args.from;
  const toPath = args.to;
  
  if (!fromPath || !toPath) {
    throw new Error('move_file requer args.from e args.to');
  }

  const fromUri = resolveWorkspacePath(options.workspaceFolder, fromPath);
  const toUri = resolveWorkspacePath(options.workspaceFolder, toPath);
  
  // 🔒 Bloqueia movimentação DE ou PARA arquivos protegidos
  const fromFileName = fromUri.fsPath.split(/[/\\]/).pop()?.toLowerCase();
  const toFileName = toUri.fsPath.split(/[/\\]/).pop()?.toLowerCase();
  const forbiddenFiles = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
  
  if (fromFileName && forbiddenFiles.includes(fromFileName)) {
    throw new Error(`Acesso negado: o arquivo ${fromFileName} é protegido e não pode ser movido.`);
  }
  if (toFileName && forbiddenFiles.includes(toFileName)) {
    throw new Error(`Acesso negado: não é permitido sobrescrever ou criar o arquivo protegido ${toFileName}.`);
  }
  
  try {
    await vscode.workspace.fs.rename(fromUri, toUri, { overwrite: false });
    return { 
      from: fromUri.fsPath.replace(/\\/g, '/'),
      to: toUri.fsPath.replace(/\\/g, '/'),
      moved: true
    };
  } catch (err: any) {
    throw new Error(`Falha ao mover "${fromPath}" para "${toPath}": ${err.message}`);
  }
}





