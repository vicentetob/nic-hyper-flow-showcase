import { ExecuteToolOptions } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { getModel, supportsVision } from '../config';
import { AssetIntelligence } from '../services/assetIntelligence';
interface ImageAttachment {
  name?: string;
  mimeType: string;
  dataBase64: string;
}

export async function executeGetImage(
  args: any,
  options: ExecuteToolOptions
): Promise<any> {
  const filePath = args.path;
  
  if (!filePath) {
    throw new Error('Caminho do arquivo (path) é obrigatório.');
  }

  // Resolve caminho absoluto
  let absolutePath = filePath;
  if (!path.isAbsolute(filePath)) {
    absolutePath = path.join(options.workspaceFolder.uri.fsPath, filePath);
  }

  // Verifica se arquivo existe
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  // --- Context Injection (AIVS) ---
  let intelligenceMetadata = null;
  if (options.workspaceFolder) {
    try {
      // Normaliza o path para relativo ao workspace se necessário, antes de passar para o AIVS
      let relativePath = filePath;
      if (path.isAbsolute(filePath)) {
        relativePath = path.relative(options.workspaceFolder.uri.fsPath, filePath).replace(/\\/g, '/');
      }

      // Tenta registrar/atualizar para garantir que temos o hash atualizado e metadados
      // Se for uma imagem que já existe mas não tem registro, o prompt original será desconhecido
      // mas o hashing e versão funcionarão.
      intelligenceMetadata = await AssetIntelligence.registerAsset(
        relativePath,
        'Unknown (Existing Asset)',
        options.workspaceFolder
      );
    } catch (e) {
      // Ignora erro de registro no get_image para não impedir a visualização
      console.error(`[get_image] AssetIntelligence error for ${filePath}:`, e);
    }
  }

  // Verifica se o modelo suporta visão
  const currentModel = getModel();
  const hasVision = supportsVision(currentModel);

  // Lê o arquivo
  try {
    const fileBuffer = await fs.promises.readFile(absolutePath);
    const mimeType = getMimeType(absolutePath);
    const base64 = fileBuffer.toString('base64');

    const imageAttachment: ImageAttachment = {
      name: path.basename(filePath),
      mimeType: mimeType,
      dataBase64: base64
    };

    let responseMessage = `Imagem "${path.basename(filePath)}" carregada.`;
    if (intelligenceMetadata && intelligenceMetadata.intelligence && intelligenceMetadata.intelligence.tags) {
        responseMessage += `\n🧠 [AIVS Metadata]: v${intelligenceMetadata.version}, Prompt Originário: "${intelligenceMetadata.origin_prompt}", Tags: ${intelligenceMetadata.intelligence.tags.join(', ')}`;
    } else if (intelligenceMetadata) {
        responseMessage += `\n🧠 [AIVS Metadata]: v${intelligenceMetadata.version || 1}, Prompt Originário: "${intelligenceMetadata.origin_prompt || 'Unknown'}"`;
    }

    if (!hasVision) {
        responseMessage += `\n⚠️ Nota: O modelo atual (${currentModel}) NÃO suporta visão. Confie apenas nos metadados do AIVS acima para entender o conteúdo da imagem.`;
    }

    return {
      message: responseMessage,
      path: filePath,
      intelligence: intelligenceMetadata,
      images: [imageAttachment],
      attachments: [imageAttachment]
    };
  } catch (error: any) {
    throw new Error(`Erro ao ler imagem: ${error.message}`);
  }
}


function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    // O Gemini (e outros modelos) falham com 400 Bad Request se o MIME type for application/octet-stream
    // em requisições de visão. Se não reconhecermos a extensão, forçamos image/jpeg como fallback seguro
    // ou deixamos o erro estourar antes de chegar na API se preferível.
    default: return 'image/jpeg';
  }
}