export type RangePos = { line: number };

function isNonNegativeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n && n >= 0;
}


/**
 * Substitui um intervalo de linhas inteiras [startLine, endLine) por replacementText.
 * - startLine e endLine são 0-based (linha 0 = primeira linha)
 * - endLine é EXCLUSIVO (não inclui a linha endLine)
 * - Sempre substitui linhas inteiras (incluindo a quebra de linha final)
 * - Para inserção: startLine == endLine (insere sem remover)
 * - Para remoção: replacementText vazio (remove as linhas)
 */
export function replaceRangeInText(
  text: string,
  start: RangePos,
  end: RangePos,
  replacementText: string
): { newText: string; startOffset: number; endOffset: number } {
  if (!isNonNegativeInt(start.line) || !isNonNegativeInt(end.line)) {
    throw new Error(`start.line e end.line devem ser inteiros >= 0 (recebido start=${start.line}, end=${end.line})`);
  }

  if (start.line > end.line) {
    throw new Error(`range inválido: start.line (${start.line}) > end.line (${end.line})`);
  }

  const lineStarts = findLineStarts(text);
  const totalLines = lineStarts.length;

  // Calcula offset do início da primeira linha a substituir
  let startOffset: number;
  if (start.line >= totalLines) {
    // Se start está além do arquivo, insere no final
    startOffset = text.length;
  } else {
    startOffset = lineStarts[start.line];
  }

  // Calcula offset do início da linha end (que é EXCLUSIVA)
  let endOffset: number;
  if (end.line >= totalLines) {
    // Se end está além do arquivo, substitui até o final
    endOffset = text.length;
  } else {
    endOffset = lineStarts[end.line];
  }

  if (startOffset > endOffset) {
    throw new Error(`range inválido: startOffset (${startOffset}) > endOffset (${endOffset})`);
  }

  const newText = text.slice(0, startOffset) + replacementText + text.slice(endOffset);
  return { newText, startOffset, endOffset };
}

/**
 * Encontra os índices de início de cada linha no texto.
 * Retorna um array onde lineStarts[i] é o offset (UTF-16) do início da linha i (0-based).
 * 
 * Suporta:
 * - LF (\n)
 * - CRLF (\r\n)
 * - CR (\r) - para arquivos antigos ou malformados
 * - Separadores de linha/parágrafo Unicode (U+2028, U+2029)
 */
function findLineStarts(text: string): number[] {
  const lineStarts: number[] = [0];
  const len = text.length;
  
  for (let i = 0; i < len; i++) {
    const c = text[i];
    
    if (c === '\n') {
      lineStarts.push(i + 1);
    } else if (c === '\r') {
      // Se for CR seguido de LF, ignoramos o CR (o LF vai tratar na próxima iteração)
      // Se for CR isolado, tratamos como quebra de linha
      if (i + 1 >= len || text[i + 1] !== '\n') {
        lineStarts.push(i + 1);
      }
    } else if (c === '\u2028' || c === '\u2029') {
      // Separadores Unicode
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}
