/**
 * Tool report_subagent_state — usada EXCLUSIVAMENTE por subagentes.
 *
 * Permite que o subagente reporte seu estado atual em uma frase.
 * - NÃO emite nada para a webview do chat diretamente
 * - Notifica o SubAgentManager que emite SUBAGENT_STATE_CHANGED para a UI
 * - NÃO reinicia o loop principal (só o payload final faz isso)
 */

import { ExecuteToolOptions } from './types';
import { SubAgentManager } from '../core/subAgentManager';

export async function executeReportSubAgentState(
  args: {
    state: string;
  },
  options: ExecuteToolOptions & { subAgentId?: string; subAgentLabel?: string }
): Promise<{ status: string; state: string }> {
  const { state } = args;

  if (!state || state.trim().length === 0) {
    throw new Error('O campo "state" é obrigatório e não pode estar vazio.');
  }

  const agentId = options.subAgentId || 'subagent';
  const label = options.subAgentLabel || 'Subagente';

  // Notifica o manager (que emite para UIBus e armazena para o loop principal)
  SubAgentManager.getInstance().reportSubAgentState(agentId, label, state.trim());

  return {
    status: 'ok',
    state: state.trim()
  };
}
