import OpenAI from 'openai';
import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { CredentialsManager } from '../../core/credentials';
import { AGENT_PROMPT } from './agent';
import { ToolTransformer } from '../toolTransformer';
import { isFocusedModeEnabled } from '../../core/focusedModeState';
import { Frame } from '../../protocol/frames';
import { calculateProviderUsageCost } from '../../utils/providerPricing';

export class DeepSeekAdapter implements ModelAdapter {
  constructor(private modelId: string = 'deepseek-chat') {}

  async supportsVision(): Promise<boolean> {
    // DeepSeek-V3/R1 chat doesn't natively support vision in the same way GPT-4o does
    return false;
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    return true;
  }

  private extractInputTokensFromUsage(usage: any): number {
    const directPromptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    if (Number.isFinite(directPromptTokens) && directPromptTokens >= 0) {
      return directPromptTokens;
    }

    const cacheHitTokens = Number(usage?.prompt_cache_hit_tokens ?? 0);
    const cacheMissTokens = Number(usage?.prompt_cache_miss_tokens ?? 0);
    const derivedPromptTokens = cacheHitTokens + cacheMissTokens;
    return Number.isFinite(derivedPromptTokens) && derivedPromptTokens >= 0 ? derivedPromptTokens : 0;
  }

  private extractCachedInputTokensFromUsage(usage: any): number {
    const directCacheHitTokens = Number(usage?.prompt_cache_hit_tokens);
    if (Number.isFinite(directCacheHitTokens) && directCacheHitTokens >= 0) {
      return directCacheHitTokens;
    }

    const nestedCachedTokens = Number(
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.input_tokens_details?.cached_tokens ??
      0
    );

    return Number.isFinite(nestedCachedTokens) && nestedCachedTokens >= 0 ? nestedCachedTokens : 0;
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const credentials = CredentialsManager.getInstance();
    const apiKey = await credentials.getSecret('apiKey:deepseek') || await credentials.getSecret('apiKey:nicassist');

    if (!apiKey) {
      yield { type: 'error', content: 'DeepSeek API Key not found. Please configure it in settings.' };
      return;
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://api.deepseek.com',
      dangerouslyAllowBrowser: true
    });

    const messages = this.convertContextToDeepSeekMessages(context);

    // Inject system prompt
    const hasSystem = messages.some(m => m.role === 'system');
    if (!hasSystem) {
      messages.unshift({ role: 'system', content: AGENT_PROMPT });
    }

    if (prompt) {
      messages.push({ role: 'user', content: prompt });
    }

    const tools = ToolTransformer.toOpenAISchema(isFocusedModeEnabled());

    // Mapas para acumular tool calls parciais
    const toolCallBuffer: Record<number, { id: string, name: string, args: string }> = {};

    try {
      const stream = await openai.chat.completions.create({
        model: this.modelId,
        messages: messages as any,
        tools: tools.length > 0 ? (tools as any) : undefined,
        stream: true,
        temperature: 0,
        stream_options: { include_usage: true }
      }, { signal: options?.signal as any });

      for await (const chunk of stream) {
        const usage = (chunk as any)?.usage;
        if (usage) {
          const inputTokens = this.extractInputTokensFromUsage(usage);
          const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          const cachedInputTokens = this.extractCachedInputTokensFromUsage(usage);
          
          const cost = calculateProviderUsageCost({
            provider: 'deepseek',
            modelId: this.modelId,
            inputTokens,
            outputTokens,
            cachedInputTokens
          });

          yield {
            type: 'usage',
            payload: {
              provider: 'deepseek',
              modelId: this.modelId,
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

        // 1. Raciocínio (DeepSeek R1/V3 pode ter reasoning_content)
        if ((delta as any).reasoning_content) {
          yield { type: 'thought', content: (delta as any).reasoning_content };
        }

        // 2. Streaming de Texto
        if (delta.content) {
          yield { type: 'text', content: delta.content };
        }

        // 3. Streaming de Tool Calls
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

        // 4. Finalização de Tool Call (Frame)
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
      }

    } catch (error) {
      yield { type: 'error', content: `DeepSeek API Error: ${error}` };
    }
  }

  private sanitizeContextForDeepSeek(context: any[]): any[] {
    const sanitized: any[] = [];

    for (let i = 0; i < context.length; i++) {
      const msg = context[i];
      if (!msg?.role) continue;

      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const validToolCalls = msg.tool_calls.filter((tc: any) => {
          const toolCallId = String(tc?.id || '');
          if (!toolCallId) return false;
          const hasResult = context.some((candidate: any, idx: number) => {
            if (idx <= i) return false;
            if (candidate?.role !== 'tool') return false;
            const resultId = String(candidate.tool_call_id || '');
            return resultId === toolCallId || resultId.endsWith(toolCallId) || toolCallId.endsWith(resultId);
          });
          if (hasResult) return true;
          // Tool calls recentes sem resultado podem estar em andamento
          return i >= context.length - 10;
        });

        sanitized.push(
          validToolCalls.length > 0
            ? { ...msg, tool_calls: validToolCalls }
            : { role: 'assistant', content: msg.content || '' }
        );
        continue;
      }

      if (msg.role === 'tool') {
        const toolCallId = String(msg.tool_call_id || '');
        const hasMatchingCall = sanitized.some((s: any) =>
          s.role === 'assistant' &&
          Array.isArray(s.tool_calls) &&
          s.tool_calls.some((tc: any) => {
            const id = String(tc?.id || '');
            if (!id || !toolCallId) return false;
            return id === toolCallId || toolCallId.endsWith(id) || id.endsWith(toolCallId);
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

  private convertContextToDeepSeekMessages(context: any[]): any[] {
    const sanitized = this.sanitizeContextForDeepSeek(context);

    return sanitized.map(msg => {
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content };
      }

      if (msg.role === 'user') {
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
}
