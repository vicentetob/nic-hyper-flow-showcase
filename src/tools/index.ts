import * as vscode from 'vscode';
import { JarvisToolRequest, JarvisToolResult, ExecuteToolOptions, EditApprovalRequest } from './types';
import { RemoteControlService } from '../services/remoteControlService';
import { buildRemoteToolSummary } from './remoteToolSummary';

// Importar todas as tools
import { executeListDir } from './list_dir';
import { executeListDirRecursive } from './list_dir_recursive';
import { executeReadFile } from './read_file';
import { executeReadMultipleFiles } from './read_multiple_files';
import { executeWriteFile } from './write_file';
import { executeCreateDir } from './create_dir';
import { executeMoveFile } from './move_file';
import { executeRenameFile } from './rename';
import { executeCopyFile } from './copy_file';
import { executeDeleteFile } from './delete_file';
import { executeGitStatus } from './git_status';
import { executeFormatCode } from './format_code';
import { executeRunCommand } from './run_command';
import { executeTerminalStart } from './terminal_start';
import { executeTerminalRead } from './terminal_read';
import { executeTerminalSend } from './terminal_send';
import { executeTerminalStop } from './terminal_stop';
import { executeTerminalList } from './terminal_list';
import { executeReadChunks } from './read_chunks';
import { executeBrowserAction } from './browser_action';
import { executeSearch } from './search';
import { executeParseLintErrors } from './parse_lint_errors';
import { executeWebSearch } from './web_search';
import { executeWikipedia } from './wikipedia';
import { executeReadUrl } from './read_url';
import { executeDownloadWebFile } from './download_web_file';
import { execute as executeGenerateImage } from './generate_image';
import { executeGetImage } from './get_image';
import { executeAdbScreenshot } from './adb_screenshot';
import { executeAdbInput } from './adb_input';

import { execute as executeSearchAssets } from './search_assets';
import { executeReportCognitiveState } from './report_cognitive_state';
import { executeReportStatus } from './report_status';
import { executeCurrentPlan } from './current_plan';
import { executeReplaceText } from './replace_text';
import { executeHttpRequest } from './http_request';
import { applyJarvisEdits } from './main';

// Importar novas ferramentas de web crawling
import { executeCrawlSite } from './crawl_site';
import { executeDownloadResource } from './download_resource';
import { executeExtractLinks } from './extract_links';
import { executeDownloadSiteAssets } from './download_site_assets';
import { executeListDownloadableFiles } from './list_downloadable_files';
import { executeReadRobotsTxt } from './read_robots_txt';
import { executeGenerateAssets } from './generate_assets';
import { executeReadPdfRef } from './readPdfRef';
import { executeReadDocx } from './readDocx';
import { executeSaveChatImageAsAsset } from './save_chat_image_as_asset';
import { executeCopyAndPasteCode } from './copy_and_paste_code';
import { wait } from './wait';

// Importar ferramenta de compressão de imagens
import { executeTinifyApi } from './tinify_api';
import { executeGenerateDocx } from './tool_generate_docx';

// Firebase / Firestore
import { executeFirebaseListProjects } from './list_firebase_projects';
import { executeFirestoreGetSchemaMap } from './firestore_get_schema_map';
import { executeFirestoreRunQuery } from './query_firestore';
import { executeFirebaseListStorageBuckets } from './firebase_list_storage_buckets';
import { executeCallClaude, executeCallClaudeCheck, executeCallClaudeStop, executeCallClaudeReply } from './call_claude';

import { executeCopyAndPasteSymbol } from './copy_and_paste_symbol';
import { executeScreenshot } from './screenshot';
import { executeGetProjectContext } from './get_project_context';
import { executeApplyPatchBatch } from './apply_patch_batch';
import { executeSessionMemory } from './session_memory';
import { executeSummarizeChanges } from './summarize_changes';
import { executeRunSubAgent, executeStopSubAgent } from './run_subagent';
import { executeReportSubAgentState } from './report_subagent_state';

// Re-exportar tipos e interfaces
export * from './types';
export * from './utils';

// Exportar funções principais que precisam ser mantidas
 export { applyReplacementToSelection, applyJarvisEdits, buildWorkspaceContext, buildContextForCurrentStep, getInitialContext } from './main';let outputChannel: vscode.OutputChannel | undefined;

export function getJarvisOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Jarvis Dev');
  }
  return outputChannel;
}

