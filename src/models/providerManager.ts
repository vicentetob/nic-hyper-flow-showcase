import { ModelAdapter } from './adapter';
import { CredentialsManager } from '../core/credentials';
import { OpenAIAdapter } from './openai/openaiAdapter';
import { OpenAICodexAdapter } from './openai/openaiCodexAdapter';
import { AnthropicAdapter } from './anthropic/anthropicAdapter';
import { GeminiAdapter } from './gemini/geminiAdapter';
import { DeepSeekAdapter } from './deepseek/deepseekAdapter';
import { QwenAdapter } from './qwen/qwenAdapter';
import { OllamaAdapter } from './ollama/ollamaAdapter';
import { getModelForChat } from '../config';
import * as vscode from 'vscode';

function normalizeReasoningEffort(value: unknown, defaultValue: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium'): 'none' | 'low' | 'medium' | 'high' | 'xhigh' {
  const normalized = String(value || '').toLowerCase();
  switch (normalized) {
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return normalized;
    default:
      return defaultValue;
  }
}

/** @deprecated Use normalizeReasoningEffort */
function normalizeOpenAIReasoningEffort(value: unknown): 'none' | 'low' | 'medium' | 'high' | 'xhigh' {
  return normalizeReasoningEffort(value, 'medium');
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  description: string;
  supportsVision: boolean;
  supportsNativeToolCalling: boolean;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  contextWindow: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
}

export class ProviderManager {
  private static instance: ProviderManager;
  private providers: Map<string, ProviderInfo> = new Map();
  private adapters: Map<string, ModelAdapter> = new Map();

  private constructor() {}

  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  registerProvider(providerId: string, providerInfo: ProviderInfo): void {
    this.providers.set(providerId, providerInfo);
  }

  registerAdapter(providerId: string, adapter: ModelAdapter): void {
    this.adapters.set(providerId, adapter);
  }

  getProvider(providerId: string): ProviderInfo | undefined {
    return this.providers.get(providerId);
  }

  getAdapter(providerId: string): ModelAdapter | undefined {
    return this.adapters.get(providerId);
  }

  getProviderForModel(modelId: string): string | undefined {
    for (const [providerId, providerInfo] of this.providers.entries()) {
      if (providerInfo.models.some(model => model.id === modelId)) {
        return providerId;
      }
    }
    return undefined;
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    for (const providerInfo of this.providers.values()) {
      const model = providerInfo.models.find(m => m.id === modelId);
      if (model) return model;
    }
    return undefined;
  }

  createAdapter(modelId: string): ModelAdapter {
    const parts = modelId.split(':');
    const providerPrefix = parts[0];
    const realModel = parts.slice(1).join(':');

    if (providerPrefix === 'openai-codex') {
      return new OpenAICodexAdapter(realModel);
    }
    if (providerPrefix === 'openai') {
      if (realModel.toLowerCase().includes('codex')) {
        return new OpenAICodexAdapter(realModel);
      }
      const config = vscode.workspace.getConfiguration('nic-hyper-flow');
      const reasoningEffort = normalizeOpenAIReasoningEffort(config.get('openaiReasoningEffort', 'medium'));
      return new OpenAIAdapter(realModel, reasoningEffort);
    }
    if (providerPrefix === 'anthropic') {
      const config = vscode.workspace.getConfiguration('nic-hyper-flow');
      const rawEffort = config.get('anthropicReasoningEffort', 'none');
      const anthropicReasoningEffort = normalizeReasoningEffort(rawEffort, 'none') as 'none' | 'low' | 'medium' | 'high';
      
      // Se por acaso vier 'xhigh' das configurações antigas, faz fallback para 'high'
      const safeEffort = (anthropicReasoningEffort as string) === 'xhigh' ? 'high' : anthropicReasoningEffort;
      
      return new AnthropicAdapter(realModel, safeEffort);
    }
    if (providerPrefix === 'google') {
      return new GeminiAdapter(realModel);
    }
    if (providerPrefix === 'deepseek') {
      return new DeepSeekAdapter(realModel);
    }
    if (providerPrefix === 'qwen') {
      return new QwenAdapter(realModel);
    }
    if (providerPrefix === 'ollama') {
      const config = vscode.workspace.getConfiguration('nic-hyper-flow');
      const baseUrl = config.get('ollamaBaseUrl', 'http://localhost:11434');
      return new OllamaAdapter(realModel, baseUrl);
    }
    
    return new DeepSeekAdapter('deepseek-chat'); // Default fallback
  }

