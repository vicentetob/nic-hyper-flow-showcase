import * as fs from 'fs';
import { ChildProcessWithoutNullStreams, spawn as spawnChildProcess } from 'child_process';
import * as vscode from 'vscode';
import type { IPty } from 'node-pty';
import { spawn as spawnPty } from 'node-pty';
import { runCommandManager } from './runCommandManager';
import { getCanonizedWorkspaceRootSync, resolveWorkspacePath } from './utils';
import { getBlockedCommandReason } from './commandSecurity';

const DEFAULT_COLS = 220;
const DEFAULT_ROWS = 50;
const DEFAULT_INITIAL_WAIT_MS = 1200;
const DEFAULT_READ_WAIT_MS = 800;
const DEFAULT_SEND_WAIT_MS = 1000;
const DEFAULT_IDLE_GRACE_MS = 250;
const EXITED_SESSION_RETENTION_MS = 6 * 60 * 60 * 1000;
const MAX_CHARS_PER_READ = 30000;
const MAX_BUFFER_CHARS = 1_000_000;
const LAST_OUTPUT_PREVIEW_CHARS = 240;
const MAX_SESSIONS = 24;
const DEFAULT_SHELL = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';

type TerminalSessionState = 'starting' | 'running' | 'waiting_input' | 'exited' | 'killed';
type TerminalBackend = 'pty' | 'process';

export interface TerminalSessionSnapshot {
  sessionId: string;
  command: string;
  cwd: string;
  shell: string;
  pid: number;
  alive: boolean;
  state: TerminalSessionState;
  waitingInput: boolean;
  exitCode: number | null;
  signalCode: number | null;
  createdAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  ageMs: number;
  idleMs: number;
  retentionExpiresAt: string | null;
  pendingOutputChars: number;
  totalOutputChars: number;
  lastOutputPreview: string;
  backend: TerminalBackend;
}

interface TerminalSession {
  id: string;
  backend: TerminalBackend;
  pty?: IPty;
  process?: ChildProcessWithoutNullStreams;
  command: string;
  cwd: string;
  shell: string;
  createdAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  retentionExpiresAt: number | null;
  outputBuffer: string;
  readOffset: number;
  totalOutputChars: number;
  alive: boolean;
  state: TerminalSessionState;
  waitingInput: boolean;
  exitCode: number | null;
  signalCode: number | null;
  disposed: boolean;
  lastOutputPreview: string;
  streamOutput?: (chunk: string) => void;
  rawOutputListeners: Set<(chunk: string) => void>;
  commandInFlight: boolean;
  lastInputAt: number | null;
  writeChain: Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B[@-_]/g, '');
}

function sanitizeOutput(value: string): string {
  return stripAnsi(normalizeLineEndings(value)).replace(/\u0000/g, '');
}

function decodeControlInput(input: string): string {
  return input
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizeInputForPlatform(input: string): string {
  if (process.platform !== 'win32') {
    return input;
  }

  return input.replace(/\r?\n/g, '\r\n').replace(/\r(?!\n)/g, '\r\n');
}

function ensureCommandTerminator(input: string): string {
  if (!input) return input;

  if (process.platform === 'win32') {
    return /\r\n$/.test(input) ? input : `${input.replace(/[\r\n]+$/, '')}\r\n`;
  }

  return /\n$/.test(input) ? input : `${input.replace(/[\r\n]+$/, '')}\n`;
}

function looksLikePlainCommandInput(input: string): boolean {
  if (!input) return false;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(input)) return false;
  if (/\r|\n/.test(input)) return false;
  return input.trim().length > 0;
}

function buildShellArgs(command?: string): string[] {
  if (!command || !command.trim()) {
    return ['/d'];
  }

  return ['/d', '/s', '/c', command];
}

function getWorkspaceRoot(workspaceFolder: vscode.WorkspaceFolder): string {
  return getCanonizedWorkspaceRootSync(workspaceFolder);
}

function buildLastOutputPreview(value: string): string {
  const sanitized = sanitizeOutput(value).trim();
  if (!sanitized) return '';
  if (sanitized.length <= LAST_OUTPUT_PREVIEW_CHARS) return sanitized;
  return `...${sanitized.slice(-LAST_OUTPUT_PREVIEW_CHARS)}`;
}

