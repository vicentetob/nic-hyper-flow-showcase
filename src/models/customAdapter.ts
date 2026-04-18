import { ModelAdapter, ModelEvent, StreamOptions } from './adapter';
import { CustomProvider, Model } from './providerTypes';
import { CredentialsManager } from '../core/credentials';

type OpenAICompatToolCallBuf = {
  id: string;
  name: string;
  arguments: string;
};

export class CustomProviderAdapter implements ModelAdapter {
  private provider: CustomProvider;
  private model: Model;
  private credentials: CredentialsManager;

  constructor(provider: CustomProvider, model: Model) {
    this.provider = provider;
    this.model = model;
    this.credentials = CredentialsManager.getInstance();
  }

  public async supportsVision(): Promise<boolean> {
    return this.model.capabilities?.vision || false;
  }

  public async supportsNativeToolCalling(): Promise<boolean> {
    // Por padrão, providers customizados não suportam tool calling nativo
    // A menos que o modelo esteja configurado com protocolMode = 'tool_calling'
    return this.model.protocolMode === 'tool_calling';
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    // Obter credenciais se necessário
    let apiKey: string | undefined;
    if (this.provider.auth.secretRef) {
      apiKey = await this.credentials.getSecret(this.provider.auth.secretRef);
    }

    if (this.provider.auth.type !== 'none' && !apiKey) {
      yield { type: 'text', content: `Erro: Chave de API não configurada para provider ${this.provider.displayName}` };
      return;
    }

    const modelId = this.model.modelId || this.model.key;
    const baseUrl = this.provider.baseUrl.replace(/\/$/, ''); // Remove trailing slash

    // Montar headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.provider.headers
    };

