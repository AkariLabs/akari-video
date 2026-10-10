export interface ChatAgentInfo {
    id: string;
    name: string;
    installed: boolean;
    version?: string;
    transport: 'claude-stream-json' | 'codex-app-server' | 'acp';
}

export interface ChatCapabilities {
    models: { id: string; label: string; description?: string }[];
    efforts?: string[];
    images: boolean;
    interrupt: boolean;
    clear: boolean;
    compact: boolean;
    resume: boolean;
    ask: boolean;
}
