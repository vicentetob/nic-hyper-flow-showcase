import { ExecuteToolOptions } from './types';
import { terminalSessionManager } from './terminal_session_manager';

export async function executeTerminalStop(
  args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<any> {
  return terminalSessionManager.stop({
    session_id: args?.session_id,
    signal: args?.signal,
    wait_ms: args?.wait_ms,
  });
}
