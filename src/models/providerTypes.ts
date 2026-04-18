/**
 * Tipos e interfaces para Providers Custom e Modelos
 */

export type ProviderKind = 'builtin' | 'custom';
export type AuthType = 'none' | 'api_key_bearer' | 'api_key_header' | 'basic' | 'oauth';
export type ProtocolMode = 'tool_calling';
export type CompatPreset = 'openai_compatible' | 'ollama' | 'anthropic_compatible' | 'gemini_compatible' | 'custom';
export type DiscoveryMode = 'auto' | 'manual';
export type ModelSource = 'discovered' | 'manual';
export type TestStatus = 'ok' | 'warn' | 'fail' | 'not_tested';

export interface AuthConfig {
  type: AuthType;
  secretRef?: string; // Referência ao SecretStorage
  headerName?: string; // Para api_key_header
  username?: string; // Para basic auth
  passwordSecretRef?: string; // Para basic auth
}

export interface DiscoveryConfig {
  mode: DiscoveryMode;
  modelsEndpoint?: string; // Ex: /v1/models
  parserPreset?: string; // Ex: openai_models_list
  cacheTtlMs?: number;
  lastSyncAt?: string;
}

export interface ProviderDefaults {
  protocolMode: ProtocolMode;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  streaming?: boolean;
}

export interface ModelCapabilities {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  json: boolean;
  reasoning?: boolean; // Thinking tokens
}

export interface ModelParams {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
}

export interface ToolCallingConfig {
  preset: string; // Ex: openai_tools
  advancedMapping?: boolean;
  endpointPath?: string;
  requestShapePreset?: string;
  responseParserPreset?: string;
  toolSchemaMode?: 'openai_tools' | 'function_call' | 'custom';
}

export interface ModelTestResult {
  status: TestStatus;
  lastTestAt?: string;
  latencyMs?: number;
  notes?: string;
  requestDump?: string;
  responseDump?: string;
}

/**
 * Overrides de metadados por modelId (usado nas listas de "Modelos" das webviews).
 * Não altera o modelo real no provider (ex: Gemini/OpenAI), apenas a apresentação/infos locais.
 */
export interface ModelInfoOverride {
  displayName?: string;
  description?: string;
  contextWindow?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  protocolMode?: ProtocolMode;
  supportsVision?: boolean;
}

export interface Model {
  key: string; // ID interno único dentro do provider
  displayName: string;
  source: ModelSource;
  modelId?: string; // Nome real na API (só para manual)
  protocolMode: ProtocolMode;
  contextWindow?: number;
  capabilities: ModelCapabilities;
  params?: ModelParams;
  toolCalling?: ToolCallingConfig;
  test?: ModelTestResult;
}

export interface CustomProvider {
  id: string; // Slug único
  kind: 'custom';
  displayName: string;
  baseUrl: string;
  timeoutMs: number;
  compatPreset: CompatPreset;
  auth: AuthConfig;
  discovery: DiscoveryConfig;
  defaults: ProviderDefaults;
  headers?: Record<string, string>; // Headers adicionais
  allowInsecureTLS?: boolean; // Dev only
  models: Record<string, Model>; // modelKey -> Model
}

export interface BuiltinProvider {
  id: string;
  kind: 'builtin';
  displayName: string;
  // Outros campos específicos de builtin
  models: Record<string, Model>;
}

export type Provider = CustomProvider | BuiltinProvider;

export interface OllamaEndpoint {
  id: string;
  url: string;
  name: string;
  selectedModel?: string;
  availableModels?: string[];
  lastChecked?: string;
}

export interface ProviderConfig {
  schemaVersion: number;
  activeProviderId?: string;
  activeModelKey?: string; // Format: providerId:modelKey
  providers: Record<string, Provider>;
  ollamaEndpoints?: OllamaEndpoint[];
  activeOllamaEndpointId?: string;
  /**
   * Overrides para metadados de modelos (chaveado por modelId usado na UI).
   */
  modelOverrides?: Record<string, ModelInfoOverride>;
}

export interface ToolCallingPreset {
  id: string;
  displayName: string;
  request: {
    endpointPath: string;
    bodyMode: string;
  };
  response: {
    toolCallPaths: string[];
    assistantTextPath: string;
  };
}
