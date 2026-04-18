import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import * as vscode from 'vscode';

export interface ApprovalResult {
    approved: boolean;
    userMessage?: string;
}

export interface ApprovalRequest {
    id: string;
    command: string;
    toolName?: string;
    resolve: (value: ApprovalResult) => void;
    reject: (reason?: any) => void;
}

class RunCommandManager extends EventEmitter {
    private static instance: RunCommandManager;
    private pendingApprovals: Map<string, ApprovalRequest> = new Map();
    private runningProcesses: Map<string, ChildProcess> = new Map();
    private allowedCommands: Set<string> = new Set();
    private allowAll: boolean = false;

    private constructor() {
        super();
        this.loadConfig();
    }

    public static getInstance(): RunCommandManager {
        if (!RunCommandManager.instance) {
            RunCommandManager.instance = new RunCommandManager();
        }
        return RunCommandManager.instance;
    }

    public loadConfig() {
        const config = vscode.workspace.getConfiguration('nic-hyper-flow.runCommand');
        this.allowAll = config.get<boolean>('allowAll', false);
        const whitelist = config.get<string[]>('allowedCommands', []);
        this.allowedCommands = new Set(whitelist);
    }

    public isAllowed(command: string): boolean {
        if (this.allowAll) {
            console.log(`[RunCommandManager] Allowed '${command}' due to allowAll=true`);
            return true;
        }
        const allowed = this.allowedCommands.has(command);
        console.log(`[RunCommandManager] Checking whitelist for '${command}': ${allowed}`);
        return allowed;
    }

    public addToWhitelist(command: string) {
        this.allowedCommands.add(command);
        const config = vscode.workspace.getConfiguration('nic-hyper-flow.runCommand');
        const currentList = config.get<string[]>('allowedCommands', []);
        if (!currentList.includes(command)) {
            config.update('allowedCommands', [...currentList, command], vscode.ConfigurationTarget.Global);
        }
    }

    public removeFromWhitelist(command: string) {
        this.allowedCommands.delete(command);
        const config = vscode.workspace.getConfiguration('nic-hyper-flow.runCommand');
        const currentList = config.get<string[]>('allowedCommands', []);
        const newList = currentList.filter(c => c !== command);
        config.update('allowedCommands', newList, vscode.ConfigurationTarget.Global);
    }

    public setAllowedCommands(commands: string[]) {
        const normalized = Array.from(new Set(
            (Array.isArray(commands) ? commands : [])
                .map(command => String(command || '').trim())
                .filter(Boolean)
        ));

        this.allowedCommands = new Set(normalized);
        const config = vscode.workspace.getConfiguration('nic-hyper-flow.runCommand');
        config.update('allowedCommands', normalized, vscode.ConfigurationTarget.Global);
    }

    public setAllowAll(value: boolean) {
        this.allowAll = value;
        const config = vscode.workspace.getConfiguration('nic-hyper-flow.runCommand');
        config.update('allowAll', value, vscode.ConfigurationTarget.Global);
    }

    public isAllowAll(): boolean {
        return this.allowAll;
    }

    public getAllowedCommands(): string[] {
        return Array.from(this.allowedCommands);
    }

    public async requestApproval(id: string, command: string, toolName?: string): Promise<ApprovalResult> {
        console.log(`[RunCommandManager] Requesting approval for '${command}' (ID: ${id}, tool: ${toolName || 'run_command'})`);
        if (this.isAllowed(command)) {
            return { approved: true };
        }

        return new Promise((resolve, reject) => {
            console.log(`[RunCommandManager] Emitting approval_requested event for ID ${id}`);
            this.pendingApprovals.set(id, { id, command, toolName, resolve, reject });
            this.emit('approval_requested', { id, command, toolName });
        });
    }

    public handleDecision(id: string, approved: boolean, alwaysAllow: boolean = false, userMessage?: string) {
        console.log(`[RunCommandManager] handleDecision called for ID ${id} (approved=${approved}, alwaysAllow=${alwaysAllow})`);
        const req = this.pendingApprovals.get(id);
        if (!req) {
            console.warn(`[RunCommandManager] No pending approval found for ID ${id}`);
            return;
        }

        this.pendingApprovals.delete(id);
        console.log(`[RunCommandManager] Approval resolved for '${req.command}' (tool: ${req.toolName || 'run_command'})`);

        if (approved) {
            if (alwaysAllow) {
                this.addToWhitelist(req.command);
            }
        }
        req.resolve({ approved, userMessage: userMessage?.trim() || undefined });
    }

    public registerProcess(id: string, process: ChildProcess) {
        this.runningProcesses.set(id, process);
        process.on('close', () => {
            this.runningProcesses.delete(id);
        });
    }

    public killProcess(id: string) {
        const proc = this.runningProcesses.get(id);
        if (proc) {
            // Tenta matar a árvore de processos se possível, ou apenas o processo
            // No Windows tree-kill é mais complexo, mas proc.kill() geralmente basta para single commands
            proc.kill(); // SIGTERM default
            this.runningProcesses.delete(id);
            return true;
        }
        return false;
    }

    public killAll() {
        console.log(`[RunCommandManager] 🛑 Killing all ${this.runningProcesses.size} running processes`);
        for (const [id, proc] of this.runningProcesses) {
            try {
                proc.kill();
            } catch (e) {
                console.error(`[RunCommandManager] Failed to kill process ${id}:`, e);
            }
        }
        this.runningProcesses.clear();

        // Também limpa aprovações pendentes
        for (const [id, req] of this.pendingApprovals) {
            req.resolve({ approved: false });
        }
        this.pendingApprovals.clear();
    }
}

export const runCommandManager = RunCommandManager.getInstance();
