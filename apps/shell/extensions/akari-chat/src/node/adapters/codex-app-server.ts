import { matchesLocalizedValue } from '../../common/chat-localized-match';
import { t } from '@akari-video/i18n';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { reapChildGroup, terminateChild } from './terminate';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { homedir } from 'os';
import { basename, extname, isAbsolute, join, relative } from 'path';
import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../../common/chat-agent';
import type { ChatAttachment } from '../../common/chat-attachments';
import type { ChatEvent } from '../../common/chat-events';
import type { ChatAdapter, ChatAdapterSession } from './adapter';
import { projectSkills } from './project-skills';
import { describeAttachments } from '../../common/chat-attachments';

type RpcMessage = { id?: number; method?: string; params?: any; result?: any; error?: { message?: string; code?: number } };
type PendingRpc = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; method: string; params: unknown };
type Question = { id: string; question: string; options?: { label: string; description?: string }[] | null };
type WaitingAnswer = { id: number; method: string; params: any; questions: Question[]; answers: Record<string, { answers: string[] }>; index: number };
type TurnWait = { resolve: () => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout>; turnId?: string };
type TurnError = { message?: string; codexErrorInfo?: string | Record<string, unknown> | null };

const authMessage = () => t('chat.codexAppServer.ui.logCodexText');
const AUTH_PATTERN = /not logged in|not authenticated|authentication required|unauthorized|login required|log in to|sign in to|401\b/i;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function classifyTurnError(error: TurnError | undefined): { kind: 'auth' | 'rate-limit' | 'other'; message: string } {
    const raw = error?.message || '';
    let message = raw;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.error?.message === 'string') {
            message = parsed.error.message;
        }
    } catch { /* Ordinary error text is already readable. */ }
    const info = error?.codexErrorInfo;
    const code = typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] : '';
    if (code === 'unauthorized' || AUTH_PATTERN.test(message)) {
        return { kind: 'auth', message: authMessage() };
    }
    if (['usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded'].includes(code || '')) {
        return { kind: 'rate-limit', message: message || t('chat.codexAppServer.ui.codexUsageLimitReachedLabel') };
    }
    return { kind: 'other', message: message || t('chat.codexAppServer.ui.codexProcessingFailedError') };
}

export function codexCandidates(home = homedir(), pathValue = process.env.PATH || ''): string[] {
    const separator = process.platform === 'win32' ? ';' : ':';
    const executable = process.platform === 'win32' ? 'codex.exe' : 'codex';
    return [...new Set([
        ...pathValue.split(separator),
        join(home, '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin'
    ].filter(Boolean).map(directory => join(directory, executable)))];
}

export async function findCodex(candidates = codexCandidates()): Promise<string | undefined> {
    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        } catch {
            // Try the next installation location.
        }
    }
    return undefined;
}

function displayPath(path: string, cwd: string): string {
    if (!isAbsolute(path)) {
        return path;
    }
    const inside = relative(cwd, path);
    return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
}

type FileChange = { path: string; diff?: string; kind?: { type: 'add' | 'delete' | 'update' } };
type CommandAction = { type: 'read' | 'listFiles' | 'search' | 'unknown'; command: string; name?: string; path?: string | null; query?: string | null };
type ToolEvent = Extract<ChatEvent, { type: 'tool' }>;

function fileLines(content: string): string[] {
    if (!content) { return []; }
    const lines = content.split('\n');
    if (lines[lines.length - 1] === '') { lines.pop(); }
    return lines;
}

function diffDetails(changes: FileChange[], cwd: string): ToolEvent['detail'] {
    let added = 0;
    let removed = 0;
    const patches = changes.map(change => {
        const diff = change.diff || '';
        if (change.kind?.type === 'add' || change.kind?.type === 'delete') {
            const lines = fileLines(diff);
            if (change.kind.type === 'add') { added += lines.length; }
            else { removed += lines.length; }
            return lines.map(line => `${change.kind?.type === 'add' ? '+' : '-'}${line}`).join('\n');
        }
        const lines = diff.split('\n');
        added += lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
        removed += lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
        return diff;
    }).filter(Boolean);
    const patch = patches.join('\n');
    return {
        path: changes[0] ? displayPath(changes[0].path, cwd) : undefined,
        diff: {
            added,
            removed,
            ...(patch ? { patch } : {})
        }
    };
}

function shellCommand(command: string): string {
    let text = command.replace(/^(?:\/bin\/)?(?:zsh|bash|sh) -lc\s+/, '').trim();
    if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
        text = text.slice(1, -1);
    }
    return text;
}

