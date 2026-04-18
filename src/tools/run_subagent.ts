/**
 * Tool run_subagent — lança um subagente com loop próprio.
 *
 * O subagente:
 * - Usa as mesmas tools que o agente principal
 * - Tem seu próprio histórico e contexto
 * - Reporta estado via `report_subagent_state`
 * - Quando termina, injeta o payload no loop principal
 * - Se o loop principal estiver parado, o reinicia
 *
 * Parâmetros:
 * - task: string — o que o subagente deve fazer
 * - label: string (opcional) — nome de exibição na UI (ex: "Analisador", "Escritor")
 * - wait: boolean (opcional, padrão: false) — aguardar o subagente terminar
 * - subagent_id: string (opcional) — ID customizado
 */

import * as uuid from 'uuid';
import { ExecuteToolOptions } from './types';
import { SubAgentManager } from '../core/subAgentManager';
import { SubAgentLoop } from '../core/subAgentLoop';
import { Logger, LogLevel } from '../runtime/logger';

interface RunSubagentArgs {
  task: string;
  label?: string;
  wait?: boolean;
  subagent_id?: string;
}

interface RunningSubAgent {
  agentId: string;
  label: string;
  task: string;
  startedAt: number;
  loop: SubAgentLoop;
  promise: Promise<any>;
}

// Mapa de subagentes rodando em background
const runningSubAgents = new Map<string, RunningSubAgent>();

export async function executeRunSubAgent(
  args: RunSubagentArgs,
  options: ExecuteToolOptions & { _subAgentAdapter?: any }
): Promise<any> {
  const { task, label, wait = false } = args;

  if (!task || typeof task !== 'string' || !task.trim()) {
    throw new Error('run_subagent requer o parâmetro "task" (string não vazia).');
  }

  // Pega o adapter registrado no SubAgentManager
  const manager = SubAgentManager.getInstance();
  const mainLoopRef = (manager as any).mainLoopRef;

  if (!mainLoopRef) {
    throw new Error(
      'run_subagent: loop principal não registrado no SubAgentManager. ' +
      'Certifique-se de que o loop principal chamou SubAgentManager.getInstance().registerMainLoop().'
    );
  }

  const adapter = mainLoopRef.getAdapter?.();
  if (!adapter) {
    throw new Error('run_subagent: não foi possível obter o adapter do loop principal.');
  }

  const workspaceFolder = mainLoopRef.getWorkspaceFolder?.() || options.workspaceFolder;
  const sidebarProvider = mainLoopRef.getSidebarProvider?.() || options.sidebarProvider;
  const chatId = mainLoopRef.getCurrentChat?.()?.chatId || options.chatId;

  const agentId = args.subagent_id || `subagent_${uuid.v4().slice(0, 8)}`;
  const agentLabel = label?.trim() || `Subagente ${agentId.slice(-4)}`;

  Logger.log(LogLevel.INFO, 'run_subagent', `Iniciando subagente: ${agentLabel} | task: ${task.slice(0, 80)}`);

  const loop = new SubAgentLoop({
    agentId,
    label: agentLabel,
    task: task.trim(),
    adapter,
    workspaceFolder,
    sidebarProvider,
    chatId,
    supportsNativeToolCalling: undefined // herda do adapter
  });

  const runPromise = loop.run();

  const entry: RunningSubAgent = {
    agentId,
    label: agentLabel,
    task: task.trim(),
    startedAt: Date.now(),
    loop,
    promise: runPromise
  };

  runningSubAgents.set(agentId, entry);

  // Limpa quando terminar
  runPromise.finally(() => {
    runningSubAgents.delete(agentId);
  });

  if (wait) {
    // Aguarda o subagente terminar
    const result = await runPromise;
    return {
      status: 'done',
      agent_id: agentId,
      label: agentLabel,
      success: result.success,
      output: result.output,
      state_history: result.stateHistory,
      turn_count: result.turnCount,
      tools_used: result.toolsUsed,
      duration_ms: result.durationMs,
      error: result.error || undefined
    };
  } else {
    // Retorna imediatamente (background)
    return {
      status: 'running',
      agent_id: agentId,
      label: agentLabel,
      started_at: new Date(entry.startedAt).toISOString(),
      instruction: (
        `Subagente "${agentLabel}" iniciado em background (id: ${agentId}). ` +
        `Você receberá as atualizações de estado dele no início dos próximos turnos. ` +
        `Quando terminar, o resultado será injetado automaticamente no seu contexto.`
      )
    };
  }
}

/** Para um subagente rodando em background pelo ID */
export async function executeStopSubAgent(
  args: { agent_id: string },
  _options: ExecuteToolOptions
): Promise<any> {
  const { agent_id } = args;
  if (!agent_id) throw new Error('stop_subagent requer "agent_id".');

  const entry = runningSubAgents.get(agent_id);
  if (!entry) {
    return { status: 'not_found', agent_id, message: 'Subagente não encontrado ou já terminou.' };
  }

  entry.loop.stop();
  return {
    status: 'stopped',
    agent_id,
    label: entry.label,
    message: `Subagente "${entry.label}" (${agent_id}) parado.`
  };
}
