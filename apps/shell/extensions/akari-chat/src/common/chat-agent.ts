export interface ChatAgentInfo {
    id: string;
    name: string;
    installed: boolean;
    version?: string;
    transport: 'claude-stream-json' | 'agy-stream-json' | 'codex-app-server' | 'acp';
    permissionModes?: readonly ('automatic' | 'checkpoints' | 'every')[];
    permissionReasons?: Partial<Record<'checkpoints' | 'every', string>>;
    installHint?: string;
    loginHint?: string;
}

export type ChatAdapterPermission = 'auto' | 'all' | 'checkpoints' | 'every';

export interface ChatCapabilities {
    models: { id: string; label: string; description?: string }[];
    currentModel?: string;
    efforts?: string[];
    images: boolean;
    interrupt: boolean;
    clear: boolean;
    compact: boolean;
    resume: boolean;
    ask: boolean;
}
