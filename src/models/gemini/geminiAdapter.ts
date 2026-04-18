import { GoogleGenerativeAI } from '@google/generative-ai';
import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { CredentialsManager } from '../../core/credentials';
import { THINKING_PROMPT } from './prompts/prompt';
import { ToolTransformer } from '../toolTransformer';
import { isFocusedModeEnabled } from '../../core/focusedModeState';
import { Frame } from '../../protocol/frames';
import { TokenRateLimiter } from '../../core/rateLimiter';
import { calculateProviderUsageCost } from '../../utils/providerPricing';

export class GeminiAdapter implements ModelAdapter {
  constructor(private modelId: string = 'gemini-1.5-pro-latest') {}

  async supportsVision(): Promise<boolean> {
    return true;
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    return true;
  }

  private resolveSystemInstruction(systemInstruction?: string): string {
    const trimmed = typeof systemInstruction === 'string' ? systemInstruction.trim() : '';
    return trimmed || THINKING_PROMPT;
  }

  private extractCachedInputTokensFromUsage(usage: any): number {
    const cachedTokens = Number(
      usage?.cachedContentTokenCount ??
      usage?.cached_content_token_count ??
      0
    );

    return Number.isFinite(cachedTokens) && cachedTokens >= 0 ? cachedTokens : 0;
  }

