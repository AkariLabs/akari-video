import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, extname, isAbsolute, join } from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type { ChatAttachment } from '../common/chat-attachments';
import type { ChatEvent } from '../common/chat-events';
import type { AkariChatClient, AkariChatService, ChatHistoryEntry } from '../common/chat-protocol';
import { chatAdapters } from './adapters';
import type { ChatAdapterSession } from './adapters/adapter';
import { addHistory, readHistory, titleFromText, updateHistory, writeHistory, renameHistory, removeHistory } from './history';

type ActiveChat = {
    agent: string;
    cwd: string;
    session: ChatAdapterSession;
    titleSet: boolean;
};

@injectable()
export class AkariChatServiceImpl implements AkariChatService {
    private client?: AkariChatClient;
    private readonly sessions = new Map<string, ActiveChat>();

    setClient(client: AkariChatClient): void {
        this.client = client;
    }

    async listAgents() {
        return Promise.all(chatAdapters.map(adapter => adapter.info()));
    }

    async start(options: {
        agent: string;
        cwd: string;
        resume?: string;
        model?: string;
        effort?: string;
        permission?: 'auto' | 'all';
    }) {
        const registered = await Promise.all(chatAdapters.map(async adapter => ({
            adapter,
            info: await adapter.info()
        })));
        const selected = registered.find(item => item.info.id === options.agent)?.adapter;
        if (!selected) {
            throw new Error('このパートナーはまだチャットに対応していません');
        }
        const session = await selected.start({
            cwd: options.cwd,
            resume: options.resume,
            model: options.model,
            effort: options.effort,
            permission: options.permission || 'auto'
        });
        const existing = options.resume
            ? (await readHistory(options.cwd)).sessions.find(entry =>
                entry.sessionRef === options.resume && entry.agent === options.agent
            )
            : undefined;
        const chatId = existing?.id || `c-${randomUUID()}`;
        this.sessions.set(chatId, {
            agent: options.agent,
            cwd: options.cwd,
            session,
            titleSet: !!options.resume
        });
        session.onEvent(event => {
            if (event.type === 'error' || event.type === 'turn.end') {
                console.warn('[akari-chat] event', {
                    chatId,
                    type: event.type,
                    state: event.type === 'error' ? event.kind : event.ok ? 'ok' : 'failed'
                });
            }
            try {
                void Promise.resolve(this.client?.onEvent(chatId, event)).catch(() => {
                    console.warn('[akari-chat] client event delivery failed', { chatId, type: event.type });
                });
            } catch {
                console.warn('[akari-chat] client event delivery failed', { chatId, type: event.type });
            }
            void this.noteEvent(chatId, event).catch(() => {
                console.warn('[akari-chat] history update failed', { chatId, type: event.type });
            });
        });
        if (!options.resume) {
            const now = new Date().toISOString();
            const entry: ChatHistoryEntry = {
                id: chatId,
                agent: options.agent,
                sessionRef: session.sessionRef,
                title: '新しいチャット',
                model: options.model,
                createdAt: now,
                updatedAt: now
            };
            await writeHistory(options.cwd, addHistory(await readHistory(options.cwd), entry));
        }
        return { chatId, capabilities: await session.capabilities() };
    }

    private async noteEvent(chatId: string, event: ChatEvent): Promise<void> {
        const current = this.sessions.get(chatId);
        if (!current || (event.type !== 'session' && event.type !== 'turn.end')) {
            return;
        }
        const history = await readHistory(current.cwd);
        await writeHistory(current.cwd, updateHistory(history, chatId, {
            sessionRef: current.session.sessionRef,
            updatedAt: new Date().toISOString(),
            ...(event.type === 'session' && event.model ? { model: event.model } : {})
        }));
    }

    async send(chatId: string, text: string, attachments: ChatAttachment[]): Promise<void> {
        const current = this.require(chatId);
        console.warn('[akari-chat] send', { chatId, state: 'received' });
        try {
            if (!current.titleSet) {
                const history = await readHistory(current.cwd);
                await writeHistory(current.cwd, updateHistory(history, chatId, {
                    title: titleFromText(text),
                    updatedAt: new Date().toISOString()
                }));
                current.titleSet = true;
            }
            console.warn('[akari-chat] send', { chatId, state: 'adapter' });
            await current.session.send(text, attachments);
            console.warn('[akari-chat] send', { chatId, state: 'finished' });
        } catch (error) {
            console.warn('[akari-chat] send', {
                chatId,
                state: 'failed',
                reason: error instanceof Error && /write|input/i.test(error.message)
                    ? 'write-failed'
                    : error instanceof Error && /timeout/i.test(error.message) ? 'timeout' : 'other'
            });
            throw error;
        }
    }

    async interrupt(chatId: string): Promise<void> {
        await this.require(chatId).session.interrupt();
    }

    async setModel(chatId: string, model: string): Promise<void> {
        await this.require(chatId).session.setModel?.(model);
    }

    async setEffort(chatId: string, effort: string): Promise<void> {
        await this.require(chatId).session.setEffort?.(effort);
    }

    async clear(chatId: string): Promise<void> {
        await this.require(chatId).session.clear?.();
    }

    async compact(chatId: string): Promise<void> {
        await this.require(chatId).session.compact?.();
    }

    async close(chatId: string): Promise<void> {
        const current = this.require(chatId);
        this.sessions.delete(chatId);
        await current.session.close();
    }

    async listHistory(cwd: string): Promise<ChatHistoryEntry[]> {
        return (await readHistory(cwd)).sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async renameHistory(cwd: string, historyId: string, title: string): Promise<void> {
        await writeHistory(cwd, renameHistory(await readHistory(cwd), historyId, title));
    }

    async removeHistory(cwd: string, historyId: string): Promise<void> {
        await writeHistory(cwd, removeHistory(await readHistory(cwd), historyId));
    }

    async saveScreenRecording(cwd: string, data: string): Promise<string> {
        const match = /^data:video\/(mp4|webm);base64,/.exec(data);
        if (!match) throw new Error('録画の形式を読めません');
        const bytes = Buffer.from(data.slice(match[0].length), 'base64');
        if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('録画のサイズが上限を超えました');
        const relative = `assets/screen-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${match[1]}`;
        await fs.mkdir(join(cwd, 'assets'), { recursive: true });
        await fs.writeFile(join(cwd, relative), bytes, { flag: 'wx' });
        return relative;
    }

    async importAttachment(cwd: string, sourcePath: string): Promise<string> {
        if (!isAbsolute(sourcePath)) throw new Error('ファイルの場所を読めません');
        const info = await fs.stat(sourcePath);
        if (!info.isFile() || info.size > 500 * 1024 * 1024) throw new Error('ファイルを取り込めません');
        const original = basename(sourcePath);
        const stem = original.slice(0, -extname(original).length || undefined).replace(/[^\p{L}\p{N}._-]/gu, '_') || 'file';
        const relative = `assets/${stem}-${randomUUID().slice(0, 8)}${extname(original)}`;
        await fs.mkdir(join(cwd, 'assets'), { recursive: true });
        await fs.copyFile(sourcePath, join(cwd, relative));
        return relative;
    }

    async resume(cwd: string, historyId: string) {
        const entry = (await this.listHistory(cwd)).find(item => item.id === historyId);
        if (!entry?.sessionRef) {
            throw new Error('この会話は開けません');
        }
        return this.start({ cwd, agent: entry.agent, resume: entry.sessionRef, model: entry.model });
    }

    private require(chatId: string): ActiveChat {
        const current = this.sessions.get(chatId);
        if (!current) {
            throw new Error('会話が見つかりません');
        }
        return current;
    }
}
