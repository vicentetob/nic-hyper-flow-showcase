import * as vscode from 'vscode';

export interface EditApprovalRequest {
  toolName: string;
  summary: string;
  files: string[];
  args?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface JarvisToolRequest {
  name: string;
  args?: Record<string, any>;
}

export interface JarvisToolResult {
  name: string;
  success: boolean;
  result?: any;
  error?: string;
  durationMs: number;
  /**
   * Identificador temporal único desta execução (timestamp em ms)
   */
  runId?: number;
  /**
   * Fase da execução (ex: "before_patch", "after_patch", "verification", "initial_scan")
   */
  phase?: string;
  /**
   * Causa/reason da execução (ex: "patch_applied:lib/main.dart", "initial_lint_scan")
   */
  cause?: string;
}

export type JarvisEditType = 'patch' | 'replace' | 'create' | 'delete' | 'patch_file';

export interface JarvisEdit {
  path: string;
  type: JarvisEditType;
  patch?: string;
  content?: string;
  /**
   * Alvo semântico opcional para PATCH (ex: nome da função/método).
   * Observação: o runtime aplica PATCH por diff no arquivo; este campo pode existir
   * por compatibilidade com formatos antigos, mas não é necessário para aplicar diffs.
   */
  symbol?: string;


  /**
   * PATCH_FILE: edição por texto exato (substitui exact_match por replacement).
   */
  patchFile?: {
    file_path: string;
    exact_match: string;
    replacement: string;
    occurrence?: number;
    require_unique?: boolean;
  };
}

export interface ExecuteToolOptions {
  workspaceFolder: vscode.WorkspaceFolder;
  outputChannel: vscode.OutputChannel;
  searchMaxResults: number;
  lintCommand?: string;
  lintTimeoutMs?: number;
  notify?: (text: string) => void;
  signal?: AbortSignal;
  sidebarProvider?: any; // JarvisSidebarProvider (opcional para evitar dependência circular)
  toolCallId?: string;
  chatId?: string;
  /**
   * messageId do turno/mensagem do assistant ao qual essas tools pertencem.
   * Usado pelo app mobile para renderizar tools no modo tool-calling.
   */
  messageId?: string;
  /** Callback para streaming de output em tempo real (usado por run_command) */
  fileTracker?: any;
  onStreamOutput?: (chunk: string) => void;
  /** Callback opcional para eventos estruturados de progresso de tools/sessões longas (ex: Claude Code). */
  onStructuredToolEvent?: (event: { type: string; payload: any }) => void;
  /** Callback opcional para aprovar/rejeitar operações que editam código/arquivos. */
  requestEditApproval?: (request: EditApprovalRequest) => Promise<{ approved: boolean; userMessage?: string }>;
  /** Base URL for backend API calls (e.g., https://us-central1-your-project.cloudfunctions.net) */
  backendBaseUrl?: string;
  /** NIC token for authentication with backend services */
  nicToken?: string;
  /** Device ID for device-specific operations */
  deviceId?: string;
  /** ID do subagente (usado por report_subagent_state para identificar quem está reportando) */
  subAgentId?: string;
  /** Label de exibição do subagente */
  subAgentLabel?: string;
}

export type PatchPreflightSnippet = {
  header: string;
  startLine: number; // 1-based
  endLine: number; // 1-based inclusive
  snippet: string;
};

export type PatchPreflightPayload = {
  path: string;
  fileHash: string;
  patchHash: string;
  snippets: PatchPreflightSnippet[];
  summary: string;
  /**
   * Instruções curtas e explícitas para o modelo montar o unified diff corretamente
   * (especialmente as linhas de contexto com prefixo ' ').
   */
  instructions?: string;
  /**
   * Opcional: quando houver múltiplos PATCHes para o mesmo arquivo no mesmo batch,
   * enviamos preflight uma única vez com os snippets de cada patch.
   */
  patches?: Array<{
    patchHash: string;
    snippets: PatchPreflightSnippet[];
  }>;
};

export type PatchPreflightRequiredError = Error & {
  code: 'PATCH_PREFLIGHT_REQUIRED';
  preflight: PatchPreflightPayload;
};

export interface PatchInfo {
  contextStart: number;
  contextLines: number;
  removedLines: string[];
  addedLines: string[];
  contextBefore?: string[]; // Linhas de contexto antes (linhas que começam com espaço)
  contextAfter?: string[]; // Linhas de contexto depois (linhas que começam com espaço)
}





