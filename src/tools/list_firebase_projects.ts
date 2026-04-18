import * as admin from 'firebase-admin';
import { ExecuteToolOptions } from './types';

/**
 * Lista os projetos do Firebase.
 * Usa o Resource Manager do Google Cloud.
 */
export async function executeFirebaseListProjects(args: any, options: ExecuteToolOptions): Promise<any> {
    try {
        // O Firebase Admin não tem uma função direta 'listProjects' no SDK de Admin para Node.js
        // mas podemos usar o CLI do gcloud via run_command ou usar a API de Resource Manager.
        // Como o usuário disse que tem o CLI configurado, vamos tentar listar via gcloud.
        
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);

        const { stdout } = await execPromise('gcloud projects list --format="json"');
        const projects = JSON.parse(stdout);

        // Filtrar apenas projetos que parecem ter Firebase habilitado ou retornar todos
        return projects.map((p: any) => ({
            projectId: p.projectId,
            name: p.name,
            projectNumber: p.projectNumber
        }));
    } catch (error: any) {
        return { error: `Erro ao listar projetos: ${error.message}` };
    }
}
