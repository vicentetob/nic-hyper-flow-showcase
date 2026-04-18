import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ExecuteToolOptions } from './types';

const MAX_RAW_OUTPUT = 200_000;
const TIMEOUT_MS     = 0; // sem timeout artificial; o usuário precisa ver a sessão viva na UI
const MAX_FILE_CHARS = 50_000;
const CLAUDE_STREAM_FLUSH_MS = 700;
const CLAUDE_STREAM_MAX_CHARS = 1200;

const SAFETY_INSTRUCTION = `
RESTRIÇÕES CRÍTICAS — siga sempre, sem exceção:
- NUNCA execute "firebase deploy --only functions" nem variações com --force. O repositório pode não conter todas as Cloud Functions do projeto e um deploy parcial derrubaria funções em produção.
- NUNCA delete arquivos de configuração sensíveis (.env, .env.*, firebase.json, .firebaserc, google-services.json, GoogleService-Info.plist).
- NUNCA faça push direto para branches main/master/production sem instrução explícita.
- NUNCA rode scripts de migração de banco de dados sem antes listar o que será alterado.
- Se uma tarefa exigir uma ação destrutiva ou irreversível, descreva o que faria no <agent_summary> em vez de executar.
`.trim();

const SUMMARY_INSTRUCTION = `

---
IMPORTANTE — ao concluir sua tarefa, finalize sua resposta com exatamente este bloco XML (sem markdown, sem backticks):

<agent_summary>
<success>true ou false</success>
<what_was_done>Resumo de 1-3 frases do que foi feito</what_was_done>
<files_modified>
  <file><path>caminho/arquivo.ts</path><snippet>primeiras linhas da mudança principal</snippet></file>
</files_modified>
<errors>
  <e>descrição do erro se houver</e>
</errors>
<next_suggestions>
  <suggestion>próxima ação sugerida se aplicável</suggestion>
</next_suggestions>
</agent_summary>`;

interface RunningJob {
  proc:      ChildProcess;
  stdout:    string;
  stderr:    string;
  done:      boolean;
  result:    CallClaudeResult | null;
  startedAt: number;
  meta?: ClaudeSessionMeta;
}

interface ClaudeSessionMeta {
  toolName: string;
  toolCallId?: string;
  messageId?: string;
  chatId?: string;
  sessionId?: string | null;
  jobId?: string;
  promptPreview?: string;
}

const runningJobs = new Map<string, RunningJob>();

interface FileRef {
  path:       string;
  startLine?: number;
  endLine?:   number;
}

interface ClaudeJsonResult {
  type:            string;
  subtype:         string;
  is_error:        boolean;
  result:          string;
  session_id?:     string;
  cost_usd?:       number;
  total_cost_usd?: number;
  duration_ms?:    number;
  num_turns?:      number;
}

interface AgentSummary {
  success:          boolean;
  what_was_done:    string;
  files_modified:   Array<{ path: string; snippet: string }>;
  errors:           string[];
  next_suggestions: string[];
}

