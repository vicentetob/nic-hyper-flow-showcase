import { ExecuteToolOptions } from './types';

const VALID_STATES = [
    'idle-receptive',
    'comprehension',
    'disambiguation',
    'planning-strategy',
    'deep-focus',
    'execution',
    'monitoring',
    'cognitive-tension',
    'insight-restructuring',
    'consolidation',
    'final-validation',
    'closure'
];

export async function executeReportCognitiveState(
    args: { state: string },
    options: ExecuteToolOptions
): Promise<{ success: boolean; state: string; message: string }> {
    const state = args.state;

    if (!VALID_STATES.includes(state)) {
        throw new Error(`Estado cognitivo inválido: "${state}". Estados válidos: ${VALID_STATES.join(', ')}`);
    }

    if (options.sidebarProvider && options.sidebarProvider.view) {
        // Enviar mensagem para a webview
        // O bridge da UI espera { type: string, payload: any }
        await options.sidebarProvider.view.webview.postMessage({
            type: 'setCognitiveState',
            payload: state
        });
    }

    return {
        success: true,
        state,
        message: `Estado cognitivo reportado: ${state}`
    };
}
