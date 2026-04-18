import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import sharp from 'sharp';
import { ExecuteToolOptions } from './types';
import { CredentialsManager } from '../core/credentials';
import { executeTinifyApi } from './tinify_api';

/**
 * Generates assets/images using GPT-Image-1.5 or Nano Banana 2 API.
 *
 * Nano Banana 2 (Google Gemini 3.1 Flash Image) is the state-of-the-art model:
 * 4x faster and higher quality than previous versions.
 *
 * PARAMETERS:
 * - prompt (required): Detailed visual description.
 * - path (required): Local file path to save the asset (e.g., "assets/cover.png").
 * - model: "gpt-image-1.5" or "nano-banana" (latest Google model via fal.ai, 4x faster).
 *          If not provided, uses the value from VS Code settings.
 * - background: "transparent" (ESSENTIAL for icons/logos/sprites) or "opaque" (default).
 * - quality: "auto" (lower cost) or "hd" (higher cost).
 * - size: "1024x1024" (default), "1024x1792", "1792x1024",
 *         "a4"           → generates 1024x1536, then upscales to 2480x3508 px (A4 @ 300 dpi, portrait)
 *         "a4-landscape" → generates 1536x1024, then upscales to 3508x2480 px (A4 @ 300 dpi, landscape)
 * - n: Number of images (1-4).
 *
 * A4 UPSCALE NOTES:
 *   The API only supports up to 1536 px on the longest side, so A4 at 300 dpi
 *   (2480×3508) is not natively reachable. When a4Mode is active the tool
 *   automatically upscales the saved file with `sharp` (lanczos3) to the exact
 *   A4 300-dpi dimensions and saves a second file alongside the original:
 *     my-cover.png        ← original 1024x1536
 *     my-cover_a4.png     ← upscaled 2480x3508 (ready for print / PDF)
 *
 *   Add to your prompt for best results:
 *     "A4 print layout, vertical page design, generous white margins for printing"
 */

// ─── A4 constants (300 dpi) ───────────────────────────────────────────────────

const A4_PORTRAIT  = { width: 2480, height: 3508 } as const;
const A4_LANDSCAPE = { width: 3508, height: 2480 } as const;

const A4_SIZES           = new Set(['a4', 'a4-portrait', 'a4portrait']);
const A4_LANDSCAPE_SIZES = new Set(['a4-landscape', 'a4landscape', 'a4-land']);

// ─── Types ────────────────────────────────────────────────────────────────────

type ResolvedSize = {
  openai: string;
  falAspect: string;
  a4Mode: boolean;
  a4Orientation: 'portrait' | 'landscape' | null;
};

type SavedAssetInfo = {
  index: number;
  requestedPath: string;
  savedPath: string;
  a4UpscaledPath?: string;
  reason?: string;
};

type GenerateAssetsResult = {
  images: Array<{ index: number; b64_json?: string }>;
  meta?: Record<string, any>;
  suggested?: Record<string, any>;
  saved?: SavedAssetInfo[];
  warnings?: string[];
};

// ─── Size resolution ──────────────────────────────────────────────────────────