function commandPresentation(item: { command?: string; commandActions?: CommandAction[] }, cwd: string,
    completed: boolean): { kind: ToolEvent['kind']; title: string; detail: ToolEvent['detail'] } {
    const actions = item.commandActions || [];
    const command = actions.length ? actions.map(action => shellCommand(action.command)).join(' && ')
        : shellCommand(item.command || '');
    if (actions.length === 1 && actions[0].type === 'read') {
        const action = actions[0];
        const path = action.path ? displayPath(action.path, cwd) : action.name || '';
        const skill = path.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/);
        if (skill) {
            return { kind: 'skill', title: `${completed ? t('chat.codexAppServer.ui.usedLabel') : t('chat.codexAppServer.ui.usingLabel')} ${skill[1]}`,
                detail: { command, path } };
        }
        const label = isAbsolute(path) ? action.name || path : path || action.name || '';
        return { kind: 'read', title: `${completed ? t('chat.codexAppServer.ui.readLabel') : t('chat.codexAppServer.ui.readingLabel')} ${label}`.trim(),
            detail: { command, path: path || undefined } };
    }
    if (actions.length === 1 && actions[0].type === 'search') {
        return { kind: 'search', title: `${completed ? t('chat.codexAppServer.ui.searchedLabel') : t('chat.codexAppServer.ui.searchingStatus')} ${actions[0].query || command}`.trim(),
            detail: { command } };
    }
    return { kind: 'command', title: `${completed ? t('chat.codexAppServer.ui.ranLabel') : t('chat.codexAppServer.ui.runningStatus')} ${command}`.trim(),
        detail: { command } };
}

export function finishedTitle(title: string): string {
    const labels = [
        ['chat.codexAppServer.ui.runningStatus', 'chat.codexAppServer.ui.ranLabel'],
        ['chat.codexAppServer.ui.writingStatus', 'chat.codexAppServer.ui.wroteLabel'],
        ['chat.codexAppServer.ui.searchingStatus', 'chat.codexAppServer.ui.searchedLabel'],
        ['chat.codexAppServer.ui.usingLabel', 'chat.codexAppServer.ui.usedLabel'],
        ['chat.codexAppServer.ui.readingLabel', 'chat.codexAppServer.ui.readLabel'],
        ['chat.codexAppServer.ui.thinkingStatus', 'chat.codexAppServer.ui.thoughtLabel']
    ];
    for (const [present, complete] of labels) {
        for (const language of ['ja', 'en'] as const) {
            const prefix = t(present, {}, language);
            if (title.startsWith(prefix)) return t(complete) + title.slice(prefix.length);
        }
    }
    return title;
}

export class CodexNotificationParser {
    private readonly messages = new Set<string>();
    private readonly messageDeltas = new Set<string>();
    private readonly tools = new Map<string, Extract<ChatEvent, { type: 'tool' }>>();
    private readonly toolTurns = new Map<string, string>();
    private readonly starts = new Map<string, number>();
    private readonly completedMessages = new Set<string>();
    private readonly reportedErrors = new Map<string, 'auth' | 'rate-limit' | 'other'>();

    constructor(private readonly cwd: string, private readonly emit: (event: ChatEvent) => void) { }

    private messageStart(id: string): void {
        if (!this.messages.has(id)) {
            this.messages.add(id);
            this.emit({ type: 'message.start', id, role: 'assistant' });
        }
    }

    private tool(id: string, kind: Extract<ChatEvent, { type: 'tool' }>['kind'], title: string,
        status: 'running' | 'done' | 'error', detail?: Extract<ChatEvent, { type: 'tool' }>['detail'], durationMs?: number): void {
        const prior = this.tools.get(id);
        const event: Extract<ChatEvent, { type: 'tool' }> = {
            type: 'tool', id, kind: prior?.status !== 'running' && prior ? prior.kind : kind,
            title: (prior?.status !== 'running' && prior ? prior.title : title).replace(/\s+/g, ' ').trim().slice(0, 160),
            status: prior?.status !== 'running' && prior ? prior.status : status, detail, durationMs
        };
        this.tools.set(id, event);
        this.emit(event);
    }

