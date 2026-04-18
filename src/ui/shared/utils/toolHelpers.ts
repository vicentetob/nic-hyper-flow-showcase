/**
 * Helpers para renderização de tool cards
 */

/**
 * Converts tool names to friendly display names in English
 */
export function getFriendlyToolName(toolName: string): string {
  const friendlyNames: Record<string, string> = {
    // Reading, Search, Navigation
    "read_file": "Read File",
    "list_dir_recursive": "Explore Directory",
    "search": "Search Workspace",
    "web_search": "Web Search",
    "wikipedia": "Wikipedia Lookup",
    "read_url": "Read Web Page",
    "get_image": "Get Image",
    "search_assets": "Search Assets",
    "http_request": "HTTP Request",
    

    
    // Editing tools (these are usually hidden but have friendly names just in case)
    "patch": "Edit File",
    "patch_file": "Edit File",
    "create": "Create File",
    "delete": "Delete File",
    "replace": "Replace File",
    
    // Utilities / FS
    "create_dir": "Create Directory",
    "move_file": "Move File",
    "rename": "Rename File",
    "copy_file": "Copy File",
    "delete_file": "Delete File",
    "format_code": "Format Code",
    "download_web_file": "Download File",
    
    // Generation / Analysis
    "generate_image": "Generate Image",
    "parse_lint_errors": "Check Lint Errors",
    "git_status": "Git Status",
    "run_command": "Run Command",
    "terminal_start": "Persistent Terminal",
    "terminal_read": "Read Terminal",
    "terminal_send": "Send To Terminal",
    "terminal_stop": "Stop Terminal",
    "terminal_list": "List Terminals",
    "call_claude": "Claude Code",
    "call_claude_reply": "Claude Reply",
    "call_claude_check": "Claude Status",
    "call_claude_stop": "Stop Claude",
    "name_chat": "Name Chat",
    "report_cognitive_state": "Cognitive State",
    "current_plan": "Manage Plan",
    "replace_text": "Replace Text",
    
    // Default fallback
    "list_dir": "List Directory",
    
    // Missing friendly names
    "write_file": "Write File",
    "read_chunks": "Read Chunks",
    "crawl_site": "Crawl Website",
    "download_resource": "Download Resource",
    "extract_links": "Extract Links",
    "download_site_assets": "Download Site Assets",
    "list_downloadable_files": "List Downloadable Files",
    "read_robots_txt": "Read Robots.txt",
    "read_pdf_ref": "Read PDF",
    "generate_assets": "Generate Assets",
    "read_multiple_files": "Read Multiple Files"
  };
  
  return friendlyNames[toolName] || toolName;
}

export function asPrettyString(val: any): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

