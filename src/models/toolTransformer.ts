import { TOOL_DEFINITIONS } from '../tools/definitions';

// Interfaces para os diferentes formatos
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface ResponsesAPITool {
  type: 'function';
  name: string;
  description: string;
  parameters: any;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
  cache_control?: { type: 'ephemeral' };
}

export interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: any;
  }>;
}

/** Tools expostas no Modo Focused — apenas o essencial para raciocínio pesado */
export const FOCUSED_MODE_TOOLS = new Set([
  'read_file',
  'read_multiple_files',
  'list_dir_recursive',
  'search',
  'get_project_context',
  'patch_file',
  'run_command',
  'parse_lint_errors',
  'web_search',
  'read_web_page',
]);

export class ToolTransformer {
  private static filterDefs(focused: boolean) {
    const defs = Object.values(TOOL_DEFINITIONS);
    return focused ? defs.filter(t => FOCUSED_MODE_TOOLS.has(t.name)) : defs;
  }

  /**
   * Converte definições internas para formato OpenAI
   */
  static toOpenAISchema(focused = false): OpenAITool[] {
    return this.filterDefs(focused).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.cleanSchema(tool.parameters)
      }
    }));
  }

  /**
   * Converte definições internas para formato OpenAI Responses API
   * (tool schema "flat" — sem wrapper `function`)
   */
  static toResponsesAPISchema(focused = false): ResponsesAPITool[] {
    return this.filterDefs(focused).map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: this.cleanSchema(tool.parameters)
    }));
  }

  /**
   * Converte definições internas para formato Anthropic
   */
  static toAnthropicSchema(focused = false): AnthropicTool[] {
    return this.filterDefs(focused).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: this.cleanSchema(tool.parameters)
    }));
  }

  /**
   * Converte definições internas para formato Gemini
   */
  static toGeminiSchema(focused = false): GeminiTool[] {
    // Gemini espera uma lista de functionDeclarations
    return [{
      functionDeclarations: this.filterDefs(focused).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: this.cleanSchemaForGemini(tool.parameters)
      }))
    }];
  }

  /**
   * Limpa e padroniza o schema JSON para compatibilidade
   */
  private static cleanSchema(schema: any): any {
    if (!schema) return { type: 'object', properties: {} };
    
    // Deep clone para não mutar original
    const clean = JSON.parse(JSON.stringify(schema));
    
    // Normalização recursiva de tipos (STRING -> string)
    const normalize = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      
      if (obj.type && typeof obj.type === 'string') {
        obj.type = obj.type.toLowerCase();
      }
      
      // Recurse into properties, items, etc.
      for (const key in obj) {
        normalize(obj[key]);
      }
    };
    
    normalize(clean);
    
    // OpenAI/Anthropic geralmente exigem type='object' na raiz
    if (!clean.type) clean.type = 'object';
    if (!clean.properties) clean.properties = {};

    return clean;
  }

  /**
   * Ajustes específicos para Gemini (Google AI Studio)
   */
  private static cleanSchemaForGemini(schema: any): any {
    const clean = this.cleanSchema(schema);
    
    // Gemini requer que todos os campos em 'properties' tenham um 'type' definido
    // E não suporta bem 'oneOf', 'anyOf', 'allOf' complexos na versão atual
    // Ajustes finos podem ser feitos aqui se necessário
    return clean;
  }
}