    accept(message: RpcMessage): void {
        const method = message.method;
        const params = message.params || {};
        const item = params.item || {};
        const id = String(params.itemId || item.id || '');
        if (method?.startsWith('item/') && id && params.turnId) {
            this.toolTurns.set(id, params.turnId);
        }
        if (method === 'item/agentMessage/delta') {
            this.messageStart(id);
            if (params.delta) {
                this.messageDeltas.add(id);
                this.emit({ type: 'message.delta', id, text: params.delta });
            }
        } else if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
            if (params.delta) this.emit({ type: 'thinking.delta', id, text: params.delta });
            const prior = this.tools.get(id);
            const text = (prior?.detail?.text || '') + (params.delta || '');
            if (text) { this.tool(id, 'think', t('chat.codexAppServer.ui.thinkingStatus'), 'running', { text }); }
        } else if (method === 'item/commandExecution/outputDelta') {
            const prior = this.tools.get(id);
            this.tool(id, prior?.kind || 'command', prior?.title || t('chat.codexAppServer.ui.runningStatus'), prior?.status || 'running', {
                ...prior?.detail,
                output: (prior?.detail?.output || '') + (params.delta || '')
            });
        } else if (method === 'item/fileChange/patchUpdated') {
            const detail = diffDetails(params.changes || [], this.cwd);
            this.tool(id, 'write', t('chat.codexAppServer.ui.writingPathStatus', { path: detail?.path || t('chat.codexAppServer.ui.fileLabel') }), 'running', detail);
        } else if (method === 'item/fileChange/outputDelta') {
            const prior = this.tools.get(id);
            this.tool(id, 'write', prior?.title || t('chat.codexAppServer.ui.writingStatus'), prior?.status || 'running', {
                ...prior?.detail, output: (prior?.detail?.output || '') + (params.delta || '')
            });
        } else if (method === 'item/started') {
            this.starts.set(id, params.startedAtMs || Date.now());
            if (item.type === 'agentMessage') {
                this.messageStart(id);
            } else if (item.type === 'commandExecution') {
                const presentation = commandPresentation(item, this.cwd, false);
                this.tool(id, presentation.kind, presentation.title, 'running', { ...presentation.detail, output: '' });
            } else if (item.type === 'fileChange') {
                const detail = diffDetails(item.changes || [], this.cwd);
                this.tool(id, 'write', t('chat.codexAppServer.ui.writingPathStatus', { path: detail?.path || t('chat.codexAppServer.ui.fileLabel') }), 'running', detail);
            } else if (item.type === 'webSearch') {
                this.tool(id, 'web', t('chat.codexAppServer.ui.searchingQueryStatus', { query: item.query || '' }).trim(), 'running');
            } else if (item.type === 'mcpToolCall') {
                this.tool(id, 'other', t('chat.codexAppServer.ui.usingServerToolLabel', { server: item.server || 'MCP', tool: item.tool || '' }).trim(), 'running');
            } else if (item.type === 'dynamicToolCall') {
                this.tool(id, 'other', t('chat.codexAppServer.ui.usingToolLabel', { tool: item.tool || t('chat.codexAppServer.ui.toolLabel') }), 'running');
            }
        } else if (method === 'item/completed') {
            const duration = item.durationMs ?? (this.starts.has(id) ? (params.completedAtMs || Date.now()) - this.starts.get(id)! : undefined);
            if (item.type === 'agentMessage') {
                this.messageStart(id);
                if (!this.completedMessages.has(id)) {
                    if (!this.messageDeltas.has(id) && item.text) {
                        this.emit({ type: 'message.delta', id, text: item.text });
                    }
                    this.emit({ type: 'message.end', id });
                    this.completedMessages.add(id);
                }
            } else if (item.type === 'reasoning') {
                const text = this.tools.get(id)?.detail?.text || (item.summary || []).join('\n');
                if (text) { this.tool(id, 'think', t('chat.codexAppServer.ui.thoughtLabel'), 'done', { text }, duration); }
            } else if (item.type === 'commandExecution') {
                const prior = this.tools.get(id);
                const presentation = commandPresentation(item, this.cwd, true);
                this.tool(id, presentation.kind, presentation.title,
                    item.status !== 'completed' || (typeof item.exitCode === 'number' && item.exitCode !== 0) ? 'error' : 'done', {
                        ...presentation.detail,
                        output: item.aggregatedOutput ?? prior?.detail?.output ?? ''
                    }, duration);
            } else if (item.type === 'fileChange') {
                const detail = diffDetails(item.changes || [], this.cwd);
                this.tool(id, 'write', t('chat.codexAppServer.ui.wrotePathLabel', { path: detail?.path || t('chat.codexAppServer.ui.fileLabel') }),
                    item.status === 'completed' ? 'done' : 'error', detail, duration);
                const files = (item.changes || []).map((change: { path: string }) => {
                    const path = displayPath(change.path, this.cwd);
                    const extension = extname(path).toLowerCase();
                    const kind = ['.mp4', '.mov', '.webm'].includes(extension) ? 'video' as const
                        : IMAGE_EXTENSIONS.has(extension) ? 'image' as const
                            : ['.html', '.htm'].includes(extension) ? 'html' as const
                                : ['.wav', '.mp3', '.m4a'].includes(extension) ? 'audio' as const : 'other' as const;
                    return { path, label: basename(path), kind };
                });
                if (files.length && item.status === 'completed') {
                    this.emit({ type: 'files', files });
                }
            } else if (item.type === 'webSearch' || item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
                const prior = this.tools.get(id);
                const kind = item.type === 'webSearch' ? 'web' : 'other';
                const title = kind === 'web' ? t('chat.codexAppServer.ui.searchedQueryLabel', { query: item.query || '' }).trim()
                    : t('chat.codexAppServer.ui.usedServerToolLabel', { server: item.server || '', tool: item.tool || '' }).trim();
                this.tool(id, kind, title, item.status === 'failed' ? 'error' : 'done', prior?.detail, duration);
            }
        } else if (method === 'item/tool/requestUserInput') {
            const question = params.questions?.[0] as Question | undefined;
            if (question) {
                this.emit({ type: 'ask', id: `${message.id ?? params.itemId}-${params.questionIndex || 0}`,
                    question: question.question, options: question.options?.length ? question.options : [{ label: t('chat.codexAppServer.ui.yesLabel') }, { label: t('chat.codexAppServer.ui.noLabel') }] });
            }
        } else if (method === 'thread/tokenUsage/updated') {
            const usage = params.tokenUsage || {};
            const usedTokens = usage.last?.totalTokens ?? usage.total?.totalTokens;
            if (typeof usedTokens === 'number') {
                this.emit({ type: 'usage', usedTokens,
                    ...(typeof usage.modelContextWindow === 'number' ? { contextWindow: usage.modelContextWindow } : {}) });
            }
        } else if (method === 'error') {
            if (!params.willRetry && !this.reportedErrors.has(params.turnId)) {
                const failure = classifyTurnError(params.error);
                this.emit({ type: 'error', ...failure });
                this.reportedErrors.set(params.turnId, failure.kind);
            }
        } else if (method === 'turn/completed') {
            const turn = params.turn || {};
            for (const [toolId, running] of this.tools) {
                if (running.status === 'running' && (!this.toolTurns.has(toolId) || this.toolTurns.get(toolId) === turn.id)) {
                    this.tool(toolId, running.kind, finishedTitle(running.title),
                        turn.status === 'completed' ? 'done' : 'error', running.detail, running.durationMs);
                }
            }
            const failure = classifyTurnError(turn.error);
            if (turn.status === 'failed' && !this.reportedErrors.has(turn.id)) {
                this.emit({ type: 'error', ...failure });
                this.reportedErrors.set(turn.id, failure.kind);
            }
            const kind = this.reportedErrors.get(turn.id) || failure.kind;
            this.emit({ type: 'turn.end', ok: turn.status === 'completed',
                ...(turn.status === 'completed' ? {} : {
                    reason: turn.status === 'interrupted' ? 'interrupted' : kind === 'other' ? 'failed' : kind
                }) });
        }
    }
}

