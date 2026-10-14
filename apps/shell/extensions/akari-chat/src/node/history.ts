import { t } from '@akari-video/i18n';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type { ChatHistoryEntry } from '../common/chat-protocol';

export interface ChatHistory {
    version: 1;
    sessions: ChatHistoryEntry[];
}

export function titleFromText(text: string): string {
    return [...text.trim().replace(/\s+/g, ' ')].slice(0, 40).join('') || t('chat.history.ui.newChatLabel');
}

export function addHistory(history: ChatHistory, entry: ChatHistoryEntry): ChatHistory {
    return {
        version: 1,
        sessions: [entry, ...history.sessions.filter(item => item.id !== entry.id)]
    };
}

export function updateHistory(
    history: ChatHistory,
    id: string,
    change: Partial<ChatHistoryEntry>
): ChatHistory {
    return {
        version: 1,
        sessions: history.sessions.map(item => item.id === id
            ? { ...item, ...change, id: item.id }
            : item)
    };
}

export function renameHistory(history: ChatHistory, id: string, title: string): ChatHistory {
    const normalized = [...title.trim().replace(/\s+/g, ' ')].slice(0, 80).join('');
    if (!normalized) throw new Error(t('chat.history.ui.enterNameLabel'));
    return updateHistory(history, id, { title: normalized });
}

export function removeHistory(history: ChatHistory, id: string): ChatHistory {
    return { version: 1, sessions: history.sessions.filter(entry => entry.id !== id) };
}

async function historyPath(cwd: string): Promise<string> {
    return join(await fs.realpath(cwd), '.akari', 'chat', 'sessions.json');
}

export async function readHistory(cwd: string): Promise<ChatHistory> {
    const target = await historyPath(cwd);
    try {
        const value = JSON.parse(await fs.readFile(target, 'utf8')) as ChatHistory;
        if (value?.version === 1 && Array.isArray(value.sessions)) return value;
        throw new SyntaxError(t('chat.history.ui.historyMalformedLabel'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sessions: [] };
        throw error;
    }
}

export async function readHistoryForWrite(cwd: string): Promise<ChatHistory> {
    try {
        return await readHistory(cwd);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        const target = await historyPath(cwd);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.rename(target, `${target}.broken-${stamp}-${randomUUID().slice(0, 8)}`);
        return { version: 1, sessions: [] };
    }
}

export async function writeHistory(cwd: string, history: ChatHistory): Promise<void> {
    const target = await historyPath(cwd);
    await fs.mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(history, null, 2) + '\n');
        await fs.rename(temporary, target);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
}
