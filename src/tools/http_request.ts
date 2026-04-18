import * as path from 'path';
import * as vscode from 'vscode';
import fetch, { Headers } from 'node-fetch';
import { URL } from 'url';
import * as dns from 'dns';
import * as net from 'net';
import * as https from 'https';
import { ExecuteToolOptions } from './types';
import { resolveWorkspacePath, writeFileSafe } from './utils';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

type BodyType = 'json' | 'text' | 'form_urlencoded' | 'multipart' | 'binary_base64' | 'none';

type AuthItem =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api_key'; in: 'header' | 'query'; name: string; value: string };

interface MultipartPart {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data_base64?: string;
}

interface HttpRequestArgs {
  url: string;

  method?: HttpMethod;
  query?: Record<string, string | number | boolean | null>;
  headers?: Record<string, string>;

  timeoutMs?: number;
  followRedirects?: boolean;
  maxRedirects?: number;

  maxResponseBytes?: number;

  // Body
  bodyType?: BodyType;
  body?: any;
  multipart?: MultipartPart[];

  // Auth
  auth?: AuthItem[];

  // Cookies
  cookies?: Record<string, string>;
  cookieJar?: { id: string; mode?: 'read_write' | 'read_only' | 'write_only' | 'disabled' };
  cookiePolicy?: { acceptSetCookie?: boolean; sendCookies?: boolean; allowThirdParty?: boolean };

  // Retry
  retry?: { times?: number; backoffMs?: number; retryOn?: number[] };

  // TLS
  tls?: {
    rejectUnauthorized?: boolean;
    caCertPem_base64?: string;
    clientCertPem_base64?: string;
    clientKeyPem_base64?: string;
    serverName?: string;
  };

  // Network guard
  network?: {
    allowPrivateIPs?: boolean;
    allowLocalhost?: boolean;
    allowlistDomains?: string[];
    denylistDomains?: string[];
  };

  // Response handling
  response?: {
    parseJson?: boolean;
    captureHeaders?: boolean;
    captureBody?: boolean;
    previewChars?: number;
    decode?: 'auto' | 'utf8' | 'latin1';
  };

  // Output mode
  mode?: 'safe' | 'raw';
}

type CookieJarFile = {
  version: 1;
  updatedAt: number;
  cookies: StoredCookie[];
};

type StoredCookie = {
  name: string;
  value: string;

  domain: string;      // lowercase, without leading dot
  path: string;

  hostOnly: boolean;   // if true: only send to exact host
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';

  expiresAt?: number;  // unix ms
};

type RedirectHop = { status: number; location?: string };

type ToolResult = {
  ok: boolean;
  status: number;
  statusText?: string;

  request: {
    url: string;
    method: string;
    headers_redacted: Record<string, string>;
    body_preview?: string;
    body_bytes?: number;
    timeoutMs: number;
  };

  redirects?: RedirectHop[];

  response: {
    headers_redacted: Record<string, string>;
    contentType?: string;
    bytes: number;
    text_preview?: string;
    json?: any;
    truncated: boolean;
  };

  timing: {
    totalMs: number;
    ttfbMs?: number;
  };

  warnings: string[];
  error?: { code: string; message: string };
};

/**
 * Tool: http_request
 * Realiza requisições HTTP controladas para testar APIs.
 *
 * Suporta:
 * - Métodos: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS
 * - Body: JSON, text, form-urlencoded, multipart, binary (base64)
 * - Auth: bearer/basic/api_key
 * - Cookies: inline + cookieJar persistente
 * - Redirects, retry, TLS, guard de rede (SSRF)
 * - Truncamento de resposta + redaction de segredos
 *
 * Args (principais):
 * - url: string (obrigatório)
 * - method?: HTTP method (default POST)
 * - headers?: map
 * - query?: map
 * - timeoutMs?: number (default 15000)
 * - followRedirects?: boolean (default true)
 * - maxRedirects?: number (default 5)
 * - maxResponseBytes?: number (default 1_000_000)
 * - bodyType?: json|text|form_urlencoded|multipart|binary_base64|none
 * - body?: any
 * - multipart?: parts
 * - auth?: list
 * - cookies?: map
 * - cookieJar?: { id, mode }
 * - cookiePolicy?: { acceptSetCookie, sendCookies, allowThirdParty }
 * - retry?: { times, backoffMs, retryOn }
 * - tls?: options
 * - network?: guard overrides
 * - response?: parsing options
 * - mode?: safe|raw (default safe)
 *
 * Output: ver ToolResult (sempre sanitizado, sem vazar segredos por padrão)
 */