function buildEditApprovalRequest(toolName: string, args: Record<string, any>): EditApprovalRequest | null {
  switch (toolName) {
    case 'write_file':
      return {
        toolName,
        summary: `Escrever arquivo ${args.path || ''}`.trim(),
        files: args.path ? [String(args.path)] : [],
        args,
        metadata: { contentPreview: String(args.content || '').slice(0, 400) }
      };
    case 'delete_file':
      return {
        toolName,
        summary: `Deletar ${args.path || ''}`.trim(),
        files: args.path ? [String(args.path)] : [],
        args
      };
    case 'move_file':
      return {
        toolName,
        summary: `Mover ${args.from || ''} → ${args.to || ''}`.trim(),
        files: [args.from, args.to].filter(Boolean).map(String),
        args
      };
    case 'rename':
      return {
        toolName,
        summary: `Renomear ${args.from || ''} → ${args.to || ''}`.trim(),
        files: [args.from, args.to].filter(Boolean).map(String),
        args
      };
    case 'copy_file':
      return {
        toolName,
        summary: `Copiar ${args.from || ''} → ${args.to || ''}`.trim(),
        files: [args.from, args.to].filter(Boolean).map(String),
        args
      };
    case 'format_code':
      return {
        toolName,
        summary: `Formatar ${args.path || ''}`.trim(),
        files: args.path ? [String(args.path)] : [],
        args
      };
    case 'create_dir':
      return {
        toolName,
        summary: `Criar diretório ${args.path || ''}`.trim(),
        files: args.path ? [String(args.path)] : [],
        args
      };
    case 'replace_text': {
      const include = Array.isArray(args.include) ? args.include.join(', ') : String(args.include || '');
      return {
        toolName,
        summary: `replace_text em ${include}`.trim(),
        files: include ? [include] : [],
        args,
        metadata: {
          search: String(args.search || '').slice(0, 200),
          replace: String(args.replace || '').slice(0, 200),
          preview: !!args.preview
        }
      };
    }
    case 'apply_patch_batch': {
      const operations = Array.isArray(args.operations) ? args.operations : [];
      return {
        toolName,
        summary: `Apply batch of ${operations.length} edits`,
        files: operations.map((op: any) => String(op?.path || '')).filter(Boolean),
        args,
        metadata: { operationCount: operations.length }
      };
    }
    default:
      return null;
  }
}