export function toMarkdownBlock(raw: any): string {
  const s = asPrettyString(raw);
  const t = s.trim();
  if (!t) return "";
  if (t.includes("```")) return t;

  const looksDiff = /^diff --git/m.test(t) || /^@@/m.test(t) || /^\+\+\+\s/m.test(t) || /^---\s/m.test(t);
  if (looksDiff) return "```diff\n" + t + "\n```";

  const looksJson = (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  if (looksJson) return "```json\n" + t + "\n```";

  return "```text\n" + t + "\n```";
}

export function summarizeTool(name: string, args: any, result: any, options: { full?: boolean } = {}): string {
  if (!name) return "";
  const res = result || {};
  const a = args || {};

  const fileLink = (p: string | null | undefined): string => {
    if (!p) {
      console.warn('[summarizeTool] fileLink recebeu path vazio:', p, 'args:', args, 'result:', result);
      return '<span class="tool-path-error">path não disponível</span>';
    }
    // Remove backticks e escapa HTML
    const cleanPath = String(p).replace(/`/g, "").replace(/[<>]/g, (c) => c === '<' ? '&lt;' : '&gt;');
    return `<span class="file-link" data-path="${cleanPath}" title="Open file">${cleanPath}</span>`;
  };

  const dirLink = (p: string | null | undefined): string => {
    if (!p) return '<span class="tool-path-error">path não disponível</span>';
    const cleanPath = String(p).replace(/`/g, "").replace(/[<>]/g, (c) => c === '<' ? '&lt;' : '&gt;');
    return `<span class="dir-path">${cleanPath}</span>`;
  };

  switch (name) {
    case "read_file": {
      const fileInfo = fileLink(a.path || res.path);
      let linesInfo = "";
      const start =
        typeof a.startLine === "number"
          ? a.startLine
          : typeof a.start_line === "number"
            ? a.start_line
          : typeof res.startLine === "number"
            ? res.startLine
            : undefined;
      const end =
        typeof a.endLine === "number"
          ? a.endLine
          : typeof a.end_line === "number"
            ? a.end_line
          : typeof res.endLine === "number"
            ? res.endLine
            : undefined;

      const hasRange = typeof start === "number" || typeof end === "number";
      if (hasRange) {
        const from = typeof start === "number" ? start : 1;
        const to =
          typeof end === "number"
            ? end
            : typeof res.totalLines === "number"
              ? res.totalLines
              : from;
        linesInfo = ` (${from}-${to})`;
      } else if (res.totalLines) {
        linesInfo = ` (${res.totalLines} lines)`;
      } else if (res.content) {
        linesInfo = ` (~${String(res.content).split("\n").length} lines)`;
      }
      return linesInfo ? `read ${fileInfo}<span class="tool-info">${linesInfo}</span>` : `read ${fileInfo}`;
    }

    case "list_dir":
      return `ls ${dirLink(a.path || res.path || ".")}<span class="tool-info">${res.count !== undefined ? ` (${res.count} items)` : ""}</span>`;

    case "search": {
      const query =
        Array.isArray(a.queries) && a.queries.length
          ? a.queries.join(", ")
          : a.query || "???";
      const resultCount = res.results ? res.results.length : (res.matches ? res.matches.length : null);
      const countInfo = resultCount !== null ? ` <span class="tool-info">(${resultCount} resultados)</span>` : "";
      
      if (!res || Object.keys(res).length === 0 || String(res) === "undefined") {
        return `search "${query}"<span class="tool-error"> sem resultados</span>`;
      }
      return `search "${query}"${countInfo}`;
    }


    case "patch":
    case "patch_file":
    case "replace":
    case "create":
      return `edit ${fileLink(a.path || res.path || (Array.isArray(res) ? res?.[0]?.path : undefined))}`;

    case "delete":
      return `${fileLink(a.path || res.path || (Array.isArray(res) ? res?.[0]?.path : undefined))}`;

    case "run_command": {
      const cmd = a.cmd || a.command || res.command || "<undefined>";
      return `\`${cmd}\``;
    }
    case "parse_lint_errors": {
      const errCount = res.errors?.length;
      const cls = errCount > 0 ? "tool-error" : "tool-info";
      return errCount !== undefined ? `<span class="${cls}">lint: ${errCount} errors</span>` : "lint checking...";
    }

    case "read_multiple_files": {
      // Usa result.files se disponível (tool já terminou), senão usa args.files (ainda rodando)
      const filePaths: string[] = (() => {
        if (Array.isArray(res.files) && res.files.length > 0) return res.files;
        if (Array.isArray(a.files)) {
          return a.files.map((f: any) => (typeof f === "string" ? f : f?.path)).filter(Boolean);
        }
        return [];
      })();

      if (filePaths.length === 0) return "Read Multiple Files";

      const isFull = !!options.full;
      const MAX_SHOW = isFull ? 100 : 2;
      const shown = filePaths.slice(0, MAX_SHOW).map(fileLink).join(", ");
      const extra = !isFull && filePaths.length > MAX_SHOW
        ? ` <span class="tool-info">(+${filePaths.length - MAX_SHOW} more)</span>`
        : "";
      return `read ${shown}${extra}`;
    }

    default:
      return getFriendlyToolName(name);
  }
}