export async function executeHttpRequest(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<ToolResult> {
  const params: HttpRequestArgs = {
    url: String(args.url ?? '').trim(),
    method: String(args.method ?? 'POST').toUpperCase() as HttpMethod,

    query: isPlainObject(args.query) ? (args.query as any) : undefined,
    headers: isPlainObject(args.headers) ? normalizeHeaderMap(args.headers) : undefined,

    timeoutMs: clampInt(args.timeoutMs ?? 15000, 1000, 60000),
    followRedirects: args.followRedirects === undefined ? true : Boolean(args.followRedirects),
    maxRedirects: clampInt(args.maxRedirects ?? 5, 0, 20),

    maxResponseBytes: clampInt(args.maxResponseBytes ?? 1_000_000, 64_000, 5_000_000),

    bodyType: (args.bodyType ? String(args.bodyType) : undefined) as any,
    body: args.body,
    multipart: Array.isArray(args.multipart) ? (args.multipart as any[]).map(toMultipartPart) : undefined,

    auth: Array.isArray(args.auth) ? (args.auth as any[]).map(toAuthItem).filter(Boolean) as any : undefined,

    cookies: isPlainObject(args.cookies) ? (args.cookies as any) : undefined,
    cookieJar: args.cookieJar && isPlainObject(args.cookieJar) ? {
      id: String(args.cookieJar.id ?? '').trim(),
      mode: (args.cookieJar.mode ? String(args.cookieJar.mode) : 'read_write') as any,
    } : undefined,
    cookiePolicy: args.cookiePolicy && isPlainObject(args.cookiePolicy) ? {
      acceptSetCookie: args.cookiePolicy.acceptSetCookie === undefined ? true : Boolean(args.cookiePolicy.acceptSetCookie),
      sendCookies: args.cookiePolicy.sendCookies === undefined ? true : Boolean(args.cookiePolicy.sendCookies),
      allowThirdParty: args.cookiePolicy.allowThirdParty === undefined ? false : Boolean(args.cookiePolicy.allowThirdParty),
    } : undefined,

    retry: args.retry && isPlainObject(args.retry) ? {
      times: clampInt(args.retry.times ?? 0, 0, 10),
      backoffMs: clampInt(args.retry.backoffMs ?? 300, 0, 30_000),
      retryOn: Array.isArray(args.retry.retryOn) ? args.retry.retryOn.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : undefined,
    } : undefined,

    tls: args.tls && isPlainObject(args.tls) ? {
      rejectUnauthorized: args.tls.rejectUnauthorized === undefined ? true : Boolean(args.tls.rejectUnauthorized),
      caCertPem_base64: args.tls.caCertPem_base64 ? String(args.tls.caCertPem_base64) : undefined,
      clientCertPem_base64: args.tls.clientCertPem_base64 ? String(args.tls.clientCertPem_base64) : undefined,
      clientKeyPem_base64: args.tls.clientKeyPem_base64 ? String(args.tls.clientKeyPem_base64) : undefined,
      serverName: args.tls.serverName ? String(args.tls.serverName) : undefined,
    } : undefined,

    network: args.network && isPlainObject(args.network) ? {
      allowPrivateIPs: args.network.allowPrivateIPs === undefined ? false : Boolean(args.network.allowPrivateIPs),
      allowLocalhost: args.network.allowLocalhost === undefined ? false : Boolean(args.network.allowLocalhost),
      allowlistDomains: Array.isArray(args.network.allowlistDomains) ? args.network.allowlistDomains.map((d: any) => String(d).toLowerCase().trim()).filter(Boolean) : undefined,
      denylistDomains: Array.isArray(args.network.denylistDomains) ? args.network.denylistDomains.map((d: any) => String(d).toLowerCase().trim()).filter(Boolean) : undefined,
    } : undefined,

    response: args.response && isPlainObject(args.response) ? {
      parseJson: args.response.parseJson === undefined ? true : Boolean(args.response.parseJson),
      captureHeaders: args.response.captureHeaders === undefined ? true : Boolean(args.response.captureHeaders),
      captureBody: args.response.captureBody === undefined ? true : Boolean(args.response.captureBody),
      previewChars: clampInt(args.response.previewChars ?? 4000, 0, 20000),
      decode: (args.response.decode ? String(args.response.decode) : 'auto') as any,
    } : undefined,

    mode: (args.mode ? String(args.mode) : 'safe') as any,
  };

  const warnings: string[] = [];
  const startedAt = Date.now();

  // Defaults
  if (!params.cookiePolicy) {
    params.cookiePolicy = { acceptSetCookie: true, sendCookies: true, allowThirdParty: false };
  }
  if (!params.response) {
    params.response = { parseJson: true, captureHeaders: true, captureBody: true, previewChars: 4000, decode: 'auto' };
  }
  if (!params.retry) {
    params.retry = { times: 0, backoffMs: 300, retryOn: [408, 429, 500, 502, 503, 504] };
  }
  if (!params.retry.retryOn) {
    params.retry.retryOn = [408, 429, 500, 502, 503, 504];
  }

  if (!params.url) {
    throw new Error('http_request requer uma URL válida no parâmetro "url"');
  }
  if (!isAllowedMethod(params.method)) {
    throw new Error(`Método HTTP inválido: ${params.method}`);
  }

  // Valida URL
  let initialUrl: URL;
  try {
    initialUrl = new URL(params.url);
  } catch {
    throw new Error(`URL inválida: ${params.url}`);
  }

  if (!['http:', 'https:'].includes(initialUrl.protocol)) {
    throw new Error(`Protocolo não suportado: ${initialUrl.protocol}`);
  }

  // Network guard / SSRF
  await enforceNetworkGuard(initialUrl, params.network);

  // Cookie jar load
  const jarId = params.cookieJar?.id?.trim();
  const jarMode = (params.cookieJar?.mode ?? 'read_write') as any;
  const jarEnabled = Boolean(jarId) && jarMode !== 'disabled';
  const jarPath = jarEnabled ? getCookieJarPath(options.workspaceFolder, jarId!) : null;
  let jar: CookieJarFile | null = null;
  if (jarEnabled && jarPath) {
    jar = await loadCookieJar(jarPath);
  }

  // Build request URL with query + api_key query auth
  const urlWithQuery = applyQueryAndAuthToUrl(initialUrl, params.query, params.auth);
  const firstPartyHost = urlWithQuery.hostname.toLowerCase();

  // Build headers
  const reqHeaders = new Headers();
  // user headers first
  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) {
      if (v === undefined || v === null) continue;
      reqHeaders.set(String(k), String(v));
    }
  }
  // auth header inject (bearer/basic/api_key header)
  applyAuthToHeaders(reqHeaders, params.auth);

  // body + content-type
  const bodyInfo = buildBody(params, reqHeaders, warnings);
  const timeoutMs = params.timeoutMs ?? 15000;

  // cookies (merge: user Cookie header + inline cookies + jar cookies)
  if (params.cookiePolicy?.sendCookies) {
    const cookieHeader = buildCookieHeader(urlWithQuery, reqHeaders.get('cookie'), params.cookies, jar, jarMode);
    if (cookieHeader) {
      reqHeaders.set('cookie', cookieHeader);
    }
  }

  // Ensure Accept default
  if (!reqHeaders.has('accept')) {
    reqHeaders.set('accept', 'application/json, text/plain, */*');
  }
  // Ensure UA
  if (!reqHeaders.has('user-agent')) {
    reqHeaders.set('user-agent', 'NicHyperFlow-HTTP/1.0 (+VSCode Extension)');
  }

  // TLS Agent (only affects https)
  const agent = buildHttpsAgent(params.tls);

  // Execute with redirects + retries
  const redirects: RedirectHop[] = [];
  let attempt = 0;
  const maxAttempts = 1 + (params.retry?.times ?? 0);

  let lastErr: any = null;

  while (attempt < maxAttempts) {
    attempt++;

    if (options.notify) {
      options.notify(`HTTP ${params.method} ${urlWithQuery.toString()} (attempt ${attempt}/${maxAttempts})`);
    }

    try {
      const res = await fetchWithRedirectsAndTimeout({
        url: urlWithQuery,
        method: params.method!,
        headers: reqHeaders,
        body: bodyInfo.body,
        timeoutMs,
        followRedirects: Boolean(params.followRedirects),
        maxRedirects: params.maxRedirects ?? 5,
        httpsAgent: agent,
        redirects,
        onSetCookie: async (setCookies: string[], hopUrl: URL) => {
          // Accept cookies into jar
          if (!jarEnabled || !jarPath || !jar) return;
          if (jarMode === 'read_only') return;
          if (!params.cookiePolicy?.acceptSetCookie) return;

          // Third-party policy: if hop host differs from first party host, optionally refuse
          const hopHost = hopUrl.hostname.toLowerCase();
          if (hopHost !== firstPartyHost && !params.cookiePolicy?.allowThirdParty) {
            warnings.push('third_party_set_cookie_blocked');
            return;
          }

          const updated = applySetCookieToJar(jar, setCookies, hopUrl);
          if (updated) {
            await saveCookieJar(jarPath, jar);
          }
        },
        onBeforeRedirect: async (nextUrl: URL) => {
          // Enforce network guard on redirect target
          await enforceNetworkGuard(nextUrl, params.network);
          // Update Cookie header for next hop from jar
          if (params.cookiePolicy?.sendCookies) {
            const cookieHeader = buildCookieHeader(nextUrl, reqHeaders.get('cookie'), params.cookies, jar, jarMode);
            if (cookieHeader) reqHeaders.set('cookie', cookieHeader);
          }
        },
      });

      const ttfb = res._ttfbMs;

      // Read response with limit
      const captureHeaders = params.response?.captureHeaders !== false;
      const captureBody = params.response?.captureBody !== false;
      const parseJson = params.response?.parseJson !== false;
      const previewChars = params.response?.previewChars ?? 4000;
      const decode = params.response?.decode ?? 'auto';

      const contentType = res.headers.get('content-type') ?? undefined;

      const { bytes, truncated, textPreview, fullTextIfSmall } = await readResponseLimited(res, params.maxResponseBytes!, previewChars, decode, captureBody);

      if (truncated) warnings.push('response_truncated');

      let json: any = undefined;
      if (captureBody && parseJson && !truncated) {
        const shouldTryJson =
          (contentType && contentType.toLowerCase().includes('application/json')) ||
          looksLikeJson(textPreview);

        if (shouldTryJson) {
          try {
            const textToParse = fullTextIfSmall ?? textPreview;
            json = JSON.parse(textToParse);
          } catch {
            warnings.push('json_parse_failed');
          }
        }
      }

      // headers redaction
      const outHeaders = captureHeaders ? redactHeaders(headersToRecord(res.headers), params.mode ?? 'safe') : {};
      const outReqHeaders = redactHeaders(headersToRecord(reqHeaders), params.mode ?? 'safe');

      const requestPreview = safeBodyPreview(bodyInfo.preview, params.mode ?? 'safe');
      const responsePreview = safeBodyPreview(textPreview, params.mode ?? 'safe');

      const ok = res.status >= 200 && res.status < 300;

      // Retry on status codes
      if (!ok && attempt < maxAttempts && params.retry?.retryOn?.includes(res.status)) {
        warnings.push(`retry_status_${res.status}`);
        await sleep(params.retry?.backoffMs ?? 300);
        continue;
      }

      return {
        ok,
        status: res.status,
        statusText: res.statusText,
        request: {
          url: urlWithQuery.toString(),
          method: params.method!,
          headers_redacted: outReqHeaders,
          body_preview: requestPreview ?? undefined,
          body_bytes: bodyInfo.bytes ?? undefined,
          timeoutMs,
        },
        redirects: redirects.length ? redirects.slice(0, 20) : undefined,
        response: {
          headers_redacted: outHeaders,
          contentType,
          bytes,
          text_preview: responsePreview ?? undefined,
          json,
          truncated,
        },
        timing: {
          totalMs: Date.now() - startedAt,
          ttfbMs: ttfb,
        },
        warnings,
      };
    } catch (e: any) {
      lastErr = e;
      const msg = e?.message ? String(e.message) : String(e);

      // Retry on network errors
      if (attempt < maxAttempts) {
        warnings.push('retry_network_error');
        await sleep(params.retry?.backoffMs ?? 300);
        continue;
      }

      return {
        ok: false,
        status: 0,
        request: {
          url: urlWithQuery.toString(),
          method: params.method!,
          headers_redacted: redactHeaders(headersToRecord(reqHeaders), params.mode ?? 'safe'),
          body_preview: safeBodyPreview(bodyInfo.preview, params.mode ?? 'safe') ?? undefined,
          body_bytes: bodyInfo.bytes ?? undefined,
          timeoutMs,
        },
        redirects: redirects.length ? redirects.slice(0, 20) : undefined,
        response: {
          headers_redacted: {},
          bytes: 0,
          truncated: false,
        },
        timing: {
          totalMs: Date.now() - startedAt,
        },
        warnings,
        error: {
          code: classifyError(lastErr),
          message: msg,
        },
      };
    }
  }

  // should never reach
  return {
    ok: false,
    status: 0,
    request: {
      url: initialUrl.toString(),
      method: params.method ?? 'POST',
      headers_redacted: {},
      timeoutMs: params.timeoutMs ?? 15000,
    },
    response: { headers_redacted: {}, bytes: 0, truncated: false },
    timing: { totalMs: Date.now() - startedAt },
    warnings: ['unexpected_fallthrough'],
    error: { code: 'unexpected', message: String(lastErr ?? 'unknown') },
  };
}

