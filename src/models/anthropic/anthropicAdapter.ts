import Anthropic from '@anthropic-ai/sdk';
import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { CredentialsManager } from '../../core/credentials';
import { THINKING_PROMPT } from './prompts/prompt';
import { ToolTransformer } from '../toolTransformer';
import { isFocusedModeEnabled } from '../../core/focusedModeState';
import { Frame } from '../../protocol/frames';
import { calculateProviderUsageCost } from '../../utils/providerPricing';

export class AnthropicAdapter implements ModelAdapter {
  private reasoningEffort: 'none' | 'low' | 'medium' | 'high' = 'none';

  constructor(
    private modelId: string = 'claude-sonnet-4-6',
    reasoningEffort: 'none' | 'low' | 'medium' | 'high' = 'none'
  ) {
    this.reasoningEffort = reasoningEffort;
  }

  setReasoningEffort(effort: 'none' | 'low' | 'medium' | 'high'): void {
    this.reasoningEffort = effort;
  }

  /**
   * Mapeia reasoning effort para budget_tokens da Anthropic Extended Thinking.
   * none   → thinking desativado
   * low    → 1 024 tokens
   * medium → 5 000 tokens
   * high   → 10 000 tokens
   */
  private resolveThinkingPayload(): { type: 'enabled'; budget_tokens: number } | undefined {
    switch (this.reasoningEffort) {
      case 'low':    return { type: 'enabled', budget_tokens: 1024 };
      case 'medium': return { type: 'enabled', budget_tokens: 5000 };
      case 'high':   return { type: 'enabled', budget_tokens: 10000 };
      default:       return undefined; // 'none' → sem thinking
    }
  }

