import * as admin from 'firebase-admin';

/**
 * Inicializa ou recupera uma instância do Firebase Admin para um projeto específico.
 * Nota: No ambiente de extensão, assumimos que as credenciais do Google Cloud 
 * (ADC ou Service Account via variáveis de ambiente) já estão configuradas.
 */
export function getFirestoreForProject(projectId: string): admin.firestore.Firestore {
    const appName = `app-${projectId}`;
    let app: admin.app.App;

    const existingApp = admin.apps.find(a => a?.name === appName);
    if (existingApp) {
        app = existingApp!;
    } else {
        app = admin.initializeApp({
            projectId: projectId
        }, appName);
    }

    return admin.firestore(app);
}

export function getStorageForProject(projectId: string): admin.storage.Storage {
    const appName = `app-${projectId}`;
    let app: admin.app.App;

    const existingApp = admin.apps.find(a => a?.name === appName);
    if (existingApp) {
        app = existingApp!;
    } else {
        app = admin.initializeApp({
            projectId: projectId
        }, appName);
    }

    return admin.storage(app);
}
