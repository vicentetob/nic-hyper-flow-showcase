/**
 * ADB_INPUT — Envia eventos de toque, swipe, texto e teclas para um dispositivo Android via ADB.
 * Complementa adb_screenshot para fechar o loop de interação com o device.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { ExecuteToolOptions } from './types';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Tipos de ações suportadas
// ---------------------------------------------------------------------------

export type AdbInputActionType =
  | 'tap'        // Toque em coordenadas absolutas
  | 'long_tap'   // Toque longo (útil para menus de contexto)
  | 'swipe'      // Swipe entre dois pontos (scroll, drag, etc)
  | 'text'       // Digita texto no campo focado
  | 'keyevent'   // Envia uma tecla (back, home, enter, etc)
  | 'get_size';  // Retorna a resolução do device (útil antes de calcular coordenadas)

export type AdbInputAction =
  | { type: 'tap';       x: number; y: number }
  | { type: 'long_tap';  x: number; y: number; durationMs?: number }
  | { type: 'swipe';     x1: number; y1: number; x2: number; y2: number; durationMs?: number }
  | { type: 'text';      value: string }
  | { type: 'keyevent';  keycode: AdbKeycode | number }
  | { type: 'get_size' };

// Keycodes mais comuns — o modelo pode usar o nome ou o número direto
export type AdbKeycode =
  | 'BACK'       // 4
  | 'HOME'       // 3
  | 'MENU'       // 82
  | 'ENTER'      // 66
  | 'DEL'        // 67  (backspace)
  | 'DPAD_UP'    // 19
  | 'DPAD_DOWN'  // 20
  | 'DPAD_LEFT'  // 21
  | 'DPAD_RIGHT' // 22
  | 'VOLUME_UP'  // 24
  | 'VOLUME_DOWN'// 25
  | 'POWER'      // 26
  | 'TAB'        // 61
  | 'ESCAPE';    // 111

const KEYCODE_MAP: Record<AdbKeycode, number> = {
  BACK: 4,
  HOME: 3,
  MENU: 82,
  ENTER: 66,
  DEL: 67,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  TAB: 61,
  ESCAPE: 111,
};

// ---------------------------------------------------------------------------
// Args da tool
// ---------------------------------------------------------------------------

export interface AdbInputArgs {
  actions: AdbInputAction[];
  deviceId?: string;   // -s <serial> — omitir se houver apenas um device
  delayMs?: number;    // delay entre ações (padrão: 100ms)
}

// ---------------------------------------------------------------------------
// Resultado de cada ação
// ---------------------------------------------------------------------------

interface ActionResult {
  type: AdbInputActionType;
  success: boolean;
  value?: string;    // para get_size
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deviceArgs(deviceId?: string): string[] {
  return deviceId ? ['-s', deviceId] : [];
}

async function adb(deviceId: string | undefined, shellArgs: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'adb',
    [...deviceArgs(deviceId), 'shell', ...shellArgs],
    { encoding: 'utf8', timeout: 10_000 }
  );
  return stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resolveKeycode(keycode: AdbKeycode | number): number {
  if (typeof keycode === 'number') return keycode;
  return KEYCODE_MAP[keycode] ?? (() => { throw new Error(`Keycode desconhecido: ${keycode}`); })();
}

// ---------------------------------------------------------------------------
// Executor de ação individual
// ---------------------------------------------------------------------------

async function runAction(
  action: AdbInputAction,
  deviceId?: string
): Promise<ActionResult> {
  const start = Date.now();
  const base: Omit<ActionResult, 'durationMs'> = { type: action.type, success: false };

  try {
    switch (action.type) {

      case 'tap': {
        await adb(deviceId, ['input', 'tap', String(action.x), String(action.y)]);
        base.success = true;
        break;
      }

      case 'long_tap': {
        const duration = action.durationMs ?? 800;
        // long press = swipe no mesmo ponto com duração
        await adb(deviceId, [
          'input', 'swipe',
          String(action.x), String(action.y),
          String(action.x), String(action.y),
          String(duration)
        ]);
        base.success = true;
        break;
      }

      case 'swipe': {
        const duration = action.durationMs ?? 300;
        await adb(deviceId, [
          'input', 'swipe',
          String(action.x1), String(action.y1),
          String(action.x2), String(action.y2),
          String(duration)
        ]);
        base.success = true;
        break;
      }

      case 'text': {
        if (!action.value) throw new Error('text requer "value"');
        // Escapa caracteres especiais para o shell do Android
        const escaped = action.value
          .replace(/\\/g, '\\\\')
          .replace(/ /g, '%s')
          .replace(/'/g, "\\'")
          .replace(/"/g, '\\"')
          .replace(/&/g, '\\&')
          .replace(/;/g, '\\;')
          .replace(/</g, '\\<')
          .replace(/>/g, '\\>');
        await adb(deviceId, ['input', 'text', escaped]);
        base.success = true;
        break;
      }

      case 'keyevent': {
        const code = resolveKeycode(action.keycode);
        await adb(deviceId, ['input', 'keyevent', String(code)]);
        base.success = true;
        break;
      }

      case 'get_size': {
        const output = await adb(deviceId, ['wm', 'size']);
        // "Physical size: 1080x2400" ou "Override size: 1080x2400"
        const match = output.match(/(\d+x\d+)/);
        base.value = match ? match[1] : output;
        base.success = true;
        break;
      }

      default: {
        throw new Error(`Tipo de ação desconhecido: ${(action as any).type}`);
      }
    }
  } catch (err: any) {
    base.error = err?.message ?? String(err);
  }

  return { ...base, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Formatação do resultado
// ---------------------------------------------------------------------------

function formatResults(results: ActionResult[]): string {
  const lines: string[] = [`ADB_INPUT — ${results.length} ação(ões) executada(s)\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.success ? '✅' : '❌';
    lines.push(`${status} [${i + 1}] ${r.type} (${r.durationMs}ms)`);
    if (r.value !== undefined) lines.push(`   → ${r.value}`);
    if (r.error)               lines.push(`   ⚠️  Erro: ${r.error}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point da tool
// ---------------------------------------------------------------------------

export async function executeAdbInput(
  args: AdbInputArgs,
  _options?: ExecuteToolOptions
): Promise<string> {
  if (!args.actions || args.actions.length === 0) {
    return 'Erro: "actions" é obrigatório e deve ser um array não-vazio.';
  }

  const delay = args.delayMs ?? 100;
  const results: ActionResult[] = [];

  for (let i = 0; i < args.actions.length; i++) {
    const result = await runAction(args.actions[i], args.deviceId);
    results.push(result);

    // Delay entre ações (exceto após a última)
    if (i < args.actions.length - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  return formatResults(results);
}