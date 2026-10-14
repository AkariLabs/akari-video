import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../../common/chat-agent';
import type { ChatAttachment } from '../../common/chat-attachments';
import type { ChatEvent } from '../../common/chat-events';
import type { ChatCommand } from '../../common/chat-protocol';

export type { ChatAgentInfo, ChatCapabilities } from '../../common/chat-agent';

export interface ChatAdapter {
    readonly info: () => Promise<ChatAgentInfo>;
    start(opts: {
        cwd: string;
        resume?: string;
        model?: string;
        effort?: string;
        permission: ChatAdapterPermission;
        signal?: AbortSignal;
    }): Promise<ChatAdapterSession>;
}

export interface ChatAdapterSession {
    readonly sessionRef: string;
    readonly initialError?: Extract<ChatEvent, { type: 'error' }>;
    capabilities(): Promise<ChatCapabilities>;
    send(text: string, attachments: ChatAttachment[]): Promise<void>;
    interrupt(): Promise<void>;
    setModel?(model: string): Promise<void>;
    setEffort?(effort: string): Promise<void>;
    clear?(): Promise<void>;
    compact?(): Promise<void>;
    listCommands?(): Promise<ChatCommand[]>;
    onEvent(listener: (event: ChatEvent) => void): { dispose(): void };
    close(): Promise<void>;
}
