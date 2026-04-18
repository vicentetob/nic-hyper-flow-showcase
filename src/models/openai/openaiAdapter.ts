import OpenAI from 'openai';
import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { CredentialsManager } from '../../core/credentials';
import { THINKING_PROMPT } from './prompts/prompt';
import { ToolTransformer } from '../toolTransformer';
import { isFocusedModeEnabled } from '../../core/focusedModeState';
import { Frame } from '../../protocol/frames';
import { calculateOpenAIUsageCost } from '../../utils/openaiPricing';

export class OpenAIAdapter implements ModelAdapter {
  constructor(
    private modelId: string,
    private reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium'
  ) {}

  setReasoningEffort(effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh'): void {
    this.reasoningEffort = effort;
  }

  async supportsVision(): Promise<boolean> {
    const visionModels = ['gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 'gpt-5', 'gpt-5.2'];
    return visionModels.some(vm => this.modelId.includes(vm));
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    return true;
  }

  /**
   * Particularidades de reasoning_effort por modelo:
   *
   * gpt-5-mini   → API aceita: 'minimal' | 'low' | 'medium' | 'high'
   *                (não aceita 'none' nem 'xhigh'; mapeia 'none' → omitido, 'xhigh' → 'high')
   *
   * gpt-5.2      → API aceita: 'low' | 'medium' | 'high'
   *                (não aceita 'none' nem 'xhigh'; mapeia 'none' → omitido, 'xhigh' → 'high')
   *
   * gpt-5.4      → API aceita: 'low' | 'medium' | 'high' | 'xhigh'
   *                (não aceita 'none'; mapeia 'none' → omitido)
   *
   * gpt-4.x      → Chat Completions, sem reasoning (campo ignorado)
   */
  private resolveReasoningPayload(): { effort: string } | undefined {
    const model = this.modelId.toLowerCase();
    const effort = this.reasoningEffort;

    if (model.includes('gpt-5-mini')) {
      // 'none' → sem reasoning | 'xhigh' → 'high' | resto mapeado abaixo
      if (effort === 'none') return undefined;
      const map: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high' };
      return { effort: map[effort] ?? 'medium' };
    }

    if (model.includes('gpt-5.2') || model.includes('gpt-5.4') || model.includes('gpt-5')) {
      // 'none' → sem reasoning | 'xhigh' suportado em gpt-5.4, mapeado para 'high' nos demais
      if (effort === 'none') return undefined;
      if (effort === 'xhigh' && !model.includes('gpt-5.4')) return { effort: 'high' };
      return { effort };
    }

    return undefined;
  }

  /**
   * Determina qual endpoint da API OpenAI usar baseado no modelo.
   * GPT-5.4+ requer Responses API para suportar tools + reasoning_effort simultaneamente.
   */
  private getEndpointForModel(): 'chat/completions' | 'completions' | 'responses' {
    const model = this.modelId.toLowerCase();

    // PRIORIDADE 1: Models "codex" usam Responses API (exclusivo para codex)
    if (model.includes('codex')) {
      return 'responses';
    }

    // PRIORIDADE 2: Toda a família GPT-5 usa Responses API
    // (suporte a tools + reasoning_effort + focused mode simultaneamente)
    if (model.includes('gpt-5')) {
      return 'responses';
    }

    // PRIORIDADE 3: Models GPT modernos (GPT-4.x, GPT-3.5) usam Chat Completions
    if (model.includes('gpt-3.5-turbo') || model.includes('gpt-4')) {
      return 'chat/completions';
    }

    // PRIORIDADE 4: Models legacy usam Completions
    if (
      model.startsWith('text-') || model.startsWith('code-') || model.startsWith('codex-') ||
      model.endsWith('-instruct') ||
      ['davinci', 'curie', 'babbage', 'ada'].includes(model)
    ) {
      return 'completions';
    }

    // PRIORIDADE 5: Default para Chat Completions (mais seguro)
    return 'chat/completions';
  }

  private getAllowedToolNamesFromOptions(options?: StreamOptions): Set<string> | undefined {
    const names = new Set<string>();
    const toolGroups = Array.isArray(options?.tools) ? (options!.tools as any[]) : [];

    for (const group of toolGroups) {
      const declarations = Array.isArray(group?.functionDeclarations)
        ? group.functionDeclarations
        : [];

      for (const declaration of declarations) {
        const name = declaration?.name;
        if (typeof name === 'string' && name.trim()) {
          names.add(name.trim());
        }
      }
    }

    return names.size > 0 ? names : undefined;
  }

  private getOpenAITools(options?: StreamOptions): any[] {
    const allowedToolNames = this.getAllowedToolNamesFromOptions(options);
    const tools = ToolTransformer.toOpenAISchema(isFocusedModeEnabled());

    if (!allowedToolNames) {
      return tools;
    }

    return tools.filter(tool => allowedToolNames.has(tool.function?.name));
  }

  private getResponsesAPITools(options?: StreamOptions): any[] {
    const allowedToolNames = this.getAllowedToolNamesFromOptions(options);
    const tools = ToolTransformer.toResponsesAPISchema(isFocusedModeEnabled());

    if (!allowedToolNames) {
      return tools;
    }

    return tools.filter(tool => allowedToolNames.has(tool.name));
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const isReasoningModel = this.modelId.toLowerCase().startsWith('gpt-5');
    const requestOptions = options?.signal ? ({ signal: options.signal as any } as any) : undefined;

    const credentials = CredentialsManager.getInstance();
    const apiKey = await credentials.getSecret('apiKey:openai');

    if (!apiKey) {
      yield { type: 'error', content: 'OpenAI API Key not found. Please configure it in settings.' };
      return;
    }

    const endpoint = this.getEndpointForModel();

    if (endpoint === 'responses') {
      yield* this.streamWithResponsesAPI(apiKey, prompt, context, options);
      return;
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });

    const messages = this.convertContextToOpenAIMessages(context);

    // Inject system prompt
    const hasSystem = messages.some(m => m.role === 'system');
    if (!hasSystem) {
      messages.unshift({ role: 'system', content: THINKING_PROMPT });
    } else {
      const sysIndex = messages.findIndex(m => m.role === 'system');
      if (sysIndex !== -1) {
        messages[sysIndex].content = `${THINKING_PROMPT}\n\n${messages[sysIndex].content}`;
      }
    }

    if (prompt) {
      messages.push({ role: 'user', content: prompt });
    }

    const tools = this.getOpenAITools(options);

    // Mapas para acumular tool calls parciais
    const toolCallBuffer: Record<number, { id: string, name: string, args: string }> = {};

    try {
      let stream: any;

      if (endpoint === 'chat/completions') {
        const payload: any = {
          model: this.modelId,
          messages: messages as any,
          tools: tools.length > 0 ? (tools as any) : undefined,
          stream: true
        };

        const payloadWithUsage: any = {
          ...payload,
          stream_options: { include_usage: true }
        };

        if (isReasoningModel) {
          payload.reasoning = { effort: this.reasoningEffort };
          payloadWithUsage.reasoning = { effort: this.reasoningEffort };
        } else {
          payload.temperature = 0.2;
          payloadWithUsage.temperature = 0.2;
        }

        try {
          console.log('[OpenAIAdapter] creating chat.completions stream with usage metadata');
          stream = await openai.chat.completions.create(payloadWithUsage, requestOptions);
        } catch (error) {
          console.warn('[OpenAIAdapter] stream_options include_usage falhou, tentando sem usage metadata:', error);
          stream = await openai.chat.completions.create(payload, requestOptions);
        }
      } else { // endpoint === 'completions'
        const promptText = this.convertMessagesToPrompt(messages);
        const payload: any = {
          model: this.modelId,
          prompt: promptText,
          stream: true,
          max_tokens: 4096
        };

        if (!isReasoningModel) {
          payload.temperature = 0.2;
        }

        stream = await openai.completions.create(payload, requestOptions);
      }

      for await (const chunk of stream) {
        if (endpoint === 'chat/completions') {
          const usage = (chunk as any)?.usage;
          if (usage) {
            const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
            const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
            const cachedInputTokens = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0);
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
                provider: 'openai',
                modelId: this.modelId,
                endpoint,
                inputTokens,
                outputTokens,
                cachedInputTokens,
                totalTokens: inputTokens + outputTokens,
                costUsd: cost.totalCost,
                costBreakdown: cost
              }
            };
          }

          const delta = chunk.choices[0]?.delta;
          const finishReason = chunk.choices[0]?.finish_reason;

          if (!delta) continue;

          // 1. Streaming de Texto
          if (delta.content) {
            yield { type: 'text', content: delta.content };
          }

          // 2. Streaming de Tool Calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index;

              if (!toolCallBuffer[index]) {
                toolCallBuffer[index] = { id: '', name: '', args: '' };
              }

              if (tc.id) toolCallBuffer[index].id = tc.id;
              if (tc.function?.name) toolCallBuffer[index].name = tc.function.name;

              if (tc.function?.arguments) {
                toolCallBuffer[index].args += tc.function.arguments;

                yield {
                  type: 'tool_call_delta',
                  toolCallDelta: {
                    id: toolCallBuffer[index].id,
                    name: toolCallBuffer[index].name,
                    argumentsText: tc.function.arguments,
                    isFinal: false
                  }
                };
              }
            }
          }

          // 3. Finalização de Tool Call (Frame)
          if (finishReason === 'tool_calls' || (finishReason === 'stop' && Object.keys(toolCallBuffer).length > 0)) {
            for (const index in toolCallBuffer) {
              const buffer = toolCallBuffer[index];

              if ((buffer as any)._sent) continue;

              let args = {};
              try {
                args = JSON.parse(buffer.args);
              } catch (e) {
                console.error(`Failed to parse tool args for ${buffer.name}:`, buffer.args);
              }

              const frame: Frame = {
                type: 'TOOL_CALL',
                payload: {
                  id: buffer.id,
                  name: buffer.name,
                  args: args
                }
              };

              (buffer as any)._sent = true;
              yield { type: 'frame', frame };
            }
          }
        } else { // endpoint === 'completions'
          const text = chunk.choices[0]?.text;

          if (text) {
            yield { type: 'text', content: text };
          }
        }
      }

    } catch (error) {
      console.error('[OpenAIAdapter] stream failed:', error);
      yield { type: 'error', content: `OpenAI SDK Error: ${error}` };
    }
  }

  /**
   * Stream usando a Responses API.
   * Usado por: modelos codex e GPT-5.4+ (suporta tools + reasoning_effort simultaneamente).
   */
  private async *streamWithResponsesAPI(
    apiKey: string,
    prompt: string,
    context: any[],
    options?: StreamOptions
  ): AsyncIterable<ModelEvent> {
    const isReasoningModel = this.modelId.toLowerCase().startsWith('gpt-5');
    const isCodex = this.modelId.toLowerCase().includes('codex');

    try {
      const input = this.convertContextToResponsesAPIInput(context);

      if (prompt) {
        input.push({ role: 'user', content: prompt });
      }

      // Injetar system prompt (codex não precisa — não suporta tools de qualquer forma)
      if (!isCodex) {
        const hasSystem = input.some((m: any) => m.role === 'system');
        if (!hasSystem) {
          input.unshift({ role: 'system', content: THINKING_PROMPT });
        } else {
          const sysIndex = input.findIndex((m: any) => m.role === 'system');
          if (sysIndex !== -1) {
            (input[sysIndex] as any).content = `${THINKING_PROMPT}\n\n${(input[sysIndex] as any).content}`;
          }
        }
      }

      const tools = isCodex ? [] : this.getResponsesAPITools(options);

      const payload: any = {
        model: this.modelId,
        input,
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
        ...(isReasoningModel && this.resolveReasoningPayload() ? { reasoning: this.resolveReasoningPayload() } : {}),
        ...(isReasoningModel && tools.length > 0 ? { parallel_tool_calls: true } : {})
      };

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload),
        signal: options?.signal
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

      // Buffers de tool calls em andamento: keyed by item_id (ou call_id)
      const toolCallBuffers: Map<string, { id: string; name: string; args: string; sent: boolean }> = new Map();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6).trim();
            if (data === '[DONE]') return;

            let event: any;
            try {
              event = JSON.parse(data);
            } catch (e) {
              console.error('[OpenAIAdapter] Failed to parse SSE event:', data, e);
              continue;
            }

            // ── Text delta ──────────────────────────────────────────────
            if (event.type === 'response.output_text.delta') {
              const text = event.delta ?? event.delta?.text;
              if (typeof text === 'string' && text) {
                yield { type: 'text', content: text };
              }
            }

            // ── Tool call: item adicionado (id + name) ───────────────────
            if (
              event.type === 'response.output_item.added' &&
              event.item?.type === 'function_call'
            ) {
              const item = event.item;
              const key = item.id ?? item.call_id;
              if (key) {
                toolCallBuffers.set(key, {
                  id: item.call_id ?? item.id,
                  name: item.name ?? '',
                  args: '',
                  sent: false
                });
              }
            }

            // ── Tool call: delta de argumentos ───────────────────────────
            if (event.type === 'response.function_call_arguments.delta') {
              const key = event.item_id ?? event.call_id;
              const buf = toolCallBuffers.get(key);
              if (buf && typeof event.delta === 'string') {
                buf.args += event.delta;

                yield {
                  type: 'tool_call_delta',
                  toolCallDelta: {
                    id: buf.id,
                    name: buf.name,
                    argumentsText: event.delta,
                    isFinal: false
                  }
                };
              }
            }

            // ── Tool call: argumentos completos ──────────────────────────
            if (event.type === 'response.function_call_arguments.done') {
              const key = event.item_id ?? event.call_id;
              const buf = toolCallBuffers.get(key);
              if (buf && !buf.sent) {
                // Usar os argumentos finais do evento se disponíveis (mais confiável que o buffer)
                const finalArgs = typeof event.arguments === 'string' ? event.arguments : buf.args;

                let args = {};
                try {
                  args = JSON.parse(finalArgs);
                } catch (e) {
                  console.error(`[OpenAIAdapter] Failed to parse tool args for ${buf.name}:`, finalArgs);
                }

                const frame: Frame = {
                  type: 'TOOL_CALL',
                  payload: {
                    id: buf.id,
                    name: buf.name,
                    args
                  }
                };

                buf.sent = true;
                yield { type: 'frame', frame };
              }
            }

            // ── Usage (no evento response.completed) ─────────────────────
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
                  provider: 'openai',
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

            // ── Erro retornado via SSE ────────────────────────────────────
            if (event.type === 'error') {
              yield { type: 'error', content: `OpenAI Responses API Error: ${event.message ?? JSON.stringify(event)}` };
              return;
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
   * Converte o contexto (formato Chat Completions interno) para o formato de input da Responses API.
   *
   * Diferenças críticas vs Chat Completions:
   * - Tool results: `{ role: 'tool', tool_call_id, content }` →
   *   `{ type: 'function_call_output', call_id, output }`
   * - Assistant com tool_calls: split em mensagem de texto + itens `function_call` separados
   */
  private convertContextToResponsesAPIInput(context: any[]): any[] {
    const sanitized = this.sanitizeMessagesForOpenAI(context);
    const result: any[] = [];

    for (const msg of sanitized) {
      if (msg.role === 'system') {
        result.push({ role: 'system', content: msg.content });
        continue;
      }

      if (msg.role === 'user') {
        if (msg.attachments && msg.attachments.length > 0) {
          const content: any[] = [{ type: 'input_text', text: msg.content || '' }];
          for (const att of msg.attachments) {
            const url = this.normalizeImageAttachmentForOpenAI(att);
            if (att.type === 'image' && url) {
              content.push({ type: 'input_image', image_url: url });
            }
          }
          result.push({ role: 'user', content });
        } else {
          result.push({ role: 'user', content: msg.content });
        }
        continue;
      }

      if (msg.role === 'assistant') {
        // Texto do assistente (pode ser null/vazio quando só há tool_calls)
        if (msg.content) {
          result.push({ role: 'assistant', content: msg.content });
        }

        // Cada tool_call vira um item `function_call` separado no input.
        // NOTA: O campo `id` deve começar com 'fc' (requisito da Responses API).
        // O `call_id` mantém o ID original para linking com `function_call_output`.
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const originalId = tc.id ?? '';
            const itemId = originalId.startsWith('fc') ? originalId : `fc_${originalId}`;
            result.push({
              type: 'function_call',
              id: itemId,
              call_id: originalId,
              name: tc.function?.name ?? '',
              arguments: typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments ?? {})
            });
          }
        }
        continue;
      }

      if (msg.role === 'tool') {
        result.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id,
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        });
        continue;
      }

      // Fallback
      result.push({ role: 'user', content: String(msg.content || '') });
    }

    return result;
  }

  /**
   * Converte o contexto para o formato Chat Completions (usado por gpt-4, gpt-5.2, etc.)
   */
  private convertContextToOpenAIMessages(context: any[]): any[] {
    const sanitizedContext = this.sanitizeMessagesForOpenAI(context);

    return sanitizedContext.map(msg => {
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content };
      }

      if (msg.role === 'user') {
        if (msg.attachments && msg.attachments.length > 0) {
          const content: any[] = [{ type: 'text', text: msg.content || '' }];

          for (const att of msg.attachments) {
            const normalizedImageDataUrl = this.normalizeImageAttachmentForOpenAI(att);
            if (att.type === 'image' && normalizedImageDataUrl) {
              content.push({
                type: 'image_url',
                image_url: { url: normalizedImageDataUrl }
              });
            }
          }
          return { role: 'user', content };
        }
        return { role: 'user', content: msg.content };
      }

      if (msg.role === 'assistant') {
        const payload: any = { role: 'assistant', content: msg.content || null };
        if (msg.tool_calls) {
          payload.tool_calls = msg.tool_calls;
        }
        return payload;
      }

      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        };
      }

      return { role: 'user', content: String(msg.content || '') };
    });
  }

  /**
   * Converte mensagens para prompt textual (usado na API de Completions legacy)
   */
  private convertMessagesToPrompt(messages: any[]): string {
    let prompt = '';

    for (const msg of messages) {
      switch (msg.role) {
        case 'system':
          prompt += `System: ${msg.content}\n\n`;
          break;
        case 'user':
          if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter((c: any) => c.type === 'text');
            if (textParts.length > 0) {
              prompt += `User: ${textParts.map((c: any) => c.text).join(' ')}\n\n`;
            }
          } else {
            prompt += `User: ${msg.content}\n\n`;
          }
          break;
        case 'assistant':
          prompt += `Assistant: ${msg.content || ''}\n\n`;
          break;
        case 'tool':
          prompt += `Tool [${msg.tool_call_id}]: ${msg.content}\n\n`;
          break;
      }
    }

    prompt += 'Assistant:';
    return prompt;
  }

  private sanitizeMessagesForOpenAI(context: any[]): any[] {
    const sanitized: any[] = [];

    for (let i = 0; i < context.length; i++) {
      const msg = context[i];
      if (!msg?.role) continue;

      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        // Para cada tool call, verifica se tem resultado correspondente
        const validToolCalls = msg.tool_calls.filter((tc: any) => {
          const toolCallId = tc?.id;
          if (!toolCallId) return false;
          
          const originalToolCallId = String(toolCallId);
          
          // Procura por tool result correspondente com lógica flexível
          const hasResult = context.some((candidate: any, idx: number) => {
            if (idx <= i) return false;
            if (candidate?.role !== 'tool') return false;
            
            const resultToolCallId = String(candidate.tool_call_id || '');
            
            // 1. Tenta match exato
            if (resultToolCallId === originalToolCallId) return true;
            
            // 2. Tenta match flexível: resultToolCallId termina com originalToolCallId
            if (resultToolCallId.endsWith(originalToolCallId)) return true;
            
            // 3. Tenta match flexível: resultToolCallId contém originalToolCallId após hífen
            if (resultToolCallId.includes('-') && resultToolCallId.split('-').pop() === originalToolCallId) return true;
            
            return false;
          });
          
          // Se tem resultado, mantém
          if (hasResult) return true;
          
          // Se não tem resultado, verifica se é recente (últimas 10 mensagens)
          // Tool calls recentes sem resultado podem estar em andamento
          const isRecent = i >= context.length - 10;
          return isRecent;
        });

        sanitized.push(
          validToolCalls.length > 0
            ? { ...msg, tool_calls: validToolCalls }
            : { role: 'assistant', content: msg.content || '' }
        );
        continue;
      }

      // tool result: só mantém se há um assistant com tool_calls correspondente no sanitized
      if (msg.role === 'tool') {
        const toolCallId = String(msg.tool_call_id || '');
        const hasMatchingCall = sanitized.some((s: any) =>
          s.role === 'assistant' &&
          Array.isArray(s.tool_calls) &&
          s.tool_calls.some((tc: any) => {
            const id = String(tc?.id || '');
            if (!id || !toolCallId) return false;
            if (id === toolCallId) return true;
            if (toolCallId.endsWith(id)) return true;
            if (id.endsWith(toolCallId)) return true;
            return false;
          })
        );
        if (hasMatchingCall) {
          sanitized.push(msg);
        }
        continue;
      }

      sanitized.push(msg);
    }

    return sanitized;
  }

  private normalizeImageAttachmentForOpenAI(att: any): string | null {
    if (!att || att.type !== 'image') return null;

    let mimeType = String(att.mimeType || '').trim().toLowerCase();
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

    const supportedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    if (!supportedMimeTypes.has(mimeType)) return null;

    const rawData = String(att.data || att.dataBase64 || '').trim();
    if (!rawData || rawData === 'undefined' || rawData === '<BASE64_DATA_REMOVED>') return null;

    if (rawData.startsWith('data:')) {
      const mimeFromDataUrl = rawData.slice(5).split(';')[0].trim().toLowerCase();
      const normalizedMime = mimeFromDataUrl === 'image/jpg' ? 'image/jpeg' : mimeFromDataUrl;
      if (!supportedMimeTypes.has(normalizedMime)) return null;

      const base64Payload = rawData.split(',')[1]?.trim() || '';
      if (!base64Payload || base64Payload === 'undefined' || base64Payload === '<BASE64_DATA_REMOVED>') {
        return null;
      }
      return rawData.replace(/^data:[^;]+;/i, `data:${normalizedMime};`);
    }

    return `data:${mimeType};base64,${rawData}`;
  }
}
