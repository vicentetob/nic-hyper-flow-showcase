import * as vscode from 'vscode';

export class UpgradeWebviewProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static async createOrShow(context: vscode.ExtensionContext, upgradeUrl: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Se já existe um painel, apenas revela ele e atualiza o conteúdo (caso a URL tenha mudado)
        if (UpgradeWebviewProvider.currentPanel) {
            UpgradeWebviewProvider.currentPanel.webview.html = UpgradeWebviewProvider.getHtmlForWebview(UpgradeWebviewProvider.currentPanel.webview, upgradeUrl);
            UpgradeWebviewProvider.currentPanel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'nicHyperFlowUpgrade',
            'Upgrade Nic Hyper Flow',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        UpgradeWebviewProvider.currentPanel = panel;
        panel.webview.html = UpgradeWebviewProvider.getHtmlForWebview(panel.webview, upgradeUrl);

        panel.onDidDispose(() => {
            UpgradeWebviewProvider.currentPanel = undefined;
        });

        // Setup message handlers
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case "openUpgrade":
                    if (message.url) {
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case "close":
                    panel.dispose();
                    break;
            }
        });
    }

    private static getHtmlForWebview(webview: vscode.Webview, upgradeUrl: string): string {
        // Ícones SVG inline para performance e independência
        const checkIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 6L9 17L4 12" stroke="#4caf50" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const lockIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 22C14.7614 22 17 19.7614 17 17V11H7V17C7 19.7614 9.23858 22 12 22Z" fill="var(--vscode-editor-foreground)" fill-opacity="0.2"/><path d="M7 11V7C7 4.23858 9.23858 2 12 2C14.7614 2 17 4.23858 17 7V11" stroke="var(--vscode-editor-foreground)" stroke-width="2" stroke-linecap="round"/></svg>`;
        const rocketIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upgrade to Pro</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --fg-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-widget-border);
            --accent-color: #007acc;
            --success-color: #4caf50;
            --danger-color: #ff4d4f;
            --card-bg: var(--vscode-sideBar-background);
            --button-bg: #238636;
            --button-hover: #2ea043;
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        }

        body {
            background-color: var(--bg-color);
            color: var(--fg-color);
            font-family: var(--font-family);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }

        .container {
            max-width: 500px;
            width: 100%;
            text-align: center;
            animation: fadeIn 0.4s ease-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .limit-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 77, 79, 0.15);
            color: #ff4d4f;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 24px;
            border: 1px solid rgba(255, 77, 79, 0.3);
        }

        h1 {
            font-size: 2.2rem;
            margin: 0 0 12px 0;
            font-weight: 700;
            line-height: 1.2;
        }

        .subtitle {
            font-size: 1.1rem;
            opacity: 0.8;
            margin: 0 0 40px 0;
            line-height: 1.5;
            max-width: 400px;
            margin-left: auto;
            margin-right: auto;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
            position: relative;
            overflow: hidden;
        }

        /* Shine effect */
        .card::before {
            content: "";
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
            transition: 0.5s;
            pointer-events: none;
        }
        
        .card:hover::before {
            left: 100%;
        }

        .plan-name {
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.6;
            margin-bottom: 8px;
            font-weight: 600;
        }

        .price {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 24px;
            color: var(--fg-color);
        }
        
        .price span {
            font-size: 1rem;
            font-weight: 400;
            opacity: 0.6;
        }

        .features-list {
            text-align: left;
            margin: 0 0 32px 0;
            padding: 0;
            list-style: none;
        }

        .features-list li {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            font-size: 1rem;
        }

        .features-list li svg {
            flex-shrink: 0;
        }

        .cta-button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            background-color: var(--button-bg);
            color: #ffffff;
            border: 1px solid rgba(255,255,255,0.1);
            padding: 16px;
            font-size: 1.1rem;
            font-weight: 600;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
        }

        .cta-button:hover {
            background-color: var(--button-hover);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .cta-button:active {
            transform: translateY(0);
        }

        .footer-note {
            margin-top: 24px;
            font-size: 0.85rem;
            opacity: 0.5;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        /* Dark mode enhancements */
        body.vscode-dark .card {
            background: rgba(30, 30, 30, 0.6);
            backdrop-filter: blur(10px);
        }

        /* High contrast support */
        @media (forced-colors: active) {
            .limit-badge, .cta-button, .card {
                border: 2px solid CanvasText;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="limit-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            Usage Limit Reached
        </div>

        <h1>Unlock Your Flow</h1>
        <p class="subtitle">You’ve used 100% of your free tokens. Upgrade now to continue building without interruptions.</p>

        <div class="card">
            <div class="plan-name">PRO PLAN</div>
            <div class="price">$7.99<span>/mo</span></div>
            
            <ul class="features-list">
                <li>${checkIcon} <span><strong>50M tokens</strong> per month</span></li>
                <li>${checkIcon} <span><strong>Context Retention</strong> (History)</span></li>
                <li>${checkIcon} <span><strong>Fast</strong> support</span></li>
                <li>${checkIcon} <span><strong>New features</strong> released first for Pro Plan</span></li>
                <li>${checkIcon} <span><strong>work without interruptions</strong></span></li>
            </ul>

            <button class="cta-button" onclick="openUpgrade()">
                Upgrade to Pro
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
            
            <div class="footer-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Secure payment via Stripe
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const upgradeUrl = "${upgradeUrl}";

        function openUpgrade() {
            vscode.postMessage({
                type: 'openUpgrade',
                url: upgradeUrl
            });
        }
    </script>
</body>
</html>`;
    }
}
