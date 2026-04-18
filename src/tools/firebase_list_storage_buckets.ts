import { getStorageForProject } from './firebase_admin_utils';
import { ExecuteToolOptions } from './types';

/**
 * Lista os buckets do Storage para um projeto.
 */
export async function executeFirebaseListStorageBuckets(args: any, options: ExecuteToolOptions): Promise<any> {
    const { projectId } = args;

    if (!projectId) {
        throw new Error("O campo 'projectId' é obrigatório.");
    }

    try {
        const storage = getStorageForProject(projectId);
        // O SDK do firebase-admin expõe o @google-cloud/storage via storage()
        // mas a tipagem pode variar. Usamos 'any' para chamar getBuckets se o TS reclamar
        const [buckets] = await (storage as any).getBuckets();

        return buckets.map((bucket: any) => ({
            name: bucket.name,
            location: bucket.metadata?.location,
            timeCreated: bucket.metadata?.timeCreated
        }));
    } catch (error: any) {
        return { error: `Erro ao listar buckets: ${error.message}` };
    }
}
