import { ModelAdapter, ModelEvent, StreamOptions } from '../adapter';
import { ToolTransformer } from '../toolTransformer';
import { Frame } from '../../protocol/frames';
import { isFocusedModeEnabled } from '../../core/focusedModeState';
import { CredentialsManager } from '../../core/credentials';

export class OllamaAdapter implements ModelAdapter {
  constructor(
    private modelId: string,
    private baseUrl: string = 'http://localhost:11434'
  ) {}

  async supportsVision(): Promise<boolean> {
    const visionModels = ['vision', 'llava', 'moondream', 'qwen2-vl', 'minicpm-v', 'gemma4', 'qwen3.5', 'glm-5', 'kimi', 'gemini-3', 'minimax-m2.7'];
    const lowerModel = this.modelId.toLowerCase();
    return visionModels.some(vm => lowerModel.includes(vm));
  }

  async supportsNativeToolCalling(): Promise<boolean> {
    // List of models known to support tool calling in Ollama
    const toolCallingModels = [
      'llama3.1', 'llama3.2', 'llama3.3',
      'qwen2.5', 'qwen2.5-coder', 'qwen3', 'qwen3.5',
      'mistral', 'mixtral', 'mistral-nemo',
      'command-r', 'nemotron',
      'gemma2', 'gemma4', 'glm-4', 'glm-5',
      'kimi', 'minimax', 'devstral', 'olmo',
      'deepseek-v3', 'gemini-3'
    ];
    const lowerModel = this.modelId.toLowerCase();
    return toolCallingModels.some(tm => lowerModel.includes(tm));
  }

  async *stream(prompt: string, context: any[], options?: StreamOptions): AsyncIterable<ModelEvent> {
    const messages = this.convertContextToOllamaMessages(context);
    
    if (prompt) {
      messages.push({ role: 'user', content: prompt });
    }

    const allTools = ToolTransformer.toOpenAISchema(isFocusedModeEnabled());
    const tools = this.filterTools(allTools, options);

    const credentials = CredentialsManager.getInstance();
    const apiKey = await credentials.getSecret('apiKey:ollama');

    const payload = {
      model: this.modelId,
      messages: messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      options: {
        temperature: 0.1,
      }
    };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: options?.signal
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 404) {
          let isModelNotFound = false;
          try {
            const parsed = JSON.parse(errorText);
            isModelNotFound = typeof parsed?.error === 'string' && parsed.error.includes('not found');
          } catch {
            isModelNotFound = errorText.includes('not found');
          }

          if (isModelNotFound) {
            yield {
              type: 'error',
              content: [
                `Model \`${this.modelId}\` was not found in Ollama.`,
                ``,
                `**To fix this, follow these steps:**`,
                `1. Make sure **Ollama is installed and running** — download it at [ollama.com](https://ollama.com)`,
                `2. If your Ollama instance requires authentication, **add your API key** in the provider settings`,
                `3. Pull the model by running this command in your terminal:`,
                `   \`\`\``,
                `   ollama pull ${this.modelId}`,
                `   \`\`\``,
              ].join('\n')
            };
            return;
          }
        }

        yield { type: 'error', content: `Ollama Error (${response.status}): ${errorText}` };
        return;
      }

      if (!response.body) {
        yield { type: 'error', content: 'Ollama Error: No response body' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Map to track tool calls if they come in chunks (though Ollama usually sends them whole in non-streaming or at the end)
      const toolCallBuffer: Record<number, { id: string, name: string, args: string }> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            
            if (chunk.error) {
              yield { type: 'error', content: chunk.error };
              continue;
            }

            const message = chunk.message;
            if (message) {
              // 1. Handling Thinking (Reasoning)
              // Some Ollama versions/models use 'thinking' or 'thought' field
              const thought = message.thinking || message.thought;
              if (thought) {
                yield { type: 'thought', content: thought };
              }

              // 2. Handling Text content
              if (message.content) {
                yield { type: 'text', content: message.content };
              }

              // 3. Handling Tool Calls
              if (Array.isArray(message.tool_calls)) {
                for (let i = 0; i < message.tool_calls.length; i++) {
                  const tc = message.tool_calls[i];
                  const callId = tc.id || `ollama-${Date.now()}-${i}`;

                  // Captura thought_signature se presente (modelos Gemini via Ollama exigem isso)
                  const thoughtSig = tc.thought_signature ?? tc.function?.thought_signature;

                  // Ollama tool calls are usually complete objects
                  const frame: Frame = {
                    type: 'TOOL_CALL',
                    payload: {
                      id: callId,
                      name: tc.function.name,
                      args: typeof tc.function.arguments === 'string'
                        ? JSON.parse(tc.function.arguments)
                        : tc.function.arguments,
                      ...(thoughtSig !== undefined && thoughtSig !== null ? { _thoughtSignature: thoughtSig } : {})
                    }
                  };
                  yield { type: 'frame', frame };
                }
              }
            }

            if (chunk.done) {
              // Yield usage if provided
              if (chunk.prompt_eval_count || chunk.eval_count) {
                yield {
                  type: 'usage',
                  payload: {
                    provider: 'ollama',
                    modelId: this.modelId,
                    inputTokens: chunk.prompt_eval_count || 0,
                    outputTokens: chunk.eval_count || 0,
                    totalTokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
                  }
                };
              }
            }
          } catch (e) {
            console.warn('[OllamaAdapter] Failed to parse JSON chunk:', line, e);
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      yield { type: 'error', content: `Ollama Connection Error: ${error.message || error}` };
    }
  }

  private convertContextToOllamaMessages(context: any[]): any[] {
    return context.map(msg => {
      const ollamaMsg: any = {
        role: msg.role,
        content: msg.content || ''
      };

      if (msg.role === 'assistant' && msg.tool_calls) {
        // Thinking models require the thinking content in the assistant message
        if (msg.thought) {
          ollamaMsg.thinking = msg.thought;
        }

        ollamaMsg.tool_calls = msg.tool_calls.map((tc: any) => {
          const thoughtSig = tc._thoughtSignature ?? tc.thought_signature;
          const fnObj: any = {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments
          };
          // thought_signature must be inside the function object, not at the top level
          if (thoughtSig !== undefined && thoughtSig !== null) {
            fnObj.thought_signature = thoughtSig;
          }
          return { function: fnObj };
        });
      }

      if (msg.role === 'tool') {
        ollamaMsg.role = 'tool';
        ollamaMsg.content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        // Ollama often uses 'name' for tool responses to match the tool name
        // but it depends on the model. Some expect 'tool_call_id'.
        // We'll stick to a compatible format.
      }

      return ollamaMsg;
    });
  }

  private filterTools(tools: any[], options?: StreamOptions): any[] {
    if (!options?.tools || options.tools.length === 0) {
      return tools;
    }

    const allowedNames = new Set<string>();
    for (const toolGroup of options.tools as any[]) {
      if (Array.isArray(toolGroup.functionDeclarations)) {
        for (const decl of toolGroup.functionDeclarations) {
          if (decl.name) allowedNames.add(decl.name);
        }
      }
    }

    if (allowedNames.size === 0) return tools;
    return tools.filter(t => allowedNames.has(t.function?.name));
  }
}
