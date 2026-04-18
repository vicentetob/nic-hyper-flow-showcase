import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { ExecuteToolOptions } from './types';
import { resolveWorkspacePath } from './utils';

// Set your Tinify API key via VSCode settings (nic-hyper-flow.tinifyApiKey)
// or the TINIFY_API_KEY environment variable. Never hardcode this value.
const DEFAULT_API_KEY = process.env.TINIFY_API_KEY ?? '';

// Tipos para a API Tinify
interface TinifyCompressArgs {
  // Opções de entrada
  source?: 'file' | 'url';
  filePath?: string;
  url?: string;
  
  // Opções de transformação
  resize?: {
    method: 'scale' | 'fit' | 'cover' | 'thumb';
    width?: number;
    height?: number;
  };
  
  convert?: {
    type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | '*/*';
  };
  
  preserve?: Array<'copyright' | 'creation' | 'location'>;
  
  // Opções de saída
  output?: 'file' | 'buffer' | 's3' | 'gcs';
  outputPath?: string;
  outputFilename?: string;
  
  // Configuração da API
  apiKey?: string;
  timeoutMs?: number;
}

interface TinifyResult {
  success: boolean;
  operation: string;
  input?: {
    size: number;
    type: string;
    filename?: string;
  };
  output?: {
    size: number;
    type: string;
    url?: string;
    path?: string;
    filename?: string;
  };
  compressionCount?: number;
  error?: string;
  warnings?: string[];
}

/**
 * Tool: tinify_api
 * Interface para a API do TinyPNG/Tinify para compressão de imagens
 * 
 * Suporta:
 * - Compressão de imagens PNG, JPEG, WebP, AVIF
 * - Upload de arquivo local ou URL
 * - Redimensionamento (scale, fit, cover, thumb)
 * - Conversão de formatos
 * - Preservação de metadados
 * - Saída para arquivo local, buffer ou cloud storage
 * 
 * Args:
 * - source: 'file' | 'url' (obrigatório)
 * - filePath: caminho do arquivo local (se source='file')
 * - url: URL da imagem (se source='url')
 * - resize: objeto com method, width, height
 * - convert: objeto com type
 * - preserve: array de metadados para preservar
 * - output: 'file' | 'buffer' | 's3' | 'gcs'
 * - outputPath: caminho de saída
 * - apiKey: chave da API Tinify (opcional, usa variável de ambiente por padrão)
 * - timeoutMs: timeout em milissegundos
 */