async function executeSingleTool(
  request: JarvisToolRequest,
  options: ExecuteToolOptions
): Promise<any> {
  const args = request.args ?? {};
  const editApprovalRequest = buildEditApprovalRequest(request.name, args);
  if (editApprovalRequest && options.requestEditApproval) {
    const approved = await options.requestEditApproval(editApprovalRequest);
    if (!approved) {
      return {
        rejectedByUser: true,
        skipped: true,
        toolName: request.name,
        summary: editApprovalRequest.summary,
        files: editApprovalRequest.files
      };
    }
  }

  switch (request.name) {
    case 'list_dir':
      return executeListDir(args, options);
    
    case 'list_dir_recursive':
      return executeListDirRecursive(args, options);
    
    case 'read_file':
      return executeReadFile(args, options);

    case 'read_multiple_files':
      return executeReadMultipleFiles(args, options);
    
    case 'write_file':
      return executeWriteFile(args, options);
    
    case 'create_dir':
      return executeCreateDir(args, options);
    
    case 'move_file':
      return executeMoveFile(args, options);
    
    case 'rename':
      return executeRenameFile(args, options);
    
    case 'copy_file':
      return executeCopyFile(args, options);
    
    case 'delete_file':
      return executeDeleteFile(args, options);
    
    case 'git_status':
      return executeGitStatus(args, options);
    
    case 'format_code':
      return executeFormatCode(args, options);
    
    case 'run_command':
      return executeRunCommand(args, options);

    case 'terminal_start':
      return executeTerminalStart(args, options);

    case 'terminal_read':
      return executeTerminalRead(args, options);

    case 'terminal_send':
      return executeTerminalSend(args, options);

    case 'terminal_stop':
      return executeTerminalStop(args, options);

    case 'terminal_list':
      return executeTerminalList(args, options);
    
    case 'read_chunks':
      return executeReadChunks(args, options);
    
    case 'apply_patch':
      // Intentionally disabled to avoid confusion with LINE PROTOCOL edits.
      throw new Error(
        `Tool "apply_patch" está desabilitada. Use <<<NHF:CMD:TOB>>> PATCH (ou REPLACE/CREATE/DELETE) para editar arquivos.`
      );
    
    case 'search':
      return executeSearch(args, options);
    
    case 'web_search':
      return executeWebSearch(args, options);
    
    case 'wikipedia':
      return executeWikipedia(args, options);
    
    case 'read_url':
      return executeReadUrl(args as any);

    case 'download_web_file':
      return executeDownloadWebFile(args, options);
    
    case 'crawl_site':
      return executeCrawlSite(args, options);
    
    case 'download_resource':
      return executeDownloadResource(args, options);
    
    case 'extract_links':
      return executeExtractLinks(args, options);
    
    case 'download_site_assets':
      return executeDownloadSiteAssets(args, options);
    
    case 'list_downloadable_files':
      return executeListDownloadableFiles(args, options);
    
    case 'read_robots_txt':
      return executeReadRobotsTxt(args as any, options);
    
    case 'parse_lint_errors':
      return executeParseLintErrors(args, options);
    
    case 'generate_image':
      return executeGenerateImage(args, options);
    
    case 'get_image':
      return executeGetImage(args, options);

    case 'adb_screenshot':
      return executeAdbScreenshot(args, options);

    case 'adb_input':
      return executeAdbInput(args as any, options);

    case 'read_pdf_ref':
      return executeReadPdfRef(args, options);

    case 'read_docx':
      return executeReadDocx(args, options);

    case 'http_request':
      return executeHttpRequest(args, options);

    case 'search_assets':
      return executeSearchAssets(args, options);

    case 'generate_assets':
      return executeGenerateAssets(args, options);

    case 'tinify_api':
      return executeTinifyApi(args, options);

    case 'generate_docx':
      return executeGenerateDocx(args, options);

    case 'save_chat_image_as_asset':
      return executeSaveChatImageAsAsset(args, options);

    case 'report_cognitive_state':
      return executeReportCognitiveState(args as any, options);

    case 'report_status':
      return executeReportStatus(args as any, options);

    case 'current_plan':
      return executeCurrentPlan(args as any, options);

    case 'replace_text':
      return executeReplaceText(args as any, options);

    case 'copy_and_paste_code':
      return executeCopyAndPasteCode(args as any, options);

    case 'firebase_list_projects':
      return executeFirebaseListProjects(args, options);

    case 'firestore_get_schema_map':
      return executeFirestoreGetSchemaMap(args, options);

    case 'firestore_run_query':
      return executeFirestoreRunQuery(args, options);

    case 'browser_action':
      return executeBrowserAction(args as any, options);

    case 'firebase_list_storage_buckets':
      return executeFirebaseListStorageBuckets(args, options);

    case 'call_claude':
      return executeCallClaude(args, options);

    case 'call_claude_check':
      return executeCallClaudeCheck(args, options);

    case 'call_claude_stop':
      return executeCallClaudeStop(args, options);

    case 'call_claude_reply':
      return executeCallClaudeReply(args, options);

    case 'copy_and_paste_symbol':
      return executeCopyAndPasteSymbol(args, options);

    case 'screenshot':
      return executeScreenshot(args, options);

    case 'patch':
      return applyJarvisEdits(
        [{ type: 'patch', path: args.path, symbol: args.symbol, patch: args.content }], 
        options.workspaceFolder, 
        options.outputChannel, 
        options.sidebarProvider,
        options.requestEditApproval
      );

    case 'replace':
      return applyJarvisEdits(
        [{ type: 'replace', path: args.path, content: args.content }], 
        options.workspaceFolder, 
        options.outputChannel, 
        options.sidebarProvider,
        options.requestEditApproval
      );

    case 'create':
      return applyJarvisEdits(
        [{ type: 'create', path: args.path, content: args.content }], 
        options.workspaceFolder, 
        options.outputChannel, 
        options.sidebarProvider,
        options.requestEditApproval
      );

    case 'delete':
      return applyJarvisEdits(
        [{ type: 'delete', path: args.path }], 
        options.workspaceFolder, 
        options.outputChannel, 
        options.sidebarProvider,
        options.requestEditApproval
      );

    case 'patch_file':
      return applyJarvisEdits(
        [{ 
          type: 'patch_file', 
          path: args.file_path || args.path, 
          patchFile: {
            file_path: args.file_path || args.path,
            exact_match: args.exact_match,
            replacement: args.replacement,
            occurrence: args.occurrence,
            require_unique: args.require_unique
          }
        }], 
        options.workspaceFolder, 
        options.outputChannel, 
        options.sidebarProvider,
        options.requestEditApproval
      );

    case 'get_project_context':
      return executeGetProjectContext(args, options);

    case 'apply_patch_batch':
      return executeApplyPatchBatch(args, options);

    case 'session_memory':
      return executeSessionMemory(args, options);

    case 'summarize_changes':
      return executeSummarizeChanges(args, options);

    case 'run_subagent':
      return executeRunSubAgent(args as any, options as any);

    case 'stop_subagent':
      return executeStopSubAgent(args as any, options);

    case 'report_subagent_state':
      return executeReportSubAgentState(args as any, options as any);

    case 'wait':
      return wait(args as any, options);

    case 'name_chat':
      await vscode.commands.executeCommand('jarvis.internal.updateChatTitle', args.title);
      return { success: true, title: args.title };

    default:
      throw new Error(`Tool desconhecida: ${request.name}`);
  }
}



