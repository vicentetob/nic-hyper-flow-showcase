import { spawn } from 'child_process';
import * as fs from 'fs';
import { ExecuteToolOptions } from './types';
import { getCanonizedWorkspaceRootSync, resolveWorkspacePath } from './utils';
import { runCommandManager } from './runCommandManager';
import { getBlockedCommandReason } from './commandSecurity';

const MAX_OUTPUT_LENGTH = 30000;
const MAX_TOTAL_OUTPUT_LENGTH = 1_000_000;

function paginateOutput(output: string): { text: string; truncated: boolean; remaining: number } {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return { text: output, truncated: false, remaining: 0 };
  }

  const chunk = output.slice(0, MAX_OUTPUT_LENGTH);
  const remaining = output.length - MAX_OUTPUT_LENGTH;
  return {
    text: `${chunk}\n\n... [PAGINADO: ${remaining} caracteres adicionais disponíveis neste resultado bruto]`,
    truncated: true,
    remaining
  };
}

export async function executeRunCommand(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  // Compat: a definição da tool expõe `cmd`, mas a runtime também aceita `command`.
  // Isso elimina a falha na primeira chamada quando o modelo alterna o nome do campo.
  const command = args?.cmd ?? args?.command;
  if (!command || typeof command !== 'string') {
    throw new Error('run_command requer args.cmd (string)');
  }

  const blockedReason = getBlockedCommandReason(command);
  if (blockedReason) {
    return {
      command,
      stdout: '',
      stderr: `Security Restriction: ${blockedReason}`,
      exitCode: -1,
      success: false,
      error: `Security Restriction: ${blockedReason}`,
    };
  }

  // Usa workspace root canonizado (Git root se disponível)
  const workspaceRoot = getCanonizedWorkspaceRootSync(options.workspaceFolder);

  // Se um path foi fornecido, resolve ele em relação ao workspace root
  let cwd = workspaceRoot;
  if (args.path) {
    const resolvedUri = resolveWorkspacePath(options.workspaceFolder, args.path);
    cwd = resolvedUri.fsPath;

    // Verificação de sanidade: o diretório de execução existe?
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`Diretório de execução inválido: "${args.path}"`);
    }
  }

  // Intercept for approval
  const toolId = options.toolCallId || `run_cmd_${Date.now()}`;
  try {
    const { approved, userMessage } = await runCommandManager.requestApproval(toolId, command, 'run_command');
    if (!approved) {
      return {
        command,
        stdout: '',
        stderr: 'Command cancelled by user.',
        exitCode: -1,
        success: false,
        error: 'User denied command execution.',
        ...(userMessage ? { userMessage } : {}),
      };
    }
  } catch (err: any) {
    return {
      command,
      stdout: '',
      stderr: err.message || 'Approval error',
      exitCode: -1,
      success: false,
      error: err.message || 'Approval error'
    };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let totalChars = 0;
    const CHECK_INTERVAL = 100; // Verificar a cada ~100 caracteres
    let lastCheckAt = 0;

    // Usa shell: true para que o Node.js lide com as aspas e espaços de forma nativa e robusta.
    // No Windows, o Node utiliza 'cmd.exe /d /s /c', o que preserva aspas aninhadas (essencial para git commit -m "texto").
    const proc = spawn(command, [], {
      shell: true,
      cwd,
      env: process.env,
      signal: options.signal,
    });
    
    // Register process for management (Stop button)
    runCommandManager.registerProcess(toolId, proc);

    // Timeout de 180 segundos (triplicado)
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      const stdoutPage = paginateOutput(stdout);
      const stderrPage = paginateOutput(stderr);
      resolve({
        command,
        stdout: stdoutPage.text,
        stderr: stderrPage.text,
        exitCode: -1,
        success: false,
        error: 'Timeout: comando excedeu 180 segundos',
        stdoutTruncated: stdoutPage.truncated,
        stderrTruncated: stderrPage.truncated,
        stdoutRemainingChars: stdoutPage.remaining,
        stderrRemainingChars: stderrPage.remaining
      });
    }, 180000);

    // Função para verificar se atingiu o limite total de buffer e parar o processo
    const checkAndStopIfNeeded = () => {
      if (totalChars >= MAX_TOTAL_OUTPUT_LENGTH) {
        proc.kill('SIGTERM');
        clearTimeout(timeout);
        const stdoutPage = paginateOutput(stdout);
        const stderrPage = paginateOutput(stderr);
        resolve({
          command,
          stdout: stdoutPage.text,
          stderr: stderrPage.text,
          exitCode: -1,
          success: false,
          error: `Comando interrompido: output excedeu ${MAX_TOTAL_OUTPUT_LENGTH} caracteres`,
          stdoutTruncated: stdoutPage.truncated,
          stderrTruncated: stderrPage.truncated,
          stdoutRemainingChars: stdoutPage.remaining,
          stderrRemainingChars: stderrPage.remaining
        });
        return true;
      }
      return false;
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      totalChars += chunk.length;
      
      // Verificar a cada ~100 caracteres para não pesar o processamento
      if (totalChars - lastCheckAt >= CHECK_INTERVAL) {
        lastCheckAt = totalChars;
        if (checkAndStopIfNeeded()) {
          return; // Processo já foi terminado
        }
      }
      
      if (options.onStreamOutput) options.onStreamOutput(chunk);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      totalChars += chunk.length;
      
      // Verificar a cada ~100 caracteres para não pesar o processamento
      if (totalChars - lastCheckAt >= CHECK_INTERVAL) {
        lastCheckAt = totalChars;
        if (checkAndStopIfNeeded()) {
          return; // Processo já foi terminado
        }
      }
      
      if (options.onStreamOutput) options.onStreamOutput(chunk);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const stdoutPage = paginateOutput(stdout || '');
      const stderrPage = paginateOutput(stderr || '');
      resolve({
        command,
        stdout: stdoutPage.text,
        stderr: stderrPage.text,
        exitCode: code,
        success: code === 0,
        stdoutTruncated: stdoutPage.truncated,
        stderrTruncated: stderrPage.truncated,
        stdoutRemainingChars: stdoutPage.remaining,
        stderrRemainingChars: stderrPage.remaining
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      const stdoutPage = paginateOutput(stdout || '');
      const stderrPage = paginateOutput(stderr || '');
      resolve({
        command,
        stdout: stdoutPage.text,
        stderr: stderrPage.text,
        exitCode: -1,
        success: false,
        error: err.message,
        stdoutTruncated: stdoutPage.truncated,
        stderrTruncated: stderrPage.truncated,
        stdoutRemainingChars: stdoutPage.remaining,
        stderrRemainingChars: stderrPage.remaining
      });
    });
  });
}