interface CallClaudeResult {
  success:     boolean;
  summary:     AgentSummary | null;
  raw_result:  string;
  session_id:  string | null;
  cost_usd:    number | null;
  duration_ms: number | null;
  num_turns:   number | null;
  error?:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileSnippet(filePath: string, startLine?: number, endLine?: number): string {
  try {
    const raw   = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    const total = lines.length;
    const from  = typeof startLine === 'number' ? Math.max(1, startLine)   : 1;
    const to    = typeof endLine   === 'number' ? Math.min(endLine, total) : total;
    const slice = lines.slice(from - 1, to).join('\n');
    const content = slice.length > MAX_FILE_CHARS
      ? slice.slice(0, MAX_FILE_CHARS) + `\n... [TRUNCADO: ${slice.length - MAX_FILE_CHARS} chars restantes]`
      : slice;
    const rangeLabel = (from === 1 && to === total)
      ? `(completo, ${total} linhas)`
      : `(linhas ${from}-${to} de ${total})`;
    return [
      `### ${filePath} ${rangeLabel}`,
      '<file_content>',
      content,
      '</file_content>'
    ].join('\n');
  } catch (err: any) {
    return `### ${filePath}\n[ERRO ao ler arquivo: ${err.message}]`;
  }
}

function buildFilesBlock(files: FileRef[], cwd: string): string {
  if (!files || files.length === 0) return '';
  const blocks = files.map((f) => {
    const absPath = path.isAbsolute(f.path) ? f.path : path.join(cwd, f.path);
    return readFileSnippet(absPath, f.startLine, f.endLine);
  });
  return `\n\n---\nARQUIVOS RELEVANTES (leia antes de agir):\n\n${blocks.join('\n\n')}`;
}

function parseAgentSummary(text: string): AgentSummary | null {
  const match = text.match(/<agent_summary>([\s\S]*?)<\/agent_summary>/);
  if (!match) return null;
  const xml = match[1];

  const success       = /<success>\s*true\s*<\/success>/i.test(xml);
  const whatMatch     = xml.match(/<what_was_done>([\s\S]*?)<\/what_was_done>/);
  const what_was_done = whatMatch ? whatMatch[1].trim() : '';

  const files_modified: AgentSummary['files_modified'] = [];
  const fileRe = /<file>[\s\S]*?<path>([\s\S]*?)<\/path>[\s\S]*?<snippet>([\s\S]*?)<\/snippet>[\s\S]*?<\/file>/g;
  let fm: RegExpExecArray | null;
  while ((fm = fileRe.exec(xml)) !== null) {
    files_modified.push({ path: fm[1].trim(), snippet: fm[2].trim() });
  }

  const errors: string[] = [];
  const errRe = /<e>([\s\S]*?)<\/e>/g;
  let em: RegExpExecArray | null;
  while ((em = errRe.exec(xml)) !== null) {
    const e = em[1].trim(); if (e) errors.push(e);
  }

  const next_suggestions: string[] = [];
  const suggRe = /<suggestion>([\s\S]*?)<\/suggestion>/g;
  let sm: RegExpExecArray | null;
  while ((sm = suggRe.exec(xml)) !== null) {
    const s = sm[1].trim(); if (s) next_suggestions.push(s);
  }

  return { success, what_was_done, files_modified, errors, next_suggestions };
}

function parseClaudeOutput(stdout: string, stderr: string, exitCode: number | null): CallClaudeResult {
  let claudeJson: ClaudeJsonResult | null = null;
  try {
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && 'result' in parsed) {
          claudeJson = parsed as ClaudeJsonResult;
          break;
        }
      } catch {
        // tenta linha anterior
      }
    }

    if (!claudeJson) {
      const jsonStart = stdout.lastIndexOf('{');
      if (jsonStart !== -1) claudeJson = JSON.parse(stdout.slice(jsonStart));
    }
  } catch { /* não era JSON */ }

  if (!claudeJson) return buildErrorResult(stderr || stdout || `Claude Code saiu com código ${exitCode}`, stdout, stderr);
  if (claudeJson.is_error || claudeJson.subtype?.includes('error')) return buildErrorResult(claudeJson.result || 'Erro desconhecido', stdout, stderr, claudeJson);

  const resultText  = String(claudeJson.result ?? '').replace(/<agent_summary>[\s\S]*?<\/agent_summary>/, '').trim();
  const summary     = parseAgentSummary(String(claudeJson.result ?? ''));
  const cleanResult = summary?.what_was_done || resultText;

  return {
    success: true, summary, raw_result: cleanResult,
    session_id:  claudeJson.session_id ?? null,
    cost_usd:    claudeJson.cost_usd ?? claudeJson.total_cost_usd ?? null,
    duration_ms: claudeJson.duration_ms ?? null,
    num_turns:   claudeJson.num_turns ?? null,
  };
}

