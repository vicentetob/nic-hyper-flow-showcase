import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';
import { EditApprovalRequest, JarvisEdit } from './types';
import { 
  resolveWorkspacePath, 
  readFileSafe, 
  writeFileSafe, 
  getCanonizedWorkspaceRootSync, 
  canonizePath, 
  makeRelativeToWorkspaceRoot 
} from './utils';
import { applyPatchFile } from './patch';
import { getJarvisOutputChannel } from './index';

/**
 * Arquivos que são estritamente proibidos de serem acessados ou modificados pelo agente.
 */
const FORBIDDEN_FILES = ['jarvis_i_o.md', 'nic_debug.md', 'pkb_v2.jsonl', 'pkb.jsonl', 'assets_registry.json'];

function summarizeEdit(edit: JarvisEdit): EditApprovalRequest {
  const toolName = edit.type;
  switch (edit.type) {
    case 'create':
      return {
        toolName,
        summary: `Criar arquivo ${edit.path}`,
        files: [edit.path],
        args: { path: edit.path },
        metadata: { type: edit.type, contentPreview: String(edit.content || '').slice(0, 400) }
      };
    case 'delete':
      return {
        toolName,
        summary: `Excluir arquivo ${edit.path}`,
        files: [edit.path],
        args: { path: edit.path },
        metadata: { type: edit.type }
      };
    case 'replace':
      return {
        toolName,
        summary: `Substituir conteúdo completo de ${edit.path}`,
        files: [edit.path],
        args: { path: edit.path },
        metadata: { type: edit.type, contentPreview: String(edit.content || '').slice(0, 400) }
      };
    case 'patch_file':
      return {
        toolName,
        summary: `Edit ${edit.path} by exact text`,
        files: [edit.path],
        args: { path: edit.path },
        metadata: {
          type: edit.type,
          exactMatchPreview: String(edit.patchFile?.exact_match || '').slice(0, 400),
          replacementPreview: String(edit.patchFile?.replacement || '').slice(0, 400),
          occurrence: edit.patchFile?.occurrence
        }
      };
    case 'patch':
    default:
      return {
        toolName,
        summary: `Aplicar patch em ${edit.path}`,
        files: [edit.path],
        args: { path: edit.path },
        metadata: { type: edit.type, patchPreview: String(edit.patch || '').slice(0, 400) }
      };
  }
}

export async function applyReplacementToSelection(
  editor: vscode.TextEditor,
  newText: string
): Promise<void> {
  const selection = editor.selection;

  if (selection.isEmpty) {
    vscode.window.showWarningMessage(
      'Nenhuma seleção ativa. Selecione um trecho de código antes.'
    );
    return;
  }

  await editor.edit(editBuilder => {
    editBuilder.replace(selection, newText);
  });
}

/**
 * Aplica edições no workspace com travas de segurança.
 */
export async function applyJarvisEdits(
  edits: JarvisEdit[] | undefined,
  workspaceFolder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel,
  sidebarProvider?: any,
  requestEditApproval?: (request: EditApprovalRequest) => Promise<{ approved: boolean; userMessage?: string }>
): Promise<
  Array<{
    path: string;
    type: string;
    applied: boolean;
    modified: boolean;
    /** Unified diff (best-effort) between pre/post file content when modified */
    diff?: string;
    /** Context window (best-effort) around the changed region in the post-patch file */
    context?: any;
    /** Optional preview for patches */
    newTextPreview?: string;
    /** Optional debug/info for patch */
    info?: any;
  }>