/* ────────────────────────────────────────────────────────────── */
/* Helpers                                                        */
/* ────────────────────────────────────────────────────────────── */

function isPlainObject(x: any): x is Record<string, any> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function clampInt(n: any, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function isAllowedMethod(m?: string): m is HttpMethod {
  return !!m && ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(m);
}

function normalizeHeaderMap(h: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || v === null) continue;
    out[String(k).toLowerCase()] = String(v);
  }
  return out;
}

function toMultipartPart(x: any): MultipartPart {
  const p: MultipartPart = {
    name: String(x?.name ?? '').trim(),
    value: x?.value !== undefined ? String(x.value) : undefined,
    filename: x?.filename !== undefined ? String(x.filename) : undefined,
    contentType: x?.contentType !== undefined ? String(x.contentType) : undefined,
    data_base64: x?.data_base64 !== undefined ? String(x.data_base64) : undefined,
  };
  return p;
}

function toAuthItem(x: any): AuthItem | null {
  const type = String(x?.type ?? '').toLowerCase().trim();
  if (type === 'bearer') {
    const token = String(x?.token ?? '').trim();
    if (!token) return null;
    return { type: 'bearer', token };
  }
  if (type === 'basic') {
    const username = String(x?.username ?? '');
    const password = String(x?.password ?? '');
    return { type: 'basic', username, password };
  }
  if (type === 'api_key' || type === 'apikey') {
    const where = String(x?.in ?? 'header').toLowerCase() === 'query' ? 'query' : 'header';
    const name = String(x?.name ?? 'x-api-key').trim();
    const value = String(x?.value ?? '').trim();
    if (!value) return null;
    return { type: 'api_key', in: where, name, value };
  }
  return null;
}

