import { getFirestoreForProject } from './firebase_admin_utils';
import { ExecuteToolOptions } from './types';

/**
 * Mapeia a estrutura de coleções e subcoleções do Firestore.
 */
export async function executeFirestoreGetSchemaMap(args: any, options: ExecuteToolOptions): Promise<any> {
    const { projectId, depth = 2, sampleSize = 2 } = args;

    if (!projectId) {
        throw new Error("O campo 'projectId' é obrigatório.");
    }

    const db = getFirestoreForProject(projectId);
    
    // Mapeamento recursivo
    async function mapCollections(parentPath?: string, currentDepth: number = 0): Promise<any> {
        if (currentDepth >= depth) return null;

        let collections;
        if (!parentPath) {
            collections = await db.listCollections();
        } else {
            // listCollections em um documento
            const docRef = db.doc(parentPath);
            collections = await docRef.listCollections();
        }

        const schema: any = {};

        for (const col of collections) {
            const colId = col.id;
            const snapshot = await col.limit(sampleSize).get();
            
            const fields: Record<string, string> = {};
            const subCollections: any = {};

            for (const doc of snapshot.docs) {
                const data = doc.data();
                // Mapear tipos dos campos
                Object.keys(data).forEach(key => {
                    const val = data[key];
                    fields[key] = typeof val;
                    if (val instanceof admin.firestore.Timestamp) fields[key] = 'timestamp';
                    if (val instanceof admin.firestore.GeoPoint) fields[key] = 'geopoint';
                    if (val instanceof admin.firestore.DocumentReference) fields[key] = 'reference';
                    if (Array.isArray(val)) fields[key] = 'array';
                });

                // Buscar subcoleções deste documento específico
                const subs = await mapCollections(`${col.path}/${doc.id}`, currentDepth + 1);
                if (subs) {
                    Object.assign(subCollections, subs);
                }
            }

            schema[colId] = {
                fields,
                subCollections: Object.keys(subCollections).length > 0 ? subCollections : undefined
            };
        }

        return Object.keys(schema).length > 0 ? schema : null;
    }

    try {
        const fullSchema = await mapCollections();
        return fullSchema || { message: "Nenhuma coleção encontrada no projeto." };
    } catch (error: any) {
        return { error: `Erro ao mapear Firestore: ${error.message}` };
    }
}

// Necessário importar o admin para os checks de instância
import * as admin from 'firebase-admin';
