import * as fs from 'fs';
import * as path from 'path';
import { ExecuteToolOptions } from './types';
import { AssetIntelligence } from '../services/assetIntelligence';

/**
 * Saves an image received in the chat as an asset in the workspace.
 * 
 * PARAMETERS:
 * - name (required): The name of the asset (e.g., "my_image.png").
 * - query (optional): Description to find the image (e.g., "print of code", "last image").
 * - origin_prompt (optional): The prompt that originated the image.
 * - path (optional): Directory relative to workspace root (defaults to "assets").
 * - index (optional): The index of the attachment if multiple images exist (default: 0).
 */
export async function executeSaveChatImageAsAsset(
  args: any,
  options: ExecuteToolOptions
): Promise<any> {
  const { name, query, origin_prompt, path: targetDir = 'assets', index = 0 } = args;

  if (!name) throw new Error('O nome do asset (name) é obrigatório.');

  if (!options.chatId) {
    throw new Error('Não foi possível identificar o chat atual.');
  }

  const { all } = require('../persistence/db');
  
  // Buscar mensagens recentes do chat que tenham anexos
  // Removendo o filtro attachments != "[]" pois o SQLite pode armazenar como string literal ou null dependendo do estado
  let messages = await all(
    'SELECT msgId, attachments, text FROM messages WHERE chatId = ? AND attachments IS NOT NULL ORDER BY createdAt DESC LIMIT 20',
    [options.chatId]
  );

  // Retry logic: a persistência pode ser assíncrona e demorar um pouco
  if (!messages || messages.length === 0 || !messages.some((m: any) => m.attachments && m.attachments !== '[]')) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    messages = await all(
      'SELECT msgId, attachments, text FROM messages WHERE chatId = ? AND attachments IS NOT NULL ORDER BY createdAt DESC LIMIT 20',
      [options.chatId]
    );
  }

  if (!messages || messages.length === 0) {
    throw new Error('Nenhuma imagem encontrada no histórico recente deste chat. Certifique-se de que a imagem foi enviada corretamente.');
  }

  // Filtrar mensagens que realmente têm imagens (não apenas arrays vazios)
  const messagesWithImages = messages.filter((m: any) => {
    if (!m.attachments || m.attachments === '[]' || m.attachments === 'null') return false;
    try {
      const parsed = JSON.parse(m.attachments);
      return Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.dataBase64;
    } catch {
      return false;
    }
  });

  if (messagesWithImages.length === 0) {
    throw new Error('Nenhuma imagem válida encontrada no histórico recente deste chat. As mensagens podem ter anexos vazios.');
  }

  let selectedImageBase64: string | undefined;
  let finalOriginPrompt = origin_prompt;

  if (query) {
    // Busca heurística baseada na query ou "última imagem"
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('última') || lowerQuery.includes('last')) {
      const lastMsg = messagesWithImages[0];
      const attachments = JSON.parse(lastMsg.attachments);
      selectedImageBase64 = attachments[index]?.dataBase64;
      if (!finalOriginPrompt) finalOriginPrompt = lastMsg.text;
    } else {
      // Tentar encontrar por descrição no texto da mensagem
      for (const msg of messagesWithImages) {
        if (msg.text && msg.text.toLowerCase().includes(lowerQuery)) {
          const attachments = JSON.parse(msg.attachments);
          selectedImageBase64 = attachments[index]?.dataBase64;
          if (!finalOriginPrompt) finalOriginPrompt = msg.text;
          break;
        }
      }
    }
  } else {
    // Comportamento padrão: pega da mensagem atual (options.messageId) ou da última se não houver ID
    const targetMsgId = options.messageId;
    let targetMsg = targetMsgId ? messagesWithImages.find((m: any) => m.msgId === targetMsgId) : messagesWithImages[0];
    
    // Se o assistant chamou a tool e ele mesmo não tem a imagem, provavelmente quer a última do usuário
    if (!targetMsg || !targetMsg.attachments) {
        targetMsg = messagesWithImages[0];
    }

    if (targetMsg && targetMsg.attachments) {
      const attachments = JSON.parse(targetMsg.attachments);
      selectedImageBase64 = attachments[index]?.dataBase64;
      if (!finalOriginPrompt) finalOriginPrompt = targetMsg.text;
    }
  }

  if (!selectedImageBase64) {
    throw new Error(`Não foi possível encontrar uma imagem correspondente ao critério: ${query || 'última imagem'}.`);
  }

  const workspaceRoot = options.workspaceFolder.uri.fsPath;
  const absDir = path.resolve(workspaceRoot, targetDir);
  const absPath = path.resolve(absDir, name);
  const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');

  // Garante que o diretório existe
  if (!fs.existsSync(absDir)) {
    await fs.promises.mkdir(absDir, { recursive: true });
  }

  // Converte base64 para buffer e salva
  try {
    const buffer = Buffer.from(selectedImageBase64, 'base64');
    await fs.promises.writeFile(absPath, buffer);

    let intelligenceMetadata = null;
    if (options.workspaceFolder) {
      intelligenceMetadata = await AssetIntelligence.registerAsset(
        relPath,
        finalOriginPrompt || 'Saved from chat',
        options.workspaceFolder
      );
    }

    return {
      success: true,
      message: `Imagem salva como asset em: ${relPath}`,
      path: relPath,
      assetId: intelligenceMetadata?.assetId,
      intelligence: intelligenceMetadata?.intelligence
    };
  } catch (error: any) {
    throw new Error(`Erro ao salvar imagem como asset: ${error.message}`);
  }
}