export class CodexAppServerAdapter implements ChatAdapter {
    constructor(private readonly executableOverride?: string, private readonly idleTimeoutMs = 300000) { }

    async info(): Promise<ChatAgentInfo> {
        const executable = this.executableOverride || await findCodex();
        if (!executable) {
            return { id: 'codex', name: 'Codex', installed: false, transport: 'codex-app-server', permissionModes: ['automatic', 'checkpoints', 'every'],
                installHint: t('chat.codexAppServer.ui.installCodexMessage') };
        }
        return { id: 'codex', name: 'Codex', installed: true, transport: 'codex-app-server', permissionModes: ['automatic', 'checkpoints', 'every'],
            installHint: t('chat.codexAppServer.ui.installCodexMessage') };
    }

    async start(opts: { cwd: string; resume?: string; model?: string; effort?: string; permission: ChatAdapterPermission; signal?: AbortSignal }): Promise<ChatAdapterSession> {
        const executable = this.executableOverride || await findCodex();
        if (!executable) {
            throw new Error('not-installed');
        }
        const session = new CodexSession(executable, opts, this.idleTimeoutMs);
        const cancel = (): void => { void session.close(); };
        opts.signal?.addEventListener('abort', cancel, { once: true });
        try {
            await session.initialize();
            if (opts.signal?.aborted) throw new Error('start-cancelled');
            return session;
        } catch (error) {
            await session.close();
            throw error;
        } finally {
            opts.signal?.removeEventListener('abort', cancel);
        }
    }
}

class CodexSession implements ChatAdapterSession {
    private child?: ChildProcessWithoutNullStreams;
    private readonly listeners = new Set<(event: ChatEvent) => void>();
    private readonly pendingRpc = new Map<number, PendingRpc>();
    private readonly parser: CodexNotificationParser;
    private nextId = 1;
    private ref = '';
    private turnId = '';
    private turnWait?: TurnWait;
    private processingTurnId?: string;
    private readonly earlyTurnEnds = new Map<string, Extract<ChatEvent, { type: 'turn.end' }>>();
    private sendTail: Promise<void> = Promise.resolve();
    private waitingAnswer?: WaitingAnswer;
    private interrupted = false;
    private closed = false;
    private stderr = '';
    private models: ChatCapabilities['models'] = [];
    private efforts: string[] = [];
    private readonly supportedModels = new Map<string, Set<string>>();
    private catalogLoaded = false;
    private actualModel?: string;
    private publishedModel?: string;
    private unauthenticated = false;

    constructor(private readonly executable: string,
        private readonly opts: { cwd: string; resume?: string; model?: string; effort?: string; permission: ChatAdapterPermission },
        private readonly idleTimeoutMs: number) {
        this.ref = opts.resume || '';
        this.parser = new CodexNotificationParser(opts.cwd, event => this.publish(event));
    }