    // Adicionar autenticação
    if (this.provider.auth.type === 'api_key_bearer' && apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (this.provider.auth.type === 'api_key_header' && apiKey) {
      const headerName = this.provider.auth.headerName || 'X-API-KEY';
      headers[headerName] = apiKey;
    } else if (this.provider.auth.type === 'basic') {
      const username = this.provider.auth.username || '';
      const password = this.provider.auth.passwordSecretRef 
        ? await this.credentials.getSecret(this.provider.auth.passwordSecretRef) || ''
        : '';
      // Node.js compatible base64 encoding
      const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${basicAuth}`;
    }

    // Preparar mensagens baseado no preset
    let endpoint = '/v1/chat/completions';
    let requestBody: any = {};

    // Buffer de tool-calls para openai_compatible (streaming incremental)
    const openaiCompatToolCalls = new Map<number, OpenAICompatToolCallBuf>();

    if (this.provider.compatPreset === 'openai_compatible') {
      endpoint = '/v1/chat/completions';
      
      // Converter contexto para formato OpenAI
      const messages: any[] = [];
      const systemMessages = context.filter(c => c.role === 'system');
      if (systemMessages.length > 0) {
        messages.push({
          role: 'system',
          content: systemMessages.map(c => c.content).join('\n\n')
        });
      }

      for (const item of context.filter(c => c.role !== 'system')) {
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        
        // Suportar attachments se o modelo tem vision capability
        const content: any[] = [];
        
        // Adicionar texto
        if (item.content) {
          content.push({
            type: 'text',
            text: item.content
          });
        }

        // Adicionar imagens se houver (formato OpenAI)
        if (item.attachments) {
          for (const attachment of item.attachments) {
            if (attachment.type === 'image') {
              content.push({
                type: 'image_url',
                image_url: {
                  url: attachment.data // Data URL completa
                }
              });
            }
          }
        }

        messages.push({
          role: role,
          content: content.length === 1 && content[0].type === 'text' 
            ? content[0].text 
            : content
        });
      }

      // Prompt atual (se houver). Em alguns fluxos o prompt já está no histórico.
      if (prompt && prompt.trim().length > 0) {
        messages.push({ role: 'user', content: prompt });
      }

      requestBody = {
        model: modelId,
        messages: messages,
        stream: true,
        temperature: this.model.params?.temperature ?? this.provider.defaults.temperature ?? 0.05,
        max_tokens: this.model.params?.maxOutputTokens ?? this.provider.defaults.maxOutputTokens
      };

      // Adicionar tools se modo tool_calling
      if (this.model.protocolMode === 'tool_calling' && options?.tools) {
        requestBody.tools = options.tools;
        requestBody.tool_choice = 'auto';
      }
    } else if (this.provider.compatPreset === 'ollama') {
      endpoint = '/api/chat';
      
      const ollamaMessages = context.map((item: any) => {
        const msg: any = {
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: item.content
        };
        
        // Adicionar imagens se houver (formato Ollama)
        if (item.attachments && item.attachments.length > 0) {
          const images = item.attachments
            .filter((a: any) => a.type === 'image')
            .map((a: any) => a.data.split(',')[1]); // Remove data:image/...;base64,
          if (images.length > 0) {
            msg.images = images;
          }
        }
        
        return msg;
      });
      
      requestBody = {
        model: modelId,
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: this.model.params?.temperature ?? this.provider.defaults.temperature ?? 0.05
        }
      };
    } else {
      // Fallback genérico
      endpoint = '/v1/chat/completions';
      requestBody = {
        model: modelId,
        messages: context,
        stream: true
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.provider.timeoutMs);

      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              
              yield { type: 'raw', raw: parsed };

              // Parse baseado no preset
              if (this.provider.compatPreset === 'openai_compatible') {
                const choice = parsed.choices?.[0];
                if (choice?.delta?.content) {
                  yield { type: 'text', content: choice.delta.content };
                }

                // Tool calls (streaming incremental)
                if (choice?.delta?.tool_calls) {
                  for (const toolCall of choice.delta.tool_calls) {
                    const index: number = toolCall.index;

                    if (!openaiCompatToolCalls.has(index)) {
                      openaiCompatToolCalls.set(index, {
                        id: toolCall.id || '',
                        name: toolCall.function?.name || '',
                        arguments: ''
                      });
                    }

                    const current = openaiCompatToolCalls.get(index)!;
                    if (toolCall.id) current.id = toolCall.id;
                    if (toolCall.function?.name) current.name = toolCall.function.name;
                    if (toolCall.function?.arguments) {
                      current.arguments += toolCall.function.arguments;

                      yield {
                        type: 'tool_call_delta',
                        toolCallDelta: {
                          id: current.id,
                          name: current.name,
                          argumentsText: current.arguments,
                          isFinal: false
                        }
                      } as any;
                    }
                  }
                }

                // Finish reason - emite TOOL_CALL final (compatível com o Loop)
                if (choice?.finish_reason === 'tool_calls') {
                  for (const tc of openaiCompatToolCalls.values()) {
                    yield {
                      type: 'tool_call_delta',
                      toolCallDelta: {
                        id: tc.id,
                        name: tc.name,
                        argumentsText: tc.arguments,
                        isFinal: true
                      }
                    } as any;

                    try {
                      const args = JSON.parse(tc.arguments || '{}');
                      yield {
                        type: 'frame',
                        frame: {
                          type: 'TOOL_CALL',
                          payload: {
                            id: tc.id,
                            name: tc.name,
                            args
                          }
                        }
                      };
                    } catch (e) {
                      console.error('Error parsing tool call arguments (openai_compatible):', e);
                    }
                  }
                  openaiCompatToolCalls.clear();
                }
              } else if (this.provider.compatPreset === 'ollama') {
                if (parsed.message?.content) {
                  yield { type: 'text', content: parsed.message.content };
                }
              } else {
                // Fallback genérico
                if (parsed.content || parsed.text) {
                  yield { type: 'text', content: parsed.content || parsed.text };
                }
              }
            } catch (e) {
              // Ignora erros de parsing
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Custom Provider Stream Error:', error);
      yield {
        type: 'debug',
        debug: { error: error.message, stack: error.stack, phase: 'streaming' }
      };
      let errorMessage = error.message;
      try {
        // Try to parse JSON if it's a stringified JSON error from backend
        const parsed = JSON.parse(error.message);
        if (parsed.error) errorMessage = parsed.error;
      } catch {
        // Not a JSON, keep original message
      }
      yield { type: 'text', content: `\n\n**API Error:** ${errorMessage}` };
    }
  }
}
