import * as vscode from 'vscode';
import { resolveWorkspacePath, writeFileSafe } from './utils';
import { ExecuteToolOptions } from './types';

export async function executeWriteFile(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const targetPath = args.path;
  if (!targetPath) {
    throw new Error('write_file requer args.path');
  }

  const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);
  
  // 🔒 Bloqueia escrita em arquivos protegidos
  const fileName = uri.fsPath.split(/[/\\]/).pop()?.toLowerCase();
  const forbiddenFiles = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
  if (fileName && forbiddenFiles.includes(fileName)) {
    throw new Error(`Acesso negado: o arquivo ${fileName} é um arquivo de sistema protegido e não pode ser modificado.`);
  }

  const content = args.content ?? '';
  
  try {
    await writeFileSafe(uri, content);
    return { 
      path: uri.fsPath.replace(/\\/g, '/'), 
      bytes: content.length 
    };
  } catch (err: any) {
    throw new Error(`Falha ao escrever arquivo "${targetPath}": ${err.message}`);
  }
}





