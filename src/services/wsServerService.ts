import * as http from 'http';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as vscode from 'vscode';

export interface WsMessage {
  type: string;
  payload?: unknown;
  id?: string;
}

interface AuthenticatedClient {
  ws: WebSocket;
  uid: string;
  connectedAt: number;
}

export class WsServerService {
  private static _instance: WsServerService | null = null;

  private _server: http.Server | null = null;
  private _wss: WebSocketServer | null = null;
  private _clients = new Map<WebSocket, AuthenticatedClient>();
  private _sessionToken: string | null = null;
  private _port: number;
  private _outputChannel: vscode.OutputChannel;

  private constructor(outputChannel: vscode.OutputChannel, port = 7890) {
    this._port = port;
    this._outputChannel = outputChannel;
  }

  static getInstance(outputChannel?: vscode.OutputChannel, port = 7890): WsServerService {
    if (!WsServerService._instance) {
      if (!outputChannel) throw new Error('outputChannel required on first call');
      WsServerService._instance = new WsServerService(outputChannel, port);
    }
    return WsServerService._instance;
  }

  // ── Token management ───────────────────────────────────────────────────────

  /** Generates a new session token. Called after QR auth succeeds. */
  rotateSessionToken(): string {
    this._sessionToken = crypto.randomBytes(32).toString('hex');
    return this._sessionToken;
  }

  getSessionToken(): string | null {
    return this._sessionToken;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._wss) {
        resolve();
        return;
      }

      this._server = http.createServer();
      this._wss = new WebSocketServer({ server: this._server });

      this._wss.on('connection', (ws, req) => this._handleConnection(ws, req));
      this._wss.on('error', (err) => this._log(`WSS error: ${err.message}`));

      this._server.listen(this._port, '127.0.0.1', () => {
        resolve();
      });

      this._server.on('error', (err: NodeJS.ErrnoException) => {
        this._log(`Server error: ${err.message}`);
        reject(err);
      });
    });
  }

  stop(): void {
    this._clients.forEach(({ ws }) => ws.close());
    this._clients.clear();
    this._wss?.close();
    this._server?.close();
    this._wss = null;
    this._server = null;
    WsServerService._instance = null;
  }

  // ── Connection handling ────────────────────────────────────────────────────

  private _handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // Validate token from Authorization header or ?token= query param
    const token = this._extractToken(req);

    if (!token || token !== this._sessionToken) {
      this._log(`Rejected unauthenticated connection from ${req.socket.remoteAddress}`);
      ws.close(4401, 'Unauthorized');
      return;
    }

    const uid = this._uidFromToken(token);
    const client: AuthenticatedClient = { ws, uid, connectedAt: Date.now() };
    this._clients.set(ws, client);

    ws.on('message', (data) => this._handleMessage(ws, data));
    ws.on('close', () => {
      this._clients.delete(ws);
    });
    ws.on('error', (err) => this._log(`Client error: ${err.message}`));

    // Send initial ack
    this._sendTo(ws, { type: 'connection/ack', payload: { connectedAt: Date.now() } });

    // Notify connect handlers (to push initial state)
    this._connectHandlers.forEach(h => h(ws));
  }

  private _extractToken(req: http.IncomingMessage): string | null {
    // Authorization: Bearer <token>
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    // Fallback: ?token=<token> in URL
    const url = new URL(req.url ?? '/', `http://localhost`);
    return url.searchParams.get('token');
  }

  private _uidFromToken(_token: string): string {
    // O token é apenas um segredo efêmero de sessão do WS.
    // O uid real já foi resolvido no fluxo de pareamento/autenticação e é
    // injetado aqui via setSessionUid(). Não extraímos uid do token em si.
    return this._sessionUid ?? 'unknown';
  }

  private _sessionUid: string | null = null;

  setSessionUid(uid: string): void {
    this._sessionUid = uid;
  }

  // ── Message handling (Mobile → Extension) ─────────────────────────────────

  private _messageHandlers = new Map<string, (payload: unknown, ws: WebSocket) => void>();
  private _connectHandlers: Array<(ws: WebSocket) => void> = [];

  onMessage(type: string, handler: (payload: unknown, ws: WebSocket) => void): void {
    this._messageHandlers.set(type, handler);
  }

  onClientConnected(handler: (ws: WebSocket) => void): void {
    this._connectHandlers.push(handler);
  }

  private _handleMessage(ws: WebSocket, data: import('ws').RawData): void {
    try {
      const msg: WsMessage = JSON.parse(data.toString());
      const handler = this._messageHandlers.get(msg.type);
      if (handler) {
        handler(msg.payload, ws);
      }
    } catch {
      // ignore
    }
  }

  // ── Broadcasting (Extension → Mobile) ─────────────────────────────────────

  broadcast(type: string, payload?: unknown): void {
    const msg = JSON.stringify({ type, payload });
    this._clients.forEach(({ ws }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    });
  }

  sendTo(ws: WebSocket, type: string, payload?: unknown): void {
    this._sendTo(ws, { type, payload });
  }

  private _sendTo(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  get connectedClients(): number {
    return this._clients.size;
  }

  get port(): number {
    return this._port;
  }

  private _log(msg: string): void {
    this._outputChannel.appendLine(`[WsServer] ${msg}`);
  }
}
