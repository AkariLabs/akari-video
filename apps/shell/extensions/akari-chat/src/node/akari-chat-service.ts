import { t } from '@akari-video/i18n';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'path';
import { injectable } from '@theia/core/shared/inversify';
import type { ChatAttachment } from '../common/chat-attachments';
import type { ChatEvent } from '../common/chat-events';
import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../common/chat-agent';
import type { AkariChatClient, AkariChatService, ChatHistoryEntry } from '../common/chat-protocol';
import { chatAdapters } from './adapters';
import { claudeConfiguredModel, claudeInitialCapabilities } from './adapters/claude-stream-json';
import type { ChatAdapterSession } from './adapters/adapter';
import { waitForTerminations } from './adapters/terminate';
import { addHistory, readHistory, readHistoryForWrite, titleFromText, updateHistory, writeHistory, renameHistory, removeHistory } from './history';
import { appendTranscript, loadTranscript, readDefaults, writeDefaults, type ChatDefaults } from './chat-storage';

type ActiveChat = {
    agent: string;
    cwd: string;
    session?: ChatAdapterSession;
    ready: Promise<ChatAdapterSession>;
    controller: AbortController;
    sendTail: Promise<void>;
    titleSet: boolean;
    model?: string;
    effort?: string;
    usage?: { usedTokens: number; contextWindow?: number };
    capabilities: ChatCapabilities;
    pendingTranscript?: { type: 'message.delta' | 'thinking.delta'; id: string; text: string };
};

const EMPTY_CAPABILITIES: ChatCapabilities = {
    models: [], images: false, interrupt: false, clear: false, compact: false, resume: false, ask: false
};

@injectable()
export class AkariChatServiceImpl implements AkariChatService {
    private client?: AkariChatClient;
    private disposed = false;
    private closeGeneration = 0;
    private readonly sessions = new Map<string, ActiveChat>();
    private readonly historyTails = new Map<string, Promise<void>>();
    private readonly transcriptTails = new Map<string, Promise<void>>();
    private readonly starts = new Map<string, { controller: AbortController; chatId?: string }>();
    private readonly cancelledStarts = new Set<string>();
    private readonly closing = new Set<Promise<void>>();
    private agentCache?: Promise<ChatAgentInfo[]>;
    private defaultsTail: Promise<void> = Promise.resolve();

