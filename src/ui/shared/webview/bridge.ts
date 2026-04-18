/**
 * Bridge para comunicação entre Webview e VS Code Extension
 * Centraliza postMessage e handlers
 */

declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

type MessageType = string;
type MessagePayload = any;
type MessageHandler = (payload: MessagePayload) => void;

class WebviewBridge {
  private vscode: ReturnType<typeof acquireVsCodeApi>;
  private handlers: Map<MessageType, MessageHandler[]> = new Map();

  constructor() {
    this.vscode = acquireVsCodeApi();
    this.setupMessageListener();
  }

  /**
   * Envia mensagem para a extensão
   */
  post(type: MessageType, payload?: MessagePayload): void {
    this.vscode.postMessage({ type, payload });
  }

  /**
   * Registra handler para mensagens da extensão
   */
  on(type: MessageType, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);

    // Retorna função para remover handler
    return () => {
      const handlers = this.handlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Roteia mensagem recebida para handlers registrados
   */
  private routeMessage(type: MessageType, payload: MessagePayload): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[Bridge] Error in handler for ${type}:`, error);
        }
      });
    }
  }

  /**
   * Configura listener global para mensagens
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message && message.type) {
        this.routeMessage(message.type, message.payload);
      }
    });
  }

  /**
   * Acesso ao vscode API (para getState/setState se necessário)
   */
  getVscode() {
    return this.vscode;
  }
}

// Singleton instance
let bridgeInstance: WebviewBridge | null = null;

export function getBridge(): WebviewBridge {
  if (!bridgeInstance) {
    bridgeInstance = new WebviewBridge();
    // Expõe globalmente para outros componentes (como patch widget) acessarem
    (window as any).__bridge = bridgeInstance;
  }
  return bridgeInstance;
}