  getAllProviders(): ProviderInfo[] {
    return Array.from(this.providers.values());
  }
  
  async initializeFromStorage(): Promise<void> {
    // ==================== GOOGLE (GEMINI) ====================
    this.registerProvider('google', {
      id: 'google',
      displayName: 'Google Gemini',
      description: 'Gemini Models (2.5, 3.0 & 3.1)',
      supportsVision: true,
      supportsNativeToolCalling: true,
      models: [
        { 
          id: 'google:gemini-2.5-flash', 
          displayName: 'Gemini 2.5 Flash', 
          description: 'Respostas rápidas e custo-benefício com bom raciocínio geral.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65535 
        },
        { 
          id: 'google:gemini-2.5-pro', 
          displayName: 'Gemini 2.5 Pro', 
          description: 'Raciocínio avançado, código complexo e tarefas STEM.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65535 
        },
        { 
          id: 'google:gemini-3-flash-preview', 
          displayName: 'Gemini 3 Flash', 
          description: 'Altíssima velocidade com boa qualidade para produção. Modelo preview do Gemini 3 Flash.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65536 
        },
        { 
          id: 'google:gemini-3-pro-preview', 
          displayName: 'Gemini 3 Pro', 
          description: 'Inteligência geral máxima e raciocínio profundo multimodal.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65536 
        },
        { 
          id: 'google:gemini-3.1-pro-preview', 
          displayName: 'Gemini 3.1 Pro', 
          description: 'Versão preview do Gemini 3.1 Pro com contexto de 1M tokens e raciocínio avançado multimodal.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65536 
        }
      ]
    });

    // ==================== OPENAI (GPT) ====================
    this.registerProvider('openai', {
      id: 'openai',
      displayName: 'OpenAI',
      description: 'GPT Models (4.1, 5.2 & 5.4)',
      supportsVision: true,
      supportsNativeToolCalling: true,
      models: [
        { 
          id: 'openai:gpt-4.1-mini', 
          displayName: 'GPT 4.1 Mini', 
          description: 'Aplicações long-context com baixo custo e boa precisão.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65535 
        },
        { 
          id: 'openai:gpt-5-mini', 
          displayName: 'GPT 5 Mini', 
          description: 'Versão mais rápida e econômica do GPT-5, ideal para tarefas bem definidas e prompts precisos.', 
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384 
        },
        { 
          id: 'openai:gpt-5.2', 
          displayName: 'GPT 5.2', 
          description: 'Tarefas profissionais complexas, análise profunda e raciocínio geral.', 
          contextWindow: 262144, inputTokenLimit: 262144, outputTokenLimit: 16384 
        },
        { 
          id: 'openai:gpt-5.4', 
          displayName: 'GPT 5.4', 
          description: 'Modelo de fronteira mais capaz para trabalho profissional, suportando planejamento de longo prazo e 1M de tokens de contexto.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65536 
        }
      ]
    });

    // ==================== OPENAI CODEX ====================
    this.registerProvider('openai-codex', {
      id: 'openai-codex',
      displayName: 'OpenAI Codex',
      description: 'GPT Codex Models (especializados em programação)',
      supportsVision: false,
      supportsNativeToolCalling: false,
      models: [
        { 
          id: 'openai-codex:gpt-5.2-codex', 
          displayName: 'GPT 5.2 Codex', 
          description: 'Programação, engenharia de software e edição de código em larga escala.', 
          contextWindow: 262144, inputTokenLimit: 262144, outputTokenLimit: 16384 
        }
      ]
    });

    // ==================== ANTHROPIC (CLAUDE) ====================
    this.registerProvider('anthropic', {
      id: 'anthropic',
      displayName: 'Anthropic',
      description: 'Claude Models (4.5 & Opus)',
      supportsVision: true,
      supportsNativeToolCalling: true,
      models: [
        { 
          id: 'anthropic:claude-sonnet-4-5', 
          displayName: 'Claude Sonnet 4.5', 
          description: 'Claude Sonnet 4.5 - Modelo anterior, mantido para compatibilidade.', 
          contextWindow: 200000, inputTokenLimit: 200000, outputTokenLimit: 64384 
        },
        { 
          id: 'anthropic:claude-sonnet-4-6', 
          displayName: 'Claude Sonnet 4.6', 
          description: 'Claude Sonnet 4.6 - Última versão com capacidades de nível Opus, melhor uso de computadores e automação.', 
          contextWindow: 200000, inputTokenLimit: 200000, outputTokenLimit: 81920 
        },
        { 
          id: 'anthropic:claude-opus-4-5', 
          displayName: 'Claude Opus 4.5', 
          description: 'Claude Opus 4.5 - Modelo anterior, mantido para compatibilidade.', 
          contextWindow: 200000, inputTokenLimit: 200000, outputTokenLimit: 64384
        },
        { 
          id: 'anthropic:claude-opus-4-6', 
          displayName: 'Claude Opus 4.6', 
          description: 'Claude Opus 4.6 - Melhor modelo do mundo.', 
          contextWindow: 200000, inputTokenLimit: 200000, outputTokenLimit: 81920
        }
      ]
    });

    // ==================== DEEPSEEK ====================
    this.registerProvider('deepseek', {
      id: 'deepseek',
      displayName: 'DeepSeek',
      description: 'DeepSeek Models (V3 & R1)',
      supportsVision: false,
      supportsNativeToolCalling: true,
      models: [
        { 
          id: 'deepseek:deepseek-chat', 
          displayName: 'DeepSeek V3', 
          description: 'High-performance model with advanced reasoning.', 
          contextWindow: 124000, inputTokenLimit: 124000, outputTokenLimit: 8192 
        },
        { 
          id: 'deepseek:deepseek-reasoner', 
          displayName: 'DeepSeek R1', 
          description: 'Maximum reasoning capacity (DeepSeek R1).', 
          contextWindow: 124000, inputTokenLimit: 124000, outputTokenLimit: 8192 
        }
      ]
    });

    // ==================== QWEN (Alibaba) ====================
    this.registerProvider('qwen', {
      id: 'qwen',
      displayName: 'Qwen',
      description: 'Alibaba Qwen Models (3.5 & 3.6-Plus)',
      supportsVision: true,
      supportsNativeToolCalling: true,
      models: [
        { 
          id: 'qwen:qwen-turbo-latest', 
          displayName: 'Qwen Turbo', 
          description: 'Modelo otimizado para velocidade e eficiência com 1M de contexto.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 8192 
        },
        { 
          id: 'qwen:qwen-plus-latest', 
          displayName: 'Qwen Plus', 
          description: 'Equilíbrio perfeito entre inteligência e velocidade com 128k de contexto.', 
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 8192 
        },
        { 
          id: 'qwen:qwen-max-latest', 
          displayName: 'Qwen Max', 
          description: 'Modelo mais poderoso da família Qwen para tarefas complexas.', 
          contextWindow: 32768, inputTokenLimit: 32768, outputTokenLimit: 8192 
        },
        { 
          id: 'qwen:qwen-long', 
          displayName: 'Qwen Long', 
          description: 'Modelo especializado em contextos massivos de até 10 milhões de tokens.', 
          contextWindow: 10000000, inputTokenLimit: 10000000, outputTokenLimit: 8192 
        },
        { 
          id: 'qwen:qwen3.5-32b-instruct', 
          displayName: 'Qwen 3.5 32B', 
          description: 'Modelo Qwen 3.5 com raciocínio avançado e suporte nativo a ferramentas.', 
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384 
        },
        { 
          id: 'qwen:qwen3.5-coder-latest', 
          displayName: 'Qwen 3.5 Coder', 
          description: 'Especialista em codificação de última geração com suporte nativo a ferramentas.', 
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384 
        },
        { 
          id: 'qwen:qwen3.6-plus', 
          displayName: 'Qwen 3.6 Plus', 
          description: 'O mais novo modelo da Alibaba com capacidades agenticas de elite e 1M de contexto.', 
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 32768 
        }
      ]
    });

    // ==================== OLLAMA ====================
    this.registerProvider('ollama', {
      id: 'ollama',
      displayName: 'Ollama (Local/Cloud)',
      description: 'Modelos de próxima geração via Ollama com suporte nativo a ferramentas e visão.',
      supportsVision: true,
      supportsNativeToolCalling: true,
      models: [
        {
          id: 'ollama:glm-5.1:cloud',
          displayName: 'GLM 5.1 (Zhipu AI)',
          description: 'Modelo flagship para engenharia agentica com altíssima performance em ferramentas.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:qwen3.5:cloud',
          displayName: 'Qwen 3.5',
          description: 'Modelo de fronteira da Alibaba com raciocínio de ponta e 1M de contexto.',
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 65536
        },
        {
          id: 'ollama:gemma4:cloud',
          displayName: 'Gemma 4 (Google Open Weights)',
          description: 'Nova geração open da Google baseada na pesquisa do Gemini 4 com suporte nativo a ferramentas e visão.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:deepseek-v3.2:cloud',
          displayName: 'DeepSeek V3.2',
          description: 'A versão mais recente do DeepSeek com eficiência computacional superior e foco agentico.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:kimi-k2.5:cloud',
          displayName: 'Kimi K2.5',
          description: 'Modelo multimodal nativo com foco em capacidades agenticas e raciocínio profundo.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:gemini-3-flash-preview:cloud',
          displayName: 'Gemini 3 Flash (Ollama Cloud)',
          description: 'Inteligência de fronteira do Google via Ollama Cloud com velocidade excepcional.',
          contextWindow: 1000000, inputTokenLimit: 1000000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:minimax-m2.7:cloud',
          displayName: 'MiniMax M2.7',
          description: 'Modelo de alta produtividade focado em tarefas complexas e codificação.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:glm-4.7:cloud',
          displayName: 'GLM 4.7',
          description: 'Modelo estável e poderoso da série GLM com suporte total a ferramentas.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:qwen3-coder-next:cloud',
          displayName: 'Qwen 3 Coder Next',
          description: 'Otimizado especificamente para fluxos de trabalho de programação e agentes de codificação.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:glm-5:cloud',
          displayName: 'GLM 5',
          description: 'A base da série 5 da Zhipu AI para tarefas gerais e raciocínio.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:nemotron-3-super:cloud',
          displayName: 'Nemotron 3 Super',
          description: 'Modelo da NVIDIA otimizado para raciocínio e alta performance agentica.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        },
        {
          id: 'ollama:devstral-2:cloud',
          displayName: 'Devstral 2',
          description: 'Modelo focado em desenvolvedores com excelentes capacidades de instrução e ferramentas.',
          contextWindow: 128000, inputTokenLimit: 128000, outputTokenLimit: 16384
        }
      ]
    });
  }

  async getCurrentProvider(chatId?: string): Promise<string | undefined> {
    if (chatId) {
      return await getModelForChat(chatId);
    }

    const config = vscode.workspace.getConfiguration('nic-hyper-flow');
    return config.get<string>('selectedModelId') || 'deepseek:deepseek-chat';
  }
}
