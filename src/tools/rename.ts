import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  resolveWorkspacePath,
  getCanonizedWorkspaceRootSync,
  makeRelativeToWorkspaceRoot,
} from "./utils";
import { ExecuteToolOptions } from "./types";

type RenameResult =
  | { ok: true; from: string; to: string; renamed: boolean; note?: string }
  | { ok: false; error: string; code?: string; from?: string; to?: string };

function safeBasename(p: string): string {
  const norm = String(p || "").replace(/\\/g, "/");
  const base = norm.split("/").pop() || "";
  return base;
}

function normalizeForCompare(p: string): string {
  // Windows/macOS: treat paths as case-insensitive for "same file" checks
  const norm = path.normalize(p);
  return process.platform === "win32" || process.platform === "darwin"
    ? norm.toLowerCase()
    : norm;
}

/**
 * Detects any attempt to access outside the workspace root.
 */
function isOutsideWorkspace(workspaceFolder: vscode.WorkspaceFolder, filePath: string): boolean {
  const workspaceRoot = getCanonizedWorkspaceRootSync(workspaceFolder);
  const absolutePath = path.resolve(filePath);

  const relative = path.relative(workspaceRoot, absolutePath);

  // Outside if:
  // - relative begins with ".." (walks up)
  // - or relative is absolute (defensive)
  // - or a sneaky prefix like "..\" or "../"
  return (
    relative === "" ? false : // inside root
    relative === "." ? false :
    relative.startsWith("..") ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  );
}

/**
 * Prevent renaming files/folders that should never be touched by this tool.
 * Note: this checks the *basename* only (as before).
 */
function isProtectedFile(fileName: string | undefined): boolean {
  if (!fileName) return false;

  const f = fileName.toLowerCase();

  const forbidden = new Set([
    "jarvis_i_o.md",
    "nic_debug.md",
    "pkb_v2.jsonl",
    "pkb.jsonl",
    "assets_registry.json",

    // Project/system files
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".gitignore",

    // "pseudo-files" / directories that should never be renamed through this
    ".git",
    "node_modules",
  ]);

  return forbidden.has(f);
}

/**
 * Blocks image renames via this tool (your rule).
 */
function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath || "").toLowerCase();
  const imageExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".ico",
    ".tiff",
    ".tif",
  ]);
  return imageExtensions.has(ext);
}

/**
 * Blocks obvious OS/system directories, with OS-aware rules.
 * (Smarter than the old hardcoded Windows-only fragments.)
 */
function isSystemDirectory(filePath: string): boolean {
  const p = path.resolve(filePath).toLowerCase().replace(/\\/g, "/");

  const windowsBlocked = [
    "/windows",
    "/windows/system32",
    "/program files",
    "/program files (x86)",
  ];

  const unixBlocked = [
    "/bin",
    "/sbin",
    "/etc",
    "/private", // macOS
    "/system",  // macOS
  ];

  const blocked = process.platform === "win32" ? windowsBlocked : unixBlocked;

  // Block if path begins with those roots OR contains them as a root segment.
  return blocked.some((dir) => p === dir || p.startsWith(dir + "/"));
}

/**
 * Friendly error helper (English-only).
 */
function fail(error: string, code?: string, from?: string, to?: string): RenameResult {
  return { ok: false, error, code, from, to };
}