function applyQueryAndAuthToUrl(base: URL, query?: Record<string, any>, auth?: AuthItem[]): URL {
  const u = new URL(base.toString());

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
  }

  if (auth && auth.length) {
    for (const a of auth) {
      if (a.type === 'api_key' && a.in === 'query') {
        u.searchParams.set(a.name, a.value);
      }
    }
  }

  return u;
}

function applyAuthToHeaders(headers: Headers, auth?: AuthItem[]) {
  if (!auth?.length) return;

  for (const a of auth) {
    if (a.type === 'bearer') {
      if (!headers.has('authorization')) headers.set('authorization', `Bearer ${a.token}`);
    } else if (a.type === 'basic') {
      if (!headers.has('authorization')) {
        const token = Buffer.from(`${a.username}:${a.password}`, 'utf8').toString('base64');
        headers.set('authorization', `Basic ${token}`);
      }
    } else if (a.type === 'api_key' && a.in === 'header') {
      if (!headers.has(a.name)) headers.set(a.name, a.value);
    }
  }
}

function buildBody(params: HttpRequestArgs, headers: Headers, warnings: string[]): { body?: any; bytes?: number; preview?: string } {
  const inferred: BodyType =
    params.bodyType ??
    (params.multipart && params.multipart.length ? 'multipart' :
    (params.body === null || params.body === undefined ? 'none' :
    (typeof params.body === 'string' ? 'text' : 'json')));

  if (inferred === 'none' || params.method === 'GET' || params.method === 'HEAD') {
    return { body: undefined, bytes: 0, preview: undefined };
  }

  if (inferred === 'multipart') {
    const parts = params.multipart ?? [];
    const { body, contentType, bytes, preview } = buildMultipartBody(parts);
    headers.set('content-type', contentType);
    return { body, bytes, preview };
  }

  if (inferred === 'binary_base64') {
    const b64 = (isPlainObject(params.body) ? String((params.body as any).data_base64 ?? '') : String(params.body ?? '')).trim();
    if (!b64) return { body: undefined, bytes: 0, preview: undefined };
    const buf = Buffer.from(b64, 'base64');
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    return { body: buf, bytes: buf.length, preview: `[binary ${buf.length} bytes base64]` };
  }

  if (inferred === 'form_urlencoded') {
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
    let s = '';
    if (typeof params.body === 'string') {
      s = params.body;
    } else if (isPlainObject(params.body)) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params.body)) {
        if (v === undefined || v === null) continue;
        sp.set(k, String(v));
      }
      s = sp.toString();
    } else {
      warnings.push('form_urlencoded_body_coerced_to_string');
      s = String(params.body ?? '');
    }
    return { body: s, bytes: Buffer.byteLength(s, 'utf8'), preview: s.slice(0, 2000) };
  }

  if (inferred === 'text') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
    const s = typeof params.body === 'string' ? params.body : String(params.body ?? '');
    return { body: s, bytes: Buffer.byteLength(s, 'utf8'), preview: s.slice(0, 2000) };
  }

  // json
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  const jsonStr = typeof params.body === 'string' ? params.body : JSON.stringify(params.body ?? {});
  return { body: jsonStr, bytes: Buffer.byteLength(jsonStr, 'utf8'), preview: jsonStr.slice(0, 2000) };
}

