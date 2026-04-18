/**
 * BROWSER_ACTION — NicHyperFlow Tool
 *
 * Controla um browser real (Chromium headless) via Playwright.
 * Mantém uma sessão singleton persistente entre chamadas (cookies, login, etc).
 *
 * Requer: npm install playwright
 * Na primeira execução: npx playwright install chromium
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExecuteToolOptions } from './types';

const DEFAULT_SCREENSHOT_QUALITY = 70;
const MAX_INLINE_SCREENSHOT_BYTES = 1_500_000;

interface BrowserActionImageAttachment {
  name?: string;
  mimeType: string;
  dataBase64: string;
}

// ---------------------------------------------------------------------------
// Tipos de ações suportadas
// ---------------------------------------------------------------------------

export type BrowserActionType =
  | 'navigate'       // Navega para uma URL
  | 'click'          // Clica num seletor CSS ou texto
  | 'type'           // Digita texto num campo
  | 'clear'          // Limpa um campo de input
  | 'select'         // Seleciona uma opção num <select>
  | 'hover'          // Passa o mouse sobre um elemento
  | 'scroll'         // Rola a página (direção ou seletor)
  | 'wait'           // Aguarda um seletor aparecer ou um tempo fixo
  | 'screenshot'     // Captura a tela (salva em disco e retorna anexo binário)
  | 'get_text'       // Extrai texto de um seletor (ou da página inteira)
  | 'get_html'       // Extrai HTML de um seletor (ou outerHTML da página)
  | 'get_url'        // Retorna a URL atual
  | 'get_title'      // Retorna o título da página
  | 'eval'           // Executa JavaScript arbitrário na página
  | 'download'       // Clica e aguarda um download
  | 'close_session'; // Fecha o browser e limpa a sessão

export interface BrowserAction {
  type: BrowserActionType;

  // Alvo (seletor CSS, texto visível, ou XPath com prefixo "xpath=")
  selector?: string;

  // Para navigate
  url?: string;

  // Para type / select / eval
  text?: string;
  value?: string;
  expression?: string;

  // Para scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number; // pixels (padrão: 300)

  // Para wait
  timeout?: number; // ms (padrão: 5000)
  delay?: number;   // ms fixo de espera

  // Para screenshot
  fullPage?: boolean;
  path?: string; // salvar em disco (opcional)
}

export interface BrowserActionArgs {
  actions: BrowserAction[];
  headless?: boolean;       // padrão: true
  sessionId?: string;       // multi-sessão (padrão: "default")
  viewportWidth?: number;   // padrão: 1280
  viewportHeight?: number;  // padrão: 800
  userAgent?: string;
  timeoutMs?: number;       // timeout global por ação (padrão: 10000)
}

interface BrowserActionResultPayload {
  message: string;
  results: ActionResult[];
  images?: BrowserActionImageAttachment[];
}

// ---------------------------------------------------------------------------
// Resultado de cada ação
// ---------------------------------------------------------------------------

interface ActionResult {
  action: BrowserActionType;
  selector?: string;
  success: boolean;
  value?: string;           // texto, url, título, resultado de eval, ou path do screenshot
  screenshotPath?: string;  // path em disco do screenshot
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Gerenciador de sessões singleton
// ---------------------------------------------------------------------------

interface Session {
  browser: any;  // playwright.Browser
  context: any;  // playwright.BrowserContext
  page: any;     // playwright.Page
  headless: boolean;
}

const sessions = new Map<string, Session>();

async function getOrCreateSession(
  sessionId: string,
  args: BrowserActionArgs
): Promise<Session> {
  if (sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }

  // Import dinâmico para não quebrar se Playwright não estiver instalado
  let playwright: any;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error(
      'Playwright não está instalado. Execute: npm install playwright && npx playwright install chromium'
    );
  }

  const headless = args.headless !== false;

  const browser = await playwright.chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: {
      width: args.viewportWidth ?? 1280,
      height: args.viewportHeight ?? 800,
    },
    userAgent: args.userAgent,
    locale: 'pt-BR',
  });

  const page = await context.newPage();

  // Escuta downloads para evitar que o playwright trave ao clicar em links de arquivos
  page.on('download', (download: any) => {
    console.log(`[BrowserAction] Download detectado: ${download.url()}`);
    // Opcional: download.cancel() para economizar recursos se não formos salvar
  });

  const session: Session = { browser, context, page, headless };
  sessions.set(sessionId, session);
  return session;
}

async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    await session.browser.close();
  } catch {
    // ignora erros ao fechar
  }
  sessions.delete(sessionId);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    default: return 'image/jpeg';
  }
}

function getScreenshotFormat(filePath?: string): 'png' | 'jpeg' {
  const ext = filePath ? path.extname(filePath).toLowerCase() : '';
  return ext === '.png' ? 'png' : 'jpeg';
}

function getScreenshotMimeType(format: 'png' | 'jpeg'): string {
  return format === 'png' ? 'image/png' : 'image/jpeg';
}

function buildScreenshotAttachmentFromBuffer(
  screenshotBuffer: Buffer,
  filePath?: string,
  format?: 'png' | 'jpeg'
): BrowserActionImageAttachment {
  const resolvedFormat = format ?? getScreenshotFormat(filePath);
  return {
    name: filePath ? path.basename(filePath) : `screenshot.${resolvedFormat === 'png' ? 'png' : 'jpg'}`,
    mimeType: getScreenshotMimeType(resolvedFormat),
    dataBase64: screenshotBuffer.toString('base64')
  };
}

// ---------------------------------------------------------------------------
// Execução de ações individuais
// ---------------------------------------------------------------------------

async function runAction(
  page: any,
  action: BrowserAction,
  globalTimeout: number,
  attachments?: BrowserActionImageAttachment[]
): Promise<ActionResult> {
  const start = Date.now();
  const timeout = action.timeout ?? globalTimeout;

  const base: Omit<ActionResult, 'durationMs'> = {
    action: action.type,
    selector: action.selector,
    success: false,
  };

  try {
    switch (action.type) {

      case 'navigate': {
        if (!action.url) throw new Error('navigate requer "url"');
        try {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout });
          base.success = true;
          base.value = page.url();
        } catch (err: any) {
          if (err.message.includes('Download is starting')) {
            base.success = true;
            base.value = `${action.url} (Download iniciado - o browser não consegue renderizar downloads diretamente)`;
          } else {
            throw err;
          }
        }
        break;
      }

      case 'click': {
        if (!action.selector) throw new Error('click requer "selector"');
        const locator = resolveLocator(page, action.selector);
        await locator.click({ timeout });
        base.success = true;
        break;
      }

      case 'type': {
        if (!action.selector) throw new Error('type requer "selector"');
        if (action.text === undefined) throw new Error('type requer "text"');
        const locator = resolveLocator(page, action.selector);
        await locator.fill(action.text, { timeout });
        base.success = true;
        break;
      }

      case 'clear': {
        if (!action.selector) throw new Error('clear requer "selector"');
        const locator = resolveLocator(page, action.selector);
        await locator.fill('', { timeout });
        base.success = true;
        break;
      }

      case 'select': {
        if (!action.selector) throw new Error('select requer "selector"');
        if (!action.value) throw new Error('select requer "value"');
        const locator = resolveLocator(page, action.selector);
        await locator.selectOption(action.value, { timeout });
        base.success = true;
        base.value = action.value;
        break;
      }

      case 'hover': {
        if (!action.selector) throw new Error('hover requer "selector"');
        const locator = resolveLocator(page, action.selector);
        await locator.hover({ timeout });
        base.success = true;
        break;
      }

      case 'scroll': {
        const amount = action.amount ?? 300;
        if (action.selector) {
          const locator = resolveLocator(page, action.selector);
          await locator.scrollIntoViewIfNeeded({ timeout });
        } else {
          const dir = action.direction ?? 'down';
          const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
          const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
          await page.mouse.wheel(dx, dy);
        }
        base.success = true;
        break;
      }

      case 'wait': {
        if (action.delay) {
          await page.waitForTimeout(action.delay);
          base.success = true;
        } else if (action.selector) {
          await page.waitForSelector(action.selector, { timeout });
          base.success = true;
        } else {
          throw new Error('wait requer "selector" ou "delay"');
        }
        break;
      }

      case 'screenshot': {
        const shouldPersistToDisk = Boolean(action.path);
        const format = getScreenshotFormat(action.path);
        const screenshotOpts: any = {
          type: format,
          quality: format === 'jpeg' ? DEFAULT_SCREENSHOT_QUALITY : undefined,
          fullPage: action.fullPage === true,
        };

        if (shouldPersistToDisk) {
          fs.mkdirSync(path.dirname(action.path!), { recursive: true });
          screenshotOpts.path = action.path!;
        }

        const screenshotBuffer = await page.screenshot(screenshotOpts);
        const screenshotByteLength = screenshotBuffer.byteLength;

        if (screenshotByteLength <= MAX_INLINE_SCREENSHOT_BYTES) {
          if (attachments) {
            attachments.push(buildScreenshotAttachmentFromBuffer(screenshotBuffer, action.path, format));
          }
        } else {
          base.error = `Screenshot grande demais para anexar inline (${Math.round(screenshotByteLength / 1024)} KB).`;
        }

        if (shouldPersistToDisk) {
          base.screenshotPath = action.path!;
          base.value = action.path!;
        }

        base.success = true;
        break;
      }

      case 'get_text': {
        if (action.selector) {
          const locator = resolveLocator(page, action.selector);
          base.value = await locator.innerText({ timeout });
        } else {
          const text = await page.evaluate(() => document.body.innerText);
          // Limita o texto retornado para evitar estourar o contexto do modelo (max 30k chars)
          const MAX_TEXT_CHARS = 30000;
          if (text.length > MAX_TEXT_CHARS) {
            base.value = text.slice(0, MAX_TEXT_CHARS) + `\n\n... (Texto truncado de ${text.length} para ${MAX_TEXT_CHARS} caracteres para economizar contexto)`;
          } else {
            base.value = text;
          }
        }
        base.success = true;
        break;
      }

      case 'get_html': {
        if (action.selector) {
          const locator = resolveLocator(page, action.selector);
          base.value = await locator.innerHTML({ timeout });
        } else {
          const html = await page.content();
          // Limita o HTML retornado para evitar estourar o contexto do modelo (max 50k chars)
          const MAX_HTML_CHARS = 50000;
          if (html.length > MAX_HTML_CHARS) {
            base.value = html.slice(0, MAX_HTML_CHARS) + `\n\n... (HTML truncado de ${html.length} para ${MAX_HTML_CHARS} caracteres para economizar contexto)`;
          } else {
            base.value = html;
          }
        }
        base.success = true;
        break;
      }

      case 'get_url': {
        base.value = page.url();
        base.success = true;
        break;
      }

      case 'get_title': {
        base.value = await page.title();
        base.success = true;
        break;
      }

      case 'eval': {
        if (!action.expression) throw new Error('eval requer "expression"');
        const result = await page.evaluate(action.expression);
        
        let jsonResult: string | undefined;
        try {
          jsonResult = result === undefined ? undefined : JSON.stringify(result);
        } catch {
          // Fallback para objetos circulares ou complexos que o JSON.stringify não aguenta
          jsonResult = `[Objeto complexo/circular: ${String(result)}]`;
        }
        
        // Limita o resultado do eval para evitar estourar o contexto (max 20k chars)
        const MAX_EVAL_CHARS = 20000;
        if (jsonResult && jsonResult.length > MAX_EVAL_CHARS) {
          base.value = jsonResult.slice(0, MAX_EVAL_CHARS) + `\n\n... (Resultado de eval truncado de ${jsonResult.length} para ${MAX_EVAL_CHARS} caracteres)`;
        } else {
          base.value = jsonResult;
        }
        base.success = true;
        break;
      }

      case 'download': {
        if (!action.selector && !action.url) throw new Error('download requer "selector" ou "url"');
        if (!action.path) throw new Error('download requer "path" para salvar o arquivo');

        const downloadPromise = page.waitForEvent('download', { timeout });
        
        if (action.url) {
          // Se for uma URL direta, faz o trigger via JS
          await page.evaluate((u: string) => {
             const a = document.createElement('a');
             a.href = u;
             a.click();
          }, action.url);
        } else {
          // Se for um seletor, clica nele
          const locator = resolveLocator(page, action.selector!);
          await locator.click();
        }

        const download = await downloadPromise;
        fs.mkdirSync(path.dirname(action.path), { recursive: true });
        await download.saveAs(action.path);
        
        base.success = true;
        base.value = `Arquivo baixado e salvo em: ${action.path}`;
        break;
      }

      case 'close_session': {
        // tratado externamente, mas não falha se chegar aqui
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

/**
 * Resolve um seletor para um Playwright Locator.
 * Suporta:
 *   - CSS normal:       "button.submit"
 *   - XPath:            "xpath=//button[@type='submit']"
 *   - Texto visível:    "text=Entrar"
 */