function buildErrorResult(message: string, stdout: string, stderr: string, json?: ClaudeJsonResult | null): CallClaudeResult {
  return {
    success: false, summary: null, raw_result: stdout.slice(0, 3000),
    session_id:  json?.session_id  ?? null,
    cost_usd:    json?.cost_usd    ?? null,
    duration_ms: json?.duration_ms ?? null,
    num_turns:   json?.num_turns   ?? null,
    error: message + (stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ''),
  };
}

function resolveCwd(args: Record<string, any>, options: ExecuteToolOptions): string {
  if (args?.cwd) return args.cwd;
  try {
    const wf = options?.workspaceFolder as any;
    if (wf?.uri?.fsPath) return wf.uri.fsPath;
    if (wf?.fsPath)      return wf.fsPath;
    if (typeof wf === 'string') return wf;
  } catch { /* ignora */ }
  return process.cwd();
}

function emitClaudeSessionEvent(options: ExecuteToolOptions, meta: ClaudeSessionMeta, phase: string, extra: Record<string, any> = {}): void {
  options.onStructuredToolEvent?.({
    type: 'CLAUDE_SESSION',
    payload: {
      id: meta.toolCallId || meta.jobId || `claude_${Date.now()}`,
      toolName: meta.toolName,
      messageId: meta.messageId,
      chatId: meta.chatId,
      sessionId: meta.sessionId ?? null,
      jobId: meta.jobId,
      promptPreview: meta.promptPreview,
      phase,
      timestamp: new Date().toISOString(),
      ...extra,
    }
  });
}

function sanitizeClaudeChunk(chunk: string): string {
  const normalized = String(chunk || '').replace(/\r/g, '');
  if (!normalized.trim()) return '';
  const sliced = normalized.length > CLAUDE_STREAM_MAX_CHARS
    ? normalized.slice(-CLAUDE_STREAM_MAX_CHARS)
    : normalized;
  return sliced.replace(/^\n+/, '');
}

function sanitizePromptPreview(text: string): string {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) return '';

  const redacted = normalized
    .replace(/(api[_-]?key\s*[:=]\s*)([^\s\n]+)/gi, '$1[REDACTED]')
    .replace(/(token\s*[:=]\s*)([^\s\n]+)/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)([^\s\n]+)/gi, '$1[REDACTED]')
    .replace(/(password\s*[:=]\s*)([^\s\n]+)/gi, '$1[REDACTED]')
    .replace(/(secret\s*[:=]\s*)([^\s\n]+)/gi, '$1[REDACTED]');

  return redacted.length > 4000
    ? `${redacted.slice(0, 4000)}\n… [prompt preview truncado]`
    : redacted;
}

function buildClaudeMeta(args: Record<string, any>, options: ExecuteToolOptions, toolName: string): ClaudeSessionMeta {
  return {
    toolName,
    toolCallId: options.toolCallId,
    messageId: options.messageId,
    chatId: options.chatId,
    sessionId: args?.session_id ?? null,
    promptPreview: sanitizePromptPreview(String(args?.task ?? args?.prompt ?? args?.message ?? '')),
  };
}

function buildClaudeArgs(args: Record<string, any>): string[] {
  const base = [
    '--print', // Essencial para saída não interativa e parsing JSON
    '--output-format', 'json',
    '--model', 'sonnet',
    '--dangerously-skip-permissions',
  ];
  if (args.session_id) base.push('--resume', args.session_id);
  return base;
}

