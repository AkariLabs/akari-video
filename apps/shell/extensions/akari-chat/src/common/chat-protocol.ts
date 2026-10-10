import type { ChatAgentInfo, ChatCapabilities } from './chat-agent';
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

export interface AkariChatClient {
    onEvent(chatId: string, event: ChatEvent): void;
}

export interface AkariChatService {
    setClient(client: AkariChatClient): void;
    listAgents(): Promise<ChatAgentInfo[]>;
    start(options: {
        agent: string;
        cwd: string;
        resume?: string;
        model?: string;
        effort?: string;
        permission?: 'auto' | 'all';
    }): Promise<{ chatId: string; capabilities: ChatCapabilities }>;
    send(chatId: string, text: string, attachments: ChatAttachment[]): Promise<void>;
    interrupt(chatId: string): Promise<void>;
    setModel(chatId: string, model: string): Promise<void>;
    setEffort(chatId: string, effort: string): Promise<void>;
    clear(chatId: string): Promise<void>;
    compact(chatId: string): Promise<void>;
    close(chatId: string): Promise<void>;
    listHistory(cwd: string): Promise<ChatHistoryEntry[]>;
    resume(cwd: string, historyId: string): Promise<{ chatId: string; capabilities: ChatCapabilities }>;
    renameHistory(cwd: string, historyId: string, title: string): Promise<void>;
    removeHistory(cwd: string, historyId: string): Promise<void>;
    saveScreenRecording(cwd: string, data: string): Promise<string>;
    importAttachment(cwd: string, sourcePath: string): Promise<string>;
}
