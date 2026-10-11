import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from './chat-agent';
import type { ChatAttachment } from './chat-attachments';
import type { ChatEvent } from './chat-events';

export const AKARI_CHAT_SERVICE_PATH = '/services/akari-chat';
export const AkariChatService = Symbol('AkariChatService');

export interface ChatHistoryEntry {
    id: string;
    agent: string;
    sessionRef: string;
    title: string;
    model?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ChatCommand {
    name: string;
    description?: string;
    kind: 'skill' | 'command';
}

export interface ChatContextInfo {
    usedTokens?: number;
    contextWindow?: number;
    model?: string;
    canCompact: boolean;
}

export interface AkariChatClient {
    onEvent(chatId: string, event: ChatEvent): void;
}

export interface AkariChatService {
    setClient(client: AkariChatClient): void;
    listAgents(): Promise<ChatAgentInfo[]>;
    refreshAgents(): Promise<ChatAgentInfo[]>;
    start(options: {
        agent: string;
        cwd: string;
        resume?: string;
        model?: string;
        effort?: string;
        permission?: ChatAdapterPermission;
        token?: string;
    }): Promise<{ chatId: string; capabilities: ChatCapabilities; error?: { kind: Extract<ChatEvent, { type: 'error' }>['kind']; message: string } }>;
    cancelStart(token: string): Promise<void>;
    send(chatId: string, text: string, attachments: ChatAttachment[]): Promise<void>;
    interrupt(chatId: string): Promise<void>;
    setModel(chatId: string, model: string): Promise<void>;
    setEffort(chatId: string, effort: string): Promise<void>;
    clear(chatId: string): Promise<void>;
    compact(chatId: string): Promise<void>;
    close(chatId: string): Promise<void>;
    closeAll(): Promise<void>;
    listCommands(chatId: string): Promise<ChatCommand[]>;
    contextInfo(chatId: string): Promise<ChatContextInfo>;
    getDefaults(agent: string): Promise<{ model?: string; effort?: string }>;
    setDefaults(agent: string, d: { model?: string; effort?: string }): Promise<void>;
    loadTranscript(cwd: string, historyId: string): Promise<{ at: string; event: ChatEvent }[]>;
    listHistory(cwd: string): Promise<ChatHistoryEntry[]>;
    resume(cwd: string, historyId: string, token?: string, permission?: ChatAdapterPermission): ReturnType<AkariChatService['start']>;
    renameHistory(cwd: string, historyId: string, title: string): Promise<void>;
    removeHistory(cwd: string, historyId: string): Promise<void>;
    saveScreenRecording(cwd: string, data: string): Promise<string>;
    importAttachment(cwd: string, sourcePath: string): Promise<string>;
    resolveAttachmentPath(cwd: string, sourcePath: string): Promise<{ path: string; inside: boolean; relative: string }>;
}
