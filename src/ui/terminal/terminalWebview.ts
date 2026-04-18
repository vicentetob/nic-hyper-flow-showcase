import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { terminalSessionManager, TerminalSessionSnapshot } from '../../tools/terminal_session_manager';

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

type RestartMeta = {
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  initialWaitMs: number;
};

export class TerminalWebviewProvider {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private static currentSessionId: string | undefined;
  private static pollTimer: NodeJS.Timeout | undefined;
  private static listPollTimer: NodeJS.Timeout | undefined;
  private static extensionContext: vscode.ExtensionContext | undefined;
  private static restartMetaBySession = new Map<string, RestartMeta>();

  public static createOrShow(context: vscode.ExtensionContext, sessionId?: string, cwd?: string) {
    TerminalWebviewProvider.extensionContext = context;
    const column = vscode.ViewColumn.Beside;

    if (TerminalWebviewProvider.currentPanel) {
      TerminalWebviewProvider.currentPanel.reveal(column);
      if (sessionId) {
        TerminalWebviewProvider.currentSessionId = sessionId;
      }
      TerminalWebviewProvider.postBootstrap(cwd);
      return TerminalWebviewProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'nicHyperFlowTerminal',
      'Nic Hyper Flow Terminal',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'dist', 'ui', 'terminal', 'view')),
          vscode.Uri.file(path.join(context.extensionPath, 'src', 'ui', 'terminal', 'view')),
        ],
      }
    );

    TerminalWebviewProvider.currentPanel = panel;
    if (sessionId) {
      TerminalWebviewProvider.currentSessionId = sessionId;
    }

    panel.webview.html = TerminalWebviewProvider.getHtmlForWebview(panel.webview, context);

    panel.webview.onDidReceiveMessage(async (message) => {
      const payload = message.payload ?? {};

      switch (message.type) {
        case 'ui/terminal/ready':
          TerminalWebviewProvider.startPolling(); // Inicia o polling antes do bootstrap para já estar ouvindo
          TerminalWebviewProvider.postBootstrap(cwd);
          return;

        case 'ui/terminal/selectSession':
          if (payload?.sessionId) {
            TerminalWebviewProvider.currentSessionId = payload.sessionId;
            TerminalWebviewProvider.postBootstrap();
            TerminalWebviewProvider.startPolling();
            TerminalWebviewProvider.postSessionsList(payload.sessionId);
          }
          return;

        case 'ui/terminal/start': {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            vscode.window.showErrorMessage('Abra um workspace para iniciar uma sessão persistente.');
            return;
          }

          const restartMeta: RestartMeta = {
            command: String(payload?.command || ''),
            cwd: String(payload?.cwd || '.'),
            cols: Number(payload?.cols || 220),
            rows: Number(payload?.rows || 50),
            initialWaitMs: Number(payload?.initialWaitMs || 1200),
          };
          TerminalWebviewProvider.restartMetaBySession.set(String(payload?.sessionId || ''), restartMeta);

          const result = await terminalSessionManager.start({
            session_id: payload?.sessionId,
            command: restartMeta.command,
            cwd: restartMeta.cwd,
            cols: restartMeta.cols,
            rows: restartMeta.rows,
            initial_wait_ms: restartMeta.initialWaitMs,
            skipApproval: false,
          }, {
            workspaceFolder,
            onStreamOutput: (chunk) => {
              if (payload?.sessionId) {
                TerminalWebviewProvider.pushOutput(payload.sessionId, chunk);
              }
            },
            toolCallId: `terminal_webview_${payload?.sessionId || Date.now()}`,
          });

          TerminalWebviewProvider.currentSessionId = payload?.sessionId;
          panel.webview.postMessage({
            type: 'terminal/started',
            payload: {
              sessionId: payload?.sessionId,
              output: result?.output || '',
              snapshot: result?.snapshot,
              restartMeta,
            }
          });
          TerminalWebviewProvider.postBootstrap(payload?.cwd);
          TerminalWebviewProvider.startPolling();
          TerminalWebviewProvider.postSessionsList(payload?.sessionId);
          return;
        }

        case 'ui/terminal/restart': {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder || !payload?.sessionId) return;

          const restartMeta = TerminalWebviewProvider.restartMetaBySession.get(payload.sessionId) || {
            command: String(payload?.command || ''),
            cwd: String(payload?.cwd || '.'),
            cols: Number(payload?.cols || 220),
            rows: Number(payload?.rows || 50),
            initialWaitMs: Number(payload?.initialWaitMs || 1200),
          };
          TerminalWebviewProvider.restartMetaBySession.set(payload.sessionId, restartMeta);

          try {
            await terminalSessionManager.stop({
              session_id: payload.sessionId,
              signal: payload.signal || 'SIGTERM',
              wait_ms: 120,
            });
          } catch {
            // noop
          }

          const nextSessionId = `${payload.sessionId}-restart-${Date.now()}`;
          TerminalWebviewProvider.restartMetaBySession.set(nextSessionId, restartMeta);

          const result = await terminalSessionManager.start({
            session_id: nextSessionId,
            command: restartMeta.command,
            cwd: restartMeta.cwd,
            cols: restartMeta.cols,
            rows: restartMeta.rows,
            initial_wait_ms: restartMeta.initialWaitMs,
            skipApproval: false,
          }, {
            workspaceFolder,
            onStreamOutput: (chunk) => TerminalWebviewProvider.pushOutput(nextSessionId, chunk),
            toolCallId: `terminal_restart_${nextSessionId}`,
          });

          TerminalWebviewProvider.currentSessionId = nextSessionId;
          panel.webview.postMessage({
            type: 'terminal/restarted',
            payload: {
              sessionId: nextSessionId,
              output: result?.output || '',
              snapshot: result?.snapshot,
              restartMeta,
            }
          });
          TerminalWebviewProvider.postBootstrap(restartMeta.cwd);
          TerminalWebviewProvider.startPolling();
          TerminalWebviewProvider.postSessionsList(nextSessionId);
          return;
        }

        case 'ui/terminal/reconnect':
          if (payload?.sessionId) {
            TerminalWebviewProvider.currentSessionId = payload.sessionId;
            TerminalWebviewProvider.postBootstrap();
            TerminalWebviewProvider.startPolling();
            TerminalWebviewProvider.postSessionsList(payload.sessionId);
          }
          return;

        case 'ui/terminal/listSessions':
          TerminalWebviewProvider.postSessionsList(payload?.sessionId);
          return;

        case 'ui/terminal/send': {
          if (!payload?.sessionId || typeof payload?.input !== 'string') return;
          TerminalWebviewProvider.currentSessionId = payload.sessionId;
          const result = await terminalSessionManager.send({
            session_id: payload.sessionId,
            input: payload.input,
            wait_ms: 50,
          });
          if (result?.output) {
            panel.webview.postMessage({
              type: 'terminal/output',
              payload: { sessionId: payload.sessionId, chunk: result.output }
            });
          }
          if (result?.snapshot) {
            panel.webview.postMessage({ type: 'terminal/snapshot', payload: result.snapshot });
          }
          TerminalWebviewProvider.postSessionsList(payload.sessionId);
          return;
        }

        case 'ui/terminal/stop': {
          if (!payload?.sessionId) return;
          TerminalWebviewProvider.currentSessionId = payload.sessionId;
          const result = await terminalSessionManager.stop({
            session_id: payload.sessionId,
            signal: payload.signal || 'SIGKILL',
            wait_ms: payload.force ? 0 : 100,
            force: payload.force,
          });
          panel.webview.postMessage({
            type: 'terminal/stopped',
            payload: {
              sessionId: payload.sessionId,
              output: result?.output || '',
              snapshot: result?.snapshot,
            }
          });
          TerminalWebviewProvider.postSessionsList(payload.sessionId);
          return;
        }
      }
    });

    panel.onDidDispose(() => {
      TerminalWebviewProvider.stopPolling();
      TerminalWebviewProvider.stopListPolling();
      TerminalWebviewProvider.currentPanel = undefined;
    });

    return panel;
  }

  public static attachToSession(sessionId: string, context?: vscode.ExtensionContext) {
    if (context) {
      TerminalWebviewProvider.extensionContext = context;
    }
    TerminalWebviewProvider.currentSessionId = sessionId;
    if (TerminalWebviewProvider.extensionContext) {
      TerminalWebviewProvider.createOrShow(TerminalWebviewProvider.extensionContext, sessionId);
    }
    TerminalWebviewProvider.postBootstrap();
    TerminalWebviewProvider.startPolling();
    TerminalWebviewProvider.startListPolling();
    TerminalWebviewProvider.postSessionsList(sessionId);
  }

  public static pushOutput(sessionId: string, chunk: string) {
    if (!TerminalWebviewProvider.currentPanel) return;
    TerminalWebviewProvider.currentPanel.webview.postMessage({
      type: 'terminal/output',
      payload: { sessionId, chunk }
    });
  }

  public static pushSnapshot(snapshot: TerminalSessionSnapshot) {
    if (!TerminalWebviewProvider.currentPanel) return;
    TerminalWebviewProvider.currentPanel.webview.postMessage({
      type: 'terminal/snapshot',
      payload: snapshot
    });
  }

  private static async postBootstrap(cwd?: string) {
    if (!TerminalWebviewProvider.currentPanel) return;
    const snapshot = TerminalWebviewProvider.currentSessionId
      ? terminalSessionManager.list().find(s => s.sessionId === TerminalWebviewProvider.currentSessionId)
      : undefined;

    let initialOutput = '';
    let refreshedSnapshot = snapshot;

    if (TerminalWebviewProvider.currentSessionId) {
      try {
        const readResult = await terminalSessionManager.read({
          session_id: TerminalWebviewProvider.currentSessionId,
          wait_ms: 0,
        });
        initialOutput = readResult?.output || '';
        if (readResult?.snapshot) {
          refreshedSnapshot = readResult.snapshot;
        }
      } catch {
        // best-effort: bootstrap continua mesmo sem conseguir ler backlog inicial
      }
    }

    TerminalWebviewProvider.currentPanel.webview.postMessage({
      type: 'terminal/bootstrap',
      payload: {
        sessionId: TerminalWebviewProvider.currentSessionId,
        cwd: cwd || refreshedSnapshot?.cwd || '.',
        snapshot: refreshedSnapshot,
        initialOutput,
        restartMeta: TerminalWebviewProvider.currentSessionId
          ? TerminalWebviewProvider.restartMetaBySession.get(TerminalWebviewProvider.currentSessionId)
          : undefined,
      }
    });
  }

  private static postSessionsList(selectedSessionId?: string) {
    if (!TerminalWebviewProvider.currentPanel) return;
    const sessions = terminalSessionManager.list();
    TerminalWebviewProvider.currentPanel.webview.postMessage({
      type: 'terminal/list',
      payload: {
        sessions,
        restartMetaBySession: Object.fromEntries(TerminalWebviewProvider.restartMetaBySession.entries())
      }
    });
    if (selectedSessionId) {
      const snapshot = sessions.find(session => session.sessionId === selectedSessionId);
      if (snapshot) {
        TerminalWebviewProvider.currentPanel.webview.postMessage({ type: 'terminal/snapshot', payload: snapshot });
      }
    }
  }

  private static startPolling() {
    TerminalWebviewProvider.stopPolling();
    // Sempre garante que o polling da lista está rodando ao iniciar o polling de output
    TerminalWebviewProvider.startListPolling();

    TerminalWebviewProvider.pollTimer = setInterval(async () => {
      if (!TerminalWebviewProvider.currentPanel) return;

      // Se não tiver sessionId, tenta pegar a primeira disponível para não ficar parado
      if (!TerminalWebviewProvider.currentSessionId) {
        const sessions = terminalSessionManager.list();
        if (sessions.length > 0) {
          TerminalWebviewProvider.currentSessionId = sessions[0].sessionId;
        } else {
          return;
        }
      }

      try {
        const result = await terminalSessionManager.read({
          session_id: TerminalWebviewProvider.currentSessionId,
          wait_ms: 10,
        });
        
        if (result?.output && TerminalWebviewProvider.currentPanel) {
          TerminalWebviewProvider.currentPanel.webview.postMessage({
            type: 'terminal/output',
            payload: { sessionId: TerminalWebviewProvider.currentSessionId, chunk: result.output }
          });
        }
        
        if (result?.snapshot && TerminalWebviewProvider.currentPanel) {
          TerminalWebviewProvider.currentPanel.webview.postMessage({ type: 'terminal/snapshot', payload: result.snapshot });
        }
      } catch (err) {
        // Se der erro (ex: sessão morreu), tenta atualizar a lista para a UI refletir
        TerminalWebviewProvider.postSessionsList(TerminalWebviewProvider.currentSessionId);
      }
    }, 100);
  }

  private static startListPolling() {
    TerminalWebviewProvider.stopListPolling();
    TerminalWebviewProvider.listPollTimer = setInterval(() => {
      TerminalWebviewProvider.postSessionsList(TerminalWebviewProvider.currentSessionId);
    }, 500);
  }

  private static stopPolling() {
    if (TerminalWebviewProvider.pollTimer) {
      clearInterval(TerminalWebviewProvider.pollTimer);
      TerminalWebviewProvider.pollTimer = undefined;
    }
  }

  private static stopListPolling() {
    if (TerminalWebviewProvider.listPollTimer) {
      clearInterval(TerminalWebviewProvider.listPollTimer);
      TerminalWebviewProvider.listPollTimer = undefined;
    }
  }

  private static getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {
    const webRoot = path.join(context.extensionPath, 'src', 'ui', 'terminal', 'view');
    const distRoot = path.join(context.extensionPath, 'dist', 'ui', 'terminal', 'view');
    const htmlPath = path.join(webRoot, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const value = nonce();
    const timestamp = Date.now();
    const appJsPath = path.join(distRoot, 'app.js');
    const appJsUri = webview.asWebviewUri(vscode.Uri.file(appJsPath)).with({ query: `v=${timestamp}` });

    return html
      .replace(/{{NONCE}}/g, value)
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(/{{APP_JS_URI}}/g, appJsUri.toString());
  }
}