  /**
   * Verifica se um erro do Gemini deve ter retry.
   */
  private shouldRetryError(error: any): boolean {
    const errorStr = String(error);
    
    // Erros que devem ter retry
    const retryablePatterns = [
      '503 Service Unavailable',
      '429 Too Many Requests',
      'Resource has been exhausted',
      'This model is currently experiencing high demand',
      'Failed to parse stream',
      'Error fetching from',
      'temporary',
      'try again later',
      'high demand',
      'rate limit',
      'quota exceeded',
      'resource exhausted',
      'exhausted',
      '429'
    ];

    return retryablePatterns.some(pattern => 
      errorStr.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Executa uma requisição com retry automático.
   */
  private async executeWithRetry(
    operation: () => Promise<any>,
    operationName: string,
    estimatedTokens: number,
    signal?: AbortSignal
  ): Promise<any> {
    const maxRetries = 10;
    const baseDelay = 1000; // 1 segundo
    const maxDelay = 30000; // 30 segundos
    
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Verifica se foi abortado antes de iniciar/repetir
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      try {
        // 1. Aplica rate limiting antes da requisição
        const rateLimiter = TokenRateLimiter.getInstance();
        await rateLimiter.waitForCapacity(estimatedTokens);
        
        // Verifica novamente após o wait do rate limiter
        if (signal?.aborted) {
          throw new Error('Operation aborted after rate limit wait');
        }

        // 2. Executa a operação
        const result = await operation();
        
        // 3. Registra uso bem-sucedido
        rateLimiter.recordUsage(estimatedTokens);
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Se o erro foi aborto, não tenta novamente
        if (signal?.aborted || (error instanceof Error && error.message.includes('aborted'))) {
          throw error;
        }

        // Verifica se deve tentar novamente
        const shouldRetry = this.shouldRetryError(error) && attempt < maxRetries;
        
        if (!shouldRetry) {
          break;
        }
        
        // Calcula backoff exponencial com jitter
        const delay = Math.min(
          maxDelay,
          baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000
        );
        
        console.log(`[GeminiAdapter] Retry ${attempt}/${maxRetries} for ${operationName} after ${delay}ms delay. Error: ${error}`);
        
        // Aguarda antes de tentar novamente de forma interrompível
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Operation aborted during retry delay'));
          }, { once: true });
        });
      }
    }
    
    throw lastError;
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const credentials = CredentialsManager.getInstance();
    const apiKey = await credentials.getSecret('apiKey:google');

    if (!apiKey) {
      yield { type: 'error', content: 'Google API Key not found. Please configure it in settings.' };
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: this.modelId });

    const { history, systemInstruction } = this.convertContextToGeminiHistory(context);
    const resolvedSystemInstruction = this.resolveSystemInstruction(systemInstruction);

    // Configura o chat session
    const chat = model.startChat({
      history: history,
      // Fix: Wrap systemInstruction in Content object structure
      systemInstruction: {
        role: 'system',
        parts: [{ text: resolvedSystemInstruction }]
      },
      // CORREÇÃO: Ignorar options.tools (que pode conter duplicatas do Loop) e usar schema limpo
      tools: ToolTransformer.toGeminiSchema(isFocusedModeEnabled()) as any,
      ...(options?.signal ? { signal: options.signal as any } : {})
    });

    let fullContent = '';
    let lastLoggedLength = 0;

    try {
      // 🎯 AJUSTE PARA O GEMINI 3 FLASH:
      // Se o prompt estiver vazio (comum no loop de ferramentas do Nic), 
      // o Gemini 3 às vezes fecha o stream sem responder.
      // Injetamos um comando implícito de continuação para "acordar" o modelo.
      let messageToSend: any = prompt;
      if (!prompt || prompt.trim() === '') {
        // Se o último item do histórico for um resultado de ferramenta, pedimos a conclusão.
        const lastMsg = history[history.length - 1];
        if (lastMsg && lastMsg.role === 'function') {
           messageToSend = 'The previous tools have finished executing. Please analyze the results and provide your response or next steps.';
        } else {
           messageToSend = 'Continue.';
        }
      }
      
      // Estima tokens para rate limiting (usa contagem já disponível se possível)
      let estimatedTokens = 10000; // Valor padrão conservador
      if (options?.estimatedTokens) {
        estimatedTokens = options.estimatedTokens;
      } else if (prompt && context) {
        // Estimativa simples baseada em caracteres, sem serializar base64 inline de imagens
        const totalChars = prompt.length + context.reduce((sum: number, msg: any) => {
          const contentChars = typeof msg?.content === 'string'
            ? msg.content.length
            : JSON.stringify(msg?.content ?? '').length;
          const attachmentChars = Array.isArray(msg?.attachments)
            ? msg.attachments.reduce((attSum: number, att: any) => {
                if (!att || att.type !== 'image') return attSum;
                return attSum + 512;
              }, 0)
            : 0;
          return sum + contentChars + attachmentChars;
        }, 0);
        estimatedTokens = Math.ceil(totalChars / 4); // ~4 chars por token
      }
      
      // Executa com retry e rate limiting
      const result = await this.executeWithRetry(
        () => chat.sendMessageStream(messageToSend),
        'sendMessageStream',
        estimatedTokens,
        options?.signal
      );

      for await (const chunk of result.stream) {
        try {
          // Suporte a Thinking (Gemini 2.0/3.0 Thinking models)
          const candidates = (chunk as any).candidates;
          if (candidates && candidates[0]?.content?.parts) {
            for (const part of candidates[0].content.parts) {
              if (part.thought === true || part.thought === 'true') {
                if (part.text) {
                  yield { type: 'thought', content: part.text };
                }
              } else if (part.text) {
                fullContent += part.text;
                yield { type: 'text', content: part.text };
              }
            }
          } else {
            // Fallback seguro: tenta obter texto apenas se existirem parts de texto
            // Isso evita a exceção "Content has no parts" quando há apenas function calls
            const parts = (chunk as any).parts || [];
            const textParts = parts.filter((p: any) => p.text);
            if (textParts.length > 0) {
              const text = chunk.text();
              if (text) {
                fullContent += text;
                yield { type: 'text', content: text };
              }
            }
          }
        } catch (err) {
          console.warn('[GeminiAdapter] Error parsing text chunk:', err);
          // Continua o processamento, pois ainda podem existir function calls no chunk
        }

        // Verifica tool calls
        let calls: any[] = [];
        try {
          calls = chunk.functionCalls() || [];
        } catch (err) {
          // Se não houver function calls, o SDK pode lançar erro em algumas versões
          calls = [];
        }
        if (calls && calls.length > 0) {
           for (const call of calls) {
             // Gemini não faz streaming parcial de args (JSON delta) pelo SDK da mesma forma que OpenAI
             // O SDK já entrega o objeto args parseado quando a function call é detectada
             const callId = 'gemini_call_' + Math.random().toString(36).substr(2, 9);

             // Emite um "delta" completo instantâneo para satisfazer o protocolo de UI
             const argsStr = JSON.stringify(call.args);
             yield {
                type: 'tool_call_delta',
                toolCallDelta: {
                  id: callId,
                  name: call.name,
                  argumentsText: argsStr,
                  isFinal: true
                }
             };

             const frame: Frame = {
               type: 'TOOL_CALL',
               payload: {
                 id: callId,
                 name: call.name,
                 args: call.args
               }
             };
             yield { type: 'frame', frame };
           }
        }
      }

      // Emite usage no final da stream
      const usage = (result.response && await result.response).usageMetadata;
      if (usage) {
        const inputTokens = Number(usage.promptTokenCount || 0);
        const outputTokens = Number(usage.candidatesTokenCount || 0);
        const totalTokens = Number(usage.totalTokenCount || 0);
        const cachedInputTokens = this.extractCachedInputTokensFromUsage(usage);

        const cost = calculateProviderUsageCost({
          provider: 'google',
          modelId: this.modelId,
          inputTokens,
          outputTokens,
          cachedInputTokens
        });

        yield {
          type: 'usage',
          payload: {
            provider: 'google',
            modelId: this.modelId,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            totalTokens,
            costUsd: cost.totalCost,
            costBreakdown: cost
          }
        };
      }

    } catch (error) {
      yield { type: 'error', content: `Gemini SDK Error: ${error}` };
    }
  }

  private convertContextToGeminiHistory(context: any[]): { history: any[], systemInstruction?: string } {
    let systemInstruction = '';
    const rawHistory: any[] = [];

    // 1. Extrai system instruction e prepara histórico bruto
    for (const msg of context) {
      if (msg.role === 'system') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        
        // Se a mensagem system contiver contextos específicos (RAG manual), 
        // transformamos em USER para o Gemini não ignorar e manter no histórico temporal.
        const isRagContext = content.includes('[PROJECT CONTEXT]') || 
                            content.includes('[WORKSPACE CONTEXT]') || 
                            content.includes('CONTEXTO RELEVANTE') ||
                            content.includes('[MEMÓRIA COMPACTADA') ||
                            content.includes('[ATUALIZAÇÕES DE SUBAGENTES]');

        if (isRagContext) {
          rawHistory.push({ role: 'user', parts: [{ text: `[SYSTEM CONTEXT INJECTION]\n${content}` }] });
        } else {
          systemInstruction += (systemInstruction ? '\n\n' : '') + content;
        }
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : (msg.role === 'tool' ? 'function' : 'user');
      const parts: any[] = [];

      if (msg.role === 'tool') {
        const responseData = typeof msg.content === 'string' ? { content: msg.content } : (msg.content || { status: 'ok' });
        parts.push({
          functionResponse: {
            name: msg.name,
            response: responseData
          }
        });
      } else {
        if (msg.content && typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text') parts.push({ text: block.text });
            else if (block.type === 'image_url') {
              const data = block.image_url.url;
              const base64Data = data.split(',')[1] || data;
              const mimeType = data.split(';')[0].split(':')[1] || 'image/jpeg';
              parts.push({ inlineData: { mimeType, data: base64Data } });
            }
          }
        }

        if (msg.attachments) {
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.data) {
              const base64Data = att.data.split(',')[1] || att.data;
              if (!base64Data || base64Data === 'undefined' || base64Data === '<ATTACHMENT_STORED_EXTERNALLY>' || base64Data === '<BASE64_DATA_REMOVED>') continue;
              const mimeType = att.mimeType || att.data.split(';')[0].split(':')[1] || 'image/jpeg';
              parts.push({ inlineData: { mimeType, data: base64Data } });
            }
          }
        }

        if (msg.role === 'assistant' && msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            try {
              parts.push({
                functionCall: {
                  name: tc.function.name,
                  args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {})
                }
              });
            } catch (e) {
              console.warn('[GeminiAdapter] Failed to parse tool arguments:', e);
            }
          }
        }
      }

      if (parts.length > 0) {
        rawHistory.push({ role, parts });
      }
    }

    // 2. Sanitização estrita para o Gemini:
    // - Deve começar com 'user'
    // - Roles devem alternar entre 'user' e 'model'
    // - Mensagens 'function' (tool results) devem vir IMEDIATAMENTE após o 'model' que as chamou, 
    //   e o conjunto [model + function] é considerado um turno que deve ser seguido por um 'user'.
    
    const sanitizedHistory: any[] = [];
    let lastRole: string | null = null;

    for (let i = 0; i < rawHistory.length; i++) {
      const current = rawHistory[i];
      
      // Se for a primeira mensagem e não for 'user', ignora até achar um 'user'
      if (sanitizedHistory.length === 0 && current.role !== 'user') {
        continue;
      }

      if (current.role === 'function') {
        const lastInSanitized = sanitizedHistory[sanitizedHistory.length - 1];
        
        if (lastInSanitized && (lastInSanitized.role === 'model' || lastInSanitized.role === 'function')) {
           sanitizedHistory.push(current);
           lastRole = 'function';
        } else {
          // Órfã ou fora de ordem: converte para turn de 'user'
          const textParts = current.parts.map((p: any) => {
            const res = p.functionResponse?.response;
            const resStr = typeof res === 'string' ? res : JSON.stringify(res);
            return `[Tool Result: ${p.functionResponse?.name}]\n${resStr}`;
          }).join('\n\n');
          
          if (lastRole === 'user') {
            lastInSanitized.parts.push({ text: textParts });
          } else {
            sanitizedHistory.push({ role: 'user', parts: [{ text: textParts }] });
            lastRole = 'user';
          }
        }
        continue;
      }

      if (current.role === lastRole) {
        sanitizedHistory[sanitizedHistory.length - 1].parts.push(...current.parts);
      } else {
        sanitizedHistory.push(current);
        lastRole = current.role;
      }
    }

    // 🎯 AJUSTE FINAL PARA O LOOP: 
    // O Gemini exige que a sequência termine em 'user' para ele poder responder com 'model'.
    // Mas no SDK ChatSession, quando enviamos sendMessage(), ele adiciona o prompt como 'user'.
    // Se o histórico JÁ termina em 'user', o SDK pode reclamar de mensagens consecutivas de 'user'.
    // Se o histórico termina em 'model' ou 'function', o SDK aceita o próximo sendMessage() como 'user'.
    // No entanto, o Loop do Nic manda prompt vazio '' quando está processando resultados de ferramentas.
    // Para o Gemini, enviar um prompt vazio '' após uma 'function' pode travar.
    // Solução: Se a última mensagem for 'function', e não tivermos prompt novo, 
    // movemos a última 'function' para ser parte de um turno de 'user' sintético.
    
    if (sanitizedHistory.length > 0) {
      const last = sanitizedHistory[sanitizedHistory.length - 1];
      if (last.role === 'function') {
        // Opção A: Manter como está e torcer pro prompt vazio funcionar
        // Opção B: Transformar o par [model + function] em um bloco só para forçar alternância (instável)
        // Opção C: Injetar um user message "Continue" se o prompt for vazio no stream() - vamos fazer isso lá no stream()
      }
    }

    return { history: sanitizedHistory, systemInstruction };
  }
}