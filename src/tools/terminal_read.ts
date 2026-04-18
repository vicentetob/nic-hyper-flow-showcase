import { ExecuteToolOptions } from './types';
import { terminalSessionManager } from './terminal_session_manager';

function normalizeTerminalLineForDedup(line: string): string {
  const trimmed = line.trim();

  if (!trimmed) {
    return '__EMPTY_LINE__';
  }

  const spinnerOnly = trimmed.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\\-]/g, '').trim();
  if (!spinnerOnly) {
    return '__SPINNER_FRAME__';
  }

  return trimmed
    .replace(/\b\d{1,3}%\b/g, '__PERCENT__')
    .replace(/\b\d+\/\d+\b/g, '__RATIO__')
    .replace(/\[[=\-#>\s]{3,}\]/g, '[__PROGRESS_BAR__]')
    .replace(/\((?:\d+|\d+\.\d+)(?:s|ms|m|h)\)/gi, '(__DURATION__)')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|m|h)\b/gi, '__DURATION__')
    .replace(/\b\d+(?:\.\d+)?(?:kb|mb|gb|tb|b)\b/gi, '__SIZE__')
    .replace(/\b\d+\b/g, '__NUM__');
}

function dedupeConsecutiveTerminalLines(output: string): string {
  if (!output) return output;

  const lines = output.split('\n');
  const result: string[] = [];
  let currentLine: string | null = null;
  let currentKey: string | null = null;
  let count = 0;

  const flush = () => {
    if (currentLine === null || currentKey === null) return;

    if (currentKey === '__EMPTY_LINE__') {
      result.push('');
      if (count > 1) {
        result.push(`(+ ${count - 1} linhas vazias consecutivas)`);
      }
      return;
    }

    if (currentKey === '__SPINNER_FRAME__') {
      result.push(currentLine);
      if (count > 1) {
        result.push(`(+ ${count - 1} frames consecutivos de spinner/redraw)`);
      }
      return;
    }

    result.push(currentLine);
    if (count > 1) {
      result.push(`(+ ${count - 1} repetições consecutivas)`);
    }
  };

  for (const line of lines) {
    const key = normalizeTerminalLineForDedup(line);

    if (currentLine === null || currentKey === null) {
      currentLine = line;
      currentKey = key;
      count = 1;
      continue;
    }

    if (key === currentKey) {
      count += 1;
      continue;
    }

    flush();
    currentLine = line;
    currentKey = key;
    count = 1;
  }

  flush();
  return result.join('\n');
}

export async function executeTerminalRead(
  args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<any> {
  const result = await terminalSessionManager.read({
    session_id: args?.session_id,
    wait_ms: args?.wait_ms,
  });

  if (typeof result?.output === 'string' && result.output.length > 0) {
    result.output = dedupeConsecutiveTerminalLines(result.output);
  }

  return result;
}