    get sessionRef(): string { return this.ref; }
    get initialError(): Extract<ChatEvent, { type: 'error' }> | undefined {
        return this.unauthenticated ? { type: 'error', kind: 'auth', message: authMessage() } : undefined;
    }

    private publish(event: ChatEvent): void {
        if (event.type === 'turn.end') {
            const waiting = this.turnWait;
            const eventTurnId = this.processingTurnId;
            if (!eventTurnId || (waiting?.turnId && waiting.turnId === eventTurnId)) {
                this.finishTurn(event);
            } else if (waiting && !waiting.turnId) {
                this.earlyTurnEnds.set(eventTurnId, event);
            } else if (this.turnId === eventTurnId) {
                this.turnId = '';
                this.waitingAnswer = undefined;
            }
        }
        for (const listener of this.listeners) {
            try { listener(event); } catch { /* The UI cannot block the stream. */ }
        }
    }

    private finishTurn(event: Extract<ChatEvent, { type: 'turn.end' }>): void {
        this.turnId = '';
        const waiting = this.turnWait;
        this.turnWait = undefined;
        this.waitingAnswer = undefined;
        if (waiting) {
            clearTimeout(waiting.timer);
            if (event.ok || event.reason === 'interrupted') { waiting.resolve(); }
            else { waiting.reject(new Error(event.reason || 'turn failed')); }
        }
    }

    private refreshTurnWait(): void {
        const waiting = this.turnWait;
        if (!waiting) { return; }
        clearTimeout(waiting.timer);
        waiting.timer = setTimeout(() => {
            if (this.turnWait !== waiting) { return; }
            this.publish({ type: 'error', kind: 'other', message: t('chat.codexAppServer.ui.codexDidNotRespondMessage') });
            this.publish({ type: 'turn.end', ok: false, reason: 'timeout' });
        }, this.idleTimeoutMs);
        waiting.timer.unref();
    }

