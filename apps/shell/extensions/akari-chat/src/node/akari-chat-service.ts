import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, extname, isAbsolute, join } from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type { ChatAttachment } from '../common/chat-attachments';
import type { ChatEvent } from '../common/chat-events';
import type { ChatCapabilities } from '../common/chat-agent';
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
    private readonly historyTails = new Map<string, Promise<void>>();
    private readonly starts = new Map<string, AbortController>();
    private readonly cancelledStarts = new Set<string>();

    private async changeHistory(cwd: string, change: (history: Awaited<ReturnType<typeof readHistory>>) => ReturnType<typeof addHistory>): Promise<void> {
        const previous = this.historyTails.get(cwd) || Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            await writeHistory(cwd, change(await readHistory(cwd)));
        });
        this.historyTails.set(cwd, next);
        try { await next; } finally { if (this.historyTails.get(cwd) === next) this.historyTails.delete(cwd); }
    }

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
        token?: string;
    }) {
        if (options.token && this.cancelledStarts.delete(options.token)) throw new Error('start-cancelled');
        const controller = new AbortController();
        if (options.token) this.starts.set(options.token, controller);
        try { return await this.startSession(options, controller.signal); }
        finally { if (options.token) this.starts.delete(options.token); }
    }

    async cancelStart(token: string): Promise<void> {
        const controller = this.starts.get(token);
        if (controller) controller.abort();
        else {
            this.cancelledStarts.add(token);
            if (this.cancelledStarts.size > 100) this.cancelledStarts.delete(this.cancelledStarts.values().next().value!);
        }
    }

    private async startSession(options: {
        agent: string; cwd: string; resume?: string; model?: string; effort?: string;
        permission?: 'auto' | 'all'; token?: string;
    }, signal: AbortSignal) {
        const registered = await Promise.all(chatAdapters.map(async adapter => ({
            adapter,
            info: await adapter.info()
        })));
        const match = registered.find(item => item.info.id === options.agent);
        if (!match) {
            throw new Error('このパートナーはまだチャットに対応していません');
        }
        if (signal.aborted) throw new Error('start-cancelled');
        let session: ChatAdapterSession;
        try {
            if (!match.info.installed) throw new Error('not-installed');
            session = await match.adapter.start({
            cwd: options.cwd,
            resume: options.resume,
            model: options.model,
            effort: options.effort,
            permission: options.permission || 'auto', signal
            });
        } catch (cause) {
            if (signal.aborted) throw new Error('start-cancelled');
            const message = String(cause);
            const kind: Extract<ChatEvent, { type: 'error' }>['kind'] = !match.info.installed ? 'not-installed'
                : /auth|login|log in|sign in/i.test(message) ? 'auth' : 'other';
            const initialError: Extract<ChatEvent, { type: 'error' }> = {
                type: 'error', kind, message: kind === 'not-installed' ? match.info.installHint || message : message
            };
            const listeners = new Set<(event: ChatEvent) => void>();
            const capabilities: ChatCapabilities = { models: [], images: false, interrupt: false, clear: false,
                compact: false, resume: false, ask: false };
            session = {
                sessionRef: '', initialError, capabilities: async () => capabilities,
                onEvent: listener => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
                send: async () => { for (const listener of listeners) {
                    listener(initialError);
                    listener({ type: 'turn.end', ok: false, reason: kind });
                } },
                interrupt: async () => undefined, close: async () => undefined
            };
        }
        if (signal.aborted) { await session.close(); throw new Error('start-cancelled'); }
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
        return { chatId, capabilities: await session.capabilities(),
            ...(session.initialError ? { error: { kind: session.initialError.kind, message: session.initialError.message } } : {}) };
    }

    private async noteEvent(chatId: string, event: ChatEvent): Promise<void> {
        const current = this.sessions.get(chatId);
        if (!current || (event.type !== 'session' && event.type !== 'turn.end')) {
            return;
        }
        if (current.session.initialError && !current.session.sessionRef) return;
        if (!current.titleSet) return;
        await this.changeHistory(current.cwd, history => updateHistory(history, chatId, {
            sessionRef: current.session.sessionRef,
            updatedAt: new Date().toISOString(),
            ...(event.type === 'session' && event.model ? { model: event.model } : {})
        }));
    }

    async send(chatId: string, text: string, attachments: ChatAttachment[]): Promise<void> {
        const current = this.require(chatId);
        console.warn('[akari-chat] send', { chatId, state: 'received' });
        try {
            if (!current.titleSet && !(current.session.initialError && !current.session.sessionRef)) {
                const now = new Date().toISOString();
                const entry: ChatHistoryEntry = {
                    id: chatId, agent: current.agent, sessionRef: current.session.sessionRef,
                    title: titleFromText(text), createdAt: now, updatedAt: now
                };
                await this.changeHistory(current.cwd, history => addHistory(history, entry));
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
        await this.historyTails.get(cwd);
        return (await readHistory(cwd)).sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async renameHistory(cwd: string, historyId: string, title: string): Promise<void> {
        await this.changeHistory(cwd, history => renameHistory(history, historyId, title));
    }

    async removeHistory(cwd: string, historyId: string): Promise<void> {
        await this.changeHistory(cwd, history => removeHistory(history, historyId));
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

    async resume(cwd: string, historyId: string, token?: string) {
        const entry = (await this.listHistory(cwd)).find(item => item.id === historyId);
        if (!entry?.sessionRef) {
            throw new Error('この会話は開けません');
        }
        return this.start({ cwd, agent: entry.agent, resume: entry.sessionRef, model: entry.model, token });
    }

    private require(chatId: string): ActiveChat {
        const current = this.sessions.get(chatId);
        if (!current) {
            throw new Error('会話が見つかりません');
        }
        return current;
    }
}
