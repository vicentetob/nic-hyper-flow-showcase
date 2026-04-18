import { ExecuteToolOptions, JarvisToolResult } from './types';
import * as planStore from '../persistence/planStore';
import { UIBus } from '../ui/events';

interface CurrentPlanArgs {
    action: 'create' | 'mark_done' | 'update' | 'abort';
    plan_description?: string;
    steps?: string[];
    completed_indices?: number[];
    update_reason?: string;
}

export async function executeCurrentPlan(args: CurrentPlanArgs, options: ExecuteToolOptions): Promise<any> {
    const chatId = (options as any).chatId;
    if (!chatId) {
        throw new Error('chatId não fornecido nas opções de execução.');
    }

    let plan: planStore.Plan | null = null;

    switch (args.action) {
        case 'create':
            if (!args.plan_description || !args.steps) {
                throw new Error('plan_description e steps são obrigatórios para a ação "create".');
            }
            plan = {
                chatId,
                description: args.plan_description,
                steps: args.steps.map(s => ({ description: s, completed: false })),
                status: 'active',
                updatedAt: Date.now()
            };
            await planStore.savePlan(plan);
            break;

        case 'mark_done':
            if (!args.completed_indices) {
                throw new Error('completed_indices é obrigatório para a ação "mark_done".');
            }
            plan = await planStore.markStepsDone(chatId, args.completed_indices);
            if (!plan) throw new Error('Nenhum plano ativo encontrado para este chat.');
            
            // Se todas as etapas foram concluídas, deletar o plano automaticamente
            if (plan.status === 'completed') {
                console.log('[DEBUG] Plano completado, deletando e emitindo PLAN_UPDATED com null');
                await planStore.deletePlan(chatId);
                UIBus.emit({
                    type: 'PLAN_UPDATED',
                    payload: { chatId, plan: null }
                });
                return {
                    success: true,
                    message: "PLAN COMPLETED AND REMOVED FROM VIEW. ALL CHECKBOXES MARKED.",
                    action: args.action,
                    plan: null
                };
            }
            break;

        case 'update':
            if (!args.plan_description || !args.steps || !args.update_reason) {
                throw new Error('plan_description, steps e update_reason são obrigatórios para a ação "update".');
            }
            plan = {
                chatId,
                description: args.plan_description,
                steps: args.steps.map(s => ({ description: s, completed: false })),
                status: 'active',
                updatedAt: Date.now()
            };
            await planStore.savePlan(plan);
            break;

        case 'abort':
            await planStore.deletePlan(chatId);
            UIBus.emit({
                type: 'PLAN_UPDATED',
                payload: { chatId, plan: null }
            });
            return { 
                success: true, 
                message: "PLAN ABORTED. THE CHECKLIST HAS BEEN REMOVED FROM THE PROMPT." 
            };

        default:
            throw new Error(`Ação desconhecida: ${args.action}`);
    }

    // Notificar a UI sobre a atualização do plano
    UIBus.emit({
        type: 'PLAN_UPDATED',
        payload: { chatId, plan }
    });

    // Mensagens de retorno para o modelo seguir o prompt injetado
    let responseMessage = "";
    switch (args.action) {
        case 'create':
            responseMessage = "PLAN CREATED AND INJECTED INTO PROMPT. FOLLOW THE STEPS IN THE PROMPT.";
            break;
        case 'mark_done':
            // Se o plano ainda existe (não foi completado), mostra mensagem padrão
            if (plan && plan.status !== 'completed') {
                responseMessage = "PLAN UPDATED. PROGRESS TRACKED. FOLLOW THE NEXT STEPS IN THE PROMPT.";
            }
            break;
        case 'update':
            responseMessage = "PLAN UPDATED AND RE-INJECTED INTO PROMPT. FOLLOW THE NEW STEPS IN THE PROMPT.";
            break;
    }

    return {
        success: true,
        message: responseMessage,
        action: args.action,
        plan: plan
      };
}