function buildMultipartBody(parts: MultipartPart[]): { body: Buffer; contentType: string; bytes: number; preview: string } {
  const boundary = `NHFBoundary_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  const chunks: Buffer[] = [];

  const pushLine = (s: string) => chunks.push(Buffer.from(s + '\r\n', 'utf8'));

  for (const p of parts) {
    if (!p?.name) continue;
    pushLine(`--${boundary}`);

    const isFile = !!p.data_base64 || !!p.filename;
    if (isFile) {
      const filename = p.filename || 'file.bin';
      const contentType = p.contentType || 'application/octet-stream';
      pushLine(`Content-Disposition: form-data; name="${escapeQuotes(p.name)}"; filename="${escapeQuotes(filename)}"`);
      pushLine(`Content-Type: ${contentType}`);
      pushLine('');

      const data = p.data_base64 ? Buffer.from(p.data_base64, 'base64') : Buffer.from(String(p.value ?? ''), 'utf8');
      chunks.push(data);
      pushLine('');
    } else {
      pushLine(`Content-Disposition: form-data; name="${escapeQuotes(p.name)}"`);
      pushLine('');
      pushLine(String(p.value ?? ''));
    }
  }

  pushLine(`--${boundary}--`);
  const body = Buffer.concat(chunks);
  const preview = `[multipart ${parts.length} parts, ${body.length} bytes]`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}`, bytes: body.length, preview };
}

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  // node-fetch Headers supports forEach
  (h as any).forEach((value: string, key: string) => {
    out[String(key).toLowerCase()] = String(value);
  });
  return out;
}

