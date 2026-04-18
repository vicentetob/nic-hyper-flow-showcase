import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { ExecuteToolOptions } from './types';

interface ReplaceTextArgs {
  search: string;
  replace: string;
  include: string | string[];
  exclude?: string | string[];
  mode?: 'literal' | 'regex';
  preview?: boolean;
}

interface ReplacementResult {
  file: string;
  changes: number;
  preview?: string[];
  error?: string;
}

export async function executeReplaceText(args: ReplaceTextArgs, options: ExecuteToolOptions): Promise<any> {
  try {
    // Validar argumentos
    if (!args.search) {
      throw new Error('Parâmetro "search" é obrigatório');
    }
    if (!args.replace && args.replace !== '') {
      throw new Error('Parâmetro "replace" é obrigatório');
    }
    if (!args.include) {
      throw new Error('Parâmetro "include" é obrigatório');
    }

    const workspacePath = options.workspaceFolder.uri.fsPath;
    const includePatterns = Array.isArray(args.include) ? args.include : [args.include];
    const excludePatterns = args.exclude ? (Array.isArray(args.exclude) ? args.exclude : [args.exclude]) : [];
    const mode = args.mode || 'literal';
    const preview = args.preview || false;

    // Coletar todos os arquivos que correspondem aos padrões include
    const allFiles: string[] = [];
    for (const pattern of includePatterns) {
      const files = await glob.glob(pattern, {
        cwd: workspacePath,
        ignore: excludePatterns,
        nodir: true,
        absolute: true
      });
      allFiles.push(...files);
    }

    // Remover duplicatas
    const uniqueFiles = [...new Set(allFiles)];

    if (uniqueFiles.length === 0) {
      return {
        success: true,
        message: 'Nenhum arquivo encontrado para os padrões especificados',
        filesScanned: 0,
        replacements: 0,
        previewMode: preview
      };
    }

    const results: ReplacementResult[] = [];
    let totalReplacements = 0;

    // Preparar a função de substituição baseada no modo
    let replaceFunction: (content: string) => { newContent: string; count: number };
    
    if (mode === 'literal') {
      replaceFunction = (content: string) => {
        const searchText = args.search;
        const replaceText = args.replace;
        
        // Contar ocorrências
        let count = 0;
        let lastIndex = 0;
        while (true) {
          const index = content.indexOf(searchText, lastIndex);
          if (index === -1) break;
          count++;
          lastIndex = index + searchText.length;
        }
        
        // Substituir
        const newContent = content.split(searchText).join(replaceText);
        return { newContent, count };
      };
    } else { // modo regex
      replaceFunction = (content: string) => {
        let regex: RegExp;
        try {
          // Tentar criar regex com flags padrão
          regex = new RegExp(args.search, 'g');
        } catch (error) {
          throw new Error(`Expressão regular inválida: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Contar ocorrências
        const matches = content.match(regex);
        const count = matches ? matches.length : 0;
        
        // Substituir
        const newContent = content.replace(regex, args.replace);
        return { newContent, count };
      };
    }

    // Processar cada arquivo
    for (const filePath of uniqueFiles) {
      try {
        // Ler conteúdo do arquivo
        const content = await fs.promises.readFile(filePath, 'utf-8');
        
        // Aplicar substituição
        const { newContent, count } = replaceFunction(content);
        
        if (count > 0) {
          const relativePath = path.relative(workspacePath, filePath);
          
          if (preview) {
            // Modo preview: apenas mostrar o que mudaria
            const oldLines = content.split('\n');
            const newLines = newContent.split('\n');
            
            // Encontrar linhas alteradas para preview
            const changedLines: number[] = [];
            for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
              if (oldLines[i] !== newLines[i]) {
                changedLines.push(i + 1); // 1-based
              }
            }
            
            // Se arquivos têm tamanhos diferentes, adicionar linhas novas
            if (oldLines.length !== newLines.length) {
              for (let i = Math.min(oldLines.length, newLines.length); i < Math.max(oldLines.length, newLines.length); i++) {
                changedLines.push(i + 1);
              }
            }
            
            // Limitar preview a 10 linhas
            const previewLines = changedLines.slice(0, 10).map(lineNum => {
              const oldLine = oldLines[lineNum - 1] || '';
              const newLine = newLines[lineNum - 1] || '';
              return `L${lineNum}: "${oldLine}" → "${newLine}"`;
            });
            
            results.push({
              file: relativePath,
              changes: count,
              preview: previewLines
            });
          } else {
            // Modo real: escrever alterações
            await fs.promises.writeFile(filePath, newContent, 'utf-8');
            results.push({
              file: relativePath,
              changes: count
            });
          }
          
          totalReplacements += count;
        }
      } catch (error) {
        const relativePath = path.relative(workspacePath, filePath);
        results.push({
          file: relativePath,
          changes: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Construir resultado
    const successfulResults = results.filter(r => !r.error);
    const failedResults = results.filter(r => r.error);
    
    const result = {
      success: true,
      summary: {
        filesScanned: uniqueFiles.length,
        filesModified: successfulResults.length,
        totalReplacements,
        previewMode: preview
      },
      results: successfulResults,
      errors: failedResults.length > 0 ? failedResults : undefined,
      message: preview 
        ? `Preview: ${totalReplacements} substituições em ${successfulResults.length} arquivo(s)`
        : `Concluído: ${totalReplacements} substituições em ${successfulResults.length} arquivo(s)`
    };

    // Log no canal de output
    const msg = preview
      ? `🔍 replace_text (preview): "${args.search}" → "${args.replace}" em ${successfulResults.length} arquivo(s)`
      : `✏️ replace_text: "${args.search}" → "${args.replace}" em ${successfulResults.length} arquivo(s)`;
    
    options.outputChannel.appendLine(msg);
    options.notify?.(msg);

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    options.outputChannel.appendLine(`❌ replace_text falhou: ${errorMsg}`);
    throw new Error(`replace_text falhou: ${errorMsg}`);
  }
}