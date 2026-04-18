export type State = 'AGENT' | 'CHAT' | 'HYPER_FLOW' | 'PLANNING';

export interface ToolCall {
  id: string;
  name: string;
  args: any;
}

export interface ToolResult {
  id: string;
  name: string;
  ok: boolean;
  // Carrega os args originais da tool para a UI (ex: path) e debug.
  // Isso é especialmente importante quando o resultado não contém `path`.
  args?: any;
  result?: any;
  error?: string;
  timestamp?: number;
}

export interface StateRequest {
  nextState: State;
  reason: string;
}

export interface StateChange {
  state: State;
  cause: string;
  from: State;
}

export interface PlanProposed {
  id: string;
  goal: string;
  steps: {
    description: string;
    doneWhen: string;
  }[];
  risks?: string;
}

export interface PatchProposed {
  id: string;
  files: string[];
  diffSummary: string;
  patch: string;
}

export interface VerifyReport {
  id: string;
  pass: boolean;
  checks: string[];
  issues: string[];
  recommendNext: State;
}

export interface KbUpsert {
  id: string;
  entries: {
    canonicalQuestion: string;
    answer: string;
    reference: string;
  }[];
}

export type Frame = 
  | { type: 'TOOL_CALL', payload: ToolCall }
  | { type: 'TOOL_RESULT', payload: ToolResult }
  | { type: 'STATE_REQUEST', payload: StateRequest }
  | { type: 'STATE_CHANGE', payload: StateChange }
  | { type: 'PLAN_PROPOSED', payload: PlanProposed }
  | { type: 'PATCH_PROPOSED', payload: PatchProposed }
  | { type: 'VERIFY_REPORT', payload: VerifyReport }
  | { type: 'KB_UPSERT', payload: KbUpsert };