    private async changeHistory(cwd: string, change: (history: Awaited<ReturnType<typeof readHistory>>) => ReturnType<typeof addHistory>): Promise<void> {
        cwd = await fs.realpath(cwd);
        const previous = this.historyTails.get(cwd) || Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            await writeHistory(cwd, change(await readHistoryForWrite(cwd)));
        });
        this.historyTails.set(cwd, next);
        try { await next; } finally { if (this.historyTails.get(cwd) === next) this.historyTails.delete(cwd); }
    }

    setClient(client: AkariChatClient): void { this.client = client; }

    private async validCwd(cwd: string): Promise<string> {
        if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error(t('chat.akariChatService.ui.invalidWorkingFolderLabel'));
        const canonical = await fs.realpath(cwd);
        const info = await fs.stat(canonical);
        if (!info.isDirectory()) throw new Error(t('chat.akariChatService.ui.invalidWorkingFolderLabel'));
        if ((await fs.stat(join(canonical, '.akari')).catch(() => undefined))?.isDirectory()) return canonical;
        for (let ancestor = canonical; ; ancestor = dirname(ancestor)) {
            const manifest = await fs.readFile(join(ancestor, '.akari', 'root.json'), 'utf8').catch(() => undefined);
            if (manifest !== undefined) {
                try {
                    if (JSON.parse(manifest)?.schema === 'creator-root/v1') return canonical;
                } catch { /* Continue searching ancestors. */ }
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) break;
        }
        throw new Error(t('chat.akariChatService.ui.selectAkariProjectWorkshopFolderMessage'));
    }

    private async validSourcePath(sourcePath: string): Promise<void> {
        if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) throw new Error(t('chat.akariChatService.ui.unableReadFileLocationError'));
        await fs.lstat(sourcePath);
        if (!(await fs.stat(sourcePath)).isFile()) throw new Error(t('chat.akariChatService.ui.selectRegularFileText'));
    }

    async closeAll(): Promise<void> {
        this.closeGeneration++;
        for (const current of this.sessions.values()) current.controller.abort();
        const ids = [...this.sessions.keys()];
        await Promise.allSettled(ids.map(id => this.close(id)));
        await Promise.allSettled([...this.closing]);
        await waitForTerminations();
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.client = undefined;
        await this.closeAll();
    }

    listAgents(): Promise<ChatAgentInfo[]> {
        if (!this.agentCache) this.agentCache = Promise.all(chatAdapters.map(adapter => adapter.info()));
        return this.agentCache;
    }

    refreshAgents(): Promise<ChatAgentInfo[]> {
        this.agentCache = undefined;
        return this.listAgents();
    }

    async getDefaults(agent: string): Promise<ChatDefaults> {
        await this.defaultsTail;
        return (await readDefaults())[agent] || {};
    }

    async setDefaults(agent: string, d: ChatDefaults): Promise<void> {
        const next = this.defaultsTail.catch(() => undefined).then(async () => {
            const all = await readDefaults();
            all[agent] = { ...d };
            await writeDefaults(all);
        });
        this.defaultsTail = next;
        await next;
    }

    private appendRecord(chatId: string, current: ActiveChat, event: ChatEvent): void {
        const previous = this.transcriptTails.get(chatId) || Promise.resolve();
        const next = previous.catch(() => undefined).then(() => appendTranscript(current.cwd, chatId, event));
        this.transcriptTails.set(chatId, next);
        void next.catch(() => console.warn('[akari-chat] transcript write failed', { chatId }));
    }

    private flushTranscript(chatId: string, current: ActiveChat): void {
        if (!current.pendingTranscript) return;
        this.appendRecord(chatId, current, current.pendingTranscript);
        current.pendingTranscript = undefined;
    }

    private record(chatId: string, event: ChatEvent): void {
        const current = this.sessions.get(chatId);
        if (!current) return;
        if (event.type === 'message.delta' || event.type === 'thinking.delta') {
            const pending = current.pendingTranscript;
            if (pending?.type === event.type && pending.id === event.id) pending.text += event.text;
            else {
                this.flushTranscript(chatId, current);
                current.pendingTranscript = { ...event };
            }
            return;
        }
        if (event.type === 'tool' && event.kind === 'think' && event.status === 'running' &&
            current.pendingTranscript?.type === 'thinking.delta' && current.pendingTranscript.id === event.id) return;
        this.flushTranscript(chatId, current);
        if (event.type !== 'commands.changed') this.appendRecord(chatId, current, event);
    }

    async loadTranscript(cwd: string, historyId: string) {
        cwd = await this.validCwd(cwd);
        const current = this.sessions.get(historyId);
        if (current?.cwd === cwd) this.flushTranscript(historyId, current);
        await this.transcriptTails.get(historyId);
        return loadTranscript(cwd, historyId);
    }

    private emit(chatId: string, event: ChatEvent): void {
        const current = this.sessions.get(chatId);
        if (!current) return;
        if (event.type === 'usage') current.usage = event;
        if (event.type === 'session' && event.model) current.model = event.model;
        if (event.type === 'model') { current.model = event.model; current.effort = event.effort; }
        if (event.type === 'capabilities') {
            current.capabilities = event.capabilities;
            if (!current.model && event.capabilities.currentModel) current.model = event.capabilities.currentModel;
        }
        this.record(chatId, event);
        try { this.client?.onEvent(chatId, event); }
        catch { console.warn('[akari-chat] client event delivery failed', { chatId, type: event.type }); }
        void this.noteEvent(chatId, event).catch(() => console.warn('[akari-chat] history update failed', { chatId }));
    }

    async start(options: {
        agent: string; cwd: string; resume?: string; model?: string; effort?: string;
        permission?: ChatAdapterPermission; token?: string;
    }): Promise<{ chatId: string; capabilities: ChatCapabilities; error?: { kind: Extract<ChatEvent, { type: 'error' }>['kind']; message: string } }> {
        if (this.disposed) throw new Error(t('chat.akariChatService.ui.connectionClosedMessage'));
        const generation = this.closeGeneration;
        options = { ...options, cwd: await this.validCwd(options.cwd) };
        if (options.token && this.cancelledStarts.delete(options.token)) throw new Error('start-cancelled');
        const agents = await this.listAgents();
        const info = agents.find(item => item.id === options.agent);
        const adapter = chatAdapters.find((item, index) => agents[index]?.id === options.agent);
        if (!info || !adapter) throw new Error(t('chat.akariChatService.ui.partnerNotYetAvailableChatMessage'));
        const defaults = await this.getDefaults(options.agent);
        if (options.token && this.cancelledStarts.delete(options.token)) throw new Error('start-cancelled');
        const model = options.model ?? defaults.model ??
            (options.agent === 'claude' ? await claudeConfiguredModel() : undefined);
        const effort = options.effort ?? defaults.effort;
        const existing = options.resume ? (await readHistory(options.cwd)).sessions.find(entry =>
            entry.sessionRef === options.resume && entry.agent === options.agent) : undefined;
        if (this.disposed || generation !== this.closeGeneration) throw new Error(t('chat.akariChatService.ui.connectionClosedMessage'));
        if (options.token && this.cancelledStarts.delete(options.token)) throw new Error('start-cancelled');
        const controller = new AbortController();
        const startEntry = { controller, chatId: undefined as string | undefined };
        if (options.token) this.starts.set(options.token, startEntry);
        if (controller.signal.aborted) {
            if (options.token) this.starts.delete(options.token);
            throw new Error('start-cancelled');
        }
        const chatId = existing?.id || `c-${randomUUID()}`;
        startEntry.chatId = chatId;
        const initialError = !info.installed ? { kind: 'not-installed' as const, message: info.installHint || 'not-installed' } : undefined;
        const ready = Promise.resolve().then(async () => {
            if (!info.installed) throw new Error('not-installed');
            const session = await adapter.start({ cwd: options.cwd, resume: options.resume, model, effort,
                permission: options.permission || 'auto', signal: controller.signal });
            if (controller.signal.aborted) { await session.close(); throw new Error('start-cancelled'); }
            const current = this.sessions.get(chatId);
            if (!current) { await session.close(); throw new Error('closed'); }
            current.session = session;
            session.onEvent(event => this.emit(chatId, event));
            if (!session.initialError && session.sessionRef) this.emit(chatId, { type: 'session', sessionId: session.sessionRef,
                agent: options.agent, model, cwd: options.cwd });
            if (session.initialError) this.emit(chatId, session.initialError);
            else this.emit(chatId, { type: 'ready' });
            void session.capabilities().then(capabilities => this.emit(chatId, { type: 'capabilities', capabilities }))
                .catch(() => this.emit(chatId, { type: 'capabilities', capabilities: EMPTY_CAPABILITIES }));
            return session;
        }).catch(error => {
            if (controller.signal.aborted) {
                this.sessions.delete(chatId);
                return {
                    sessionRef: '', capabilities: async () => EMPTY_CAPABILITIES,
                    onEvent: () => ({ dispose: () => undefined }), send: async () => { throw new Error('start-cancelled'); },
                    interrupt: async () => undefined, close: async () => undefined
                } satisfies ChatAdapterSession;
            }
            const missing = String(error).includes('akari-chat:resume-missing:');
            const message = initialError?.message || String(error).replace(/^Error: akari-chat:resume-missing:/, '');
            const kind = initialError?.kind || (/auth|login|log in|sign in/i.test(message) ? 'auth'
                : /rate.?limit|quota|too many requests|\b429\b/i.test(message) ? 'rate-limit' : 'other');
            this.emit(chatId, { type: 'error', kind, message,
                ...(options.resume ? { resumeFailure: missing ? 'missing' as const : 'startup' as const } : {}) });
            const failed: ChatAdapterSession = {
                sessionRef: '', initialError: { type: 'error', kind, message,
                    ...(options.resume ? { resumeFailure: missing ? 'missing' as const : 'startup' as const } : {}) }, capabilities: async () => EMPTY_CAPABILITIES,
                onEvent: () => ({ dispose: () => undefined }),
                send: async () => { this.emit(chatId, { type: 'turn.end', ok: false, reason: kind }); },
                interrupt: async () => undefined, close: async () => undefined
            };
            const current = this.sessions.get(chatId);
            if (current) current.session = failed;
            return failed;
        }).finally(() => { if (options.token) this.starts.delete(options.token); });
        const capabilities = options.agent === 'claude' ? claudeInitialCapabilities(model) : EMPTY_CAPABILITIES;
        this.sessions.set(chatId, { agent: options.agent, cwd: options.cwd, ready, controller, sendTail: Promise.resolve(),
            titleSet: !!options.resume, model, effort, capabilities });
        return { chatId, capabilities, ...(initialError ? { error: initialError } : {}) };
    }

    async cancelStart(token: string): Promise<void> {
        const start = this.starts.get(token);
        if (start) {
            start.controller.abort();
            if (start.chatId) {
                const current = this.sessions.get(start.chatId);
                this.sessions.delete(start.chatId);
                await current?.session?.close();
            }
        }
        else {
            this.cancelledStarts.add(token);
            if (this.cancelledStarts.size > 100) this.cancelledStarts.delete(this.cancelledStarts.values().next().value!);
        }
    }

    private async noteEvent(chatId: string, event: ChatEvent): Promise<void> {
        const current = this.sessions.get(chatId);
        if (!current || !current.titleSet || (current.session?.initialError && !current.session.sessionRef) ||
            (event.type !== 'session' && event.type !== 'turn.end' && event.type !== 'model')) return;
        await this.changeHistory(current.cwd, history => updateHistory(history, chatId, {
            sessionRef: current.session?.sessionRef || '', updatedAt: new Date().toISOString(),
            ...(current.model ? { model: current.model } : {})
        }));
    }

    async send(chatId: string, text: string, attachments: ChatAttachment[]): Promise<void> {
        const current = this.require(chatId);
        const next = current.sendTail.then(async () => {
            const session = await current.ready;
            if (this.sessions.get(chatId) !== current) throw new Error(t('chat.akariChatService.ui.conversationNotFoundError'));
            if (session.initialError && !session.sessionRef) {
                this.emit(chatId, { type: 'error', kind: session.initialError.kind,
                    message: t('chat.akariChatService.ui.errorCloseConversationTryLaunchingAgainMessage', { error: session.initialError.message }) });
                this.emit(chatId, { type: 'turn.end', ok: false, reason: session.initialError.kind });
                throw new Error('akari-chat:not-delivered');
            }
            this.record(chatId, { type: 'user', text, attachments });
            const skill = current.agent === 'claude' ? /^\/([\w:-]+)(?=\s|$)/.exec(text)?.[1] : undefined;
            const commands = skill ? await session.listCommands?.().catch(() => []) : undefined;
            if (skill && commands?.some(command => command.name === skill && command.kind === 'skill')) {
                this.emit(chatId, { type: 'tool', id: `skill-${randomUUID()}`, kind: 'skill',
                    title: t('chat.akariChatService.ui.usedSkillLabel', { skill: skill }), status: 'done' });
            }
            if (!current.titleSet && !(session.initialError && !session.sessionRef)) {
                const now = new Date().toISOString();
                const entry: ChatHistoryEntry = { id: chatId, agent: current.agent, sessionRef: session.sessionRef,
                    title: titleFromText(text), createdAt: now, updatedAt: now };
                await this.changeHistory(current.cwd, history => addHistory(history, entry));
                current.titleSet = true;
            }
            try { await session.send(text, attachments); }
            finally {
                await this.transcriptTails.get(chatId);
                await this.historyTails.get(current.cwd);
            }
        });
        current.sendTail = next.catch(() => undefined);
        return next;
    }

    async interrupt(chatId: string): Promise<void> { await (await this.require(chatId).ready).interrupt(); }

    async setModel(chatId: string, model: string): Promise<void> {
        const current = this.require(chatId);
        await (await current.ready).setModel?.(model);
        current.model = model;
        this.emit(chatId, { type: 'model', model, effort: current.effort });
    }

    async setEffort(chatId: string, effort: string): Promise<void> {
        const current = this.require(chatId);
        await (await current.ready).setEffort?.(effort);
        current.effort = effort;
        this.emit(chatId, { type: 'model', model: current.model, effort });
    }

    async listCommands(chatId: string) {
        return (await this.require(chatId).ready).listCommands?.() || [];
    }

    async contextInfo(chatId: string) {
        const current = this.require(chatId);
        return { usedTokens: current.usage?.usedTokens, contextWindow: current.usage?.contextWindow,
            model: current.model, canCompact: current.capabilities.compact };
    }

    async clear(chatId: string): Promise<void> { await (await this.require(chatId).ready).clear?.(); }
    async compact(chatId: string): Promise<void> { await (await this.require(chatId).ready).compact?.(); }

    async close(chatId: string): Promise<void> {
        const current = this.require(chatId);
        this.flushTranscript(chatId, current);
        this.sessions.delete(chatId);
        current.controller.abort();
        const closing = (async () => {
            await (await current.ready).close();
            await this.transcriptTails.get(chatId);
            await this.historyTails.get(current.cwd);
        })();
        this.closing.add(closing);
        void closing.finally(() => this.closing.delete(closing)).catch(() => undefined);
    }

    async listHistory(cwd: string): Promise<ChatHistoryEntry[]> {
        cwd = await this.validCwd(cwd);
        await this.historyTails.get(cwd);
        return (await readHistory(cwd)).sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async renameHistory(cwd: string, historyId: string, title: string): Promise<void> {
        cwd = await this.validCwd(cwd);
        await this.changeHistory(cwd, history => renameHistory(history, historyId, title));
    }

    async removeHistory(cwd: string, historyId: string): Promise<void> {
        cwd = await this.validCwd(cwd);
        await this.changeHistory(cwd, history => removeHistory(history, historyId));
    }

    async saveScreenRecording(cwd: string, data: string): Promise<string> {
        cwd = await this.validCwd(cwd);
        const match = /^data:video\/(mp4|webm);base64,/.exec(data);
        if (!match) throw new Error(t('chat.akariChatService.ui.unableReadRecordingFormatError'));
        const bytes = Buffer.from(data.slice(match[0].length), 'base64');
        if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error(t('chat.akariChatService.ui.recordingSizeExceedsLimitStatus'));
        const relative = `assets/screen-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${match[1]}`;
        await fs.mkdir(join(cwd, 'assets'), { recursive: true });
        await fs.writeFile(join(cwd, relative), bytes, { flag: 'wx' });
        return relative;
    }

    async importAttachment(cwd: string, sourcePath: string): Promise<string> {
        cwd = await this.validCwd(cwd);
        await this.validSourcePath(sourcePath);
        const info = await fs.stat(sourcePath);
        if (!info.isFile() || info.size > 500 * 1024 * 1024) throw new Error(t('chat.akariChatService.ui.unableImportFileError'));
        const original = basename(sourcePath);
        const stem = original.slice(0, -extname(original).length || undefined).replace(/[^\p{L}\p{N}._-]/gu, '_') || 'file';
        const relative = `assets/${stem}-${randomUUID().slice(0, 8)}${extname(original)}`;
        await fs.mkdir(join(cwd, 'assets'), { recursive: true });
        await fs.copyFile(sourcePath, join(cwd, relative));
        return relative;
    }

    async resolveAttachmentPath(cwd: string, sourcePath: string): Promise<{ path: string; inside: boolean; relative: string }> {
        cwd = await this.validCwd(cwd);
        await this.validSourcePath(sourcePath);
        const actual = await fs.realpath(sourcePath);
        const within = relative(cwd, actual);
        return { path: actual, inside: within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within), relative: within };
    }

    async resume(cwd: string, historyId: string, token?: string, permission?: ChatAdapterPermission) {
        const generation = this.closeGeneration;
        cwd = await this.validCwd(cwd);
        const entry = (await this.listHistory(cwd)).find(item => item.id === historyId);
        if (!entry?.sessionRef) {
            throw new Error(t('chat.akariChatService.ui.conversationCannotOpenedError'));
        }
        if (this.disposed || generation !== this.closeGeneration) throw new Error(t('chat.akariChatService.ui.connectionClosedMessage'));
        return this.start({ cwd, agent: entry.agent, resume: entry.sessionRef, model: entry.model, token, permission });
    }

    private require(chatId: string): ActiveChat {
        const current = this.sessions.get(chatId);
        if (!current) {
            throw new Error(t('chat.akariChatService.ui.conversationNotFoundError'));
        }
        return current;
    }
}
