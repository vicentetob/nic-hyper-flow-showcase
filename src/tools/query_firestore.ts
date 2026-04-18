import { getFirestoreForProject } from './firebase_admin_utils';
import { ExecuteToolOptions } from './types';
import * as admin from 'firebase-admin';

/**
 * Executa uma consulta no Firestore.
 */
export async function executeFirestoreRunQuery(args: any, options: ExecuteToolOptions): Promise<any> {
    const { projectId, collectionPath, filters = [], orderBy, limit = 10 } = args;

    if (!projectId || !collectionPath) {
        throw new Error("Campos 'projectId' e 'collectionPath' são obrigatórios.");
    }

    const db = getFirestoreForProject(projectId);
    let query: admin.firestore.Query = db.collection(collectionPath);

    // Aplicar filtros
    for (const f of filters) {
        query = query.where(f.field, f.operator as admin.firestore.WhereFilterOp, f.value);
    }

    // Ordenação
    if (orderBy) {
        query = query.orderBy(orderBy);
    }

    // Limite
    query = query.limit(Math.min(limit, 50));

    try {
        const snapshot = await query.get();
        const results = snapshot.docs.map(doc => ({
            id: doc.id,
            path: doc.ref.path,
            ...doc.data()
        }));

        return {
            results,
            count: results.length
        };
    } catch (error: any) {
        return { error: `Erro na consulta Firestore: ${error.message}` };
    }
}