function detectWaitingInput(value: string): boolean {
  const text = sanitizeOutput(value).trim();
  if (!text) return false;

  const patterns = [
    /\[[Yy]\/n\]/,
    /\[[Yy]\/N\]/,
    /\[[Nn]\/y\]/,
    /\[[Nn]\/Y\]/,
    /press any key/i,
    /select an option/i,
    /select option/i,
    /choose an option/i,
    /enter choice/i,
    /enter your choice/i,
    /pick one/i,
    /continue\?/i,
    /confirm\?/i,
    /are you sure\?/i,
    /do you want to continue\?/i,
    /waiting for input/i,
    /type .* and press enter/i,
  ];

  if (patterns.some(pattern => pattern.test(text))) {
    return true;
  }

  const lastLine = text.split('\n').map(line => line.trim()).filter(Boolean).pop() || '';
  if (!lastLine) return false;

  if (/[:>]$/.test(lastLine)) return true;
  if (/\?$/.test(lastLine)) return true;
  if (/^>\s*$/.test(lastLine)) return true;
  if (/^(choice|option|selection|input)\s*[:>]$/i.test(lastLine)) return true;

  return false;
}

class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();

  private pruneExpiredSessions(): void {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (!session.alive && session.retentionExpiresAt && session.retentionExpiresAt <= now) {
        this.disposeSession(session.id);
      }
    }
  }

  private ensureSessionLimit(): void {
    this.pruneExpiredSessions();

    if (this.sessions.size < MAX_SESSIONS) return;

    const oldest = [...this.sessions.values()]
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
      .find(session => !session.alive);

    if (oldest) {
      this.disposeSession(oldest.id);
      return;
    }

    throw new Error(`Limite de sessões de terminal atingido (${MAX_SESSIONS}). Encerre uma sessão antes de abrir outra.`);
  }

  private getSessionOrThrow(sessionId: string): TerminalSession {
    this.pruneExpiredSessions();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sessão '${sessionId}' não encontrada.`);
    }
    return session;
  }

  private updateDerivedState(session: TerminalSession, recentChunk?: string): void {
    const source = typeof recentChunk === 'string' && recentChunk.length > 0
      ? recentChunk
      : session.outputBuffer.slice(Math.max(0, session.outputBuffer.length - 4000));

    session.lastOutputPreview = buildLastOutputPreview(source || session.outputBuffer);
    session.waitingInput = detectWaitingInput(source);

    if (!session.alive) {
      session.state = session.signalCode !== null ? 'killed' : 'exited';
      return;
    }

    if (session.waitingInput) {
      session.state = 'waiting_input';
      return;
    }

    if (session.totalOutputChars === 0) {
      session.state = 'starting';
      return;
    }

    session.state = 'running';
  }

  private appendOutput(session: TerminalSession, chunk: string): void {
    if (!chunk) return;
    session.outputBuffer += chunk;
    session.totalOutputChars += chunk.length;
    session.lastActivityAt = Date.now();
    session.retentionExpiresAt = null;
    session.commandInFlight = false;

    this.updateDerivedState(session, chunk);

    for (const listener of session.rawOutputListeners) {
      try { listener(chunk); } catch { /* noop */ }
    }

    if (session.streamOutput) {
      session.streamOutput(sanitizeOutput(chunk));
    }

    if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
      const overflow = session.outputBuffer.length - MAX_BUFFER_CHARS;
      session.outputBuffer = session.outputBuffer.slice(overflow);
      session.readOffset = Math.max(0, session.readOffset - overflow);
    }
  }

  private drainOutput(session: TerminalSession): string {
    const unread = session.outputBuffer.slice(session.readOffset);
    if (unread.length <= MAX_CHARS_PER_READ) {
      session.readOffset = session.outputBuffer.length;
      return unread;
    }

    const chunk = unread.slice(0, MAX_CHARS_PER_READ);
    session.readOffset += chunk.length;
    const remaining = session.outputBuffer.length - session.readOffset;
    return `${chunk}\n\n... [PAGINADO: ${remaining} caracteres ainda disponíveis; chame terminal_read novamente para continuar]`;
  }

  private async collectOutput(session: TerminalSession, waitMs: number): Promise<string> {
    const deadline = Date.now() + Math.max(0, waitMs);
    let lastObservedLength = session.outputBuffer.length;

    while (Date.now() < deadline && session.alive) {
      await wait(Math.min(DEFAULT_IDLE_GRACE_MS, Math.max(0, deadline - Date.now())));
      const currentLength = session.outputBuffer.length;
      if (currentLength !== lastObservedLength) {
        lastObservedLength = currentLength;
        continue;
      }
      break;
    }

    this.updateDerivedState(session);
    return sanitizeOutput(this.drainOutput(session)) || '';
  }

  private markSessionExited(session: TerminalSession, exitCode: number | null, signalCode: number | null): void {
    session.alive = false;
    session.exitCode = exitCode;
    session.signalCode = signalCode;
    session.endedAt = Date.now();
    session.lastActivityAt = session.endedAt;
    session.retentionExpiresAt = session.endedAt + EXITED_SESSION_RETENTION_MS;
    session.commandInFlight = false;
    this.updateDerivedState(session);
  }

  private snapshot(session: TerminalSession): TerminalSessionSnapshot {
    const now = Date.now();
    return {
      sessionId: session.id,
      command: session.command,
      cwd: session.cwd,
      shell: session.shell,
      pid: session.backend === 'pty' ? (session.pty?.pid ?? -1) : (session.process?.pid ?? -1),
      alive: session.alive,
      state: session.state,
      waitingInput: session.waitingInput,
      exitCode: session.exitCode,
      signalCode: session.signalCode,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivityAt: new Date(session.lastActivityAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      ageMs: now - session.createdAt,
      idleMs: now - session.lastActivityAt,
      retentionExpiresAt: session.retentionExpiresAt ? new Date(session.retentionExpiresAt).toISOString() : null,
      pendingOutputChars: Math.max(0, session.outputBuffer.length - session.readOffset),
      totalOutputChars: session.totalOutputChars,
      lastOutputPreview: session.lastOutputPreview,
      backend: session.backend,
    };
  }

  private buildResponse(session: TerminalSession, output: string): any {
    this.updateDerivedState(session, output);
    return {
      session_id: session.id,
      output,
      alive: session.alive,
      state: session.state,
      waitingInput: session.waitingInput,
      lastOutputPreview: session.lastOutputPreview,
      exitCode: session.exitCode,
      signalCode: session.signalCode,
      backend: session.backend,
      snapshot: this.snapshot(session),
    };
  }

  async start(args: {
    session_id: string;
    command: string;
    cwd?: string;
    shell?: string;
    cols?: number;
    rows?: number;
    initial_wait_ms?: number;
    skipApproval?: boolean;
  }, options: { workspaceFolder: vscode.WorkspaceFolder; onStreamOutput?: (chunk: string) => void; toolCallId?: string }): Promise<any> {
    const sessionId = String(args.session_id || '').trim();
    const command = String(args.command || '').trim();
    const shellCommand = process.platform === 'win32' ? '' : command;

    if (!sessionId) throw new Error('terminal_start requer session_id.');
    if (!command) throw new Error('terminal_start requer command.');
    if (this.sessions.has(sessionId)) {
      // If a session with the same ID already exists, return its current state instead
      // of throwing. This avoids repeated attempts to start the same persistent
      // session (e.g. 'persistent-terminal') and reduces races where callers try
      // to start the same session multiple times.
      const existing = this.sessions.get(sessionId)!;
      // Drain any unread output to return a meaningful response to the caller.
      const output = this.drainOutput(existing);
      return this.buildResponse(existing, sanitizeOutput(output));
    }

    this.ensureSessionLimit();

    const blockedReason = getBlockedCommandReason(command);
    if (blockedReason) {
      return {
        session_id: sessionId,
        output: '',
        alive: false,
        state: 'killed' as TerminalSessionState,
        waitingInput: false,
        lastOutputPreview: '',
        error: `Security Restriction: ${blockedReason}`,
      };
    }

    const workspaceRoot = getWorkspaceRoot(options.workspaceFolder);
    const cwd = args.cwd
      ? resolveWorkspacePath(options.workspaceFolder, args.cwd).fsPath
      : workspaceRoot;

    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`Diretório de execução inválido: "${args.cwd ?? cwd}"`);
    }

    const shell = DEFAULT_SHELL;
    const cols = Number.isFinite(args.cols) ? Math.max(40, Number(args.cols)) : DEFAULT_COLS;
    const rows = Number.isFinite(args.rows) ? Math.max(10, Number(args.rows)) : DEFAULT_ROWS;
    const initialWaitMs = Number.isFinite(args.initial_wait_ms)
      ? Math.max(0, Number(args.initial_wait_ms))
      : DEFAULT_INITIAL_WAIT_MS;

    const toolId = options.toolCallId || `terminal_start_${sessionId}_${Date.now()}`;
    if (!args.skipApproval) {
      const { approved, userMessage } = await runCommandManager.requestApproval(toolId, command, 'terminal_start');
      if (!approved) {
        return {
          session_id: sessionId,
          output: '',
          alive: false,
          state: 'killed' as TerminalSessionState,
          waitingInput: false,
          lastOutputPreview: '',
          error: 'User denied terminal session execution.',
          ...(userMessage ? { userMessage } : {}),
        };
      }
    }

    if (process.platform === 'win32') {
      const proc = spawnChildProcess(shell, buildShellArgs(shellCommand), {
        cwd,
        env: { ...process.env },
        stdio: 'pipe',
        windowsHide: true,
      });

      const session: TerminalSession = {
        id: sessionId,
        backend: 'process',
        process: proc,
        command,
        cwd,
        shell,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        endedAt: null,
        retentionExpiresAt: null,
        outputBuffer: '',
        readOffset: 0,
        totalOutputChars: 0,
        alive: true,
        state: 'starting',
        waitingInput: false,
        exitCode: null,
        signalCode: null,
        disposed: false,
        lastOutputPreview: '',
        streamOutput: options.onStreamOutput,
        rawOutputListeners: new Set(),
        commandInFlight: false,
        lastInputAt: null,
        writeChain: Promise.resolve(),
      };

      proc.stdout.on('data', (data: Buffer | string) => this.appendOutput(session, data.toString()));
      proc.stderr.on('data', (data: Buffer | string) => this.appendOutput(session, data.toString()));
      proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        this.markSessionExited(session, code, signal ? 1 : null);
      });
      proc.on('error', (error: Error) => {
        this.appendOutput(session, `\n[terminal error] ${error.message}\n`);
        this.markSessionExited(session, -1, null);
      });

      this.sessions.set(sessionId, session);

      if (command) {
        const normalizedCommand = ensureCommandTerminator(normalizeInputForPlatform(command));
        session.commandInFlight = true;
        session.lastInputAt = Date.now();
        session.process?.stdin.write(normalizedCommand);
      }

      const output = await this.collectOutput(session, initialWaitMs);
      return this.buildResponse(session, output);
    }

    let pty: IPty;
    try {
      pty = spawnPty(shell, buildShellArgs(command), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        session_id: sessionId,
        output: '',
        alive: false,
        state: 'killed' as TerminalSessionState,
        waitingInput: false,
        lastOutputPreview: '',
        error: `Failed to start persistent terminal: ${message}`,
      };
    }

    const session: TerminalSession = {
      id: sessionId,
      backend: 'pty',
      pty,
      command,
      cwd,
      shell,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      endedAt: null,
      retentionExpiresAt: null,
      outputBuffer: '',
      readOffset: 0,
      totalOutputChars: 0,
      alive: true,
      state: 'starting',
      waitingInput: false,
      exitCode: null,
      signalCode: null,
      disposed: false,
      lastOutputPreview: '',
      streamOutput: options.onStreamOutput,
      rawOutputListeners: new Set(),
      commandInFlight: false,
      lastInputAt: null,
      writeChain: Promise.resolve(),
    };

    pty.onData((data: string) => this.appendOutput(session, data));
    pty.onExit((event: { exitCode: number; signal?: number }) => {
      this.markSessionExited(session, event.exitCode, event.signal ?? null);
    });

    this.sessions.set(sessionId, session);
    const output = await this.collectOutput(session, initialWaitMs);
    return this.buildResponse(session, output);
  }

  async read(args: { session_id: string; wait_ms?: number }): Promise<any> {
    const session = this.getSessionOrThrow(String(args.session_id || '').trim());
    const waitMs = Number.isFinite(args.wait_ms) ? Math.max(0, Number(args.wait_ms)) : DEFAULT_READ_WAIT_MS;
    const output = await this.collectOutput(session, waitMs);
    return this.buildResponse(session, output);
  }

  async send(args: { session_id: string; input: string; wait_ms?: number }): Promise<any> {
    const session = this.getSessionOrThrow(String(args.session_id || '').trim());
    if (!session.alive) {
      throw new Error(`Sessão '${session.id}' já foi encerrada.`);
    }

    const rawInput = decodeControlInput(String(args.input ?? ''));
    const normalizedInput = normalizeInputForPlatform(rawInput);
    const input = looksLikePlainCommandInput(normalizedInput)
      ? ensureCommandTerminator(normalizedInput)
      : normalizedInput;
    const waitMs = Number.isFinite(args.wait_ms) ? Math.max(0, Number(args.wait_ms)) : DEFAULT_SEND_WAIT_MS;

    session.writeChain = session.writeChain.then(async () => {
      if (!session.alive) {
        throw new Error(`Sessão '${session.id}' já foi encerrada.`);
      }

      if (session.commandInFlight) {
        await wait(DEFAULT_IDLE_GRACE_MS);
      }

      session.waitingInput = false;
      session.state = 'running';
      session.commandInFlight = true;
      session.lastInputAt = Date.now();
      session.lastActivityAt = session.lastInputAt;

      if (session.backend === 'process') {
        session.process?.stdin.write(input);
      } else {
        session.pty?.write(input);
      }
    });

    await session.writeChain;

    const output = await this.collectOutput(session, waitMs);
    return this.buildResponse(session, output);
  }

  async stop(args: { session_id: string; signal?: 'SIGINT' | 'SIGTERM' | 'SIGKILL'; wait_ms?: number; force?: boolean }): Promise<any> {
    const session = this.getSessionOrThrow(String(args.session_id || '').trim());
    const signal = args.signal || 'SIGTERM';
    const waitMs = Number.isFinite(args.wait_ms) ? Math.max(0, Number(args.wait_ms)) : DEFAULT_SEND_WAIT_MS;
    const force = !!args.force || signal === 'SIGKILL';

    if (session.alive) {
      if (session.backend === 'process') {
        if (signal === 'SIGINT' && !force) {
          session.process?.stdin.write('\u0003');
        } else {
          try {
            session.process?.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
          } catch {
            session.process?.kill();
          }
        }
      } else {
        if (signal === 'SIGINT' && !force) {
          session.pty?.write('\u0003');
        } else {
          try {
            session.pty?.kill();
          } catch {
            // noop
          }
        }
      }
    }

    if (force && session.alive) {
      this.markSessionExited(session, null, signal === 'SIGKILL' ? 9 : null);
      session.retentionExpiresAt = Date.now() + EXITED_SESSION_RETENTION_MS;
    }

    const output = waitMs > 0 ? await this.collectOutput(session, waitMs) : sanitizeOutput(this.drainOutput(session)) || '';
    return this.buildResponse(session, output);
  }

  list(): TerminalSessionSnapshot[] {
    this.pruneExpiredSessions();
    return [...this.sessions.values()]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map(session => this.snapshot(session));
  }

  /** Registra um listener que recebe chunks brutos (com ANSI) conforme chegam.
   *  Retorna função de remoção (unsubscribe). */
  addRawOutputListener(sessionId: string, listener: (chunk: string) => void): () => void {
    const session = this.sessions.get(sessionId.trim());
    if (!session) return () => {};
    session.rawOutputListeners.add(listener);
    return () => session.rawOutputListeners.delete(listener);
  }

  /** Escreve dados diretamente no PTY/process sem overhead de wait/chain. */
  writeRaw(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId.trim());
    if (!session?.alive) return;
    if (session.backend === 'process') {
      session.process?.stdin.write(data);
    } else {
      session.pty?.write(data);
    }
  }

  /** Retorna os últimos maxChars do buffer de output (para display inicial no terminal). */
  getRecentBuffer(sessionId: string, maxChars = 50000): string {
    const session = this.sessions.get(sessionId.trim());
    if (!session) return '';
    const buf = session.outputBuffer;
    return buf.length > maxChars ? buf.slice(buf.length - maxChars) : buf;
  }

  private disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.disposed) return;
    session.disposed = true;
    try {
      if (session.alive) {
        if (session.backend === 'process') {
          session.process?.kill();
        } else {
          session.pty?.kill();
        }
      }
    } catch {
      // noop
    }
    this.sessions.delete(sessionId);
  }
}

export const terminalSessionManager = new TerminalSessionManager();