/**
 * EXECUÇÃO DE TOOLS
 *
 * ⚠️ IMPORTANTE:
 * Para evitar condições de corrida/concorrência e arquivos truncados quando o modelo
 * envia múltiplos comandos na mesma resposta, executamos TODAS as tools
 * estritamente em série e na ordem exata recebida.
 */
export async function executeToolRequests(
  requests: JarvisToolRequest[],
  options: ExecuteToolOptions,
  metadata?: {
    runId?: number;
    phase?: string;
    cause?: string;
  }
): Promise<JarvisToolResult[]> {
  console.log(`🚀 executeToolRequests chamado com ${requests.length} requisição(ões):`, requests.map(r => r.name).join(', '));
  const results: JarvisToolResult[] = [];

  // Reordena para garantir que parse_lint_errors seja sempre a última
  const lintRequests = requests.filter(r => r.name === 'parse_lint_errors');
  const otherRequests = requests.filter(r => r.name !== 'parse_lint_errors');
  const orderedRequests = [...otherRequests, ...lintRequests];

  if (lintRequests.length > 0 && otherRequests.length > 0) {
     console.log('🔄 Reordenando execução: movendo parse_lint_errors para o final.');
  }

  // 🔄 Executar tools sempre em série
  for (const request of orderedRequests) {
    const start = Date.now();
    try {
      console.log(`🔧 Iniciando execução da tool: ${request.name}`);
      const resultPayload = await executeSingleTool(request, options);
      const duration = Date.now() - start;
      console.log(`✅ Tool ${request.name} concluída em ${duration}ms`);

      // Logs para acompanhamento
      switch (request.name) {
        case 'list_dir': {
          const pathArg = request.args?.path ?? '.';
          const count = Array.isArray(resultPayload) ? resultPayload.length : 0;
          const msg = `📂 list_dir: ${pathArg} → ${count} entradas (${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'read_file': {
          const pathResult = resultPayload?.path ?? request.args?.path ?? '';
          const content: string = resultPayload?.content ?? '';
          const totalLines = content ? content.split(/\r?\n/).length : 0;
          const fromLine = typeof request.args?.startLine === 'number' ? request.args.startLine : 1;
          const toLine = typeof request.args?.endLine === 'number' ? request.args.endLine : totalLines;
          const msg = `📖 read_file: ${pathResult} (linhas ${fromLine}–${toLine}/${totalLines}, ${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'read_multiple_files': {
          const count = Array.isArray(resultPayload?.results) ? resultPayload.results.length : 0;
          const paths = Array.isArray(resultPayload?.files) ? resultPayload.files.join(', ') : '';
          const msg = `📖 read_multiple_files: ${count} arquivos [${paths}] (${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'search': {
          const queriesArg: string[] = Array.isArray(request.args?.queries)
            ? request.args.queries.map((q: any) => String(q)).filter((q: string) => q.trim()).slice(0, 10)
            : [];
          const queryArg = String(request.args?.query ?? '').trim();
          const queries = queriesArg.length > 0 ? queriesArg : (queryArg ? [queryArg] : []);

          // Suporta retorno antigo (single) e retorno novo (multi)
          const isMultiResult = Array.isArray(resultPayload?.results);

          let totalMatches = 0;
          const fileSet = new Set<string>();
          if (isMultiResult) {
            for (const r of resultPayload.results) {
              const ms = Array.isArray(r?.matches) ? r.matches : [];
              totalMatches += ms.length;
              for (const m of ms) {
                if (m?.path) {fileSet.add(String(m.path));}
              }
            }
          } else {
            const ms = Array.isArray(resultPayload?.matches) ? resultPayload.matches : [];
            totalMatches = ms.length;
            for (const m of ms) {
              if (m?.path) {fileSet.add(String(m.path));}
            }
          }

          const label =
            queries.length <= 1
              ? `"${queries[0] ?? ''}"`
              : `${queries.length} termos`;

          const msg = `🔍 search: ${label} → ${totalMatches} em ${fileSet.size} arquivo(s) (${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'write_file': {
          const pathResult = resultPayload?.path ?? request.args?.path ?? '';
          const bytes = resultPayload?.bytes ?? 0;
          const msg = `✏️ write_file: ${pathResult} (${bytes} bytes, ${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'generate_image': {
          const pathResult = resultPayload?.path ?? request.args?.path ?? '';
          const bytes = resultPayload?.bytes ?? 0;
          const model = resultPayload?.model ?? '';
          const msg = `🎨 generate_image: ${pathResult} (${bytes} bytes, ${model}, ${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'get_image': {
          const pathResult = resultPayload?.path ?? request.args?.path ?? '';
          const msg = `🖼️ get_image: ${pathResult} (${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
case 'search_assets': {
          const query = String(request.args?.query ?? '');
          const count = resultPayload?.assets?.length ?? 0;
          const msg = `🔍 search_assets: "${query}" → ${count} asset(s) encontrado(s) (${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'generate_assets': {
          const count = resultPayload?.images?.length ?? 0;
          const size = resultPayload?.meta?.size ?? 'auto';
          const msg = `🎨 generate_assets: ${count} image(s) (${size}) generated in ${duration}ms`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        case 'save_chat_image_as_asset': {
          const pathResult = resultPayload?.path ?? '';
          const msg = `💾 save_chat_image_as_asset: ${pathResult} (${duration}ms)`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
          break;
        }
        default: {
          const msg = `🔧 ${request.name} executada em ${duration}ms`;
          options.outputChannel.appendLine(msg);
          options.notify?.(msg);
        }
      }

      results.push({
        name: request.name,
        success: true,
        result: resultPayload,
        durationMs: duration,
        runId: metadata?.runId || Date.now(),
        phase: metadata?.phase,
        cause: metadata?.cause
      });

      // Reportar status da tool para o app Flutter
      try {
        if (options.sidebarProvider && options.sidebarProvider._remoteControlService) {
          const remoteControlService = options.sidebarProvider._remoteControlService as RemoteControlService;
          // Envia um resumo amigável do que a tool fez (para o widget do Flutter)
          // Ex: "read_file main.dart" ao inv e9s de apenas "read_file".
          const args = request.args ?? {};
          const toolSummary = buildRemoteToolSummary(request.name, args, resultPayload);

          await remoteControlService.reportToolStatus(
            request.name,
            true,
            {
              durationMs: duration,
              summary: toolSummary,
              args,
              result: resultPayload,
              phase: metadata?.phase,
              cause: metadata?.cause
            },
            options.chatId,
            options.toolCallId,
            options.messageId
          );
        }
      } catch (reportError) {
        console.error(`[RemoteControl] Failed to report tool status for ${request.name}:`, reportError);
      }
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      console.error(`❌ Tool ${request.name} falhou após ${duration}ms:`, message);
      const msg = `⚠️ ${request.name} falhou: ${message}`;
      options.outputChannel.appendLine(msg);
      options.notify?.(msg);
      
      results.push({
        name: request.name,
        success: false,
        error: message,
        durationMs: duration,
        runId: metadata?.runId || Date.now(),
        phase: metadata?.phase,
        cause: metadata?.cause
      });

      // Reportar status da tool (erro) para o app Flutter
      try {
        if (options.sidebarProvider && options.sidebarProvider._remoteControlService) {
          const remoteControlService = options.sidebarProvider._remoteControlService as RemoteControlService;
          const args = request.args ?? {};
          const toolSummary = buildRemoteToolSummary(request.name, args, undefined);

          await remoteControlService.reportToolStatus(
            request.name,
            false,
            {
              durationMs: duration,
              summary: toolSummary,
              args,
              error: message,
              phase: metadata?.phase,
              cause: metadata?.cause
            },
            options.chatId,
            options.toolCallId,
            options.messageId
          );
        }
      } catch (reportError) {
        console.error(`[RemoteControl] Failed to report tool error status for ${request.name}:`, reportError);
      }
    }
  }

  console.log(`✅ executeToolRequests concluído: ${results.length} resultado(s) retornado(s)`);
  
  // Garantir que sempre retornamos algo, mesmo se algo der errado
  if (results.length === 0 && requests.length > 0) {
    console.warn(`⚠️ Nenhum resultado retornado para ${requests.length} requisição(ões), criando resultados de erro`);
    for (const request of requests) {
      results.push({
        name: request.name,
        success: false,
        error: 'Tool não retornou resultado (possível travamento)',
        durationMs: 0,
        runId: metadata?.runId || Date.now(),
        phase: metadata?.phase,
        cause: metadata?.cause
      });
    }
  }
  
  return results;
}