function spawnClaude(claudeArgs: string[], fullPrompt: string, systemPrompt: string, cwd: string, options: ExecuteToolOptions, meta: ClaudeSessionMeta): { proc: ChildProcess; job: RunningJob } {
  const isWin = process.platform === 'win32';
  const finalArgs = [...claudeArgs];
  const tempFiles: string[] = [];

  // System Prompt via arquivo para evitar problemas de escape no Windows
  const spFile = path.join(os.tmpdir(), `nic_claude_sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);
  fs.writeFileSync(spFile, systemPrompt, 'utf-8');
  tempFiles.push(spFile);
  finalArgs.push('--append-system-prompt-file', spFile);

  // Prompt principal via stdin (usando --input-format text para ler do stdin)
  finalArgs.push('--input-format', 'text');

  console.log('[call_claude] Final Spawn Args:', JSON.stringify(finalArgs, null, 2));

  const proc = spawn(isWin ? 'claude.cmd' : 'claude', finalArgs, {
    shell: isWin,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'], // 'pipe' no stdin para enviar o prompt
    env: { ...process.env, ANTHROPIC_API_KEY: undefined as any },
  });

  // Escrever prompt no stdin e fechar
  if (proc.stdin) {
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  }

  const job: RunningJob = { proc, stdout: '', stderr: '', done: false, result: null, startedAt: Date.now(), meta };

  let streamBuffer = '';
  let lastFlushAt = 0;
  const flushClaudeProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlushAt < CLAUDE_STREAM_FLUSH_MS) return;
    const text = sanitizeClaudeChunk(streamBuffer);
    if (!text) return;
    lastFlushAt = now;
    streamBuffer = '';
    emitClaudeSessionEvent(options, meta, 'progress', { text });
  };

  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    if (job.stdout.length < MAX_RAW_OUTPUT) job.stdout += chunk;
    options?.onStreamOutput?.(chunk);
    streamBuffer += chunk;
    flushClaudeProgress(false);
  });
  proc.stderr?.on('data', (data: Buffer) => { job.stderr += data.toString().slice(0, 5000); });

  // Cleanup dos arquivos temporários
  proc.on('close', () => {
    flushClaudeProgress(true);
    for (const f of tempFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  return { proc, job };
}

// ─── Lógica compartilhada de execução ────────────────────────────────────────

function runWait(claudeArgs: string[], fullPrompt: string, systemPrompt: string, cwd: string, options: ExecuteToolOptions, label: string, meta: ClaudeSessionMeta): Promise<CallClaudeResult> {
  return new Promise((resolve) => {
    const { proc, job } = spawnClaude(claudeArgs, fullPrompt, systemPrompt, cwd, options, meta);
    console.log(`[${label}] PID: ${proc.pid}`);
    emitClaudeSessionEvent(options, meta, 'start', {
      pid: proc.pid,
      waitMode: 'foreground',
      text: 'Claude Code iniciado. Aguardando saída do processo...'
    });

    const timeout = TIMEOUT_MS > 0 ? setTimeout(() => {
      console.warn(`[${label}] Timeout configurado.`);
      proc.kill('SIGTERM');
      emitClaudeSessionEvent(options, meta, 'error', { text: 'Claude Code excedeu o timeout configurado.' });
      resolve(buildErrorResult('Timeout: Claude Code excedeu o tempo configurado', job.stdout, job.stderr));
    }, TIMEOUT_MS) : null;

    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      const result = parseClaudeOutput(job.stdout, job.stderr, code);
      if (result.session_id) meta.sessionId = result.session_id;
      emitClaudeSessionEvent(options, meta, result.success ? 'done' : 'error', {
        text: result.success ? (result.summary?.what_was_done || result.raw_result || 'Claude Code finalizado.') : (result.error || 'Claude Code falhou.'),
        pid: proc.pid,
        costUsd: result.cost_usd,
        durationMs: result.duration_ms,
        numTurns: result.num_turns,
      });
      console.log(`[${label}] result:`, JSON.stringify(result, null, 2));
      resolve(result);
    });
    proc.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      emitClaudeSessionEvent(options, meta, 'error', { text: err.message, pid: proc.pid });
      resolve(buildErrorResult(`Falha ao iniciar claude: ${err.message}. Verifique se @anthropic-ai/claude-code está instalado e no PATH.`, job.stdout, job.stderr));
    });
  });
}

function runBackground(claudeArgs: string[], fullPrompt: string, systemPrompt: string, cwd: string, options: ExecuteToolOptions, label: string, meta: ClaudeSessionMeta): Promise<any> {
  const jobId = `claude_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  meta.jobId = jobId;

  return new Promise((resolve) => {
    try {
      const { proc, job } = spawnClaude(claudeArgs, fullPrompt, systemPrompt, cwd, options, meta);
      job.meta = meta;
      runningJobs.set(jobId, job);
      emitClaudeSessionEvent(options, meta, 'start', {
        pid: proc.pid,
        waitMode: 'background',
        text: 'Claude Code iniciado em background. Aguardando saída do processo...'
      });

      let hasError = false;

      proc.on('error', (err) => {
        hasError = true;
        console.error(`[${label}] Erro no spawn (background):`, err);
        job.done   = true;
        job.result = buildErrorResult(`Falha ao iniciar claude em background: ${err.message}`, job.stdout, job.stderr);
        emitClaudeSessionEvent(options, meta, 'error', { text: err.message, pid: proc.pid });
        resolve({ status: 'error', job_id: jobId, error: `Falha ao iniciar: ${err.message}` });
      });

      const timeout = TIMEOUT_MS > 0 ? setTimeout(() => {
        if (!job.done) {
          proc.kill('SIGTERM');
          job.done   = true;
          job.result = buildErrorResult('Timeout: Claude Code excedeu o limite de tempo global', job.stdout, job.stderr);
          emitClaudeSessionEvent(options, meta, 'error', { text: 'Claude Code excedeu o timeout configurado.', pid: proc.pid });
        }
      }, TIMEOUT_MS) : null;

      proc.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        const result = parseClaudeOutput(job.stdout, job.stderr, code);
        if (result.session_id) meta.sessionId = result.session_id;
        console.log(`[${label}] Job ${jobId} finalizado:`, JSON.stringify(result, null, 2));
        job.done   = true;
        job.result = result;
        emitClaudeSessionEvent(options, meta, result.success ? 'done' : 'error', {
          text: result.success ? (result.summary?.what_was_done || result.raw_result || 'Claude Code finalizado em background.') : (result.error || 'Claude Code falhou em background.'),
          pid: proc.pid,
          costUsd: result.cost_usd,
          durationMs: result.duration_ms,
          numTurns: result.num_turns,
        });
      });

      // Se após 1000ms não tiver dado erro, assumimos que iniciou ok
      setTimeout(() => {
        if (!hasError) {
          console.log(`[${label}] Job ${jobId} iniciado (PID: ${proc.pid})`);
          emitClaudeSessionEvent(options, meta, 'background', {
            text: `Claude Code rodando em background (job_id: ${jobId}).`,
            pid: proc.pid,
          });
          resolve({
            status:      'running',
            job_id:      jobId,
            pid:         proc.pid,
            started_at:  new Date(job.startedAt).toISOString(),
            instruction: `Claude Code iniciado em background (job_id: "${jobId}", PID: ${proc.pid}). Chame call_claude_check com esse job_id para verificar quando terminar.`,
          });
        }
      }, 1000);
    } catch (err: any) {
      console.error(`[${label}] Exceção ao tentar iniciar claude:`, err);
      emitClaudeSessionEvent(options, meta, 'error', { text: err.message });
      resolve({ status: 'error', error: `Exceção ao iniciar: ${err.message}` });
    }
  });
}