function redactHeaders(h: Record<string, string>, mode: 'safe' | 'raw'): Record<string, string> {
  if (mode === 'raw') return h;

  const SENSITIVE_KEYS = [
    'authorization', 'cookie', 'set-cookie',
    'x-api-key', 'api-key', 'apikey',
    'x-auth-token', 'x-access-token',
  ];

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (SENSITIVE_KEYS.includes(lk) || lk.includes('token') || lk.includes('secret') || lk.includes('password')) {
      out[lk] = '[REDACTED]';
    } else {
      out[lk] = v;
    }
  }
  return out;
}

function safeBodyPreview(text: string | undefined, mode: 'safe' | 'raw'): string | undefined {
  if (!text) return undefined;
  if (mode === 'raw') return text;

  // heurística simples de redaction em preview
  return text
    .replace(/(authorization|cookie|set-cookie)\s*:\s*.+/gi, '$1: [REDACTED]')
    .replace(/("password"\s*:\s*)".+?"/gi, '$1"[REDACTED]"')
    .replace(/("token"\s*:\s*)".+?"/gi, '$1"[REDACTED]"')
    .replace(/("secret"\s*:\s*)".+?"/gi, '$1"[REDACTED]"')
    .replace(/(password|token|secret)=([^&\s]+)/gi, '$1=[REDACTED]');
}

function looksLikeJson(s: string | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function buildHttpsAgent(tls?: HttpRequestArgs['tls']): https.Agent | undefined {
  if (!tls) return undefined;

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: tls.rejectUnauthorized !== false,
  };

  if (tls.serverName) agentOptions.servername = tls.serverName;

  if (tls.caCertPem_base64) {
    agentOptions.ca = Buffer.from(tls.caCertPem_base64, 'base64').toString('utf8');
  }
  if (tls.clientCertPem_base64) {
    agentOptions.cert = Buffer.from(tls.clientCertPem_base64, 'base64').toString('utf8');
  }
  if (tls.clientKeyPem_base64) {
    agentOptions.key = Buffer.from(tls.clientKeyPem_base64, 'base64').toString('utf8');
  }

  return new https.Agent(agentOptions);
}

async function readResponseLimited(
  res: any,
  maxBytes: number,
  previewChars: number,
  decode: 'auto' | 'utf8' | 'latin1',
  captureBody: boolean
): Promise<{ bytes: number; truncated: boolean; textPreview: string; fullTextIfSmall?: string }> {
  if (!captureBody) {
    return { bytes: 0, truncated: false, textPreview: '' };
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  const body = res.body; // node-fetch Readable
  if (!body) {
    return { bytes: 0, truncated: false, textPreview: '' };
  }

  // Read stream with limit
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;

    if (bytes <= maxBytes) {
      chunks.push(buf);
    } else {
      truncated = true;
      // keep only up to maxBytes
      const over = bytes - maxBytes;
      const keepLen = buf.length - over;
      if (keepLen > 0) chunks.push(buf.slice(0, keepLen));
      // stop reading
      try { body.destroy(); } catch {}
      break;
    }
  }

  const data = Buffer.concat(chunks);

  const encoding = decode === 'auto' ? 'utf8' : decode;
  let text = data.toString(encoding);

  const textPreview = previewChars > 0 ? text.slice(0, previewChars) : '';
  const fullTextIfSmall = !truncated ? text : undefined;

  return { bytes: truncated ? maxBytes : bytes, truncated, textPreview, fullTextIfSmall };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function classifyError(e: any): string {
  const msg = String(e?.message ?? e ?? '').toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  if (msg.includes('dns')) return 'dns_error';
  if (msg.includes('blocked')) return 'blocked';
  if (msg.includes('certificate') || msg.includes('self signed')) return 'tls_error';
  return 'network_error';
}

/* ────────────────────────────────────────────────────────────── */
/* Redirect + Timeout wrapper                                     */
/* ────────────────────────────────────────────────────────────── */

async function fetchWithRedirectsAndTimeout(opts: {
  url: URL;
  method: HttpMethod;
  headers: Headers;
  body?: any;
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  httpsAgent?: https.Agent;
  redirects: RedirectHop[];

  onSetCookie?: (setCookies: string[], hopUrl: URL) => Promise<void>;
  onBeforeRedirect?: (nextUrl: URL) => Promise<void>;
}): Promise<any> {
  let currentUrl = new URL(opts.url.toString());
  let method = opts.method;
  let body = opts.body;

  const started = Date.now();
  let ttfbMs: number | undefined;

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res = await fetch(currentUrl.toString(), {
        method,
        headers: opts.headers,
        body,
        redirect: 'manual',
        signal: controller.signal as any,
        agent: currentUrl.protocol === 'https:' ? (opts.httpsAgent as any) : undefined,
      } as any);

      if (ttfbMs === undefined) ttfbMs = Date.now() - started;

      // capture set-cookie
      const rawSetCookie = (res.headers as any)?.raw?.()['set-cookie'] as string[] | undefined;
      const setCookies = Array.isArray(rawSetCookie) ? rawSetCookie : [];
      if (setCookies.length && opts.onSetCookie) {
        await opts.onSetCookie(setCookies, currentUrl);
      }

      const status = res.status;
      const isRedirect = [301, 302, 303, 307, 308].includes(status);

      if (isRedirect && opts.followRedirects) {
        const location = res.headers.get('location') ?? undefined;
        opts.redirects.push({ status, location });

        if (!location) return attachTtfb(res, ttfbMs);

        const nextUrl = new URL(location, currentUrl);

        if (opts.onBeforeRedirect) {
          await opts.onBeforeRedirect(nextUrl);
        }

        // Method rewriting rules:
        // - 303 => GET (and drop body)
        // - 301/302 for POST often become GET in browsers, mas aqui mantemos RFC-safe:
        //   somente 303 troca. (Se quiser comportamento browser, troque aqui.)
        if (status === 303) {
          method = 'GET';
          body = undefined;
          opts.headers.delete('content-type');
          opts.headers.delete('content-length');
        }

        currentUrl = nextUrl;
        continue;
      }

      return attachTtfb(res, ttfbMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('max_redirects_reached');
}

function attachTtfb(res: any, ttfbMs?: number) {
  (res as any)._ttfbMs = ttfbMs;
  return res;
}

/* ────────────────────────────────────────────────────────────── */
/* Cookie Jar (persistente no workspace)                          */
/* ────────────────────────────────────────────────────────────── */

function getCookieJarPath(workspaceFolder: vscode.WorkspaceFolder, id: string): vscode.Uri {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const rel = path.join('.nic', 'cookiejars', `${safeId}.json`);
  return resolveWorkspacePath(workspaceFolder, rel);
}

async function loadCookieJar(uri: vscode.Uri): Promise<CookieJarFile> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const obj = JSON.parse(text) as CookieJarFile;
    if (!obj || obj.version !== 1 || !Array.isArray(obj.cookies)) throw new Error('invalid_cookiejar');
    // prune expired
    const now = Date.now();
    obj.cookies = obj.cookies.filter(c => !c.expiresAt || c.expiresAt > now);
    return obj;
  } catch {
    // ensure dir
    const parentDir = path.dirname(uri.fsPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDir));
    return { version: 1, updatedAt: Date.now(), cookies: [] };
  }
}

