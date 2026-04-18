import { Frame, State } from '../protocol/frames';

export type UIEventType = 
  | 'STATE_CHANGED' 
  | 'TOOL_STARTED' 
  | 'TOOL_FINISHED' 
  | 'TOOL_STREAM'
  | 'CLAUDE_SESSION'
  | 'TEXT_CHUNK' 
  | 'FRAME_EMITTED'
  | 'LOG_HINT'
  | 'FILE_STATS'
  | 'STREAMING_FINISHED'
  | 'COMMAND_PREVIEW'
  | 'CONTEXT_COMPACTED'
  | 'PLAN_UPDATED'
  | 'LOOP_PAUSED'
  | 'LOOP_INTERRUPTED'
  | 'QUEUED_MESSAGE_CONSUMED'
  | 'USAGE'
  | 'SUBAGENT_STATE_CHANGED';

export type ToolStreamMode = 'text' | 'diff' | 'json';

export interface ToolStreamPayload {
  id: string;
  delta: string;
  mode?: ToolStreamMode;
}


export interface UIEvent {
  type: UIEventType;
  payload: any;
}

export type UIListener = (event: UIEvent) => void;

export class UIBus {
  private static listeners: UIListener[] = [];

  static subscribe(listener: UIListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  static emit(event: UIEvent) {
    this.listeners.forEach(l => l(event));
  }
}