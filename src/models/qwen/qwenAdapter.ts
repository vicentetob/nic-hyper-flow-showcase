import OpenAI from 'openai';
import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { CredentialsManager } from '../../core/credentials';
import { AGENT_PROMPT } from './prompts/prompt';
import { ToolTransformer } from '../toolTransformer';
import { isFocusedModeEnabled } from '../../core/focusedModeState';
import { Frame } from '../../protocol/frames';
import { calculateProviderUsageCost } from '../../utils/providerPricing';

export class QwenAdapter implements ModelAdapter {
  constructor(private modelId: string = 'qwen-max-latest') {}

  async supportsVision(): Promise<boolean> {
    const visionModels = ['qwen-vl', 'qwen2-vl', 'qwen-omnni', 'qwen3-omni'];
    return visionModels.some(vm => this.modelId.toLowerCase().includes(vm));
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    return true;
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const credentials = CredentialsManager.getInstance();
    
    // Tentativa 1: SecretStorage (Padrão)
    let apiKey = await credentials.getSecret('apiKey:qwen');
    
    // Tentativa 2: GlobalState Backup
    if (!apiKey) {
      apiKey = (credentials as any).context?.globalState.get('apiKey:qwen_backup');
    }

    if (!apiKey) {
      console.error('[QwenAdapter] API Key NOT FOUND in all storages (checked SecretStorage:apiKey:qwen and GlobalState:apiKey:qwen_backup)');
      yield { 
        type: 'error', 
        content: 'Qwen API Key (DashScope) not found. Por favor, re-insira sua chave em Configurações > Qwen (DashScope) e clique em Salvar.' 
      };
      return;
    }

    // Alibaba DashScope is OpenAI-compatible
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      dangerouslyAllowBrowser: true
    });

    const messages = this.convertContextToQwenMessages(context);

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
        temperature: 0.1,
        // DashScope supports include_usage in stream_options
        stream_options: { include_usage: true }
      }, { signal: options?.signal as any });

      for await (const chunk of stream) {
        const usage = (chunk as any)?.usage;
        if (usage) {
          const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
          const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
          
          const cost = calculateProviderUsageCost({
            provider: 'qwen',
            modelId: this.modelId,
            inputTokens,
            outputTokens
          });

          yield {
            type: 'usage',
            payload: {
              provider: 'qwen',
              modelId: this.modelId,
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
              costUsd: cost.totalCost,
              costBreakdown: cost
            }
          };
        }

        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        if (!delta) continue;

        // Support for reasoning_content if available (some Qwen models might support it)
        if ((delta as any).reasoning_content) {
          yield { type: 'thought', content: (delta as any).reasoning_content };
        }

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
      }

    } catch (error) {
      yield { type: 'error', content: `Qwen API Error: ${error}` };
    }
  }

  private convertContextToQwenMessages(context: any[]): any[] {
    // Qwen OpenAI-compatible interface follows the standard Chat Completions format
    return context.map(msg => {
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content };
      }

      if (msg.role === 'user') {
        if (msg.attachments && msg.attachments.length > 0) {
          const content: any[] = [{ type: 'text', text: msg.content || '' }];
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.data) {
              // Standard OpenAI format for vision
              content.push({
                type: 'image_url',
                image_url: { url: att.data.startsWith('data:') ? att.data : `data:${att.mimeType};base64,${att.data}` }
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
}