async function saveCookieJar(uri: vscode.Uri, jar: CookieJarFile): Promise<void> {
  jar.updatedAt = Date.now();
  const text = JSON.stringify(jar, null, 2);
  await writeFileSafe(uri, text);
}

function buildCookieHeader(
  url: URL,
  existingCookieHeader: string | null,
  inlineCookies?: Record<string, string>,
  jar?: CookieJarFile | null,
  jarMode?: 'read_write' | 'read_only' | 'write_only' | 'disabled'
): string {
  const map: Record<string, string> = {};

  // existing
  if (existingCookieHeader) {
    for (const part of existingCookieHeader.split(';')) {
      const [k, ...rest] = part.split('=');
      const key = (k ?? '').trim();
      if (!key) continue;
      map[key] = rest.join('=').trim();
    }
  }

  // inline cookies
  if (inlineCookies) {
    for (const [k, v] of Object.entries(inlineCookies)) {
      if (!k) continue;
      map[String(k)] = String(v);
    }
  }

  // jar cookies
  if (jar && jarMode !== 'write_only' && jarMode !== 'disabled') {
    const selected = selectCookiesForUrl(jar, url);
    for (const c of selected) {
      map[c.name] = c.value;
    }
  }

  const pairs = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  return pairs.join('; ');
}

function selectCookiesForUrl(jar: CookieJarFile, url: URL): StoredCookie[] {
  const now = Date.now();
  const host = url.hostname.toLowerCase();
  const pathName = url.pathname || '/';
  const isHttps = url.protocol === 'https:';

  return jar.cookies.filter(c => {
    if (c.expiresAt && c.expiresAt <= now) return false;

    // secure
    if (c.secure && !isHttps) return false;

    // domain match
    if (c.hostOnly) {
      if (host !== c.domain) return false;
    } else {
      if (host !== c.domain && !host.endsWith(`.${c.domain}`)) return false;
    }

    // path match
    if (!pathName.startsWith(c.path)) return false;

    return true;
  });
}