// ─── TOOL: call_claude ────────────────────────────────────────────────────────

export async function executeCallClaude(args: Record<string, any>, options: ExecuteToolOptions): Promise<any> {
  const task: string = args?.task ?? args?.prompt;
  if (!task || typeof task !== 'string') throw new Error('call_claude requer args.task (string)');

  const wait: boolean = args?.wait !== false;
  const cwd           = resolveCwd(args, options);
  const meta          = buildClaudeMeta(args, options, 'call_claude');

  const fileRefs: FileRef[] = Array.isArray(args?.send_multiple_files) ? args.send_multiple_files : [];
  const filesBlock          = buildFilesBlock(fileRefs, cwd);
  const fullPrompt          = task + filesBlock + SUMMARY_INSTRUCTION;

  const systemPrompt = [
    SAFETY_INSTRUCTION,
    typeof args?.system_context === 'string' && args.system_context.trim() ? args.system_context.trim() : '',
  ].filter(Boolean).join('\n\n');

  const claudeArgs = buildClaudeArgs(args);

  if (wait) {
    return runWait(claudeArgs, fullPrompt, systemPrompt, cwd, options, 'call_claude', meta);
  } else {
    return runBackground(claudeArgs, fullPrompt, systemPrompt, cwd, options, 'call_claude', meta);
  }
}

