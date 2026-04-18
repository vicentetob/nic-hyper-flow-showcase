import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CredentialsManager } from '../../core/credentials';
import { ProviderManager } from '../../models/providerManager';
import * as knowledgeService from '../../services/knowledgeService';
import { AssetIntelligence } from '../../services/assetIntelligence';
import { runCommandManager } from '../../tools/runCommandManager';
import { isFocusedModeEnabled, setFocusedModeEnabled } from '../../core/focusedModeState';
import { findPricingForModel, normalizeModelIdForPricing } from '../../utils/providerPricing';

export class SettingsWebviewProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static async createOrShow(context: vscode.ExtensionContext, credentials: CredentialsManager) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Se já existe um painel, apenas revela ele
        if (SettingsWebviewProvider.currentPanel) {
            SettingsWebviewProvider.currentPanel.reveal(column);
            return;
        }

        // Cria um novo painel
        // Prepara localResourceRoots: inclui a pasta da webview e o workspace root (para assets)
        const resourceRoots = [
            vscode.Uri.file(path.join(context.extensionPath, 'dist', 'ui', 'settings', 'view'))
        ];
        
        // Adiciona o workspace root se houver um workspace aberto (necessário para exibir assets)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            resourceRoots.push(workspaceFolders[0].uri);
        }
        
        const panel = vscode.window.createWebviewPanel(
            'nicHyperFlowSettings',
            'Nic Hyper Flow - Configurações',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: resourceRoots,
                retainContextWhenHidden: true
            }
        );

        SettingsWebviewProvider.currentPanel = panel;
        panel.webview.html = SettingsWebviewProvider.getHtmlForWebview(panel.webview, context);

        // Setup message handlers
        panel.webview.onDidReceiveMessage(async (message) => {
            const payload = message.payload ?? {};

            switch (message.type) {
                case "ui/requestSettings":
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/setRunCommandAllowAll":
                    runCommandManager.setAllowAll(!!payload.allowAll);
                    
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/removeFromWhitelist":
                    if (payload.command) {
                        runCommandManager.removeFromWhitelist(payload.command);
                        
                        await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    }
                    break;

                case "ui/saveAllowlist":
                    runCommandManager.setAllowedCommands(Array.isArray(payload.commands) ? payload.commands : []);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveUiSettings":
                    await SettingsWebviewProvider.saveUiSettings(context, payload);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveReasoningVisibility":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('showReasoningButton', !!payload.enabled, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveTokenCostVisibility":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('showApiCost', !!payload.enabled, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveSummarizeVisibility":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('showSummarizeButton', !!payload.enabled, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveFocusedMode":
                    setFocusedModeEnabled(!!payload.enabled);
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('focusedModeEnabled', !!payload.enabled, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveDefaultFocusedMode":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('defaultFocusedMode', !!payload.enabled, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveEditApprovalMode": {
                    const mode = payload.mode === 'ask_before_apply' ? 'ask_before_apply' : 'apply_everything';
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('editApprovalMode', mode, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;
                }

                case "ui/saveTokenCounterVisibility":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('showTokenCounter', !!payload.enabled, vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/selectDefaultModel":
                    if (payload.modelId) {
                        await vscode.workspace.getConfiguration('nic-hyper-flow').update('selectedModelId', String(payload.modelId), vscode.ConfigurationTarget.Global);
                        await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    }
                    break;

                case "ui/saveImageModel":
                    if (payload.model) {
                        await vscode.workspace.getConfiguration('nic-hyper-flow').update('defaultImageModel', String(payload.model), vscode.ConfigurationTarget.Global);
                        await credentials.saveImageModel(String(payload.model));
                        await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    }
                    break;

                case "ui/saveOpenAIReasoning":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('openaiReasoningEffort', String(payload.effort || 'medium'), vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveAnthropicReasoning":
                    await vscode.workspace.getConfiguration('nic-hyper-flow').update('anthropicReasoningEffort', String(payload.effort || 'none'), vscode.ConfigurationTarget.Global);
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/summarizeCurrentChat":
                    await vscode.commands.executeCommand('nic-hyper-flow.chatView.focus');
                    await vscode.commands.executeCommand('nic-hyper-flow.reloadChatView');
                    vscode.window.showInformationMessage('O comando de sumarização foi encaminhado para o chat.');
                    break;

                case "ui/selectBackgroundImage": {
                    const selected = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        canSelectFolders: false,
                        canSelectFiles: true,
                        filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] },
                        openLabel: 'Usar como background'
                    });

                    if (selected && selected[0]) {
                        const source = selected[0];
                        const ext = path.extname(source.fsPath) || '.png';
                        const targetDir = path.join(context.globalStorageUri.fsPath, 'ui-backgrounds');
                        fs.mkdirSync(targetDir, { recursive: true });
                        const fileName = `chat-background${ext}`;
                        const targetPath = path.join(targetDir, fileName);
                        fs.copyFileSync(source.fsPath, targetPath);
                        await SettingsWebviewProvider.saveUiSettings(context, {
                            backgroundMode: 'static',
                            backgroundImagePath: targetPath
                        });
                    }
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;
                }

                case "ui/removeBackgroundImage":
                    await SettingsWebviewProvider.saveUiSettings(context, {
                        backgroundMode: 'none',
                        backgroundImagePath: 'assets/background.png'
                    });
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveProviderKey":
                    const providerId = payload.provider;
                    const key = payload.key;
                    
                    console.log(`[SettingsWebview] Salvando chave para o provider: ${providerId}`);
                    
                    if (providerId === 'openai') await credentials.saveOpenAIKey(key);
                    if (providerId === 'anthropic') await credentials.saveAnthropicKey(key);
                    if (providerId === 'google') await credentials.saveGoogleKey(key);
                    if (providerId === 'deepseek') await credentials.saveDeepSeekKey(key);
                    if (providerId === 'xai') await credentials.saveXAIKey(key);
                    if (providerId === 'qwen') {
                        console.log(`[SettingsWebview] Executando saveQwenKey e redundância saveKey('qwen_backup')`);
                        await credentials.saveQwenKey(key);
                        await credentials.saveKey('qwen_backup', key); 
                    }
                    if (providerId === 'fal') await credentials.saveFalKey(key);
                    if (providerId === 'serper') await credentials.saveSerperApiKey(key);
                    if (providerId === 'brave') await credentials.saveBraveApiKey(key);
                    
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/removeProviderKey":
                    if (payload.provider === 'openai') await credentials.deleteSecret('apiKey:openai');
                    if (payload.provider === 'anthropic') await credentials.deleteSecret('apiKey:anthropic');
                    if (payload.provider === 'google') await credentials.deleteSecret('apiKey:google');
                    if (payload.provider === 'deepseek') await credentials.deleteSecret('apiKey:deepseek');
                    if (payload.provider === 'xai') await credentials.deleteSecret('apiKey:xai');
                    if (payload.provider === 'qwen') await credentials.deleteSecret('apiKey:qwen');
                    if (payload.provider === 'fal') await credentials.deleteSecret('apiKey:fal');
                    if (payload.provider === 'serper') await credentials.deleteSerperApiKey();
                    if (payload.provider === 'brave') await credentials.deleteBraveApiKey();
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/saveCustomPrompt":
                    const customPrompt = payload.prompt !== undefined ? payload.prompt : (message.prompt || "");
                    await credentials.saveCustomPrompt(customPrompt);
                    
                    await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
                    break;

                case "ui/requestAssets":
                    await SettingsWebviewProvider.sendAssetsData(panel.webview, context, { repair: !!payload.repair });
                    break;

                case "ui/setAssetStatus":
                    if ((payload.assetId || payload.path) && payload.status) {
                        await SettingsWebviewProvider.setAssetStatus(context, payload.assetId, payload.path, payload.status);
                        await SettingsWebviewProvider.sendAssetsData(panel.webview, context, { repair: false });
                    }
                    break;

                case "ui/repairAsset":
                    if (payload.assetId) {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (workspaceFolders && workspaceFolders.length > 0) {
                            await AssetIntelligence.tryRepairAsset(payload.assetId, workspaceFolders[0]);
                        }
                        await SettingsWebviewProvider.sendAssetsData(panel.webview, context, { repair: false });
                    }
                    break;

                case "ui/openAsset":
                    if (payload.path || message.path || payload.assetId) {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (!workspaceFolders || workspaceFolders.length === 0) break;
                        const wf = workspaceFolders[0];

                        let assetPath = payload.path || message.path;
                        if (!assetPath && payload.assetId) {
                            assetPath = await AssetIntelligence.resolveAssetPath(payload.assetId, wf);
                        }
                        if (!assetPath) break;
                        const fullPath = path.join(wf.uri.fsPath, assetPath);
                        const uri = vscode.Uri.file(fullPath);
                        await vscode.commands.executeCommand('vscode.open', uri);
                    }
                    break;

                case "ui/requestPkbEntries":
                    await SettingsWebviewProvider.sendPkbData(panel.webview, context);
                    break;

                case "ui/savePkbEntry":
                    if (payload.entry || message.entry) {
                        const entry = payload.entry || message.entry;
                        await SettingsWebviewProvider.savePkbEntry(context, entry);
                        
                        await SettingsWebviewProvider.sendPkbData(panel.webview, context);
                    }
                    break;

                case "ui/deletePkbEntry":
                    const deleteId = payload.id || message.id;
                    const deleteDedupKey = payload.dedupKey || message.dedupKey;
                    const deleteQuestion = payload.question || message.question || "este conhecimento";
                    if (deleteId || deleteDedupKey) {
                        const confirm = await vscode.window.showWarningMessage(
                            `Deseja realmente APAGAR PERMANENTEMENTE o conhecimento:\n"${deleteQuestion}"?\n\nEsta ação não pode ser desfeita!`,
                            { modal: true },
                            "Sim, apagar", "Cancelar"
                        );
                        if (confirm === "Sim, apagar") {
                            try {
                                await SettingsWebviewProvider.deletePkbEntry(context, deleteId, deleteDedupKey);
                                
                                await SettingsWebviewProvider.sendPkbData(panel.webview, context);
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Erro ao remover conhecimento: ${error.message}`);
                            }
                        }
                    } else {
                        vscode.window.showErrorMessage("ID ou dedupKey não fornecido para deletar.");
                    }
                    break;

                case "ui/togglePkbStatus":
                    if (payload.id || message.id) {
                        const id = payload.id || message.id;
                        const newStatus = payload.status || message.status;
                        await SettingsWebviewProvider.updatePkbEntryStatus(context, id, newStatus);
                        await SettingsWebviewProvider.sendPkbData(panel.webview, context);
                    }
                    break;

                case "ui/requestBillingData":
                    await SettingsWebviewProvider.sendBillingData(panel.webview, context);
                    break;

                case "ui/requestUpgrade":
                    await SettingsWebviewProvider.openUpgradePage(context);
                    break;

                case "ui/manageSubscription":
                    await SettingsWebviewProvider.openSubscriptionManagement(context);
                    break;
            }
        });

        // Quando o painel é fechado, limpa a referência
        panel.onDidDispose(() => {
            SettingsWebviewProvider.currentPanel = undefined;
        }, null);

        // Enviar dados iniciais
        await SettingsWebviewProvider.sendSettingsData(panel.webview, credentials);
    }

    private static getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {
        const webRoot = path.join(context.extensionPath, 'dist', 'ui', 'settings', 'view');
        const htmlPath = path.join(webRoot, 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        // Cache busting com timestamp
        const timestamp = new Date().getTime();
        const appJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'app.js'))).with({ query: `v=${timestamp}` });
        const stylesUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, 'styles.css'))).with({ query: `v=${timestamp}` });
        
        const nonce = getNonce();

        html = html.replace(/{{CSP_SOURCE}}/g, webview.cspSource)
                   .replace(/{{NONCE}}/g, nonce)
                   .replace(/{{APP_JS_URI}}/g, appJsUri.toString())
                   .replace(/{{STYLES_URI}}/g, stylesUri.toString());

        return html;
    }

    private static async sendSettingsData(webview: vscode.Webview, credentials: CredentialsManager) {
        const customPrompt = await credentials.getCustomPrompt() || '';
        const config = vscode.workspace.getConfiguration('nic-hyper-flow');
        const providerManager = ProviderManager.getInstance();
        const allModels = providerManager.getAllProviders().flatMap((provider) =>
            provider.models.map((model) => ({
                id: model.id,
                displayName: model.displayName,
                description: model.description,
                provider: provider.id,
                providerName: provider.displayName,
                supportsVision: provider.supportsVision,
                contextWindow: model.contextWindow,
                inputTokenLimit: model.inputTokenLimit,
                outputTokenLimit: model.outputTokenLimit,
                protocolMode: 'tool_calling'
            }))
        );

        const providerIds = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'qwen', 'fal', 'serper', 'brave'];
        const providerState: Record<string, boolean> = {};
        for (const providerId of providerIds) {
            providerState[providerId] = !!(await credentials.getSecret(`apiKey:${providerId}`));
        }

        const selectedModelId = config.get<string>('selectedModelId', 'google:gemini-2.5-flash');
        const defaultImageModel = config.get<string>('defaultImageModel', 'gpt-image-1.5');
        const imageModel = (await credentials.getImageModel()) || defaultImageModel;
        const uiSettings = SettingsWebviewProvider.readUiSettings();
        const openaiReasoning = config.get<string>('openaiReasoningEffort', 'medium');
        const anthropicReasoning = config.get<string>('anthropicReasoningEffort', 'none');

        const pricingByModel = allModels.map((model) => {
            const normalized = normalizeModelIdForPricing(model.id);
            const pricing = findPricingForModel(model.provider, model.id);
            return {
                modelId: model.id,
                displayName: model.displayName,
                provider: model.provider,
                normalizedModelId: normalized,
                pricing: pricing
                    ? {
                        input: pricing.input,
                        output: pricing.output,
                        cachedInput: pricing.cachedInput ?? null
                    }
                    : null
            };
        });

        webview.postMessage({
            type: "core/settingsData",
            payload: {
                customPrompt,
                imageModel,
                selectedModelId,
                allModels,
                pricingByModel,
                uiSettings,
                reasoning: {
                    openai: openaiReasoning,
                    anthropic: anthropicReasoning,
                },
                runCommand: {
                    allowAll: runCommandManager.isAllowAll(),
                    allowedCommands: runCommandManager.getAllowedCommands()
                },
                providers: providerState
            }
        });
    }

    private static readUiSettings() {
        const config = vscode.workspace.getConfiguration('nic-hyper-flow');
        const fallbackImageModel = config.get<string>('defaultImageModel', 'gpt-image-1.5');

        return {
            backgroundMode: config.get<string>('uiBackgroundMode', 'static'),
            backgroundImagePath: config.get<string>('uiBackgroundImagePath', 'assets/background.png'),
            showReasoningButton: config.get<boolean>('showReasoningButton', true),
            showApiCost: config.get<boolean>('showApiCost', true),
            showSummarizeButton: config.get<boolean>('showSummarizeButton', true),
            focusedModeEnabled: config.get<boolean>('focusedModeEnabled', isFocusedModeEnabled()),
            defaultFocusedMode: config.get<boolean>('defaultFocusedMode', false),
            editApprovalMode: config.get<string>('editApprovalMode', 'apply_everything'),
            showTokenCounter: config.get<boolean>('showTokenCounter', true),
            defaultImageModel: fallbackImageModel,
        };
    }

    private static async saveUiSettings(context: vscode.ExtensionContext, payload: any) {
        const config = vscode.workspace.getConfiguration('nic-hyper-flow');
        const updates: Array<Thenable<void>> = [];

        if (payload?.backgroundMode !== undefined) {
            updates.push(config.update('uiBackgroundMode', String(payload.backgroundMode), vscode.ConfigurationTarget.Global));
        }

        if (payload?.backgroundImagePath !== undefined) {
            const nextPath = String(payload.backgroundImagePath || '').trim() || 'assets/background.png';
            updates.push(config.update('uiBackgroundImagePath', nextPath, vscode.ConfigurationTarget.Global));
        }

        await Promise.all(updates);
    }

    // ========== ASSETS MANAGEMENT ==========
    private static async sendAssetsData(
        webview: vscode.Webview,
        context: vscode.ExtensionContext,
        opts: { repair?: boolean } = {}
    ) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                webview.postMessage({ type: "core/assetsData", payload: [] });
                return;
            }

            const wf = workspaceFolders[0];
            const workspaceRoot = wf.uri.fsPath;

            // Load (and auto-migrate) registry
            let reg = AssetIntelligence.loadRegistry(wf);

            // Optional: repair missing assets on demand
            if (opts.repair) {
                const missing = Object.values(reg.assetsById || {}).filter((a: any) => {
                    const full = path.join(workspaceRoot, a.lastKnownPath || '');
                    return !!a.lastKnownPath && !fs.existsSync(full);
                });
                for (const a of missing) {
                    try { await AssetIntelligence.tryRepairAsset(a.assetId, wf); } catch { /* ignore */ }
                }
                reg = AssetIntelligence.loadRegistry(wf);
            }

            const assets: any[] = [];
            for (const a of Object.values(reg.assetsById || {})) {
                const relPath = (a as any).lastKnownPath;
                const fullPath = relPath ? path.join(workspaceRoot, relPath) : '';
                const exists = !!relPath && fs.existsSync(fullPath);

                let webviewUri: string | undefined = undefined;
                if (exists) {
                    const diskUri = vscode.Uri.file(fullPath);
                    webviewUri = webview.asWebviewUri(diskUri).toString();
                }

                assets.push({
                    assetId: (a as any).assetId,
                    path: relPath,
                    basename: relPath ? path.basename(relPath) : (a as any).assetId,
                    webviewUri,
                    missing: !exists,
                    aliases: (a as any).aliases || [],
                    fingerprint: (a as any).fingerprint,
                    ext: (a as any).ext,
                    size: (a as any).size,
                    mtimeMs: (a as any).mtimeMs,
                    origin_prompt: (a as any).origin_prompt,
                    version: (a as any).version,
                    status: (a as any).status || 'pending',
                    intelligence: (a as any).intelligence
                });
            }

            // newest first (roughly: by mtime)
            assets.sort((x, y) => (y.mtimeMs || 0) - (x.mtimeMs || 0));

            webview.postMessage({ type: "core/assetsData", payload: assets });
        } catch (error: any) {
            console.error('Error sending assets data:', error);
            webview.postMessage({ type: "core/assetsData", payload: [] });
        }
    }

    private static async setAssetStatus(
        context: vscode.ExtensionContext,
        assetId: string | undefined,
        assetPath: string | undefined,
        status: string
    ) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) return;
            const wf = workspaceFolders[0];

            const reg = AssetIntelligence.loadRegistry(wf);
            const id = assetId || (assetPath ? reg.paths?.[assetPath] : undefined);
            if (!id) return;
            const rec = reg.assetsById?.[id];
            if (!rec) return;

            rec.status = status;
            // keep a lightweight stamp
            (rec as any).statusUpdatedAt = Date.now();
            AssetIntelligence.saveRegistry(wf, reg);
        } catch (error: any) {
            console.error('Error setting asset status:', error);
        }
    }

    // ========== PKB MANAGEMENT ==========
    private static async sendPkbData(webview: vscode.Webview, context: vscode.ExtensionContext) {
        try {
            // PKB é POR PROJETO, não global da extensão!
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                webview.postMessage({
                    type: "core/pkbData",
                    payload: []
                });
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const pkbPath = path.join(workspaceRoot, '.nic-hyper-flow', 'pkb_v2.jsonl');

            if (!fs.existsSync(pkbPath)) {
                webview.postMessage({
                    type: "core/pkbData",
                    payload: []
                });
                return;
            }

            // Read JSONL file
            const content = fs.readFileSync(pkbPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            const entries = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(entry => entry !== null);

            webview.postMessage({
                type: "core/pkbData",
                payload: entries
            });
        } catch (error: any) {
            console.error('Error sending PKB data:', error);
            webview.postMessage({
                type: "core/pkbData",
                payload: []
            });
        }
    }

    private static async savePkbEntry(context: vscode.ExtensionContext, entry: any) {
        try {
            // PKB é POR PROJETO!
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('Nenhum workspace aberto');
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const pkbDir = path.join(workspaceRoot, '.nic-hyper-flow');
            const pkbPath = path.join(pkbDir, 'pkb_v2.jsonl');

            // Ensure directory exists
            if (!fs.existsSync(pkbDir)) {
                fs.mkdirSync(pkbDir, { recursive: true });
            }

            // Read existing entries
            let entries: any[] = [];
            if (fs.existsSync(pkbPath)) {
                const content = fs.readFileSync(pkbPath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line.trim());
                entries = lines.map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                }).filter(e => e !== null);
            }

            const now = Date.now();
            const isUpdate = !!entry.id;

            if (isUpdate) {
                // Update existing entry
                const existingIndex = entries.findIndex(e => e.id === entry.id);
                if (existingIndex >= 0) {
                    const existing = entries[existingIndex];
                    entries[existingIndex] = {
                        ...existing,
                        canonicalQuestion: entry.canonicalQuestion || existing.canonicalQuestion,
                        canonicalScope: entry.canonicalScope || existing.canonicalScope,
                        answer: entry.answer || existing.answer,
                        reference: entry.reference ?? existing.reference,
                        tags: Array.isArray(entry.tags) ? entry.tags : (existing.tags || []),
                        sources: Array.isArray(entry.sources) ? entry.sources : (existing.sources || []),
                        confidence: typeof entry.confidence === 'number' ? entry.confidence : (existing.confidence || 1.0),
                        status: entry.status || existing.status,
                        updatedAt: now,
                        version: existing.version || 1
                    };
                }
            } else {
                // Create new entry using knowledgeService
                await knowledgeService.addKnowledge(workspaceRoot, {
                    canonicalQuestion: entry.canonicalQuestion || entry.question,
                    canonicalScope: entry.canonicalScope || entry.scope || 'global',
                    answer: entry.answer,
                    reference: entry.reference || '',
                    tags: Array.isArray(entry.tags) ? entry.tags : [],
                    sources: Array.isArray(entry.sources) ? entry.sources : [],
                    confidence: typeof entry.confidence === 'number' ? entry.confidence : 1.0
                });
                return; // knowledgeService already writes to file
            }

            // Write back to file
            const newContent = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
            fs.writeFileSync(pkbPath, newContent, 'utf8');
        } catch (error: any) {
            console.error('Error saving PKB entry:', error);
            throw error;
        }
    }

    private static async deletePkbEntry(context: vscode.ExtensionContext, id?: string, dedupKey?: string) {
        try {
            // PKB é POR PROJETO!
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('Nenhum workspace aberto');
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const pkbPath = path.join(workspaceRoot, '.nic-hyper-flow', 'pkb_v2.jsonl');

            if (!fs.existsSync(pkbPath)) {
                console.log('PKB file does not exist, nothing to delete');
                return;
            }

            // Read existing entries
            const content = fs.readFileSync(pkbPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            let entries = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    console.error('Error parsing line:', line, e);
                    return null;
                }
            }).filter(e => e !== null);

            const beforeCount = entries.length;

            // Remove entry completely (real delete)
            entries = entries.filter(e => {
                // If id is provided, match by id
                if (id && e.id === id) {
                    console.log(`Deleting entry by id: ${id}`);
                    return false;
                }
                // If dedupKey is provided and no id match, match by dedupKey
                if (dedupKey && e.dedupKey === dedupKey && !id) {
                    console.log(`Deleting entry by dedupKey: ${dedupKey}`);
                    return false;
                }
                return true;
            });

            const afterCount = entries.length;

            if (beforeCount === afterCount) {
                console.warn(`No entry found to delete. id: ${id}, dedupKey: ${dedupKey}`);
                throw new Error('Entrada não encontrada para deletar');
            }

            // Write back to file
            const newContent = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
            fs.writeFileSync(pkbPath, newContent, 'utf8');
            console.log(`Successfully deleted entry. Before: ${beforeCount}, After: ${afterCount}`);
        } catch (error: any) {
            console.error('Error deleting PKB entry:', error);
            throw error;
        }
    }

    private static async updatePkbEntryStatus(context: vscode.ExtensionContext, id: string, newStatus: string) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('Nenhum workspace aberto');
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const pkbPath = path.join(workspaceRoot, '.nic-hyper-flow', 'pkb_v2.jsonl');

            if (!fs.existsSync(pkbPath)) return;

            const content = fs.readFileSync(pkbPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            const entries = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(e => e !== null);

            // Update status
            const updated = entries.map(e => {
                if (e.id === id) {
                    return { ...e, status: newStatus, updatedAt: Date.now() };
                }
                return e;
            });

            const newContent = updated.map(e => JSON.stringify(e)).join('\n') + (updated.length > 0 ? '\n' : '');
            fs.writeFileSync(pkbPath, newContent, 'utf8');
        } catch (error: any) {
            console.error('Error updating PKB entry status:', error);
            throw error;
        }
    }

    private static async sendBillingData(webview: vscode.Webview, context: vscode.ExtensionContext) {
        try {
            // Importar AuthService para obter status da assinatura
            const { AuthService } = await import('../../services/authService.js');
            
            // Obter status da assinatura (usar instância)
            const authService = AuthService.getInstance();
            const subStatus = await authService.getSubscriptionStatus(context);
            const isPro = subStatus.plan === 'pro';
            const plan = subStatus.plan || 'free';
            
            // Tentar obter informações de quota do usuário autenticado
            let tokensUsed = 0;
            let monthlyLimit = isPro ? 80000000 : 3000000;
            let month = new Date().toISOString().slice(0, 7); // Formato YYYY-MM
            let tokensRemaining = monthlyLimit;
            
            // Verificar se o usuário está autenticado e obter informações de quota
            if (await authService.isAuthenticated()) {
                try {
                    // Obter informações do usuário que podem conter dados de quota
                    const userInfo = await authService.getUserInfo();
                    const nicToken = await authService.getNicToken();
                    
                    // Se temos token, podemos tentar obter informações atualizadas do backend
                    if (nicToken) {
                        // Decodificar JWT para obter claims (pode conter informações de quota)
                        const tokenParts = nicToken.split('.');
                        if (tokenParts.length === 3) {
                            try {
                                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf-8'));
                                
                                // Verificar se o token contém informações de quota
                                if (payload.quota) {
                                    tokensUsed = payload.quota.used_this_month || 0;
                                    monthlyLimit = payload.quota.max_tokens_per_month || monthlyLimit;
                                    tokensRemaining = payload.quota.remaining || monthlyLimit;
                                    month = payload.quota.month || month;
                                } else if (payload.plan && payload.plan.quota) {
                                    // Formato alternativo: plan.quota
                                    tokensUsed = payload.plan.quota.used_this_month || 0;
                                    monthlyLimit = payload.plan.quota.max_tokens_per_month || monthlyLimit;
                                    tokensRemaining = payload.plan.quota.remaining || monthlyLimit;
                                    month = payload.quota.month || month;
                                }
                            } catch (e) {
                                console.warn('Não foi possível decodificar informações de quota do token:', e);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Erro ao obter informações de quota:', error);
                }
            }
            
            // Histórico de billing (simulado por enquanto)
            const billingHistory: Array<{
                date: string;
                description: string;
                status: string;
                amount?: number;
            }> = [
                {
                    date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                    description: "Subscription created",
                    status: "success"
                }
            ];
            
            // Adicionar histórico de upgrade se for Pro
            if (isPro) {
                billingHistory.unshift({
                    date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
                    description: "Upgraded to Pro plan",
                    amount: 7.99,
                    status: "success"
                });
            }
            
            webview.postMessage({
                type: "core/billingData",
                payload: {
                    plan,
                    is_pro: isPro,
                    tokens_used: tokensUsed,
                    monthly_limit: monthlyLimit,
                    tokens_remaining: tokensRemaining,
                    current_month: month,
                    billing_history: billingHistory
                }
            });
            
        } catch (error: any) {
            console.error('Error sending billing data:', error);
            webview.postMessage({
                type: "core/billingData",
                payload: {
                    plan: "free",
                    is_pro: false,
                    tokens_used: 0,
                    monthly_limit: 3000000,
                    tokens_remaining: 3000000,
                    current_month: new Date().toISOString().slice(0, 7),
                    billing_history: []
                }
            });
        }
    }

    private static async openUpgradePage(context: vscode.ExtensionContext) {
        try {
            // Usar o fluxo existente de upgrade
            // O comando 'nic-hyper-flow.openUpgrade' já gerencia a URL de upgrade
            await vscode.commands.executeCommand('nic-hyper-flow.openUpgrade');
        } catch (error: any) {
            console.error('Error opening upgrade page:', error);
            vscode.window.showErrorMessage(`Error opening upgrade page: ${error.message}`);
        }
    }

    private static async openSubscriptionManagement(context: vscode.ExtensionContext) {
        try {
            // Por enquanto, abrir a página de upgrade para gerenciamento
            // TODO: Implementar portal do cliente do Stripe quando disponível
            await vscode.commands.executeCommand('nic-hyper-flow.openUpgrade');
            
        } catch (error: any) {
            console.error('Error opening subscription management:', error);
            vscode.window.showErrorMessage(`Error opening subscription management: ${error.message}`);
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
