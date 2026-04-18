import { ExecuteToolOptions } from './types';
import { terminalSessionManager } from './terminal_session_manager';

export async function executeTerminalList(
  _args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<any> {
  return {
    sessions: terminalSessionManager.list(),
  };
}