function resolveSize(rawSize: string): ResolvedSize {
  const s = rawSize.trim().toLowerCase();

  if (A4_SIZES.has(s)) {
    return { openai: '1024x1536', falAspect: '9:16', a4Mode: true, a4Orientation: 'portrait' };
  }
  if (A4_LANDSCAPE_SIZES.has(s)) {
    return { openai: '1536x1024', falAspect: '16:9', a4Mode: true, a4Orientation: 'landscape' };
  }

  // Legacy / explicit sizes
  if (s === '1024x1792') return { openai: '1024x1536', falAspect: '9:16', a4Mode: false, a4Orientation: null };
  if (s === '1792x1024') return { openai: '1536x1024', falAspect: '16:9', a4Mode: false, a4Orientation: null };
  if (['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(s)) {
    const falAspect = s === '1536x1024' ? '16:9' : s === '1024x1536' ? '9:16' : '1:1';
    return { openai: s, falAspect, a4Mode: false, a4Orientation: null };
  }

  return { openai: 'auto', falAspect: '1:1', a4Mode: false, a4Orientation: null };
}

// ─── A4 upscale ───────────────────────────────────────────────────────────────

/**
 * Upscales `sourcePath` to exact A4 dimensions at 300 dpi using sharp (lanczos3).
 * Saves the result as `<basename>_a4<ext>` in the same directory.
 * Returns the path of the upscaled file.
 */
async function upscaleToA4(sourcePath: string, orientation: 'portrait' | 'landscape'): Promise<string> {
  const { dir, base, ext } = splitName(sourcePath);
  const outPath = path.join(dir, `${base}_a4${ext}`);
  const { width, height } = orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT;

  await sharp(sourcePath)
    .resize(width, height, {
      fit: 'fill',                    // exact dimensions, no cropping
      kernel: sharp.kernel.lanczos3, // best quality upscale kernel
    })
    .withMetadata({ density: 300 })  // embed 300 dpi in file metadata
    .toFile(outPath);

  return outPath;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeFormat(fmt: string) {
  const f = (fmt || '').trim().toLowerCase();
  if (!f) return 'png';
  if (f === 'jpg') return 'jpeg';
  return f;
}

function ensureExt(filePath: string, outputFormat: string) {
  return path.extname(filePath) ? filePath : `${filePath}.${outputFormat}`;
}

function isLikelyDirectoryPath(p: string) {
  const trimmed = p.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(path.sep) || trimmed.endsWith('/') || trimmed.endsWith('\\')) return true;
  return path.extname(trimmed).length === 0;
}

async function ensureDirExists(dirPath: string) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function fileExists(p: string) {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function splitName(filePath: string) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return { dir, base, ext };
}

async function findNonCollidingPath(
  targetPath: string,
  maxTries = 999
): Promise<{ finalPath: string; changed: boolean; attempts: number }> {
  const { dir, base, ext } = splitName(targetPath);
  let candidate = path.join(dir, `${base}${ext}`);
  if (!(await fileExists(candidate))) return { finalPath: candidate, changed: false, attempts: 0 };

  for (let i = 1; i <= maxTries; i++) {
    candidate = path.join(dir, `${base}${i}${ext}`);
    if (!(await fileExists(candidate))) return { finalPath: candidate, changed: true, attempts: i };
  }

  throw new Error(`Could not find a free filename after ${maxTries} attempts for: ${targetPath}`);
}

async function writeBufferWithCollisionAvoidance(
  requestedPath: string,
  buffer: Buffer,
  warnings: string[]
): Promise<{ savedPath: string; reason?: string }> {
  const absRequested = path.resolve(requestedPath);
  const dir = path.dirname(absRequested);

  await ensureDirExists(dir);

  let lastErr: any = null;

  for (let attempt = 0; attempt < 50; attempt++) {
    const { finalPath, changed, attempts } = await findNonCollidingPath(absRequested);
    const tmpPath = path.join(
      dir,
      `.${path.basename(finalPath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );

    try {
      await fs.promises.writeFile(tmpPath, buffer);

      if (await fileExists(finalPath)) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        lastErr = Object.assign(new Error('EEXIST: target appeared during write'), { code: 'EEXIST' });
        continue;
      }

      await fs.promises.rename(tmpPath, finalPath);

      if (changed) {
        warnings.push(
          `WARNING: requested asset path already existed, saved as "${finalPath}" (suffix ${attempts}).`
        );
        return { savedPath: finalPath, reason: 'file already existed, used numeric suffix' };
      }

      return { savedPath: finalPath };
    } catch (err: any) {
      lastErr = err;
      await fs.promises.unlink(tmpPath).catch(() => {});
      if (err?.code === 'EEXIST') continue;
      throw new Error(`Failed to write asset to disk: ${err?.message || String(err)}`);
    }
  }

  throw new Error(
    `Failed to write asset after multiple attempts. Last error: ${lastErr?.message || String(lastErr)}`
  );
}

// ─── API callers ──────────────────────────────────────────────────────────────

async function localGenerateAssets(
  apiKey: string,
  body: Record<string, any>,
  resolved: ResolvedSize,
  timeoutMs: number
): Promise<GenerateAssetsResult> {
  const url = 'https://api.openai.com/v1/images/generations';
  const model = 'gpt-image-1.5';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const openaiBody = {
      model,
      prompt: body.prompt,
      n: body.n || 1,
      size: resolved.openai,
      quality: 'high',
      background: body.background || 'transparent',
      output_format: body.outputFormat || 'png',
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(openaiBody),
      signal: ctrl.signal,
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(`${model} API failed: ${data?.error?.message || `HTTP ${resp.status}`}`);
    }

    return {
      images: data.data.map((img: any, idx: number) => ({ index: idx, b64_json: img.b64_json })),
      meta: {
        model,
        resolvedSize: resolved.openai,
        a4Mode: resolved.a4Mode,
        ...(resolved.a4Orientation ? { a4Orientation: resolved.a4Orientation } : {}),
      },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`${model} API timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function falGenerateAssets(
  apiKey: string,
  body: Record<string, any>,
  resolved: ResolvedSize,
  timeoutMs: number
): Promise<GenerateAssetsResult> {
  const url = 'https://fal.run/fal-ai/nano-banana-2';
  const model = 'fal-ai/nano-banana-2';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const falBody = {
      prompt: body.prompt,
      num_images: body.n || 1,
      aspect_ratio: resolved.falAspect,
      output_format: body.outputFormat || 'png',
      sync_mode: true,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(falBody),
      signal: ctrl.signal,
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(`${model} API failed: ${data?.detail || data?.error || `HTTP ${resp.status}`}`);
    }

    const images = (data.images || []).map((img: any, i: number) => {
      let b64 = img.url;
      if (b64.startsWith('data:')) b64 = b64.split(',')[1];
      return { index: i, b64_json: b64 };
    });

    return {
      images,
      meta: {
        model,
        requestId: data.request_id,
        resolvedAspect: resolved.falAspect,
        a4Mode: resolved.a4Mode,
        ...(resolved.a4Orientation ? { a4Orientation: resolved.a4Orientation } : {}),
      },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`${model} API timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function executeGenerateAssets(
  args: Record<string, any>,
  _options: ExecuteToolOptions
): Promise<GenerateAssetsResult> {
  const config = vscode.workspace.getConfiguration('nic-hyper-flow');
  const defaultModel = config.get<string>('defaultImageModel', 'gpt-image-1.5');
  const model = String(args.model || defaultModel).trim().toLowerCase();
  const isNanoBanana = model === 'nano-banana' || model.includes('banana');

  if (!args.prompt || !args.path) {
    throw new Error('Faltam argumentos obrigatórios: prompt e path.');
  }

  const credentials = CredentialsManager.getInstance();
  let apiKey: string | undefined;

  if (isNanoBanana) {
    apiKey =
      (await credentials.getSecret('apiKey:fal')) ||
      (await credentials.getSecret('apiKey:google'));
    if (!apiKey) throw new Error('Chave de API (Fal ou Google) não encontrada para o modelo Nano Banana.');
  } else {
    apiKey = await credentials.getSecret('apiKey:openai');
    if (!apiKey) throw new Error('OpenAI API Key not found for gpt-image-1.5.');
  }

  const rawPrompt = String(args.prompt).trim();
  const resolved  = resolveSize(String(args.size || '1024x1024').trim());
  const a4PromptHint =
    resolved.a4Orientation === 'landscape'
      ? 'A4 print layout, horizontal landscape page design'
      : resolved.a4Orientation === 'portrait'
      ? 'A4 print layout, vertical portrait page design'
      : null;
  const prompt = a4PromptHint ? `${rawPrompt}. ${a4PromptHint}` : rawPrompt;
  const n            = clampInt(args.n, 1, 4, 1);
  const outputFormat = normalizeFormat(String(args.outputFormat || 'png'));
  const background   = String(args.background || 'transparent').trim();
  const timeoutMs    = clampInt(args.timeoutMs, 5000, 180_000, 60_000);

  let result: GenerateAssetsResult;
  if (isNanoBanana) {
    result = await falGenerateAssets(apiKey, { prompt, n, outputFormat, background }, resolved, timeoutMs);
  } else {
    result = await localGenerateAssets(apiKey, { prompt, n, outputFormat, background }, resolved, timeoutMs);
  }

  // ── Save images ─────────────────────────────────────────────────────────────
  const workspaceRoot = _options?.workspaceFolder?.uri?.fsPath;
  if (result.images && result.images.length > 0) {
    const savePathRaw = String(args.path).trim();
    const savePathAbs = path.isAbsolute(savePathRaw)
      ? savePathRaw
      : workspaceRoot
      ? path.resolve(workspaceRoot, savePathRaw)
      : path.resolve(savePathRaw);

    const saved: SavedAssetInfo[] = [];
    const warnings: string[] = [];
    const isDir = isLikelyDirectoryPath(savePathRaw);

    if (isDir) await ensureDirExists(savePathAbs);

    const getRequestedPath = (index: number): string => {
      if (isDir) {
        return ensureExt(path.join(savePathAbs, `asset_${index + 1}`), outputFormat);
      }
      const base = ensureExt(savePathAbs, outputFormat);
      if (index === 0) return base;
      const { dir, base: b, ext } = splitName(base);
      return path.join(dir, `${b}_${index + 1}${ext}`);
    };

    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      if (!img.b64_json) continue;

      const requested = getRequestedPath(i);
      const { savedPath, reason } = await writeBufferWithCollisionAvoidance(
        requested,
        Buffer.from(img.b64_json, 'base64'),
        warnings
      );

      const info: SavedAssetInfo = {
        index: i,
        requestedPath: requested,
        savedPath,
        ...(reason ? { reason } : {}),
      };

      // ── A4 upscale step ───────────────────────────────────────────────────
      if (resolved.a4Mode && resolved.a4Orientation) {
        try {
          info.a4UpscaledPath = await upscaleToA4(savedPath, resolved.a4Orientation);
        } catch (upscaleErr: any) {
          warnings.push(
            `WARNING: A4 upscale failed for "${savedPath}": ${upscaleErr?.message || upscaleErr}`
          );
        }
      }

      saved.push(info);
    }

    result.saved = saved;
    if (warnings.length) result.warnings = warnings;

    // ── Tinify compression ────────────────────────────────────────────────────
    // Compress the upscaled A4 file when available; otherwise compress the original.
    for (const asset of saved) {
      const targetForCompression = asset.a4UpscaledPath ?? asset.savedPath;
      try {
        const { dir, base, ext } = splitName(targetForCompression);
        await executeTinifyApi(
          {
            source: 'file',
            filePath: targetForCompression,
            outputPath: path.join(dir, `${base}_compressed${ext}`),
          },
          _options
        );
      } catch {}
    }
  }

  // Strip base64 payloads before returning
  if (result.images) {
    result.images = result.images.map(img => ({ ...img, b64_json: '<BASE64_DATA_REMOVED>' }));
  }

  return result;
}