  async supportsVision(): Promise<boolean> {
    return true; // Sonnet suporta visão
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    return true;
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const credentials = CredentialsManager.getInstance();
    const apiKey = await credentials.getSecret('apiKey:anthropic');

    if (!apiKey) {
      yield { type: 'error', content: 'Anthropic API Key not found. Please configure it in settings.' };
      return;
    }

    const anthropic = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });

    const { system, messages } = this.convertContextToAnthropicMessages(context);

    // Inject system prompt explicitly
    if (system.length === 0) {
      system.push({ type: 'text', text: THINKING_PROMPT });
    } else {
      // Prepend if system already exists (though convertContext handles system roles)
      // Usually better to just have it once.
      // Let's rely on convertContextToAnthropicMessages to parse existing system messages
      // but if none, we add the default one.
      // Wait, if system blocks exist, we should probably APPEND or PREPEND our default prompt?
      // The user wants "prompt.ts" used as system prompt.
      // Let's prepend it to ensure instructions are there.
       system.unshift({ type: 'text', text: THINKING_PROMPT });
    }

    // Adicionar prompt atual se não estiver vazio
    if (prompt) {
      messages.push({ role: 'user', content: prompt });
    }

    // Rate Limiting desativado por performance.

    // CORREÇÃO: Ignorar options.tools (que pode vir no formato Gemini do Loop) e gerar schema nativo Anthropic
    const tools = ToolTransformer.toAnthropicSchema(isFocusedModeEnabled());

    // Adicionar cache_control na última tool para cachear todas as definições de ferramentas
    if (tools && tools.length > 0) {
      tools[tools.length - 1].cache_control = { type: 'ephemeral' };
    }

    // Mapas para acumular tool calls parciais
    const toolCallBuffer: Record<number, { id: string, name: string, args: string }> = {};

    let fullContent = '';
    let lastLoggedLength = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadInputTokens = 0;
    let totalCacheCreationInputTokens = 0;

    try {
      const thinkingPayload = this.resolveThinkingPayload();
      const isThinkingEnabled = !!thinkingPayload;

      // Quando extended thinking está ativo:
      // - temperature DEVE ser 1 (requisito da Anthropic)
      // - max_tokens deve ser maior que budget_tokens (usamos budget + 8192 de saída)
      const maxTokens = isThinkingEnabled
        ? (thinkingPayload!.budget_tokens + 8192)
        : 8192;

      const streamPayload: any = {
        model: this.modelId,
        max_tokens: maxTokens,
        messages: messages as any,
        system: system,
        tools: tools as any,
        ...(isThinkingEnabled
          ? { thinking: thinkingPayload, temperature: 1 }
          : { temperature: 0.2 })
      };

      const stream = anthropic.messages.stream(streamPayload);

      // Hook para capturar usage do final da stream
      stream.on('message', (message: any) => {
        const usage = message.usage;
        if (usage) {
          totalInputTokens = Number(usage.input_tokens || 0);
          totalOutputTokens = Number(usage.output_tokens || 0);
          totalCacheCreationInputTokens = Number(usage.cache_creation_input_tokens || 0);
          totalCacheReadInputTokens = Number(usage.cache_read_input_tokens || 0);
        }
      });

      for await (const event of stream) {
        if (event.type === 'message_stop') {
          const effectiveCachedInputTokens = totalCacheReadInputTokens;
          const effectiveInputTokens = totalInputTokens + totalCacheReadInputTokens;

          const cost = calculateProviderUsageCost({
            provider: 'anthropic',
            modelId: this.modelId,
            inputTokens: effectiveInputTokens,
            outputTokens: totalOutputTokens,
            cachedInputTokens: effectiveCachedInputTokens
          });

          yield {
            type: 'usage',
            payload: {
              provider: 'anthropic',
              modelId: this.modelId,
              inputTokens: effectiveInputTokens,
              outputTokens: totalOutputTokens,
              cachedInputTokens: effectiveCachedInputTokens,
              cacheCreationInputTokens: totalCacheCreationInputTokens,
              totalTokens: effectiveInputTokens + totalOutputTokens,
              costUsd: cost.totalCost,
              costBreakdown: cost
            }
          };
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullContent += event.delta.text;
          // Contagem de tokens desativada por performance.
          yield { type: 'text', content: event.delta.text };
        }

        // Extended Thinking: emite o conteúdo do pensamento como 'thought'
        if (event.type === 'content_block_delta' && (event.delta as any).type === 'thinking_delta') {
          yield { type: 'thought', content: (event.delta as any).thinking };
        }

        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          const index = event.index;
          const block = event.content_block;

          toolCallBuffer[index] = {
            id: block.id,
            name: block.name,
            args: ''
          };
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          const index = event.index;
          const delta = event.delta.partial_json;

          if (toolCallBuffer[index]) {
            toolCallBuffer[index].args += delta;

            yield {
              type: 'tool_call_delta',
              toolCallDelta: {
                id: toolCallBuffer[index].id,
                name: toolCallBuffer[index].name,
                argumentsText: delta, // Delta do JSON para preview
                isFinal: false
              }
            };
          }
        }

        if (event.type === 'content_block_stop') {
          const index = event.index;
          // Se foi um bloco de tool_use, emite o frame final
          if (toolCallBuffer[index]) {
            const buffer = toolCallBuffer[index];
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

            yield { type: 'frame', frame };
          }
        }
      }

    } catch (error) {
      yield { type: 'error', content: `Anthropic SDK Error: ${error}` };
    }
  }

  private convertContextToAnthropicMessages(context: any[]): { system: any[], messages: any[] } {
    const systemBlocks: any[] = [];
    const messages: any[] = [];

    for (const msg of context) {
      if (msg.role === 'system') {
        systemBlocks.push({
          type: 'text',
          text: msg.content
        });
        continue;
      }

      if (msg.role === 'user') {
        if (msg.attachments && msg.attachments.length > 0) {
          const content: any[] = [{ type: 'text', text: msg.content || '' }];
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.data) {
              // Anthropic espera base64 sem prefixo data:image/...
              const base64Data = att.data.split(',')[1] || att.data;
              if (!base64Data || base64Data === 'undefined' || base64Data === '<BASE64_DATA_REMOVED>') {
                continue;
              }
              const mediaType = att.data.split(';')[0].split(':')[1] || 'image/jpeg';

              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              });
            }
          }
          messages.push({ role: 'user', content });
        } else {
          messages.push({ role: 'user', content: msg.content });
        }
        continue;
      }

      if (msg.role === 'assistant') {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || '{}')
            });
          }
        }
        messages.push({ role: 'assistant', content });
        continue;
      }

      if (msg.role === 'tool') {
        const toolResultContent: any[] = [];

        if (msg.content) {
          toolResultContent.push({
            type: 'text',
            text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          });
        }

        if (msg.attachments) {
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.data) {
              const base64Data = att.data.split(',')[1] || att.data;
              if (!base64Data || base64Data === 'undefined' || base64Data === '<BASE64_DATA_REMOVED>') {
                continue;
              }
              const mediaType = att.data.split(';')[0].split(':')[1] || 'image/jpeg';
              toolResultContent.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              });
            }
          }
        }

        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: toolResultContent.length > 0
            ? toolResultContent
            : [{ type: 'text', text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
          is_error: msg._isError
        };

        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          // Já existe uma mensagem user com blocos, agrupa
          lastMsg.content.push(toolResultBlock);
        } else {
          // Nova mensagem user
          messages.push({
            role: 'user',
            content: [toolResultBlock]
          });
        }
      }
    }

    // Adicionar cache_control no último bloco do system para cachear todo o prompt do sistema
    if (systemBlocks.length > 0) {
       // Ensure only the LAST block gets cache_control, remove from others if present
       systemBlocks.forEach(b => delete b.cache_control);
       systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' };
    }

    // Adicionar cache_control na última mensagem de usuário (antes da atual) para cachear o histórico
    // Procurar a última mensagem de usuário que não seja a atual
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        if (Array.isArray(content) && content.length > 0) {
          // Adicionar cache_control no último bloco de conteúdo
          content[content.length - 1].cache_control = { type: 'ephemeral' };
        }
        break;
      }
    }

    return { system: systemBlocks, messages };
  }
}
