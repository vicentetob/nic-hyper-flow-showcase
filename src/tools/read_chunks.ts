// Esta tool depende de chunking que não existe neste projeto
// Vamos criar uma versão simplificada que retorna erro informativo
import { ExecuteToolOptions } from './types';

export async function executeReadChunks(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  // Tool não implementada - depende de módulo chunking
  throw new Error('read_chunks não está disponível neste projeto. Use read_file com startLine/endLine para ler partes específicas de arquivos.');
}