function resolveLocator(page: any, selector: string): any {
  if (selector.startsWith('xpath=')) {
    return page.locator(selector);
  }
  if (selector.startsWith('text=')) {
    return page.getByText(selector.slice(5), { exact: false });
  }
  return page.locator(selector);
}

// ---------------------------------------------------------------------------
// Formatação do resultado
// ---------------------------------------------------------------------------

function formatResults(results: ActionResult[]): string {
  const lines: string[] = [`BROWSER_ACTION — ${results.length} ação(ões) executada(s)\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.success ? '✅' : '❌';
    const label = r.selector ? ` [${r.selector}]` : r.action === 'navigate' ? '' : '';

    lines.push(`${status} [${i + 1}] ${r.action}${label} (${r.durationMs}ms)`);

    if (r.screenshotPath) {
      lines.push(`   📸 screenshot: ${r.screenshotPath}`);
      lines.push('   → screenshot anexada ao resultado da tool para visão do modelo');
    }

    if (r.value !== undefined && !r.screenshotPath) {
      const display = r.value.length > 2000
        ? r.value.slice(0, 2000) + `\n… (truncado, ${r.value.length} chars total)`
        : r.value;
      lines.push(`   → ${display}`);
    }

    if (r.error) {
      lines.push(`   ⚠️  Erro: ${r.error}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Executor principal (entry point da tool)
// ---------------------------------------------------------------------------

/**
 * Converte uma string no formato "key=value key2=value2" em um objeto BrowserAction.
 * Usado para compatibilidade com o protocolo de texto do Nic Assist.
 */
function parseActionString(s: string): BrowserAction {
  const action: any = {};
  const regex = /([a-zA-Z_]\w*)=(?:\"([^\"]*)\"|'([^\']*)'|([^ \t\n\r\f\v\"']+))/g;
  let match;

  while ((match = regex.exec(s)) !== null) {
    const key = match[1];
    const value = match[2] || match[3] || match[4];

    if (value === 'true') action[key] = true;
    else if (value === 'false') action[key] = false;
    else if (!isNaN(Number(value)) && value.trim() !== '' && !key.includes('selector') && !key.includes('text') && !key.includes('url')) {
       action[key] = Number(value);
    } else {
      action[key] = value;
    }
  }

  return action as BrowserAction;
}

export async function executeBrowserAction(
  args: any,
  options?: ExecuteToolOptions
): Promise<BrowserActionResultPayload | string> {
  let actions: BrowserAction[] = [];

  const rawActions = args.actions || args.action;

  if (Array.isArray(rawActions)) {
    actions = rawActions.map(a => typeof a === 'string' ? parseActionString(a) : a);
  } else if (typeof rawActions === 'string') {
    actions = [parseActionString(rawActions)];
  } else if (typeof rawActions === 'object' && rawActions !== null) {
    actions = [rawActions as BrowserAction];
  }

  if (actions.length === 0) {
    return 'Erro: "actions" é obrigatório e deve ser um array não-vazio ou uma lista de strings "action:".';
  }

  const sessionId = args.sessionId ?? 'default';
  const globalTimeout = args.timeoutMs ?? 10_000;
  const results: ActionResult[] = [];
  const images: BrowserActionImageAttachment[] = [];

  if (actions.length === 1 && actions[0].type === 'close_session') {
    await closeSession(sessionId);
    return '✅ Sessão do browser encerrada.';
  }

  if (typeof args.headless === 'string') {
    args.headless = args.headless.toLowerCase() === 'true';
  }

  if (typeof args.viewportWidth === 'string') {
    args.viewportWidth = parseInt(args.viewportWidth, 10);
  }
  if (typeof args.viewportHeight === 'string') {
    args.viewportHeight = parseInt(args.viewportHeight, 10);
  }

  let session: Session;
  try {
    session = await getOrCreateSession(sessionId, args);
  } catch (err: any) {
    return `Erro ao iniciar browser: ${err.message}`;
  }

  const { page } = session;

  for (const action of actions) {
    if (action.type === 'close_session') {
      results.push({
        action: 'close_session',
        success: true,
        durationMs: 0,
      });
      await closeSession(sessionId);
      break;
    }

    const result = await runAction(page, action, globalTimeout, images);
    results.push(result);
  }

  const payload: BrowserActionResultPayload = {
    message: formatResults(results),
    results
  };

  if (images.length > 0) {
    payload.images = images;
  }

  return payload;
}