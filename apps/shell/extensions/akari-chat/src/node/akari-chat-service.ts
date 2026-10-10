import { randomUUID } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';
import type { ChatAttachment } from '../common/chat-attachments';
import type { ChatEvent } from '../common/chat-events';
import type { AkariChatClient, AkariChatService, ChatHistoryEntry } from '../common/chat-protocol';
import { chatAdapters } from './adapters';
import type { ChatAdapterSession } from './adapters/adapter';
import { addHistory, readHistory, titleFromText, updateHistory, writeHistory } from './history';

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
        return (await readHistory(cwd)).sessions;
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
