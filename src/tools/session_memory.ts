import * as fs from 'fs';
import * as path from 'path';
import { ExecuteToolOptions } from './types';

// Persiste em .nic-hyper-flow/memory.json dentro do workspace
const MEMORY_FILE = '.nic-hyper-flow/memory.json';

type MemoryCategory = 'task' | 'project' | 'user';
type MemoryOperation = 'set' | 'get' | 'list' | 'delete' | 'clear' | 'append';

interface MemoryStore {
  task: Record<string, any>;
  project: Record<string, any>;
  user: Record<string, any>;
  _meta: {
    updatedAt: string;
    version: number;
  };
}

function getMemoryPath(workspacePath: string): string {
  return path.join(workspacePath, MEMORY_FILE);
}

function loadMemory(workspacePath: string): MemoryStore {
  const filePath = getMemoryPath(workspacePath);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch { /* arquivo corrompido — recria */ }

  return {
    task: {},
    project: {},
    user: {},
    _meta: { updatedAt: new Date().toISOString(), version: 1 }
  };
}

function saveMemory(workspacePath: string, store: MemoryStore): void {
  const filePath = getMemoryPath(workspacePath);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  store._meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

export async function executeSessionMemory(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const op: MemoryOperation = args.operation;
  const category: MemoryCategory = args.category ?? 'task';
  const key: string | undefined = args.key;
  const value: any = args.value;

  if (!op) { throw new Error(`session_memory requer "operation": set | get | list | delete | clear`); }

  const rootPath = options.workspaceFolder.uri.fsPath;
  const store = loadMemory(rootPath);

  const validCategories: MemoryCategory[] = ['task', 'project', 'user'];
  if (!validCategories.includes(category)) {
    throw new Error(`Categoria inválida: "${category}". Use: task | project | user`);
  }

  switch (op) {
    case 'set': {
      if (!key) { throw new Error(`"set" requer "key"`); }
      if (value === undefined) { throw new Error(`"set" requer "value"`); }
      store[category][key] = value;
      saveMemory(rootPath, store);
      return { success: true, operation: 'set', category, key, value };
    }

    case 'get': {
      if (!key) {
        // Sem key: retorna toda a categoria
        return { success: true, operation: 'get', category, data: store[category] };
      }
      const result = store[category][key];
      return { success: true, operation: 'get', category, key, value: result ?? null, found: result !== undefined };
    }

    case 'list': {
      const summary: Record<string, any> = {};
      for (const cat of validCategories) {
        summary[cat] = Object.keys(store[cat]);
      }
      return {
        success: true,
        operation: 'list',
        keys: summary,
        updatedAt: store._meta.updatedAt,
        memoryFile: MEMORY_FILE,
      };
    }

    case 'delete': {
      if (!key) { throw new Error(`"delete" requer "key"`); }
      const existed = key in store[category];
      delete store[category][key];
      if (existed) { saveMemory(rootPath, store); }
      return { success: true, operation: 'delete', category, key, existed };
    }

    case 'append': {
      if (!key) { throw new Error(`"append" requer "key"`); }
      if (value === undefined) { throw new Error(`"append" requer "value"`); }
      const existing = store[category][key];
      if (existing === undefined) {
        store[category][key] = [value];
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        // Converte valor escalar existente em array
        store[category][key] = [existing, value];
      }
      saveMemory(rootPath, store);
      return { success: true, operation: 'append', category, key, newLength: Array.isArray(store[category][key]) ? store[category][key].length : 1 };
    }

    case 'clear': {
      if (args.category) {
        // Limpa só a categoria especificada
        store[category] = {};
        saveMemory(rootPath, store);
        return { success: true, operation: 'clear', category };
      } else {
        // Limpa tudo
        store.task = {};
        store.project = {};
        store.user = {};
        saveMemory(rootPath, store);
        return { success: true, operation: 'clear', category: 'all' };
      }
    }

    default:
      throw new Error(`Operação desconhecida: "${op}". Use: set | get | list | delete | clear | append`);
  }
}

