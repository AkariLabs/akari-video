import { t } from '@akari-video/i18n';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ChatEvent } from '../common/chat-events';

export type ChatDefaults = { model?: string; effort?: string };
export type TranscriptRow = { at: string; event: ChatEvent };

function defaultsPath(): string {
    return join(process.env.HOME || homedir(), '.akari', 'chat', 'defaults.json');
}

export async function readDefaults(): Promise<Record<string, ChatDefaults>> {
    try {
        const value = JSON.parse(await fs.readFile(defaultsPath(), 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
}

export async function writeDefaults(value: Record<string, ChatDefaults>): Promise<void> {
    const target = defaultsPath();
    await fs.mkdir(join(process.env.HOME || homedir(), '.akari', 'chat'), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
        await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
}

function transcriptPath(cwd: string, historyId: string): string {
    if (!/^c-[a-zA-Z0-9-]+$/.test(historyId)) throw new Error(t('chat.chatStorage.ui.conversationIDIncorrectLabel'));
    return join(cwd, '.akari', 'chat', 'transcripts', `${historyId}.jsonl`);
}

export async function appendTranscript(cwd: string, historyId: string, event: ChatEvent): Promise<void> {
    const target = transcriptPath(cwd, historyId);
    await fs.mkdir(join(cwd, '.akari', 'chat', 'transcripts'), { recursive: true });
    const stored = event.type === 'user' ? { ...event, attachments: event.attachments.map(item =>
        item.kind === 'review' ? { ...item, review: { ...item.review, thumbnail: undefined } } : item) } : event;
    await fs.appendFile(target, JSON.stringify({ at: new Date().toISOString(), event: stored }) + '\n');
}

export async function loadTranscript(cwd: string, historyId: string): Promise<TranscriptRow[]> {
    const target = transcriptPath(cwd, historyId);
    try {
        return (await fs.readFile(target, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as TranscriptRow);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}
