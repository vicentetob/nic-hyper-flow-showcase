import * as vscode from 'vscode';
import * as path from 'path';
import { ExecuteToolOptions } from './types';
import { executeRunCommand } from './run_command';
import { getExtensionContext } from '../context';

export async function executeGenerateDocx(args: any, options: ExecuteToolOptions): Promise<any> {
    // Se o modelo enviou os campos direto na raiz, usamos args como spec.
    // Se enviou dentro de um campo 'spec' (legado ou erro de prompt), usamos spec.
    const spec = args.spec || args;
    
    if (!spec || !spec.content || !spec.output_path) {
        throw new Error('Os campos "content" e "output_path" são obrigatórios para generate_docx.');
    }

    const context = getExtensionContext();
    const scriptPath = path.join(context.extensionPath, 'dist', 'tools', 'generate_docx.py');
    const specString = JSON.stringify(spec);
    
    // Escapar aspas simples para o comando shell se necessário, 
    // mas executeRunCommand já deve lidar com isso ou podemos passar via stdin.
    // O script aceita via stdin por padrão se não houver flags.
    
    try {
        // Vamos usar o executeRunCommand para rodar o script python
        // O script generate_docx.py aceita o spec via stdin.
        // No Windows/Node spawn shell: true, o pipe funciona bem.
        
        // O specString já é um JSON. O problema anterior era JSON.stringify(specString) 
        // que gerava uma string escapada extra. Queremos o JSON bruto no echo.
        // No Windows, echo aspas duplas pode ser chato, mas o JSON usa aspas duplas.
        
        // Para maior robustez, vamos salvar em um arquivo temporário e passar via --file
        const tmpDir = path.join(options.workspaceFolder.uri.fsPath, 'assets', 'temp');
        if (!vscode.workspace.fs.stat(vscode.Uri.file(tmpDir)).then(() => true, () => false)) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir));
        }
        
        const specFileName = `spec_${Date.now()}.json`;
        const specPath = path.join(tmpDir, specFileName);
        const specUri = vscode.Uri.file(specPath);
        
        await vscode.workspace.fs.writeFile(specUri, Buffer.from(JSON.stringify(spec), 'utf8'));

        // Lógica para encontrar o executável Python (Python Bundled)
        let pythonCmd = 'python';
        const platform = process.platform === 'win32' ? 'win32' : 'linux'; // Simples por enquanto
        const venvPython = path.join(
            context.extensionPath, 
            'bin', 
            'python-runtime', 
            platform, 
            'venv', 
            platform === 'win32' ? 'Scripts' : 'bin',
            platform === 'win32' ? 'python.exe' : 'python'
        );

        const fs = require('fs');
        if (fs.existsSync(venvPython)) {
            pythonCmd = `"${venvPython}"`;
        } else if (process.platform === 'win32') {
            pythonCmd = 'py -3';
        }

        const result = await executeRunCommand({ 
            cmd: `${pythonCmd} "${scriptPath}" --file "${specPath}"` 
        }, options);

        // Deletar o arquivo temporário após o uso
        try {
            await vscode.workspace.fs.delete(specUri);
        } catch (e) {
            console.error('Erro ao deletar arquivo temporário de spec:', e);
        }

        if (result && result.stdout) {
            try {
                // O script python imprime o JSON de resultado no stdout
                return JSON.parse(result.stdout);
            } catch (e) {
                return { ok: false, error: 'Erro ao parsear resposta do script python', raw: result.stdout };
            }
        }
        
        return result;
    } catch (error: any) {
        return { ok: false, error: error.message };
    }
}
