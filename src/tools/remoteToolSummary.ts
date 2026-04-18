export type RemoteToolSummary = {
  title: string; // short label for UI (e.g. "read_file main.dart")
  subtitle?: string; // optional extra info (e.g. "lines 1-120")
  targetPath?: string;
  startLine?: number;
  endLine?: number;
};

function basename(p: string): string {
  const s = String(p || '');
  const parts = s.split(/[/\\]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

function safeStr(v: any): string {
  if (v === null || v === undefined) {return '';}
  return String(v);
}

export function buildRemoteToolSummary(toolName: string, args: any, resultPayload?: any): RemoteToolSummary {
  const a = args ?? {};

  switch (toolName) {
    case 'read_file': {
      const path = safeStr(a.path);
      const result = (resultPayload && typeof resultPayload === 'object') ? resultPayload : {};
      const startLine = Number(result.startLine ?? a.startLine);
      const endLine = Number(result.endLine ?? a.endLine);
      const hasRange = Number.isFinite(startLine) || Number.isFinite(endLine);
      return {
        title: `read_file ${basename(path)}`.trim(),
        subtitle: hasRange ? `lines ${Number.isFinite(startLine) ? startLine : ''}-${Number.isFinite(endLine) ? endLine : ''}` : undefined,
        targetPath: path || safeStr(result.path),
        startLine: Number.isFinite(startLine) ? startLine : undefined,
        endLine: Number.isFinite(endLine) ? endLine : undefined,
      };
    }

    case 'read_multiple_files': {
      const files = Array.isArray(a.files) ? a.files : [];
      const count = files.length;
      const names = files.slice(0, 3).map((f: any) => basename(typeof f === 'string' ? f : f.path)).join(', ');
      const more = count > 3 ? `... +${count - 3}` : '';
      return {
        title: `read_multiple_files (${count})`.trim(),
        subtitle: `${names}${more}`.trim(),
      };
    }

    case 'read_pdf_ref': {
      const ref = safeStr(a.ref || a.path);
      return { title: `read_pdf_ref ${basename(ref)}`.trim() };
    }

    case 'list_dir_recursive': {
      const path = safeStr(a.path || '.');
      return { title: `list_dir_recursive ${path}`.trim() };
    }

    case 'search': {
      const q = safeStr(a.query || (Array.isArray(a.queries) ? a.queries.join(' | ') : ''));
      return { title: `search ${q}`.trim() };
    }

    case 'web_search': {
      const q = safeStr(a.query || (Array.isArray(a.queries) ? a.queries.join(' | ') : ''));
      return { title: `web_search ${q}`.trim() };
    }

    case 'read_url': {
      const url = safeStr(a.url);
      return { title: `read_url ${url}`.trim() };
    }

    case 'http_request': {
      const method = safeStr(a.method || 'POST').toUpperCase();
      const url = safeStr(a.url);
      return { title: `http_request ${method} ${url}`.trim() };
    }

    case 'run_command': {
      const cmd = safeStr(a.cmd);
      return {
        title: `run_command ${cmd}`.trim(),
        subtitle: cmd.length > 80 ? `${cmd.slice(0, 77)}...` : undefined,
      };
    }

    case 'patch_file': {
      const path = safeStr(a.file_path);
      return {
        title: `patch_file ${basename(path)}`.trim(),
        targetPath: path,
      };
    }

    case 'replace_text': {
      const include = Array.isArray(a.include) ? a.include.join(', ') : safeStr(a.include);
      return { title: `replace_text ${include}`.trim() };
    }

    case 'download_web_file': {
      const url = safeStr(a.url);
      const path = safeStr(a.path);
      return { title: `download_web_file ${basename(path) || url}`.trim() };
    }

    case 'get_image': {
      const path = safeStr(a.path);
      return { title: `get_image ${basename(path)}`.trim() };
    }

    case 'generate_assets': {
      const n = a.n ?? resultPayload?.images?.length;
      return { title: `generate_assets ${n ?? ''}`.trim() };
    }

    case 'save_chat_image_as_asset': {
      const name = safeStr(a.name);
      return { title: `save_chat_image_as_asset ${basename(name)}`.trim() };
    }

    default:
      return { title: toolName };
  }
}
