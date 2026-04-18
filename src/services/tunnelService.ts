import * as child_process from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

function getCloudflaredBinName(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function getBundledCloudflaredBin(): string {
  return path.join(__dirname, 'bin', getCloudflaredBinName());
}

function getFallbackCloudflaredBin(): string {
  return path.join(os.tmpdir(), 'nic-hyper-flow', 'bin', getCloudflaredBinName());
}

function resolveExistingCloudflaredBin(): string | null {
  const bundledBin = getBundledCloudflaredBin();
  if (fs.existsSync(bundledBin)) return bundledBin;

  const fallbackBin = getFallbackCloudflaredBin();
  if (fs.existsSync(fallbackBin)) return fallbackBin;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cloudflared = require('cloudflared') as { bin?: string };
    if (cloudflared.bin && fs.existsSync(cloudflared.bin)) return cloudflared.bin;
  } catch {
    // ignore
  }

  return null;
}

function canExecuteCloudflared(binPath: string): boolean {
  try {
    const result = child_process.spawnSync(binPath, ['--version'], {
      windowsHide: true,
      timeout: 10000,
      encoding: 'utf8'
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

async function ensureCloudflaredBin(log?: (line: string) => void): Promise<string> {
  const existingBin = resolveExistingCloudflaredBin();
  if (existingBin) {
    if (canExecuteCloudflared(existingBin)) {
      log?.(`cloudflared encontrado em ${existingBin}`);
      return existingBin;
    }
    log?.(`cloudflared encontrado em ${existingBin}, mas o binário não pôde ser executado. Tentando reinstalar...`);
  }

  const proceed = await vscode.window.showInformationMessage(
    'To enable Remote Control, Nic Hyper Flow needs to download and install the Cloudflare tunnel binary (cloudflared). This creates a secure connection between your VS Code session and your mobile device. The binary is downloaded after installation and is not included in the extension package.',
    { modal: true },
    'Download and Install',
    'Cancel'
  );

  if (proceed !== 'Download and Install') {
    throw new Error('Cloudflared installation was cancelled by the user. Remote Control requires this binary to work.');
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cloudflared = require('cloudflared') as { bin?: string; install?: (to: string, version?: string) => Promise<string> };
    if (typeof cloudflared.install !== 'function') {
      throw new Error('Pacote cloudflared não expõe install()');
    }

    const target = getFallbackCloudflaredBin();
    fs.mkdirSync(path.dirname(target), { recursive: true });

    log?.(`cloudflared não encontrado. Baixando binário para ${target}...`);

    let installedPath = '';
    try {
      installedPath = await cloudflared.install(target);
    } catch (error) {
      log?.(`Falha na instalação direta do cloudflared: ${error instanceof Error ? error.message : String(error)}`);
    }

    const candidates = [
      installedPath,
      target,
      cloudflared.bin,
      getFallbackCloudflaredBin(),
      resolveExistingCloudflaredBin() ?? ''
    ].filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index);

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      if (!canExecuteCloudflared(candidate)) {
        log?.(`cloudflared encontrado em ${candidate}, mas não executou corretamente após o download.`);
        continue;
      }
      log?.(`cloudflared instalado com sucesso em ${candidate}`);
      return candidate;
    }

    throw new Error('O download do cloudflared terminou sem gerar um binário executável.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.(`Falha ao carregar ou instalar o cloudflared: ${message}`);
    throw new Error(`Falha ao baixar o cloudflared automaticamente: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

/**
 * Parses the metrics server port from a cloudflared output line.
 * cloudflared prints: "INF Starting metrics server on 127.0.0.1:20241/metrics"
 */
function parseMetricsPort(line: string): number | null {
  const match = line.match(/Starting metrics server on 127\.0\.0\.1:(\d+)/i);
  if (!match) return null;
  const port = parseInt(match[1], 10);
  return Number.isFinite(port) && port > 0 ? port : null;
}

/**
 * Parses a trycloudflare.com URL from a cloudflared output line.
 * Used only as a last-resort fallback if the metrics endpoint never returns a URL.
 */
function parseTunnelUrlFromStdout(line: string): string | null {
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0] : null;
}

/**
 * Polls the cloudflared /ready endpoint and returns the number of active
 * tunnel connections, or 0 if the tunnel is not ready yet.
 *
 * Response shape (cloudflared ≥ 2024.x):
 *   { "status": 200, "readyConnections": 1, "connectorId": "..." }
 */
function checkMetricsReady(metricsPort: number): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: metricsPort, path: '/ready', timeout: 2000 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(0); return; }
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { readyConnections?: number };
            resolve(json.readyConnections ?? 0);
          } catch {
            // /ready returned 200 but non-JSON body — treat as 1 ready connection
            resolve(1);
          }
        });
      }
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

/**
 * Extracts the public tunnel URL from the cloudflared Prometheus metrics endpoint.
 *
 * cloudflared exposes the hostname via:
 *   cloudflared_tunnel_user_hostnames_counts{userHostname="https://xxx.trycloudflare.com"} 1
 *
 * This is the most reliable source: it is machine-readable, version-stable,
 * and independent of log message formatting.
 */
function extractUrlFromMetrics(metricsPort: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: metricsPort, path: '/metrics', timeout: 3000 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const match = body.match(
            /cloudflared_tunnel_user_hostnames_counts\{userHostname="(https:\/\/[^"]+)"\}/
          );
          resolve(match ? match[1] : null);
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ---------------------------------------------------------------------------
// TunnelService
// ---------------------------------------------------------------------------

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

// How long (ms) to wait for the metrics-based approach before falling back to
// the stdout-parsed URL (preserves compatibility with older cloudflared versions).
const METRICS_FALLBACK_TIMEOUT_MS = 60_000;

// How long (ms) to pause retries after a Cloudflare rate-limit (HTTP 429 / error 1015).
const RATE_LIMIT_BACKOFF_MS = 60_000;

/**
 * Returns true when a cloudflared output line indicates that Cloudflare is
 * rate-limiting quick tunnel creation (HTTP 429 / error code 1015).
 */
function isRateLimitError(line: string): boolean {
  return (
    (line.includes('429') || line.includes('1015') || line.toLowerCase().includes('rate limit')) &&
    (line.toLowerCase().includes('tunnel') || line.toLowerCase().includes('quick') || line.toLowerCase().includes('unmarshal'))
  );
}

export class TunnelService {
  private static _instance: TunnelService | null = null;

  private _proc: child_process.ChildProcess | null = null;
  private _url: string | null = null;
  private _status: TunnelStatus = 'stopped';
  private _outputChannel: vscode.OutputChannel;
  private _onUrlReady: ((url: string) => void) | null = null;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;
  private _port = 0;

  // Named Tunnel mode (set via startWithToken)
  private _tunnelToken: string | null = null;
  private _knownHostname: string | null = null;

  // Metrics-based detection state (reset on each _launch)
  private _metricsPort: number | null = null;
  private _metricsPoller: ReturnType<typeof setInterval> | null = null;
  private _metricsFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** URL captured from stdout — used only if /metrics never yields a URL. */
  private _stdoutUrlFallback: string | null = null;
  /** Set to true when the current launch attempt hit a Cloudflare rate limit. */
  private _rateLimited = false;

  private constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
  }

  static getInstance(outputChannel?: vscode.OutputChannel): TunnelService {
    if (!TunnelService._instance) {
      if (!outputChannel) throw new Error('outputChannel required on first call');
      TunnelService._instance = new TunnelService(outputChannel);
    }
    return TunnelService._instance;
  }

  get url(): string | null { return this._url; }
  get status(): TunnelStatus { return this._status; }

  onUrlReady(cb: (url: string) => void): void {
    this._onUrlReady = cb;
    if (this._url) cb(this._url);
  }

  start(localPort: number): void {
    const config = vscode.workspace.getConfiguration('nic-hyper-flow');
    const disableTunnel = config.get<boolean>('debugDisableTunnel', false);
    
    if (disableTunnel) {
      this._log('Túnel desativado via configuração nic-hyper-flow.debugDisableTunnel');
      this._status = 'stopped';
      return;
    }

    this._port = localPort;
    this._stopped = false;
    void this._launch(localPort);
  }

  /**
   * Starts a Named Tunnel using a pre-provisioned token.
   * The public hostname is known upfront — no URL discovery needed.
   * Falls back to `start()` behaviour if token/hostname are empty.
   */
  startWithToken(localPort: number, tunnelToken: string, knownHostname: string): void {
    const config = vscode.workspace.getConfiguration('nic-hyper-flow');
    const disableTunnel = config.get<boolean>('debugDisableTunnel', false);
    
    if (disableTunnel) {
      this._log('Túnel (Named) desativado via configuração nic-hyper-flow.debugDisableTunnel');
      this._status = 'stopped';
      return;
    }

    this._tunnelToken = tunnelToken;
    this._knownHostname = knownHostname;
    this.start(localPort);
  }

  stop(): void {
    this._stopped = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    this._stopMetricsPolling();
    this._kill();
    this._status = 'stopped';
    this._url = null;
    this._onUrlReady = null;
    this._tunnelToken = null;
    this._knownHostname = null;
    TunnelService._instance = null;
  }

  private async _launch(port: number): Promise<void> {
    this._status = 'starting';
    this._url = null;
    this._metricsPort = null;
    this._stdoutUrlFallback = null;
    this._rateLimited = false;
    this._stopMetricsPolling();

    let cloudflaredBin: string;
    try {
      cloudflaredBin = await ensureCloudflaredBin((line) => this._log(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._log(message);
      this._status = 'error';
      return;
    }

    const isNamedTunnel = !!(this._tunnelToken && this._knownHostname);
    const args = isNamedTunnel
      ? ['tunnel', 'run', '--token', this._tunnelToken!]
      : ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'];

    this._log(isNamedTunnel
      ? `Iniciando Named Tunnel para ${this._knownHostname}`
      : `Iniciando Quick Tunnel com binário: ${cloudflaredBin}`);

    this._proc = child_process.spawn(cloudflaredBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const processLine = (line: string): void => {
      this._log(line);

      // Detect Cloudflare rate-limit (HTTP 429 / error 1015) before doing anything else.
      if (!this._rateLimited && isRateLimitError(line)) {
        this._rateLimited = true;
        this._log(`Rate limit do Cloudflare detectado. Próxima tentativa em ${RATE_LIMIT_BACKOFF_MS / 1000}s.`);
        void vscode.window.showWarningMessage(
          'O limite de conexões rápidas do Cloudflare foi atingido (erro 429). ' +
          'O Remote Control aguardará 1 minuto antes de tentar reconectar automaticamente.'
        );
      }

      // Primary: detect the metrics server port to start programmatic URL extraction.
      if (this._metricsPort === null) {
        const metricsPort = parseMetricsPort(line);
        if (metricsPort !== null) {
          this._metricsPort = metricsPort;
          this._log(`Metrics server detectado na porta ${metricsPort}`);
          this._startMetricsPolling(metricsPort);
        }
      }

      // Fallback only: capture URL from stdout in case /metrics never returns it.
      if (this._stdoutUrlFallback === null) {
        const stdoutUrl = parseTunnelUrlFromStdout(line);
        if (stdoutUrl !== null) {
          this._stdoutUrlFallback = stdoutUrl;
        }
      }
    };

    this._proc.stdout?.on('data', (d: Buffer) => {
      d.toString().split('\n').forEach(l => { if (l.trim()) processLine(l.trim()); });
    });
    this._proc.stderr?.on('data', (d: Buffer) => {
      d.toString().split('\n').forEach(l => { if (l.trim()) processLine(l.trim()); });
    });

    this._proc.on('error', (error) => {
      this._log(`Erro ao iniciar cloudflared: ${error.message}`);
      this._status = 'error';
      this._url = null;
      this._stopMetricsPolling();
    });

    this._proc.on('exit', (code, signal) => {
      this._log(`Processo cloudflared finalizado. code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this._status = 'error';
      this._url = null;
      this._proc = null;
      this._stopMetricsPolling();
      if (!this._stopped) {
        const delay = this._rateLimited ? RATE_LIMIT_BACKOFF_MS : 5000;
        if (this._rateLimited) {
          this._log(`Aguardando ${delay / 1000}s devido ao rate limit antes de reconectar...`);
        }
        this._restartTimer = setTimeout(() => { void this._launch(port); }, delay);
      }
    });

    // Fallback timer: activate URL if metrics polling hasn't produced one yet.
    this._metricsFallbackTimer = setTimeout(() => {
      if (this._url) return;
      if (this._knownHostname) {
        this._log('Timeout aguardando metrics. Ativando hostname Named Tunnel.');
        this._activateUrl(`https://${this._knownHostname}`);
      } else if (this._stdoutUrlFallback) {
        this._log('Timeout aguardando URL via /metrics. Usando URL do stdout (fallback).');
        this._activateUrl(this._stdoutUrlFallback);
      } else {
        this._log('Timeout aguardando URL via /metrics. Nenhuma URL detectada no stdout.');
      }
    }, METRICS_FALLBACK_TIMEOUT_MS);
  }

  /**
   * Polls /ready every second. When readyConnections > 0, queries /metrics for
   * the public tunnel URL and fires onUrlReady. Stops itself once the URL is confirmed.
   */
  private _startMetricsPolling(metricsPort: number): void {
    this._metricsPoller = setInterval(() => {
      void (async () => {
        if (this._url) { this._stopMetricsPolling(); return; }

        const readyConnections = await checkMetricsReady(metricsPort);
        if (readyConnections <= 0) return;

        this._log(`/ready: ${readyConnections} conexão(ões) ativa(s). Extraindo URL de /metrics...`);

        if (this._knownHostname) {
          // Named Tunnel: hostname is known upfront, no need to extract from metrics.
          this._stopMetricsPolling();
          this._activateUrl(`https://${this._knownHostname}`);
        } else {
          const url = await extractUrlFromMetrics(metricsPort);
          if (url) {
            this._stopMetricsPolling();
            this._activateUrl(url);
          } else {
            this._log('Tunnel ativo mas userHostname ainda não disponível em /metrics. Aguardando...');
          }
        }
      })();
    }, 1000);
  }

  private _stopMetricsPolling(): void {
    if (this._metricsPoller) {
      clearInterval(this._metricsPoller);
      this._metricsPoller = null;
    }
    if (this._metricsFallbackTimer) {
      clearTimeout(this._metricsFallbackTimer);
      this._metricsFallbackTimer = null;
    }
  }

  /** Converts the https URL to wss://, sets state and fires the callback. */
  private _activateUrl(httpsUrl: string): void {
    if (this._url) return;
    this._url = httpsUrl.replace('https://', 'wss://');
    this._status = 'running';
    this._log(`Tunnel ativo e confirmado: ${this._url}`);
    this._onUrlReady?.(this._url);
  }

  private _kill(): void {
    if (this._proc) {
      try { this._proc.kill(); } catch { /* ignore */ }
      this._proc = null;
    }
  }

  private _log(line: string): void {
    if (line) this._outputChannel.appendLine(`[Tunnel] ${line}`);
  }
}
