import * as vscode from 'vscode';
import { terminalSessionManager } from '../../tools/terminal_session_manager';

class VscodeTerminalBridge {
  private terminals = new Map<string, vscode.Terminal>();

  /** Cria ou exibe o terminal VS Code nativo para uma sessão existente. */
  createOrShow(sessionId: string): void {
    const existing = this.terminals.get(sessionId);
    if (existing) {
      existing.show(false);
      return;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();

    let unsubscribe: (() => void) | undefined;

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,

      open: () => {
        // Escreve buffer histórico (últimos 50k chars)
        const history = terminalSessionManager.getRecentBuffer(sessionId, 50000);
        if (history) {
          writeEmitter.fire(history.replace(/\r?\n/g, '\r\n'));
        }

        // Assina output futuro (chunks brutos com ANSI)
        unsubscribe = terminalSessionManager.addRawOutputListener(sessionId, (chunk) => {
          writeEmitter.fire(chunk.replace(/\r?\n/g, '\r\n'));
        });

        // Avisa se a sessão já foi encerrada
        const sessions = terminalSessionManager.list();
        const snap = sessions.find(s => s.sessionId === sessionId);
        if (snap && !snap.alive) {
          writeEmitter.fire(`\r\n\x1b[33m[sessão encerrada: código ${snap.exitCode ?? '?'}]\x1b[0m\r\n`);
        }
      },

      close: () => {
        unsubscribe?.();
        unsubscribe = undefined;
        writeEmitter.dispose();
        closeEmitter.dispose();
        this.terminals.delete(sessionId);
      },

      handleInput: (data: string) => {
        terminalSessionManager.writeRaw(sessionId, data);
      },
    };

    const sessions = terminalSessionManager.list();
    const snap = sessions.find(s => s.sessionId === sessionId);
    const label = snap
      ? `${snap.command.slice(0, 40)} [${sessionId}]`
      : sessionId;

    const terminal = vscode.window.createTerminal({ name: label, pty });
    this.terminals.set(sessionId, terminal);
    terminal.show(false);
  }

  /** Remove o terminal VS Code para uma sessão (sem encerrar o processo). */
  dispose(sessionId: string): void {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(sessionId);
    }
  }
}

export const vscodeTerminalBridge = new VscodeTerminalBridge();
