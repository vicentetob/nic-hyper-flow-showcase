import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { CredentialsManager } from '../../core/credentials';
import { ToolTransformer } from '../toolTransformer';
import { calculateOpenAIUsageCost } from '../../utils/openaiPricing';

export class OpenAICodexAdapter implements ModelAdapter {
  constructor(private modelId: string) {}

  async supportsVision(): Promise<boolean> {
    // Modelos codex não suportam visão
    return false;
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    // A Responses API atualmente não suporta tool calls
    // TODO: Verificar quando a Responses API adicionar suporte a tool calls
    return false;
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const credentials = CredentialsManager.getInstance();
    const apiKey = await credentials.getSecret('apiKey:openai');

    if (!apiKey) {
      yield { type: 'error', content: 'OpenAI API Key not found. Please configure it in settings.' };
      return;
    }

    // Converter contexto para o formato da Responses API
    const messages = this.convertContextToOpenAIMessages(context);
    
    if (prompt) {
      messages.push({ role: 'user', content: prompt });
    }

    try {
      // Construir payload para a Responses API
      // NOTA: Models codex não suportam parâmetro 'temperature' na Responses API
      const payload = {
        model: this.modelId,
        input: messages,
        stream: true
      };

      // Fazer requisição direta à Responses API
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield { type: 'error', content: `OpenAI Responses API Error: ${response.status} ${errorText}` };
        return;
      }

      if (!response.body) {
        yield { type: 'error', content: 'OpenAI Responses API Error: No response body' };
        return;
      }

      // Processar streaming de Server-Sent Events (SSE)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                return;
              }

              try {
                const event = JSON.parse(data);
                
                // Processar evento de streaming da Responses API
                if (event.type === 'response.output_text.delta' && event.delta?.text) {
                  yield { type: 'text', content: event.delta.text };
                }

                if (event.type === 'response.completed' && event.response?.usage) {
                  const usage = event.response.usage;
                  const inputTokens = Number(usage.input_tokens ?? 0);
                  const outputTokens = Number(usage.output_tokens ?? 0);
                  const cachedInputTokens = Number(
                    usage.input_token_details?.cached_tokens ??
                    usage.input_tokens_details?.cached_tokens ??
                    0
                  );

                  const cost = calculateOpenAIUsageCost({
                    modelId: this.modelId,
                    inputTokens,
                    outputTokens,
                    cachedInputTokens,
                    tier: 'standard'
                  });

                  yield {
                    type: 'usage',
                    payload: {
                      provider: 'openai-codex',
                      modelId: this.modelId,
                      endpoint: 'responses',
                      inputTokens,
                      outputTokens,
                      cachedInputTokens,
                      totalTokens: inputTokens + outputTokens,
                      costUsd: cost.totalCost,
                      costBreakdown: cost
                    }
                  };
                }
                // TODO: Adicionar suporte a tool calls quando a Responses API suportar
              } catch (e) {
                console.error('Failed to parse SSE event:', data, e);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error) {
      yield { type: 'error', content: `OpenAI Responses API Error: ${error}` };
    }
  }

  /**
   * Converte contexto para o formato OpenAI Messages
   */
  private convertContextToOpenAIMessages(context: any[]): any[] {
    return context.map(msg => {
      // 1. System messages
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content };
      }

      // 2. User messages (codex não suporta visão, então ignoramos attachments)
      if (msg.role === 'user') {
        return { role: 'user', content: msg.content };
      }

      // 3. Assistant messages
      if (msg.role === 'assistant') {
        const payload: any = { role: 'assistant', content: msg.content || null };
        
        if (msg.tool_calls) {
          payload.tool_calls = msg.tool_calls;
        }
        
        return payload;
      }

      // 4. Tool results (codex não suporta tool calls, mas mantemos para compatibilidade)
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content
        };
      }

      // Fallback
      return { role: 'user', content: String(msg.content || '') };
    });
  }
}