> {
  if (!edits || edits.length === 0) {
    return [];
  }

  const results: Array<{
    path: string;
    type: string;
    applied: boolean;
    modified: boolean;
    diff?: string;
    context?: any;
    newTextPreview?: string;
    info?: any;
  }> = [];

  for (const edit of edits) {
    try {
      if (requestEditApproval) {
        const { approved, userMessage } = await requestEditApproval(summarizeEdit(edit));
        if (!approved) {
          output.appendLine(`⛔ Edição rejeitada pelo usuário: ${edit.type} ${edit.path}`);
          results.push({
            path: edit.path,
            type: edit.type,
            applied: false,
            modified: false,
            info: { rejectedByUser: true, ...(userMessage ? { userMessage } : {}) },
          });
          continue;
        }
      }

      const targetUri = resolveWorkspacePath(workspaceFolder, edit.path);
      const fileName = path.basename(targetUri.fsPath).toLowerCase();
      
      // 🔒 TRAVA DE SEGURANÇA GLOBAL: impede qualquer modificação em arquivos do sistema
      if (FORBIDDEN_FILES.includes(fileName)) {
        throw new Error(`Acesso negado: o arquivo ${fileName} é um arquivo de sistema protegido e não pode ser modificado.`);
      }

      switch (edit.type) {
        case 'create': {
          if (!edit.content) {
            throw new Error(`CREATE requer content para ${edit.path}`);
          }
          try {
            await vscode.workspace.fs.stat(targetUri);
            throw new Error(
              `❌ Arquivo "${edit.path}" já existe. Use PATCH para modificar ou REPLACE para substituir completamente.`
            );
          } catch (statError: any) {
            if (statError.code !== 'FileNotFound' && statError.code !== 'ENOENT') {
              throw statError;
            }
          }
          await writeFileSafe(targetUri, edit.content);
          output.appendLine(`✅ CREATE: ${edit.path}`);
          
          // Notifica a criação do arquivo
          sidebarProvider?.notifyFileModified?.(edit.path, 'created', edit.content.split('\n').length, 0);
          sidebarProvider?.postSystemMessage?.(`✅ CREATE aplicado: ${edit.path}`);
          
          results.push({ path: edit.path, type: 'create', applied: true, modified: true });
          break;
        }

        case 'delete': {
          let removedLines = 50; // valor padrão se não conseguir ler o arquivo
          
          try {
            // Tenta ler o arquivo para contar linhas antes de deletar
            const content = await readFileSafe(targetUri);
            removedLines = content.split('\n').length;
          } catch {
            // Se não conseguir ler, mantém o valor padrão
          }
          
          try {
            await vscode.workspace.fs.delete(targetUri);
            output.appendLine(`✅ DELETE: ${edit.path}`);
            
            // Notifica a exclusão do arquivo
            sidebarProvider?.notifyFileModified?.(edit.path, 'deleted', 0, removedLines);
            sidebarProvider?.postSystemMessage?.(`✅ DELETE aplicado: ${edit.path}`);
            
            results.push({ path: edit.path, type: 'delete', applied: true, modified: true });
          } catch (err: any) {
            if (err.code !== 'FileNotFound') throw err;
            output.appendLine(`⚠️ DELETE: ${edit.path} (não encontrado)`);
            results.push({ path: edit.path, type: 'delete', applied: false, modified: false });
          }
          break;
        }

        case 'replace': {
          if (!edit.content) throw new Error(`REPLACE requer content para ${edit.path}`);
          
          let added = 0;
          let removed = 0;
          
          try {
            // Tenta ler o conteúdo anterior para calcular diff
            const beforeContent = await readFileSafe(targetUri);
            const afterContent = edit.content;
            
            // Calcula diff usando a mesma lógica do patch.ts
            const diffResult = diff.diffLines(beforeContent, afterContent);
            
            for (const part of diffResult) {
              if (part.added) {
                added += part.count || 1;
              } else if (part.removed) {
                removed += part.count || 1;
              }
            }
          } catch {
            // Se não conseguir ler (arquivo não existe), considera tudo como adicionado
            added = edit.content.split('\n').length;
            removed = 0;
          }
          
          await writeFileSafe(targetUri, edit.content);
          output.appendLine(`✅ REPLACE: ${edit.path}`);
          
          // Notifica a substituição do arquivo
          sidebarProvider?.notifyFileModified?.(edit.path, 'modified', added, removed);
          sidebarProvider?.postSystemMessage?.(`✅ REPLACE aplicado: ${edit.path}`);
          
          results.push({ path: edit.path, type: 'replace', applied: true, modified: true });
          break;
        }

        case 'patch': {
          const patchResult = await applyPatchFile(edit, workspaceFolder, output, sidebarProvider);
          results.push({ 
            path: patchResult.path, 
            type: 'patch', 
            applied: patchResult.applied, 
            modified: patchResult.modified,
            diff: patchResult.diff,
            context: patchResult.context
          });
          break;
        }


        case 'patch_file': {
          const patchResult = await applyPatchFile(edit, workspaceFolder, output, sidebarProvider);
          results.push({
            path: patchResult.path,
            type: 'patch_file',
            applied: patchResult.applied,
            modified: patchResult.modified,
            diff: patchResult.diff,
            context: patchResult.context
          });
          break;
        }


        default:
          throw new Error(`Tipo de edição desconhecido: ${(edit as any).type}`);
      }
    } catch (err: any) {
      if (err?.code === 'PATCH_PREFLIGHT_REQUIRED') throw err;
      output.appendLine(`❌ Erro em ${edit.path}: ${err.message}`);
      throw err;
    }
  }

  return results;
}

