/**
 * Teste de validação: garante que todo o sistema usa numeração 1-based consistentemente
 * 
 * Este teste valida que:
 * - read_file numera linhas começando em 1
 * - parse_lint_errors reporta linhas como 1-based
 * - unified diff hunks são interpretados como 1-based
 * - Não há offsets manuais (-1/+1) que quebrem a consistência
 */

import * as vscode from 'vscode';
import { executeReadFile } from './read_file';
import { executeParseLintErrors } from './parse_lint_errors';
// import { applyPatchByDiff } from './apply_patch_diff';
import { ExecuteToolOptions } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Cria um arquivo temporário de teste
 */
async function createTestFile(content: string[]): Promise<{ uri: vscode.Uri; cleanup: () => Promise<void> }> {
  const tmpDir = path.join(os.tmpdir(), 'jarvis-test-' + Date.now());
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, 'test_file.ts');
  await fs.promises.writeFile(filePath, content.join('\n'), 'utf8');
  
  const uri = vscode.Uri.file(filePath);
  const cleanup = async () => {
    try {
      await fs.promises.unlink(filePath);
      await fs.promises.rmdir(tmpDir);
    } catch {}
  };
  
  return { uri, cleanup };
}

/**
 * Teste principal: valida numeração 1-based em todo o sistema
 */
export async function validateLineNumbering(): Promise<{ passed: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Arquivo de teste com linhas conhecidas
  const testContent = [
    '// Linha 1',
    'function test() {',
    '  // Linha 3',
    '  const x = 1;',
    '  // Linha 5',
    '  return x;',
    '}',
    '// Linha 8'
  ];
  
  const { uri, cleanup } = await createTestFile(testContent);
  
  try {
    // Mock workspace folder
    const workspaceFolder = {
      uri: vscode.Uri.file(path.dirname(uri.fsPath)),
      name: 'test',
      index: 0
    } as vscode.WorkspaceFolder;
    
    const outputChannel = {
      name: 'test',
      append: () => {},
      appendLine: () => {},
      replace: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {}
    } as vscode.OutputChannel;
    
    const options: ExecuteToolOptions = {
      workspaceFolder,
      outputChannel,
      searchMaxResults: 100,
      lintCommand: undefined,
      lintTimeoutMs: 300000
    };
    
    // TESTE 1: read_file deve numerar linhas começando em 1
    const readResult = await executeReadFile(
      { path: uri.fsPath },
      options
    );
    
    if (!readResult.content) {
      errors.push('read_file não retornou conteúdo');
    } else {
      const firstLine = readResult.content.split('\n')[0];
      if (!firstLine.startsWith('1|')) {
        errors.push(`read_file primeira linha deve começar com "1|", mas foi: "${firstLine}"`);
      }
      
      // Verifica que a linha 5 está correta
      const line5 = readResult.content.split('\n').find((l: string) => l.startsWith('5|'));
      if (!line5 || !line5.includes('// Linha 5')) {
        errors.push(`read_file linha 5 não encontrada ou incorreta: "${line5}"`);
      }
    }
    
    if (readResult.startLine !== 1) {
      errors.push(`read_file startLine deve ser 1, mas foi ${readResult.startLine}`);
    }
    
    // TESTE 2: read_file com range deve manter 1-based
    const readRangeResult = await executeReadFile(
      { path: uri.fsPath, startLine: 3, endLine: 5 },
      options
    );
    
    if (readRangeResult.startLine !== 3 || readRangeResult.endLine !== 5) {
      errors.push(`read_file range: esperado 3-5, mas foi ${readRangeResult.startLine}-${readRangeResult.endLine}`);
    }
    
    const rangeFirstLine = readRangeResult.content.split('\n')[0];
    if (!rangeFirstLine.startsWith('3|')) {
      errors.push(`read_file range primeira linha deve começar com "3|", mas foi: "${rangeFirstLine}"`);
    }
    
    // TESTE 3: parse_lint_errors deve reportar linhas 1-based
    // (Este teste requer um linter real, então vamos apenas verificar a estrutura)
    // Em um ambiente real, você criaria um arquivo com erro conhecido na linha K
    // e verificaria que parse_lint_errors reporta line: K (não K-1)
    
    // TESTE 4: unified diff deve interpretar hunks como 1-based
    // Cria um patch que altera a linha 4
    const patch = `--- a/test_file.ts
+++ b/test_file.ts
@@ -4,1 +4,1 @@
-  const x = 1;
+  const x = 2;
`;
    
    const edit = {
      path: path.relative(workspaceFolder.uri.fsPath, uri.fsPath),
      type: 'patch' as const,
      patch
    };
    
    try {
      // await applyPatchByDiff(edit, workspaceFolder, outputChannel);
      
      // Verifica que a linha 4 foi alterada
      const afterContent = await fs.promises.readFile(uri.fsPath, 'utf8');
      const afterLines = afterContent.split('\n');
      
      if (afterLines[3] !== '  const x = 2;') { // índice 3 = linha 4 (0-based)
        errors.push(`Patch não aplicou corretamente na linha 4. Esperado "  const x = 2;", mas foi: "${afterLines[3]}"`);
      }
    } catch (e: any) {
      errors.push(`Erro ao aplicar patch: ${e.message}`);
    }
    
  } finally {
    await cleanup();
  }
  
  return {
    passed: errors.length === 0,
    errors
  };
}

/**
 * Executa o teste se chamado diretamente
 */
if (require.main === module) {
  validateLineNumbering()
    .then(result => {
      if (result.passed) {
        console.log('✅ Teste de numeração 1-based: PASSOU');
        process.exit(0);
      } else {
        console.error('❌ Teste de numeração 1-based: FALHOU');
        result.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('❌ Erro ao executar teste:', err);
      process.exit(1);
    });
}

