import { Frame } from '../protocol/frames';

// Tipos locais para substituir @google/generative-ai
interface Tool {
  functionDeclarations: any[];
}

interface ToolConfig {
  functionCallingConfig: {
    mode: string;
  };
}

export interface ToolCallDelta {
  /** Provider tool_call id (quando disponível) */
  id: string;
  /** Tool/function name */
  name: string;
  /** JSON arguments buffer (texto) acumulado até agora */
  argumentsText: string;
  /** True quando o provider indicou que o tool-call foi fechado */
  isFinal?: boolean;
}

export interface ModelEvent {
  type: 'text' | 'thought' | 'frame' | 'raw' | 'debug' | 'tool_call_delta' | 'usage' | 'error';
  content?: string;
  frame?: Frame;
  raw?: any;
  debug?: any;
  toolCallDelta?: ToolCallDelta;
  payload?: any;
}

export interface StreamOptions {
  tools?: Tool[];
  toolConfig?: ToolConfig;
  currentPlan?: any;
  estimatedTokens?: number;
  signal?: AbortSignal;
}

export interface ModelAdapter {
  stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent>;
  supportsVision(): Promise<boolean>;
  supportsNativeToolCalling(): Promise<boolean>;
}
