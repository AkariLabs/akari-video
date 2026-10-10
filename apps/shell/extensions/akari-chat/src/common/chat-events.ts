export type ToolKind = 'think' | 'read' | 'write' | 'command' | 'search' | 'skill' | 'web' | 'other';

export type ChatEvent =
    | { type: 'session'; sessionId: string; agent: string; model?: string; cwd: string }
    | { type: 'message.start'; id: string; role: 'assistant' }
    | { type: 'message.delta'; id: string; text: string }
    | { type: 'message.end'; id: string }
    | {
        type: 'tool';
        id: string;
        kind: ToolKind;
        title: string;
        status: 'running' | 'done' | 'error';
        detail?: {
            command?: string;
            output?: string;
            path?: string;
            diff?: { added: number; removed: number; patch?: string };
            text?: string;
        };
        durationMs?: number;
    }
    | { type: 'ask'; id: string; question: string; options: { label: string; description?: string }[] }
    | { type: 'usage'; usedTokens: number; contextWindow?: number }
    | {
        type: 'files';
        files: { path: string; label: string; kind: 'video' | 'image' | 'html' | 'audio' | 'other' }[];
    }
    | { type: 'turn.end'; ok: boolean; reason?: string }
    | { type: 'error'; kind: 'auth' | 'not-installed' | 'crashed' | 'rate-limit' | 'other'; message: string };