// ─── TOOL: call_claude_reply ──────────────────────────────────────────────────

export async function executeCallClaudeReply(args: Record<string, any>, options: ExecuteToolOptions): Promise<any> {
  const sessionId: string = args?.session_id;
  const message:   string = args?.message;
  if (!sessionId) throw new Error('call_claude_reply requer args.session_id');
  if (!message)   throw new Error('call_claude_reply requer args.message');

  const wait: boolean = args?.wait !== false;
  const cwd           = resolveCwd(args, options);
  const meta          = buildClaudeMeta(args, options, 'call_claude_reply');
  meta.sessionId      = sessionId;
  
  const fullPrompt = message + SUMMARY_INSTRUCTION;
  const systemPrompt = SAFETY_INSTRUCTION;
  emitClaudeSessionEvent(options, meta, 'replying', { text: 'Gemini enviou contexto adicional para o Claude.' });
  
  const claudeArgs = buildClaudeArgs({ session_id: sessionId });

  if (wait) {
    return runWait(claudeArgs, fullPrompt, systemPrompt, cwd, options, 'call_claude_reply', meta);
  } else {
    return runBackground(claudeArgs, fullPrompt, systemPrompt, cwd, options, 'call_claude_reply', meta);
  }
}

// ─── TOOL: call_claude_check ──────────────────────────────────────────────────

export async function executeCallClaudeCheck(args: Record<string, any>, options: ExecuteToolOptions): Promise<any> {
  const jobId: string = args?.job_id;
  if (!jobId) throw new Error('call_claude_check requer args.job_id');

  const job = runningJobs.get(jobId);
  if (!job) return { status: 'not_found', job_id: jobId, message: 'Job não encontrado. Pode ter expirado ou o job_id está incorreto.' };

  if (!job.done) {
    const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
    if (job.meta) {
      emitClaudeSessionEvent(options, job.meta, 'checking', { text: `Claude Code ainda trabalhando (${elapsed}s).`, elapsedSec: elapsed });
    }
    return { status: 'running', job_id: jobId, elapsed_sec: elapsed, message: `Claude Code ainda trabalhando (${elapsed}s). Tente novamente em breve.` };
  }

  if (job.meta) {
    emitClaudeSessionEvent(options, job.meta, 'checked_done', { text: 'Consulta de status confirmou que o job terminou.' });
  }
  runningJobs.delete(jobId);
  return { status: 'done', job_id: jobId, ...job.result };
}

// ─── TOOL: call_claude_stop ───────────────────────────────────────────────────

export async function executeCallClaudeStop(args: Record<string, any>, options: ExecuteToolOptions): Promise<any> {
  const jobId: string = args?.job_id;
  if (!jobId) throw new Error('call_claude_stop requer args.job_id');

  const job = runningJobs.get(jobId);
  if (!job) return { status: 'not_found', job_id: jobId, message: 'Job não encontrado. Já terminou ou o job_id está incorreto.' };
  if (job.done) { runningJobs.delete(jobId); return { status: 'already_done', job_id: jobId, message: 'Job já havia terminado.' }; }

  job.proc.kill('SIGTERM');
  job.done   = true;
  job.result = buildErrorResult('Job interrompido pelo Agente via call_claude_stop.', job.stdout, job.stderr);
  if (job.meta) {
    emitClaudeSessionEvent(options, job.meta, 'stopped', { text: `Claude Code (job_id: ${jobId}) foi interrompido.` });
  }
  runningJobs.delete(jobId);

  return { status: 'stopped', job_id: jobId, message: `Claude Code (job_id: "${jobId}") interrompido com sucesso.` };
}
