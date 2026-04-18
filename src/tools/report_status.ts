import { ExecuteToolOptions } from './types';

/**
 * Tool report_status — permite o modelo reportar um status customizado
 * com prioridade MÁXIMA (bypassa o sistema de prioridades do agentStatus).
 * O modelo pode definir texto, cor de fundo e cor da bolinha.
 */
export async function executeReportStatus(
    args: {
        text: string;
        dotColor?: string;
        backgroundColor?: string;
        autoHideMs?: number;
    },
    options: ExecuteToolOptions
): Promise<{ success: boolean; message: string }> {
    const { text, dotColor, backgroundColor, autoHideMs = 0 } = args;

    if (!text || text.trim().length === 0) {
        throw new Error('O campo "text" é obrigatório e não pode estar vazio.');
    }

    // Envia para a webview do chat
    if (options.sidebarProvider && options.sidebarProvider.view) {
        await options.sidebarProvider.view.webview.postMessage({
            type: 'core/reportStatus',
            payload: {
                text: text.trim(),
                dotColor: dotColor || undefined,
                backgroundColor: backgroundColor || undefined,
                autoHideMs: autoHideMs || 0,
            }
        });
    }

    return {
        success: true,
        message: `Status reportado: "${text.trim()}"`
    };
}
