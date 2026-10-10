import type { ChatAgentInfo, ChatCapabilities } from '../../common/chat-agent';
import type { ChatAttachment } from '../../common/chat-attachments';
import type { ChatEvent } from '../../common/chat-events';

export type { ChatAgentInfo, ChatCapabilities } from '../../common/chat-agent';

export interface ChatAdapter {
    readonly info: () => Promise<ChatAgentInfo>;
    start(opts: {
        cwd: string;
        resume?: string;
        model?: string;
        effort?: string;
        permission: 'auto' | 'all';
    }): Promise<ChatAdapterSession>;
}

export interface ChatAdapterSession {
    readonly sessionRef: string;
    capabilities(): Promise<ChatCapabilities>;
    send(text: string, attachments: ChatAttachment[]): Promise<void>;
    interrupt(): Promise<void>;
    setModel?(model: string): Promise<void>;
    setEffort?(effort: string): Promise<void>;
    clear?(): Promise<void>;
    compact?(): Promise<void>;
    onEvent(listener: (event: ChatEvent) => void): { dispose(): void };
    close(): Promise<void>;
}