export async function executeTinifyApi(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<TinifyResult> {
  try {
    const params: TinifyCompressArgs = {
      source: args.source as 'file' | 'url',
      filePath: args.filePath,
      url: args.url,
      apiKey: args.apiKey,
      timeoutMs: args.timeoutMs ? parseInt(args.timeoutMs) : 30000,
    };

    // Processar transformações
    if (args.resize) {
      params.resize = {
        method: args.resize.method || 'fit',
        width: args.resize.width ? parseInt(args.resize.width) : undefined,
        height: args.resize.height ? parseInt(args.resize.height) : undefined,
      };
    }

    if (args.convert) {
      params.convert = {
        type: args.convert.type || 'image/png',
      };
    }

    if (args.preserve) {
      params.preserve = Array.isArray(args.preserve) 
        ? args.preserve.filter(p => ['copyright', 'creation', 'location'].includes(p))
        : undefined;
    }

    // Processar opções de saída
    params.output = args.output || 'file';
    params.outputPath = args.outputPath;
    params.outputFilename = args.outputFilename;

    // Validar parâmetros obrigatórios
    if (!params.source) {
      throw new Error('Parâmetro "source" é obrigatório (deve ser "file" ou "url")');
    }

    if (params.source === 'file' && !params.filePath) {
      throw new Error('Parâmetro "filePath" é obrigatório quando source="file"');
    }

    if (params.source === 'url' && !params.url) {
      throw new Error('Parâmetro "url" é obrigatório quando source="url"');
    }

    // Obter API key (variável de ambiente, parâmetro ou default)
    const apiKey = params.apiKey || process.env.TINIFY_API_KEY || DEFAULT_API_KEY;
    if (!apiKey) {
      throw new Error('API key não encontrada. Configure TINIFY_API_KEY no ambiente ou passe via apiKey');
    }

    // Resolver caminhos relativos ao workspace
    let inputFilePath: string | undefined;
    if (params.source === 'file' && params.filePath) {
      const resolvedUri = resolveWorkspacePath(options.workspaceFolder, params.filePath);
      inputFilePath = resolvedUri.fsPath;
      
      // Verificar se o arquivo existe
      if (!fs.existsSync(inputFilePath)) {
        throw new Error(`Arquivo não encontrado: ${inputFilePath}`);
      }
    }

    // Preparar resultado
    const result: TinifyResult = {
      success: false,
      operation: 'compress',
      input: inputFilePath ? {
        size: fs.statSync(inputFilePath).size,
        type: path.extname(inputFilePath).toLowerCase().replace('.', ''),
        filename: path.basename(inputFilePath),
      } : params.url ? {
        size: 0,
        type: 'url',
        filename: params.url,
      } : undefined,
    };

    // Chamar a API Tinify
    const apiResult = await callTinifyApi(apiKey, params, options, inputFilePath);
    
    // Combinar resultados
    result.success = apiResult.success;
    result.output = apiResult.output;
    result.compressionCount = apiResult.compressionCount;
    result.warnings = apiResult.warnings;
    
    if (apiResult.error) {
      result.error = apiResult.error;
    }

    return result;

  } catch (error) {
    return {
      success: false,
      operation: 'compress',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Função auxiliar para chamar a API Tinify
 */
async function callTinifyApi(
  apiKey: string,
  params: TinifyCompressArgs,
  options: ExecuteToolOptions,
  inputFilePath?: string
): Promise<{
  success: boolean;
  output?: {
    size: number;
    type: string;
    url?: string;
    path?: string;
    filename?: string;
  };
  compressionCount?: number;
  error?: string;
  warnings?: string[];
}> {
  const base64ApiKey = Buffer.from(`api:${apiKey}`).toString('base64');
  const apiUrl = 'https://api.tinify.com/shrink';
  
  const headers: Record<string, string> = {
    'Authorization': `Basic ${base64ApiKey}`,
    'User-Agent': 'NicHyperFlow/2.0',
  };

  let body: string | Buffer;
  
  if (params.source === 'file' && inputFilePath) {
    // Upload de arquivo
    body = fs.readFileSync(inputFilePath);
    headers['Content-Type'] = 'application/octet-stream';
  } else if (params.source === 'url' && params.url) {
    // Upload por URL
    body = JSON.stringify({
      source: {
        url: params.url,
      },
    });
    headers['Content-Type'] = 'application/json';
  } else {
    throw new Error('Fonte de imagem inválida');
  }

  // Adicionar timeout
  const timeoutMs = params.timeoutMs || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Primeira chamada: compressão
    const compressResponse = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: body as any,
      signal: controller.signal as any,
    });

    clearTimeout(timeoutId);

    if (!compressResponse.ok) {
      const errorText = await compressResponse.text();
      let errorMessage = `API Tinify retornou status ${compressResponse.status}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorMessage;
      } catch {
        errorMessage = `${errorMessage}: ${errorText}`;
      }
      
      throw new Error(errorMessage);
    }

    const compressionCount = parseInt(compressResponse.headers.get('Compression-Count') || '0');
    const location = compressResponse.headers.get('Location');
    
    if (!location) {
      throw new Error('API não retornou URL para download da imagem comprimida');
    }

    // Preparar transformações
    const transformations: any = {};
    
    if (params.resize) {
      transformations.resize = params.resize;
    }
    
    if (params.convert) {
      transformations.convert = params.convert;
    }
    
    if (params.preserve && params.preserve.length > 0) {
      transformations.preserve = params.preserve;
    }

    let outputUrl = location;
    
    // Aplicar transformações se especificadas
    if (Object.keys(transformations).length > 0) {
      const transformResponse = await fetch(location, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${base64ApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transformations),
        signal: controller.signal as any,
      });

      if (!transformResponse.ok) {
        throw new Error(`Falha ao aplicar transformações: ${transformResponse.status}`);
      }
      
      outputUrl = location; // A mesma URL agora tem as transformações aplicadas
    }

    // Baixar a imagem resultante
    const downloadResponse = await fetch(outputUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${base64ApiKey}`,
      },
      signal: controller.signal as any,
    });

    if (!downloadResponse.ok) {
      throw new Error(`Falha ao baixar imagem: ${downloadResponse.status}`);
    }

    const imageBuffer = await downloadResponse.arrayBuffer();
    const outputSize = imageBuffer.byteLength;
    const contentType = downloadResponse.headers.get('Content-Type') || 'application/octet-stream';
    
    // Determinar tipo de arquivo
    let fileType = 'unknown';
    if (contentType.includes('png')) fileType = 'png';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) fileType = 'jpeg';
    else if (contentType.includes('webp')) fileType = 'webp';
    else if (contentType.includes('avif')) fileType = 'avif';

    // Salvar ou retornar a imagem
    let outputPath: string | undefined;
    let outputFilename: string | undefined;
    
    // Sempre salvar como arquivo para evitar bytes no contexto
    const finalOutputPath = params.outputPath || (params.source === 'file' ? params.filePath : `assets/compressed_${Date.now()}.${fileType}`);
    
    if (finalOutputPath) {
      const outputUri = resolveWorkspacePath(options.workspaceFolder, finalOutputPath);
      const resolvedOutputPath = outputUri.fsPath;
      
      // Se o outputPath aponta para um diretório, anexamos o nome do arquivo
      let finalPath = resolvedOutputPath;
      outputFilename = params.outputFilename || path.basename(finalOutputPath);
      
      // Garantir que temos um nome de arquivo se for um diretório ou sem extensão
      if (!path.extname(outputFilename)) {
        outputFilename = `compressed_${Date.now()}.${fileType}`;
      }

      try {
        const stats = fs.statSync(resolvedOutputPath);
        if (stats.isDirectory()) {
          finalPath = path.join(resolvedOutputPath, outputFilename);
        }
      } catch {
        // Se não existe, verificamos se parece um diretório
        if (finalOutputPath.endsWith('/') || finalOutputPath.endsWith('\\\\') || !path.extname(finalOutputPath)) {
          fs.mkdirSync(resolvedOutputPath, { recursive: true });
          finalPath = path.join(resolvedOutputPath, outputFilename);
        } else {
          const parentDir = path.dirname(resolvedOutputPath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }
        }
      }
      
      outputPath = finalPath;
      fs.writeFileSync(outputPath, Buffer.from(imageBuffer));
    }

    return {
      success: true,
      output: {
        size: outputSize,
        type: fileType,
        url: outputUrl,
        path: outputPath,
        filename: outputFilename,
      },
      compressionCount,
      warnings: compressionCount >= 450 ? [
        `Atenção: ${compressionCount}/500 compressões usadas este mês.`,
        'Plano gratuito permite até 500 compressões/mês.',
      ] : undefined,
    };

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timeout após ${timeoutMs}ms`);
    }
    
    throw error;
  }
}

/**
 * Função auxiliar para validar e normalizar argumentos
 */
function validateTinifyArgs(args: Record<string, any>): string[] {
  const errors: string[] = [];
  
  if (!args.source) {
    errors.push('Parâmetro "source" é obrigatório');
  } else if (!['file', 'url'].includes(args.source)) {
    errors.push('Parâmetro "source" deve ser "file" ou "url"');
  }
  
  if (args.source === 'file' && !args.filePath) {
    errors.push('Parâmetro "filePath" é obrigatório quando source="file"');
  }
  
  if (args.source === 'url' && !args.url) {
    errors.push('Parâmetro "url" é obrigatório quando source="url"');
  }
  
  if (args.resize) {
    if (!args.resize.method) {
      errors.push('Parâmetro "resize.method" é obrigatório');
    } else if (!['scale', 'fit', 'cover', 'thumb'].includes(args.resize.method)) {
      errors.push('Parâmetro "resize.method" deve ser scale, fit, cover ou thumb');
    }
    
    if (args.resize.method === 'scale' && !args.resize.width && !args.resize.height) {
      errors.push('Para resize.method="scale", especifique width OU height');
    }
    
    if (args.resize.method === 'fit' && (!args.resize.width || !args.resize.height)) {
      errors.push('Para resize.method="fit", especifique width E height');
    }
    
    if (args.resize.method === 'cover' && (!args.resize.width || !args.resize.height)) {
      errors.push('Para resize.method="cover", especifique width E height');
    }
    
    if (args.resize.method === 'thumb' && (!args.resize.width || !args.resize.height)) {
      errors.push('Para resize.method="thumb", especifique width E height');
    }
  }
  
  if (args.convert && args.convert.type) {
    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', '*/*'];
    if (!validTypes.includes(args.convert.type)) {
      errors.push(`Tipo de conversão inválido. Use: ${validTypes.join(', ')}`);
    }
  }
  
  return errors;
}
