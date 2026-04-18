import * as vscode from 'vscode';
import { ExecuteToolOptions } from './index';

/**
 * Interface para os argumentos da ferramenta 'wait'.
 */
export interface WaitArgs {
    /**
     * Tempo de espera em milissegundos.
     * Limite mínimo: 1000 (1s)
     * Limite máximo: 600000 (10 minutos)
     */
    ms: number;
    /**
     * Motivo da espera (opcional, para logs e UI).
     */
    reason?: string;
}

/**
 * Pausa a execução por um tempo determinado.
 * Permite que processos em segundo plano (como terminais persistentes) progridam antes da próxima ação.
 * A espera pode ser interrompida pelo sinal de aborto (botão Stop na UI).
 */
export async function wait(args: WaitArgs, options: ExecuteToolOptions): Promise<any> {
    const minWait = 1000;
    const maxWait = 600000; // 10 minutos
    
    let ms = Number(args.ms);
    
    if (isNaN(ms) || ms < minWait) {
        ms = minWait;
    }
    
    if (ms > maxWait) {
        ms = maxWait;
    }

    const reason = args.reason || 'Waiting for background processes to finish';
    const seconds = (ms / 1000).toFixed(1);
    
    if (options.outputChannel) {
        options.outputChannel.appendLine(`[Tool: wait] Pausing for ${seconds}s. Reason: ${reason}`);
    }

    // Informar a UI sobre o progresso da espera via onStreamOutput (se disponível)
    if (options.onStreamOutput) {
        options.onStreamOutput(`⏳ Wait started: ${seconds}s... (${reason})\n`);
    }

    try {
        // Contador regressivo em tempo real para a UI
        if (options.onStreamOutput) {
            let remaining = Math.ceil(ms / 1000);
            const interval = setInterval(() => {
                remaining--;
                if (remaining > 0 && options.onStreamOutput) {
                    options.onStreamOutput(`⏳ Remaining: ${remaining}s...\n`);
                } else {
                    clearInterval(interval);
                }
            }, 1000);

            // Garante que o intervalo seja limpo se o sinal de aborto for disparado
            options.signal?.addEventListener('abort', () => clearInterval(interval), { once: true });
            
            // Link do intervalo à promise do sleep para garantir limpeza no final
            await sleepWithAbort(ms, options.signal);
            clearInterval(interval);
        } else {
            await sleepWithAbort(ms, options.signal);
        }
        
        const result = {
            success: true,
            waitedMs: ms,
            message: `Completed wait of ${seconds} seconds.`
        };

        if (options.onStreamOutput) {
            options.onStreamOutput(`✅ Wait completed.\n`);
        }

        return result;
    } catch (err: any) {
        if (err.name === 'AbortError' || (options.signal && options.signal.aborted)) {
            if (options.outputChannel) {
                options.outputChannel.appendLine(`[Tool: wait] Wait interrupted by user.`);
            }
            // Quando abortado, retornamos um erro específico que o Loop pode tratar
            // para "esquecer" que existe wait e não mandar nada pro modelo se desejar,
            // mas aqui retornamos um status de erro padrão do protocolo de tools.
            return {
                success: false,
                error: 'Wait interrupted by user.',
                interrupted: true
            };
        }
        throw err;
    }
}

/**
 * Implementação de sleep que respeita o AbortSignal.
 */
function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            return reject(new DOMException('Wait aborted', 'AbortError'));
        }

        const timeout = setTimeout(() => {
            if (signal) {
                signal.removeEventListener('abort', abortHandler);
            }
            resolve();
        }, ms);

        const abortHandler = () => {
            clearTimeout(timeout);
            reject(new DOMException('Wait aborted', 'AbortError'));
        };

        if (signal) {
            signal.addEventListener('abort', abortHandler, { once: true });
        }
    });
}
