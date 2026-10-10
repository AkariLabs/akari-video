import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { ChatHistoryEntry } from '../common/chat-protocol';

export interface ChatHistory {
    version: 1;
    sessions: ChatHistoryEntry[];
}

export function titleFromText(text: string): string {
    return [...text.trim().replace(/\s+/g, ' ')].slice(0, 40).join('') || '新しいチャット';
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
    if (!normalized) throw new Error('名前を入力してください');
    return updateHistory(history, id, { title: normalized });
}

export function removeHistory(history: ChatHistory, id: string): ChatHistory {
    return { version: 1, sessions: history.sessions.filter(entry => entry.id !== id) };
}

function historyPath(cwd: string): string {
    return join(cwd, '.akari', 'chat', 'sessions.json');
}

export async function readHistory(cwd: string): Promise<ChatHistory> {
    try {
        const value = JSON.parse(await fs.readFile(historyPath(cwd), 'utf8')) as ChatHistory;
        return value.version === 1 && Array.isArray(value.sessions)
            ? value
            : { version: 1, sessions: [] };
    } catch {
        return { version: 1, sessions: [] };
    }
}

export async function writeHistory(cwd: string, history: ChatHistory): Promise<void> {
    const target = historyPath(cwd);
    await fs.mkdir(join(cwd, '.akari', 'chat'), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(history, null, 2) + '\n');
        await fs.rename(temporary, target);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
}
