import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExecuteToolOptions } from './types';
import { exec } from 'child_process';
import { getExtensionContext } from '../context';
import { promisify } from 'util';
import { getModel, supportsVision } from '../config';
import { AssetIntelligence } from '../services/assetIntelligence';

const execAsync = promisify(exec);

interface ScreenshotArgs {
    savePath?: string;
}

interface ImageAttachment {
    name?: string;
    mimeType: string;
    dataBase64: string;
}

export async function executeScreenshot(
    args: Record<string, any>,
    options: ExecuteToolOptions
): Promise<any> {
    const { savePath } = args as ScreenshotArgs;

    try {
        const timestamp = Date.now();
        const context = getExtensionContext();
        // Nota: no ambiente de desenvolvimento o script pode estar em src/tools ou dist/tools
        let pyScript = path.join(context.extensionPath, 'dist', 'tools', 'screenshot.py');
        if (!fs.existsSync(pyScript)) {
            pyScript = path.join(context.extensionPath, 'src', 'tools', 'screenshot.py');
        }
        
        const tempDir = process.env.TEMP || process.env.TMP || '/tmp';
        const finalPath = savePath || path.join(tempDir, `vscode_screenshot_${timestamp}.png`);

        // Executa o script Python
        const { stdout, stderr } = await execAsync(`python "${pyScript}" "${finalPath}"`);

        // Tentar parsear como JSON para erros de dependência
        try {
            const parsed = JSON.parse(stdout.trim());
            if (parsed.ok === false) {
                return { 
                    sucesso: false, 
                    erro: parsed.error, 
                    suggestion: parsed.suggestion,
                    missing_dependency: parsed.missing_dependency 
                };
            }
        } catch (e) {
            // Não é JSON, segue fluxo normal
        }

        if (stderr && !stdout.includes('SUCCESS:')) {
            return { sucesso: false, erro: stderr };
        }

        if (stdout.includes('SUCCESS:')) {
            const actualPath = stdout.split('SUCCESS:')[1].trim();
            
            // --- Injeção de Imagem para o Agente (similar ao get_image) ---
            
            // Resolve caminho relativo para o workspace se possível para o AssetIntelligence
            let relativePath = actualPath;
            if (options.workspaceFolder && path.isAbsolute(actualPath)) {
                const workspacePath = options.workspaceFolder.uri.fsPath;
                if (actualPath.toLowerCase().startsWith(workspacePath.toLowerCase())) {
                    relativePath = path.relative(workspacePath, actualPath).replace(/\\/g, '/');
                }
            }

            // Registro no AssetIntelligence
            let intelligenceMetadata = null;
            if (options.workspaceFolder) {
                try {
                    intelligenceMetadata = await AssetIntelligence.registerAsset(
                        relativePath,
                        "IDE Screenshot",
                        options.workspaceFolder
                    );
                } catch (e) {
                    // Ignora erro de registro
                }
            }

            // Verifica suporte a visão
            const currentModel = getModel();
            const hasVision = supportsVision(currentModel);

            // Lê o arquivo para anexar
            const fileBuffer = await fs.promises.readFile(actualPath);
            const base64 = fileBuffer.toString('base64');

            const imageAttachment: ImageAttachment = {
                name: path.basename(actualPath),
                mimeType: 'image/png',
                dataBase64: base64
            };

            let responseMessage = `Screenshot da IDE capturado com sucesso.`;
            if (intelligenceMetadata) {
                responseMessage += `\n🧠 [AIVS Metadata]: v${intelligenceMetadata.version || 1}, Tags: IDE, Screenshot`;
            }

            if (!hasVision) {
                responseMessage += `\n⚠️ Nota: O modelo atual (${currentModel}) NÃO suporta visão direta.`;
            }

            return {
                sucesso: true,
                message: responseMessage,
                path: actualPath,
                timestamp: new Date().toISOString(),
                intelligence: intelligenceMetadata,
                images: [imageAttachment],
                attachments: [imageAttachment]
            };
        }

        if (stdout.includes('ERROR:')) {
            const errorMsg = stdout.split('ERROR:')[1].trim();
            return { sucesso: false, erro: errorMsg };
        }

        return { sucesso: false, erro: "Falha desconhecida na execução do screenshot", stdout, stderr };
    } catch (err: any) {
        return { sucesso: false, erro: err.message };
    }
}
