import * as vscode from 'vscode';
import { resolveWorkspacePath } from './utils';
import { ExecuteToolOptions } from './types';
import * as path from 'path';

/**
 * Tool: generate_image
 * Geração de imagens não está disponível no Nic Assist 2.0.
 */
export async function execute(args: any, options: ExecuteToolOptions): Promise<any> {
  throw new Error('Generate image não está disponível. Esta funcionalidade foi removida pela generate_assets');
}

