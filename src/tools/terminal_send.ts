import { ExecuteToolOptions } from './types';
import { terminalSessionManager } from './terminal_session_manager';

export async function executeTerminalSend(
  args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<any> {
  return terminalSessionManager.send({
    session_id: args?.session_id,
    input: args?.input,
    wait_ms: args?.wait_ms,
  });
}
