import { Frame, State } from './frames';

export class ProtocolValidator {
  static validateFrame(frame: Frame): boolean {
    if (!frame.type || !frame.payload) return false;
    
    switch (frame.type) {
      case 'TOOL_CALL':
        return !!(frame.payload.id && frame.payload.name && frame.payload.args);
      case 'STATE_REQUEST':
        return !!(frame.payload.nextState && frame.payload.reason);
      case 'PLAN_PROPOSED':
        return !!(frame.payload.id && frame.payload.goal && Array.isArray(frame.payload.steps));
      default:
        return true;
    }
  }

  static validateStateTransition(from: State, to: State, allowed: Record<State, State[]>): boolean {
    return allowed[from]?.includes(to) ?? false;
  }
}