    onEvent(listener: (event: ChatEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    private fail(message: string): void {
        const auth = AUTH_PATTERN.test(message + this.stderr);
        if (this.turnWait || this.turnId || this.waitingAnswer) {
            if (!this.interrupted) {
                this.publish({ type: 'error', kind: auth ? 'auth' : 'crashed', message: auth ? authMessage() : message });
            }
            this.publish({ type: 'turn.end', ok: false, reason: this.interrupted ? 'interrupted' : auth ? 'auth' : 'crashed' });
        }
        for (const [id, pending] of this.pendingRpc) {
            clearTimeout(pending.timer);
            pending.reject(new Error(message));
            this.pendingRpc.delete(id);
        }
    }

    private launch(): void {
        const child = spawn(this.executable, ['app-server', '--stdio'], {
            cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32'
        });
        reapChildGroup(child);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        this.child = child;
        this.stderr = '';
        let buffer = '';
        child.stdout.on('data', chunk => {
            if (this.child !== child) { return; }
            buffer += chunk;
            let end: number;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (!line) { continue; }
                try { this.receive(JSON.parse(line)); } catch { /* Ignore one malformed server line. */ }
            }
        });
        child.stderr.on('data', chunk => {
            if (this.child === child) { this.stderr = (this.stderr + chunk).slice(-4000); }
        });
        child.stdin.on('error', error => {
            if (this.child === child) { this.fail(t('chat.codexAppServer.ui.failedSendCodexError', { error: error.message })); }
        });
        child.on('error', error => {
            if (this.child === child) { this.fail(t('chat.codexAppServer.ui.couldNotStartCodexError', { error: error.message })); this.child = undefined; }
        });
        child.on('close', code => {
            if (this.child === child) { this.fail(t('chat.codexAppServer.ui.codexHasEndedCodeLabel', { code: String(code) })); this.child = undefined; }
        });
    }

    private write(message: RpcMessage): void {
        const child = this.child;
        if (!child || !child.stdin.writable) { throw new Error(t('chat.codexAppServer.ui.codexInputClosedLabel')); }
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    }

    private rpc(method: string, params: unknown, timeoutMs = 30000): Promise<any> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRpc.delete(id);
                reject(new Error(`${method}: timeout`));
            }, timeoutMs);
            timer.unref();
            this.pendingRpc.set(id, { resolve, reject, timer, method, params });
            try { this.write({ id, method, params }); } catch (error) {
                clearTimeout(timer);
                this.pendingRpc.delete(id);
                reject(error);
            }
        });
    }

    private receive(message: RpcMessage): void {
        if (message.method && message.id !== undefined) {
            this.refreshForMessage(message);
            this.serverRequest(message);
        } else if (message.method) {
            this.refreshForMessage(message);
            this.processingTurnId = message.method === 'turn/completed'
                ? message.params?.turn?.id : message.params?.turnId;
            try {
                this.parser.accept(message);
            } finally {
                this.processingTurnId = undefined;
            }
        } else if (message.id !== undefined) {
            const pending = this.pendingRpc.get(message.id);
            if (!pending) { return; }
            this.pendingRpc.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) { pending.reject(new Error(`${pending.method === 'thread/resume'
                ? 'akari-chat:resume-missing:' : ''}${message.error.message || 'JSON-RPC error'}`)); }
            else {
                const requestedModel = pending.method === 'turn/start' ? (pending.params as { model?: string }).model : undefined;
                const model = pending.method === 'turn/start' ? requestedModel || this.actualModel : undefined;
                if (model && model !== this.publishedModel) {
                    this.actualModel = model;
                    this.publishedModel = model;
                    this.publish({ type: 'session', sessionId: this.ref, agent: 'codex', model, cwd: this.opts.cwd });
                }
                pending.resolve(message.result);
            }
        }
    }

    private refreshForMessage(message: RpcMessage): void {
        const waiting = this.turnWait;
        if (!waiting || message.params?.threadId !== this.ref) { return; }
        const turnId = message.method === 'turn/started' || message.method === 'turn/completed'
            ? message.params?.turn?.id : message.params?.turnId;
        if (turnId && (!waiting.turnId || waiting.turnId === turnId)) {
            this.refreshTurnWait();
        }
    }

    private ask(waiting: WaitingAnswer): void {
        if (this.turnWait && waiting.params?.turnId) {
            this.turnId = waiting.params.turnId;
            this.turnWait.turnId = waiting.params.turnId;
        }
        const question = waiting.questions[waiting.index];
        if (!question) {
            this.write({ id: waiting.id, result: { answers: waiting.answers } });
            this.waitingAnswer = undefined;
            return;
        }
        this.waitingAnswer = waiting;
        if (waiting.method === 'item/tool/requestUserInput') {
            this.parser.accept({ id: waiting.id, method: waiting.method,
                params: { ...waiting.params, questions: [question], questionIndex: waiting.index } });
        } else {
            this.publish({ type: 'ask', id: `${waiting.id}-${waiting.index}`, question: question.question,
                options: question.options?.length ? question.options : [{ label: t('chat.codexAppServer.ui.yesLabel') }, { label: t('chat.codexAppServer.ui.noLabel') }] });
        }
        // The current UI serializes send() calls. Release it so the answer can be sent.
        if (this.turnWait) {
            const turn = this.turnWait;
            this.turnWait = undefined;
            clearTimeout(turn.timer);
            turn.resolve();
        }
    }

    private serverRequest(message: RpcMessage): void {
        const method = message.method || '';
        const id = message.id!;
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
            this.write({ id, result: { decision: 'accept' } });
        } else if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
            this.write({ id, result: { decision: 'approved' } });
        } else if (method === 'item/tool/requestUserInput') {
            const questions = (message.params?.questions || []) as Question[];
            this.ask({ id, method, params: message.params, questions, answers: {}, index: 0 });
        } else if (method === 'item/permissions/requestApproval') {
            this.ask({ id, method, params: message.params,
                questions: [{ id: 'permission', question: message.params?.reason || t('chat.codexAppServer.ui.doWantAllowAdditionalPermissionsMessage'),
                    options: [{ label: t('chat.codexAppServer.ui.allowLabel') }, { label: t('chat.codexAppServer.ui.denyLabel') }] }], answers: {}, index: 0 });
        } else if (method === 'mcpServer/elicitation/request') {
            const schema = message.params?.requestedSchema;
            const form = message.params?.mode !== 'url';
            const question = `${message.params?.message || t('chat.codexAppServer.ui.answerMCPConfirmationText')}${form ? t('chat.codexAppServer.ui.enterMultipleItemsJsonText') : ` ${message.params?.url || ''}`}`.trim();
            this.ask({ id, method, params: message.params,
                questions: [{ id: 'elicitation', question,
                    options: form && Object.keys(schema?.properties || {}).length ? [{ label: t('chat.codexAppServer.ui.denyLabel') }] : [{ label: t('chat.codexAppServer.ui.allowLabel') }, { label: t('chat.codexAppServer.ui.denyLabel') }] }],
                answers: {}, index: 0 });
        } else {
            this.write({ id, error: { code: -32601, message: `Method not supported: ${method}` } });
        }
    }

    async initialize(): Promise<void> {
        this.launch();
        await this.rpc('initialize', { clientInfo: { name: 'akari-chat', version: '0.1.0' }, capabilities: null });
        this.write({ method: 'initialized', params: {} });
        const account = await this.rpc('account/read', { refreshToken: false }).catch(() => undefined);
        this.unauthenticated = !!(account?.requiresOpenaiAuth && !account.account);
        await this.loadModelCatalog();
        await this.openThread(!!this.ref);
    }

    private async loadModelCatalog(): Promise<void> {
        try {
            const data: any[] = [];
            let cursor: string | null = null;
            do {
                const page = await this.rpc('model/list', cursor ? { cursor } : {});
                if (!Array.isArray(page.data)) { throw new Error('invalid model catalog'); }
                data.push(...page.data);
                cursor = page.nextCursor || null;
            } while (cursor);
            this.catalogLoaded = true;
            this.supportedModels.clear();
            for (const model of data) {
                const id = model.model || model.id;
                if (typeof id === 'string') {
                    this.supportedModels.set(id, new Set((model.supportedReasoningEfforts || [])
                        .map((option: any) => String(option.reasoningEffort))));
                }
            }
            this.models = data.filter((model: any) => !model.hidden)
                .map((model: any) => ({ id: model.model || model.id, label: model.displayName || model.model || model.id,
                    ...(model.description ? { description: model.description } : {}) }));
            this.efforts = [...new Set([...this.supportedModels.values()].flatMap(options => [...options]))];
        } catch {
            this.catalogLoaded = false;
            this.supportedModels.clear();
            this.models = [];
            this.efforts = [];
        }
    }

    private validModel(model: string | undefined): string | undefined {
        return model && (!this.catalogLoaded || this.supportedModels.has(model)) ? model : undefined;
    }

    private validEffort(effort: string | undefined, model: string | undefined): string | undefined {
        if (!effort || !this.catalogLoaded) { return effort; }
        const supported = model && this.supportedModels.get(model);
        return (supported || new Set(this.efforts)).has(effort) ? effort : undefined;
    }

    private async openThread(resume: boolean): Promise<void> {
        const permission = this.opts.permission === 'all'
            ? { approvalPolicy: 'never', sandbox: 'danger-full-access' }
            : this.opts.permission === 'every' ? { approvalPolicy: 'untrusted', sandbox: 'workspace-write' }
                : this.opts.permission === 'checkpoints' ? { approvalPolicy: 'on-request', sandbox: 'workspace-write' }
                    : { approvalPolicy: 'on-request', approvalsReviewer: 'guardian_subagent', sandbox: 'workspace-write' };
        const model = this.validModel(this.opts.model);
        const result = await this.rpc(resume ? 'thread/resume' : 'thread/start', {
            ...(resume ? { threadId: this.ref } : {}), cwd: this.opts.cwd,
            ...(model ? { model } : {}), ...permission
        });
        this.ref = result.thread.id;
        this.actualModel = result.model || model;
        this.publishedModel = this.listeners.size ? this.actualModel : undefined;
        this.publish({ type: 'session', sessionId: this.ref, agent: 'codex', model: this.actualModel, cwd: this.opts.cwd });
    }

    async capabilities(): Promise<ChatCapabilities> {
        return { models: this.models, currentModel: this.actualModel,
            ...(this.efforts.length ? { efforts: this.efforts } : {}),
            images: true, interrupt: true, clear: true, compact: true, resume: true, ask: true };
    }

    private async answer(text: string): Promise<void> {
        const waiting = this.waitingAnswer;
        if (!waiting) { return; }
        const question = waiting.questions[waiting.index];
        if (waiting.method === 'item/tool/requestUserInput') {
            waiting.answers[question.id] = { answers: [text] };
            waiting.index++;
            this.ask(waiting);
        } else if (waiting.method === 'item/permissions/requestApproval') {
            const requested = waiting.params.permissions || {};
            const permissions = matchesLocalizedValue(text, 'chat.codexAppServer.ui.allowLabel') ? {
                ...(requested.network ? { network: requested.network } : {}),
                ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {})
            } : {};
            this.write({ id: waiting.id, result: { permissions, scope: 'turn' } });
            this.waitingAnswer = undefined;
        } else {
            const schema = waiting.params?.requestedSchema;
            const fields = Object.keys(schema?.properties || {});
            let content: unknown = null;
            if (!matchesLocalizedValue(text, 'chat.codexAppServer.ui.denyLabel') && waiting.params?.mode !== 'url' && fields.length) {
                try { content = JSON.parse(text); } catch {
                    content = fields.length === 1 ? { [fields[0]]: text } : null;
                }
                if (!content || typeof content !== 'object' || Array.isArray(content)) {
                    this.ask(waiting);
                    return;
                }
            }
            this.write({ id: waiting.id, result: { action: matchesLocalizedValue(text, 'chat.codexAppServer.ui.denyLabel') ? 'decline' : 'accept', content, _meta: null } });
            this.waitingAnswer = undefined;
        }
        if (this.waitingAnswer) { return; }
        await this.waitForTurn();
    }

    private waitForTurn(startTimer = true): Promise<void> {
        return new Promise((resolve, reject) => {
            this.turnWait = { resolve, reject,
                ...(this.turnId ? { turnId: this.turnId } : {}) };
            if (startTimer) { this.refreshTurnWait(); }
        });
    }

    private async sendOne(text: string, attachments: ChatAttachment[]): Promise<void> {
        if (this.closed) { throw new Error('closed'); }
        if (this.waitingAnswer) { return this.answer(text); }
        if (!this.child) {
            await this.initialize();
        }
        if (this.unauthenticated) {
            const account = await this.rpc('account/read', { refreshToken: false }).catch(() => undefined);
            this.unauthenticated = !!(account?.requiresOpenaiAuth && !account.account);
            if (this.unauthenticated) {
                this.publish({ type: 'error', kind: 'auth', message: authMessage() });
                this.publish({ type: 'turn.end', ok: false, reason: 'auth' });
                return;
            }
        }
        const content = [text, describeAttachments(attachments)].filter(Boolean).join('\n\n');
        const input: any[] = [{ type: 'text', text: content, text_elements: [] }];
        for (const attachment of attachments) {
            if (attachment.kind === 'file' && IMAGE_EXTENSIONS.has(extname(attachment.path).toLowerCase())) {
                input.push({ type: 'localImage', path: isAbsolute(attachment.path) ? attachment.path : join(this.opts.cwd, attachment.path) });
            }
        }
        this.interrupted = false;
        this.turnId = '';
        const done = this.waitForTurn(false);
        try {
            const model = this.validModel(this.opts.model);
            const effort = this.validEffort(this.opts.effort, model || this.actualModel);
            const reasoningModel = model || this.actualModel;
            const knownEfforts = reasoningModel ? this.supportedModels.get(reasoningModel) : undefined;
            const summary = (knownEfforts ? knownEfforts.size > 0 : !!effort || !this.catalogLoaded)
                ? 'detailed' as const : undefined;
            const params: { threadId: string; input: any[]; model?: string; effort?: string; summary?: 'detailed' } = {
                threadId: this.ref, input,
                ...(model ? { model } : {}),
                ...(effort ? { effort } : {}),
                ...(summary ? { summary } : {})
            };
            let result;
            try { result = await this.rpc('turn/start', params); }
            catch (error) {
                if (!summary || !/summary|reasoning|unknown field|invalid params|unsupported/i.test(String(error))) throw error;
                delete params.summary;
                result = await this.rpc('turn/start', params);
            }
            const id = result.turn?.id;
            if (id && (this.turnWait || this.waitingAnswer)) {
                this.turnId = id;
                if (this.turnWait) {
                    this.turnWait.turnId = id;
                    const ended = this.earlyTurnEnds.get(id);
                    this.earlyTurnEnds.clear();
                    if (ended) {
                        this.finishTurn(ended);
                    } else {
                        this.refreshTurnWait();
                    }
                }
            }
        } catch (error) {
            this.publish({ type: 'error', kind: AUTH_PATTERN.test(String(error)) ? 'auth' : 'other',
                message: AUTH_PATTERN.test(String(error)) ? authMessage() : String(error) });
            this.publish({ type: 'turn.end', ok: false, reason: AUTH_PATTERN.test(String(error)) ? 'auth' : 'failed' });
        }
        return done;
    }

    send(text: string, attachments: ChatAttachment[]): Promise<void> {
        const next = this.sendTail.then(() => this.sendOne(text, attachments));
        this.sendTail = next.catch(() => undefined);
        return next;
    }

    async interrupt(): Promise<void> {
        if (!this.turnId || !this.child) { return; }
        this.interrupted = true;
        await this.rpc('turn/interrupt', { threadId: this.ref, turnId: this.turnId });
    }

    async setModel(model: string): Promise<void> {
        if (this.catalogLoaded && !this.supportedModels.has(model)) throw new Error(t('chat.codexAppServer.ui.modelNotAvailableError'));
        this.opts.model = model;
    }
    async setEffort(effort: string): Promise<void> {
        if (this.catalogLoaded && !this.validEffort(effort, this.opts.model || this.actualModel)) throw new Error(t('chat.codexAppServer.ui.depthCannotSelectedError'));
        this.opts.effort = effort;
    }

    async listCommands() {
        try {
            const result = await this.rpc('skills/list', { cwds: [this.opts.cwd] });
            const items = Array.isArray(result.skills) ? result.skills : Array.isArray(result.data)
                ? result.data.flatMap((group: any) => Array.isArray(group.skills) ? group.skills : [group]) : [];
            const commands = items.flatMap((item: any) => {
                const name = String(item.name || '');
                return name ? [{ name, description: item.description ? String(item.description) : undefined,
                    kind: 'skill' as const }] : [];
            });
            if (commands.length) return commands;
        } catch { /* 古い app-server では利用できない場合がある。 */ }
        return projectSkills(this.opts.cwd);
    }

    async clear(): Promise<void> {
        if (this.turnId) { await this.interrupt(); }
        await this.openThread(false);
    }

    async compact(): Promise<void> {
        await this.rpc('thread/compact/start', { threadId: this.ref });
    }

    async close(): Promise<void> {
        this.closed = true;
        const child = this.child;
        this.child = undefined;
        if (this.turnWait) {
            clearTimeout(this.turnWait.timer);
            this.turnWait.reject(new Error('closed'));
            this.turnWait = undefined;
        }
        for (const pending of this.pendingRpc.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('closed'));
        }
        this.pendingRpc.clear();
        await terminateChild(child);
    }
}
