import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ExecuteToolOptions } from './types';
import { optimizeInlineImageAttachment } from '../utils/imageAttachmentProcessing';

interface AdbScreenshotImageAttachment {
  name?: string;
  mimeType: string;
  dataBase64: string;
}

const execFileAsync = promisify(execFile);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface AdbScreenshotArgs {
  deviceId?: string;
  savePath?: string;  // padrão: /tmp/adb_screenshot_<ts>.png
  displayId?: string | number;
}

function buildDeviceArgs(deviceId?: string): string[] {
  return deviceId ? ['-s', deviceId] : [];
}

function buildScreencapArgs(displayId?: string | number): string[] {
  const args = ['screencap', '-p'];
  if (displayId !== undefined && displayId !== null && String(displayId).trim() !== '') {
    args.push('-d', String(displayId).trim());
  }
  return args;
}

function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function normalizeShellScreencapBuffer(buf: Buffer): Buffer {
  if (isPngBuffer(buf)) return buf;

  const normalized = Buffer.from(
    buf
      .toString('binary')
      .replace(/\r\r\n/g, '\n')
      .replace(/\r\n/g, '\n'),
    'binary'
  );

  return normalized;
}

async function captureViaExecOut(deviceArgs: string[], displayId?: string | number): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    'adb',
    [...deviceArgs, 'exec-out', ...buildScreencapArgs(displayId)],
    { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }
  );

  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function captureViaShellToTempFile(deviceArgs: string[], displayId?: string | number): Promise<Buffer> {
  const remotePath = `/sdcard/__jarvis_adb_screenshot_${Date.now()}.png`;
  const localTempPath = path.join(os.tmpdir(), `jarvis_adb_screenshot_${Date.now()}.png`);

  try {
    await execFileAsync(
      'adb',
      [...deviceArgs, 'shell', ...buildScreencapArgs(displayId), remotePath],
      { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 }
    );

    await execFileAsync(
      'adb',
      [...deviceArgs, 'pull', remotePath, localTempPath],
      { encoding: 'utf8', timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }
    );

    return await fs.readFile(localTempPath);
  } finally {
    await Promise.allSettled([
      fs.unlink(localTempPath),
      execFileAsync('adb', [...deviceArgs, 'shell', 'rm', '-f', remotePath], {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      })
    ]);
  }
}

export async function executeAdbScreenshot(
  args: AdbScreenshotArgs,
  _options?: ExecuteToolOptions
): Promise<any> {
  const start = Date.now();
  const deviceArgs = buildDeviceArgs(args.deviceId);
  const savePath = args.savePath ?? `/tmp/adb_screenshot_${Date.now()}.png`;

  try {
    let buf = await captureViaExecOut(deviceArgs, args.displayId);
    let strategy = 'exec-out';

    if (buf.length === 0) {
      throw new Error('Buffer vazio — dispositivo conectado e autorizado?');
    }

    if (!isPngBuffer(buf)) {
      const normalized = normalizeShellScreencapBuffer(buf);
      if (isPngBuffer(normalized)) {
        buf = normalized;
        strategy = 'exec-out(normalized)';
      } else {
        buf = await captureViaShellToTempFile(deviceArgs, args.displayId);
        strategy = 'shell+pull';
      }
    }

    if (!isPngBuffer(buf)) {
      throw new Error('Não foi possível obter um PNG válido via exec-out nem via fallback shell/pull');
    }

    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, buf);

    const imageAttachment = await optimizeInlineImageAttachment<AdbScreenshotImageAttachment>({
      name: path.basename(savePath),
      mimeType: 'image/png',
      dataBase64: buf.toString('base64')
    });

    return {
      message: `✅ Screenshot salvo em: ${savePath} (${Math.round(buf.length / 1024)} KB, ${Date.now() - start}ms, via ${strategy})`,
      path: savePath,
      strategy,
      sizeBytes: buf.length,
      images: [imageAttachment],
      attachments: [imageAttachment]
    };
  } catch (err: any) {
    return {
      message: `❌ Falha ao capturar screenshot ADB: ${err?.message ?? String(err)}`,
      error: err?.message ?? String(err)
    };
  }
}