export async function executeRenameFile(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<RenameResult> {
  const rawFrom = String(args?.from ?? "").trim();
  const rawTo = String(args?.to ?? "").trim();
  const overwrite = Boolean(args?.overwrite); // supported if you want it, default false

  if (!rawFrom || !rawTo) {
    return fail(`rename requires args.from and args.to`, "ERR_ARGS");
  }

  // Resolve paths using your workspace logic
  const fromUri = resolveWorkspacePath(options.workspaceFolder, rawFrom);
  const toUri = resolveWorkspacePath(options.workspaceFolder, rawTo);

  const fromAbs = fromUri.fsPath;
  const toAbs = toUri.fsPath;

  // Pre-compute relative paths for returns (stable + nice)
  const fromRel = makeRelativeToWorkspaceRoot(options.workspaceFolder, fromAbs);
  const toRel = makeRelativeToWorkspaceRoot(options.workspaceFolder, toAbs);

  // 🔒 Guard 1: workspace boundary
  if (isOutsideWorkspace(options.workspaceFolder, fromAbs)) {
    return fail(`Access denied: source path is outside the allowed workspace.`, "ERR_OUTSIDE_WS", fromRel, toRel);
  }
  if (isOutsideWorkspace(options.workspaceFolder, toAbs)) {
    return fail(`Access denied: destination path is outside the allowed workspace.`, "ERR_OUTSIDE_WS", fromRel, toRel);
  }

  // 🔒 Guard 2: system directories
  if (isSystemDirectory(fromAbs)) {
    return fail(`Access denied: renaming files inside OS/system directories is not allowed.`, "ERR_SYSTEM_DIR", fromRel, toRel);
  }
  if (isSystemDirectory(toAbs)) {
    return fail(`Access denied: renaming files into OS/system directories is not allowed.`, "ERR_SYSTEM_DIR", fromRel, toRel);
  }

  // 🔒 Guard 3: protected files (source/destination basenames)
  const fromFileName = safeBasename(fromAbs);
  if (isProtectedFile(fromFileName)) {
    return fail(`Access denied: "${fromFileName}" is protected and cannot be renamed.`, "ERR_PROTECTED", fromRel, toRel);
  }

  const toFileName = safeBasename(toAbs);
  if (isProtectedFile(toFileName)) {
    return fail(`Access denied: renaming into protected file name "${toFileName}" is not allowed.`, "ERR_PROTECTED", fromRel, toRel);
  }

  // 🔒 Guard 4: image files (your rule)
  if (isImageFile(fromAbs)) {
    return fail(
      `Access denied: image files cannot be renamed with this tool. Use move_file for images.`,
      "ERR_IMAGE",
      fromRel,
      toRel
    );
  }
  if (isImageFile(toAbs)) {
    return fail(`Access denied: destination is an image file; not allowed.`, "ERR_IMAGE", fromRel, toRel);
  }

  // 🔒 Guard 5: source exists + is file
  if (!fs.existsSync(fromAbs)) {
    return fail(`Source file not found: "${rawFrom}".`, "ERR_NOT_FOUND", fromRel, toRel);
  }

  let fromStats: fs.Stats;
  try {
    fromStats = fs.statSync(fromAbs);
  } catch (e: any) {
    return fail(`Failed to stat source path "${rawFrom}": ${e?.message ?? String(e)}`, "ERR_STAT", fromRel, toRel);
  }

  if (fromStats.isDirectory()) {
    return fail(`Source path is a directory: "${rawFrom}". Use move_file to move directories.`, "ERR_IS_DIR", fromRel, toRel);
  }

  // ✅ Smart no-op detection (same normalized path)
  if (normalizeForCompare(fromAbs) === normalizeForCompare(toAbs)) {
    return { ok: true, from: fromRel, to: toRel, renamed: false, note: "No changes: destination equals source." };
  }

  // 🔒 Guard 6: destination parent exists + is directory
  const toParentDir = path.dirname(toAbs);
  if (!fs.existsSync(toParentDir)) {
    return fail(
      `Destination parent directory does not exist: "${makeRelativeToWorkspaceRoot(options.workspaceFolder, toParentDir)}". Create it first.`,
      "ERR_PARENT_MISSING",
      fromRel,
      toRel
    );
  }

  let parentStats: fs.Stats;
  try {
    parentStats = fs.statSync(toParentDir);
  } catch (e: any) {
    return fail(`Failed to stat destination parent: ${e?.message ?? String(e)}`, "ERR_STAT_PARENT", fromRel, toRel);
  }

  if (!parentStats.isDirectory()) {
    return fail(`Destination parent is not a directory: "${toParentDir}".`, "ERR_PARENT_NOT_DIR", fromRel, toRel);
  }

  // 🔒 Guard 7: destination exists handling
  if (fs.existsSync(toAbs)) {
    let toStats: fs.Stats;
    try {
      toStats = fs.statSync(toAbs);
    } catch (e: any) {
      return fail(`Failed to stat destination path: ${e?.message ?? String(e)}`, "ERR_STAT_DEST", fromRel, toRel);
    }

    // If destination is a directory, treat "to" as "move into directory keeping filename"
    if (toStats.isDirectory()) {
      const newPath = path.join(toAbs, fromFileName || "file");
      const newUri = vscode.Uri.file(newPath);
      const newRel = makeRelativeToWorkspaceRoot(options.workspaceFolder, newPath);

      if (fs.existsSync(newPath)) {
        return fail(`A file named "${fromFileName}" already exists inside the destination directory.`, "ERR_DEST_EXISTS", fromRel, newRel);
      }

      try {
        await vscode.workspace.fs.rename(fromUri, newUri, { overwrite: false });
        return { ok: true, from: fromRel, to: newRel, renamed: true };
      } catch (e: any) {
        return fail(`Rename failed (move into directory): ${e?.message ?? String(e)}`, "ERR_RENAME", fromRel, newRel);
      }
    }

    // Destination is a file
    if (!overwrite) {
      return fail(
        `Destination already exists: "${rawTo}". Set overwrite: true to replace it.`,
        "ERR_DEST_EXISTS",
        fromRel,
        toRel
      );
    }
  }

  // Execute rename
  try {
    await vscode.workspace.fs.rename(fromUri, toUri, { overwrite });
    return { ok: true, from: fromRel, to: toRel, renamed: true };
  } catch (e: any) {
    return fail(`Rename failed: "${rawFrom}" -> "${rawTo}": ${e?.message ?? String(e)}`, "ERR_RENAME", fromRel, toRel);
  }
}