/**
 * Constrói o contexto básico do workspace (arquivos abertos).
 */
export async function buildWorkspaceContext(
  workspaceFolder: vscode.WorkspaceFolder,
  maxOpenFiles: number,
  maxBytesPerFile: number
) {
  const activeEditor = vscode.window.activeTextEditor;
  const visibleEditors = vscode.window.visibleTextEditors;

  const openFiles: { path: string; content: string; truncated: boolean }[] = [];
  
  if (activeEditor && activeEditor.document.uri.scheme === 'file') {
    const filePath = activeEditor.document.uri.fsPath.replace(/\\/g, '/');
    const fileName = path.basename(filePath).toLowerCase();
    
    if (!FORBIDDEN_FILES.includes(fileName)) {
      openFiles.push({
        path: filePath,
        content: activeEditor.document.getText(),
        truncated: false
      });
    }
  }

  const visibleFiles: { path: string; lines: number; language: string }[] = [];
  for (const editor of visibleEditors) {
    if (editor === activeEditor) continue;
    const doc = editor.document;
    if (doc.isUntitled || doc.uri.scheme !== 'file') continue;

    const fileName = path.basename(doc.uri.fsPath).toLowerCase();
    if (FORBIDDEN_FILES.includes(fileName)) continue;
    
    visibleFiles.push({
      path: doc.uri.fsPath.replace(/\\/g, '/'),
      lines: doc.lineCount,
      language: doc.languageId
    });
  }

  return {
    workspaceRoot: getCanonizedWorkspaceRootSync(workspaceFolder),
    activeFile: activeEditor?.document.uri.fsPath ? canonizePath(activeEditor.document.uri.fsPath) : null,
    activeSelection: activeEditor?.selection?.isEmpty ? null : activeEditor?.document.getText(activeEditor.selection) ?? null,
    openFiles,
    visibleFiles
  };
}

/**
 * Constrói contexto focado no step atual do plano.
 */
export async function buildContextForCurrentStep(
  workspaceFolder: vscode.WorkspaceFolder,
  currentPlan: any | null,
  maxBytesPerFile: number
) {
  const currentStep = currentPlan?.steps?.find((s: any) => s.status === 'in_progress') 
                   || currentPlan?.steps?.find((s: any) => s.status === 'pending');
  
  if (!currentStep || !currentStep.targets || currentStep.targets.length === 0) {
    return buildWorkspaceContext(workspaceFolder, 20, maxBytesPerFile);
  }
  
  const openFiles: { path: string; content: string; truncated: boolean }[] = [];
  for (const targetPath of currentStep.targets) {
    const uri = resolveWorkspacePath(workspaceFolder, targetPath);
    const fileName = path.basename(uri.fsPath).toLowerCase();
    
    if (FORBIDDEN_FILES.includes(fileName)) continue;
    
    try {
      const content = await readFileSafe(uri);
      openFiles.push({
        path: uri.fsPath.replace(/\\/g, '/'),
        content: content,
        truncated: false
      });
    } catch {
      continue;
    }
  }
  
  if (openFiles.length === 0) return buildWorkspaceContext(workspaceFolder, 20, maxBytesPerFile);
  
  return {
    workspaceRoot: getCanonizedWorkspaceRootSync(workspaceFolder),
    activeFile: openFiles[0]?.path ?? null,
    activeSelection: null,
    openFiles,
    visibleFiles: [] 
  };
}

/**
 * Coleta o contexto inicial dos arquivos abertos e seus símbolos.
 */
export async function getInitialContext(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
  const visibleEditors = vscode.window.visibleTextEditors;
  if (visibleEditors.length === 0) return "";

  let context = "\n\n[CONTEXTO INICIAL: ARQUIVOS ABERTOS E SÍMBOLOS]\n";

  for (const editor of visibleEditors) {
    const doc = editor.document;
    if (doc.uri.scheme !== 'file') continue;

    const fileName = path.basename(doc.uri.fsPath).toLowerCase();
    if (FORBIDDEN_FILES.includes(fileName)) continue;

    const filePath = makeRelativeToWorkspaceRoot(workspaceFolder, doc.uri.fsPath);
    context += `\nArquivo: ${filePath}\n`;
  }

  context += "----------------------------------------------\n";
  return context;
}