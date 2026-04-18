import { ExecuteToolOptions } from './types';
import { terminalSessionManager } from './terminal_session_manager';
import { vscodeTerminalBridge } from '../ui/terminal/vscodeTerminalBridge';

export async function executeTerminalStart(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const result = await terminalSessionManager.start({
    session_id: args?.session_id,
    command: args?.command,
    cwd: args?.cwd,
    shell: args?.shell,
    cols: args?.cols,
    rows: args?.rows,
    initial_wait_ms: args?.initial_wait_ms,
    skipApproval: args?.skipApproval,
  }, {
    workspaceFolder: options.workspaceFolder,
    onStreamOutput: options.onStreamOutput,
    toolCallId: options.toolCallId,
  });

  const sessionId = result?.session_id ?? args?.session_id;
  if (sessionId) {
    vscodeTerminalBridge.createOrShow(String(sessionId));
  }

  return result;
}