function applySetCookieToJar(jar: CookieJarFile, setCookies: string[], reqUrl: URL): boolean {
  let changed = false;

  for (const sc of setCookies) {
    const parsed = parseSetCookie(sc, reqUrl);
    if (!parsed) continue;

    // overwrite by name+domain+path
    const idx = jar.cookies.findIndex(c => c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path && c.hostOnly === parsed.hostOnly);
    if (idx >= 0) {
      jar.cookies[idx] = parsed;
    } else {
      jar.cookies.push(parsed);
    }
    changed = true;
  }

  // prune expired
  const now = Date.now();
  const before = jar.cookies.length;
  jar.cookies = jar.cookies.filter(c => !c.expiresAt || c.expiresAt > now);
  if (jar.cookies.length !== before) changed = true;

  return changed;
}

function defaultCookiePath(url: URL): string {
  const p = url.pathname || '/';
  if (!p.startsWith('/')) return '/';
  if (p === '/') return '/';
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

function parseSetCookie(setCookie: string, reqUrl: URL): StoredCookie | null {
  const parts = setCookie.split(';').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;

  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf('=');
  if (eq <= 0) return null;

  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1).trim();

  let domainAttr: string | undefined;
  let pathAttr: string | undefined;
  let expiresAt: number | undefined;
  let secure = false;
  let httpOnly = false;
  let sameSite: StoredCookie['sameSite'] | undefined;

  for (const a of attrs) {
    const [kRaw, ...vParts] = a.split('=');
    const k = (kRaw ?? '').trim().toLowerCase();
    const v = vParts.join('=').trim();

    if (k === 'domain') domainAttr = v.toLowerCase().replace(/^\./, '');
    else if (k === 'path') pathAttr = v || '/';
    else if (k === 'expires') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) expiresAt = t;
    } else if (k === 'max-age') {
      const n = Number(v);
      if (Number.isFinite(n)) expiresAt = Date.now() + Math.max(0, n) * 1000;
    } else if (k === 'secure') secure = true;
    else if (k === 'httponly') httpOnly = true;
    else if (k === 'samesite') {
      const vv = v.toLowerCase();
      if (vv === 'lax') sameSite = 'Lax';
      else if (vv === 'strict') sameSite = 'Strict';
      else if (vv === 'none') sameSite = 'None';
    }
  }

  const host = reqUrl.hostname.toLowerCase();
  const hostOnly = !domainAttr;
  const domain = (domainAttr || host).toLowerCase();
  const p = pathAttr || defaultCookiePath(reqUrl);

  // Cookie deletions: empty value + expires in past
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    // still store? better to delete
    return {
      name,
      value,
      domain,
      path: p,
      hostOnly,
      secure,
      httpOnly,
      sameSite,
      expiresAt,
    };
  }

  return {
    name,
    value,
    domain,
    path: p,
    hostOnly,
    secure,
    httpOnly,
    sameSite,
    expiresAt,
  };
}

/* ────────────────────────────────────────────────────────────── */
/* Network guard / SSRF                                           */
/* ────────────────────────────────────────────────────────────── */

async function enforceNetworkGuard(url: URL, network?: HttpRequestArgs['network']): Promise<void> {
  const host = url.hostname.toLowerCase();

  // basic hard blocks
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    if (!network?.allowLocalhost) throw new Error('blocked_localhost');
  }

  // denylist domains
  if (network?.denylistDomains?.length) {
    if (domainMatchesList(host, network.denylistDomains)) {
      throw new Error('blocked_domain_denylist');
    }
  }

  // allowlist domains
  if (network?.allowlistDomains?.length) {
    if (!domainMatchesList(host, network.allowlistDomains)) {
      throw new Error('blocked_domain_not_in_allowlist');
    }
  }

  // metadata endpoint
  if (host === '169.254.169.254') {
    if (!network?.allowPrivateIPs) throw new Error('blocked_metadata_endpoint');
  }

  // If host is IP, check directly; else resolve DNS
  const ips = await resolveHostToIps(host);
  for (const ip of ips) {
    if (isLocalhostIp(ip) && !network?.allowLocalhost) throw new Error('blocked_localhost_ip');
    if (isPrivateIp(ip) && !network?.allowPrivateIPs) throw new Error('blocked_private_ip');
    if (ip === '169.254.169.254' && !network?.allowPrivateIPs) throw new Error('blocked_metadata_ip');
  }
}

function domainMatchesList(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  for (const entry of list) {
    const e = entry.toLowerCase().trim();
    if (!e) continue;
    if (h === e) return true;
    if (h.endsWith(`.${e}`)) return true;
  }
  return false;
}

async function resolveHostToIps(host: string): Promise<string[]> {
  // If already IP
  if (net.isIP(host)) return [host];

  try {
    const records = await dns.promises.lookup(host, { all: true });
    return records.map(r => r.address);
  } catch {
    // DNS failure -> let fetch error classify; but we still block nothing here
    return [];
  }
}

function isLocalhostIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    return ip.startsWith('127.');
  }
  // IPv6 loopback
  return ip === '::1';
}

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(x => parseInt(x, 10));
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true;
    return false;
  }

  // IPv6 heuristic (good enough for guard)
  const low = ip.toLowerCase();
  if (low === '::1') return true;
  if (low.startsWith('fe80')) return true; // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique local
  return false;
}
