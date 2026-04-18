import * as vscode from 'vscode';
import { resolveWorkspacePath } from './utils';
import { ExecuteToolOptions } from './types';

export async function executeFormatCode(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const targetPath = args.path;
  if (!targetPath) {
    throw new Error('format_code requer args.path');
  }

  const uri = resolveWorkspacePath(options.workspaceFolder, targetPath);
  
  // 🔒 Bloqueia formatação de arquivos protegidos
  const fileName = uri.fsPath.split(/[/\\]/).pop()?.toLowerCase();
  const forbiddenFiles = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];
  if (fileName && forbiddenFiles.includes(fileName)) {
    throw new Error(`Acesso negado: o arquivo ${fileName} não pode ser formatado.`);
  }
  
  try {
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      uri,
      { tabSize: 2, insertSpaces: true } as vscode.FormattingOptions
    );
    
    if (edits && edits.length > 0) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      for (const textEdit of edits) {
        edit.replace(uri, textEdit.range, textEdit.newText);
      }
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
    
    return {
      path: uri.fsPath.replace(/\\/g, '/'),
      formatted: true,
      editsApplied: edits?.length || 0
    };
  } catch (err: any) {
    throw new Error(`Falha ao formatar "${targetPath}": ${err.message}`);
  }
}




