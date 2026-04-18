import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function renderWebviewContent(webview: vscode.Webview, context: vscode.ExtensionContext): string {
    const webRoot = path.join(context.extensionPath, 'dist', 'ui', 'chat', 'view');
    const sharedRoot = path.join(context.extensionPath, 'dist', 'ui', 'shared');
    const outRoot = webRoot;
    const htmlPath = path.join(webRoot, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Cache busting com timestamp
    const timestamp = new Date().getTime();
    
    // Main app (TypeScript compilado para out/)
    // Nota: app.ts compila para out/ui/chat/view/app.js
    const appJsPath = path.join(outRoot, 'app.js');
    const appJsUri = webview.asWebviewUri(vscode.Uri.file(appJsPath));
    
    // Shared CSS
    const tokensCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(sharedRoot, 'theme', 'tokens.css')));
    const baseCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(sharedRoot, 'theme', 'base.css')));
    const utilitiesCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(sharedRoot, 'styles', 'utilities.css')));
    
    // Chat layout CSS
    const chatCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'styles.css')));
    
    // Feature CSS
    const messagesCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'messages', 'messages.css')));
    const thinkingCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'thinking', 'thinking.css')));
    const toolCardsCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'toolCards', 'toolCards.css')));
    const composerCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'composer', 'composer.css')));
    const attachmentsCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'attachments', 'attachments.css')));
    const modelSelectorCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'modelSelector', 'modelSelector.css')));
    const chatListHeaderCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'chatListHeader', 'chatListHeader.css')));
    const sidebarCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'sidebar', 'sidebar.css')));
    const fileChangesCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'fileChanges', 'fileChanges.css')));
    const contextProgressCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'contextProgress', 'contextProgress.css')));
    const visionWarningCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'visionWarning', 'visionWarning.css')));
    const subscriptionWarningCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'subscriptionWarning', 'subscriptionWarning.css')));
    const editModalCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'editModal', 'editModal.css')));
    const planBoardCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'planBoard', 'planBoard.css')));
    const agentStatusCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'features', 'agentStatus', 'agentStatus.css')));
    
    // Vendor
    const markedJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'vendor', 'marked.min.js')));
    
    // Widget patch
    const patchWidgetJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'widget_patch', 'patch-widget.js')));
    const patchWidgetCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'widget_patch', 'patch-widget.css')));
    
    // Assets da extensão (para background cognitivo)
    // As imagens estão em assets/generated/cognitive-states/ dentro do diretório da extensão
    const extensionAssetsPath = path.join(context.extensionPath, 'assets');
    const assetsRoot = vscode.Uri.file(extensionAssetsPath);
    const assetsUriStr = webview.asWebviewUri(assetsRoot).toString();
    const config = vscode.workspace.getConfiguration('nic-hyper-flow');
    const configuredBackgroundPath = config.get<string>('uiBackgroundImagePath', 'assets/background.png');
    const resolvedStaticBackgroundUri = (() => {
        if (configuredBackgroundPath && path.isAbsolute(configuredBackgroundPath) && fs.existsSync(configuredBackgroundPath)) {
            return webview.asWebviewUri(vscode.Uri.file(configuredBackgroundPath)).with({ query: `v=${timestamp}` });
        }
        return webview.asWebviewUri(vscode.Uri.file(path.join(extensionAssetsPath, 'background.png'))).with({ query: `v=${timestamp}` });
    })();
    const chatUiSettings = JSON.stringify({
      backgroundMode: config.get<string>('uiBackgroundMode', 'static'),
      backgroundImagePath: configuredBackgroundPath,
      showReasoningButton: config.get<boolean>('showReasoningButton', true),
      showApiCost: config.get<boolean>('showApiCost', true),
      showSummarizeButton: config.get<boolean>('showSummarizeButton', true),
      focusedModeEnabled: config.get<boolean>('focusedModeEnabled', false),
      showTokenCounter: config.get<boolean>('showTokenCounter', true)
    });
    const applyEverythingIconUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionAssetsPath, 'generated', 'edit-approval', 'apply_everything_64.png'))).with({ query: `v=${timestamp}` });
    const askBeforeApplyIconUri = webview.asWebviewUri(vscode.Uri.file(path.join(extensionAssetsPath, 'generated', 'edit-approval', 'ask_before_apply_64.png'))).with({ query: `v=${timestamp}` });
    const applyEverythingIconPath = path.join(extensionAssetsPath, 'generated', 'edit-approval', 'apply_everything_64.png');
    const askBeforeApplyIconPath = path.join(extensionAssetsPath, 'generated', 'edit-approval', 'ask_before_apply_64.png');

    // Inline brain SVG — lê o arquivo, força fill=currentColor e injeta no HTML
    let brainSvgInline = '🧠';
    try {
      const brainSvgPath = path.join(context.extensionPath, 'assets', 'svg_brain.svg');
      let svgRaw = fs.readFileSync(brainSvgPath, 'utf8');
      // Extract original dimensions to build viewBox before stripping them
      const wMatch = svgRaw.match(/<svg[^>]*\s+width="([^"]+)"/);
      const hMatch = svgRaw.match(/<svg[^>]*\s+height="([^"]+)"/);
      const vbAttr = (wMatch && hMatch) ? ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"` : '';
      svgRaw = svgRaw
        .replace(/<\?xml[^>]*\?>\s*/g, '')
        .replace(/<!DOCTYPE[^[]*(\[[^\]]*\])?\s*>\s*/g, '')
        .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
        .replace(/fill="#[0-9a-fA-F]{3,8}"/gi, 'fill="currentColor"')
        .replace(/fill="black"/gi, 'fill="currentColor"')
        .replace(/(<svg[^>]*)\s+width="[^"]*"/, '$1')
        .replace(/(<svg[^>]*)\s+height="[^"]*"/, '$1')
        .replace(/<svg/, `<svg class="brain-svg-inner" width="20" height="20"${vbAttr} style="display:block"`)
        .trim();
      brainSvgInline = svgRaw;
    } catch {
      // fallback silencioso
    }

    // Inline focus mode SVG — crosshair/target minimalista
    const focusSvgInline = `<svg class="focus-svg-inner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block">
  <circle cx="12" cy="12" r="9"/>
  <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>
  <line x1="12" y1="2" x2="12" y2="6.5"/>
  <line x1="12" y1="17.5" x2="12" y2="22"/>
  <line x1="2" y1="12" x2="6.5" y2="12"/>
  <line x1="17.5" y1="12" x2="22" y2="12"/>
</svg>`;

    const applyEverythingSvgInline = fs.existsSync(applyEverythingIconPath)
      ? `<img src="${applyEverythingIconUri.toString()}" alt="" />`
      : `<svg class="edit-approval-svg-inner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block">
  <path d="M7 12.5l3.2 3.2L17.5 8.4"/>
  <path d="M20 12a8 8 0 1 1-4.2-7" opacity="0.9"/>
</svg>`;

    const askBeforeApplySvgInline = fs.existsSync(askBeforeApplyIconPath)
      ? `<img src="${askBeforeApplyIconUri.toString()}" alt="" />`
      : `<svg class="edit-approval-svg-inner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block">
  <circle cx="12" cy="12" r="8.5"/>
  <path d="M9.9 9.2a2.4 2.4 0 0 1 4.6.9c0 1.5-1 2.2-1.8 2.8-.7.5-1.2.9-1.2 1.7"/>
  <circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none"/>
</svg>`;

    const nonce = getNonce();

    html = html.replace(/{{CSP_SOURCE}}/g, webview.cspSource)
               .replace(/{{NONCE}}/g, nonce)
               .replace(/{{APP_JS_URI}}/g, appJsUri.toString())
               .replace(/{{TOKENS_CSS_URI}}/g, tokensCssUri.toString())
               .replace(/{{BASE_CSS_URI}}/g, baseCssUri.toString())
               .replace(/{{UTILITIES_CSS_URI}}/g, utilitiesCssUri.toString())
               .replace(/{{CHAT_CSS_URI}}/g, chatCssUri.toString())
               .replace(/{{MESSAGES_CSS_URI}}/g, messagesCssUri.toString())
               .replace(/{{THINKING_CSS_URI}}/g, thinkingCssUri.toString())
               .replace(/{{TOOL_CARDS_CSS_URI}}/g, toolCardsCssUri.toString())
               .replace(/{{COMPOSER_CSS_URI}}/g, composerCssUri.toString())
               .replace(/{{ATTACHMENTS_CSS_URI}}/g, attachmentsCssUri.toString())
               .replace(/{{MODEL_SELECTOR_CSS_URI}}/g, modelSelectorCssUri.toString())
               .replace(/{{CHAT_LIST_HEADER_CSS_URI}}/g, chatListHeaderCssUri.toString())
               .replace(/{{SIDEBAR_CSS_URI}}/g, sidebarCssUri.toString())
               .replace(/{{FILE_CHANGES_CSS_URI}}/g, fileChangesCssUri.toString())
               .replace(/{{CONTEXT_PROGRESS_CSS_URI}}/g, contextProgressCssUri.toString())
               .replace(/{{VISION_WARNING_CSS_URI}}/g, visionWarningCssUri.toString())
               .replace(/{{SUBSCRIPTION_WARNING_CSS_URI}}/g, subscriptionWarningCssUri.toString())
               .replace(/{{EDIT_MODAL_CSS_URI}}/g, editModalCssUri.toString())
               .replace(/{{PLAN_BOARD_CSS_URI}}/g, planBoardCssUri.toString())
               .replace(/{{AGENT_STATUS_CSS_URI}}/g, agentStatusCssUri.toString())
               .replace(/{{MARKED_JS_URI}}/g, markedJsUri.toString())
               .replace(/{{PATCH_WIDGET_JS_URI}}/g, patchWidgetJsUri.toString())
               .replace(/{{PATCH_WIDGET_CSS_URI}}/g, patchWidgetCssUri.toString())
               .replace(/{{ASSETS_URI}}/g, assetsUriStr)
               .replace(/{{STATIC_BACKGROUND_URI}}/g, resolvedStaticBackgroundUri.toString())
               .replace(/{{CHAT_UI_SETTINGS}}/g, chatUiSettings.replace(/'/g, "\\'").replace(/</g, '\\u003c'))
               .replace(/{{BRAIN_SVG}}/g, brainSvgInline)
               .replace(/{{FOCUS_SVG}}/g, focusSvgInline)
               .replace(/{{APPLY_EVERYTHING_ICON_URI}}/g, applyEverythingIconUri.toString())
               .replace(/{{ASK_BEFORE_APPLY_ICON_URI}}/g, askBeforeApplyIconUri.toString())
               .replace(/{{APPLY_EVERYTHING_SVG}}/g, applyEverythingSvgInline)
               .replace(/{{ASK_BEFORE_APPLY_SVG}}/g, askBeforeApplySvgInline)
               .replace(/{{NIC_LOGO_URI}}/g, webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'assets', 'nic-hyper-flow-marketplace.png'))).toString());
    return html;
}


function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Legado para manter compatibilidade se necessário, 
 * mas agora centralizamos no renderWebviewContent
 */
export function renderWebview(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): string {
    return renderWebviewContent(panel.webview, context);
}