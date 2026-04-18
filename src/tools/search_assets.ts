import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AssetIntelligence, AssetRegistryV2 } from '../services/assetIntelligence';
import { ExecuteToolOptions } from './types';

/**
 * Tool: search_assets
 * Pesquisa assets no AIVS Registry por tags, nome ou prompt.
 * 
 * Args:
 * - query: string (obrigatório) - Termo de busca (tag, nome ou parte do prompt)
 */
export async function execute(args: any, options: ExecuteToolOptions): Promise<any> {
    const query = String(args.query || '').toLowerCase();
    const workspaceRoot = options.workspaceFolder.uri.fsPath;
    const registryPath = path.join(workspaceRoot, '.nic-hyper-flow/assets_registry.json');

    if (!fs.existsSync(registryPath)) {
        return { message: "Nenhum registro de assets encontrado.", assets: [] };
    }

    try {
        const registry: AssetRegistryV2 = AssetIntelligence.loadRegistry(options.workspaceFolder);
        const assets = Object.values(registry.assetsById || {})
            .filter((meta: any) => {
                const nameMatch =
                    String(meta.lastKnownPath || '').toLowerCase().includes(query) ||
                    (Array.isArray(meta.aliases) && meta.aliases.some((p: string) => String(p).toLowerCase().includes(query)));
                const promptMatch = String(meta.origin_prompt || '').toLowerCase().includes(query);
                const tags = meta?.intelligence?.tags || [];
                const tagMatch = Array.isArray(tags) && tags.some((t: string) => String(t).toLowerCase().includes(query));
                return nameMatch || promptMatch || tagMatch;
            })
            .map((meta: any) => ({
                assetId: meta.assetId,
                path: meta.lastKnownPath,
                prompt: meta.origin_prompt,
                tags: meta?.intelligence?.tags || [],
                version: meta.version,
                status: meta.status || 'pending',
                aliases: meta.aliases || []
            }));

        return {
            message: `Encontrados ${assets.length} assets para a busca: "${query}"`,
            assets: assets
        };
    } catch (e: any) {
        throw new Error(`Erro ao pesquisar assets: ${e.message}`);
    }
}