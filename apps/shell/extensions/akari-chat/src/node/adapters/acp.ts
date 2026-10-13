import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { constants } from 'fs';
import { access, lstat, open, readFile, realpath } from 'fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'path';
import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../../common/chat-agent';
import type { ChatAttachment } from '../../common/chat-attachments';
import type { ChatEvent, ToolKind } from '../../common/chat-events';
import type { ChatAdapter, ChatAdapterSession } from './adapter';
import { projectSkills } from './project-skills';
import { describeAttachments } from '../../common/chat-attachments';
import { findAcpExecutable, AcpAgentDefinition, AcpDetectionEnvironment } from './acp-agents';
import { reapChildGroup, terminateChild } from './terminate';

type JsonObject = Record<string, unknown>;
type RpcError = Error & { code?: number; crashed?: boolean };
type PendingRpc = { resolve: (value: JsonObject) => void; reject: (error: RpcError) => void; timer?: ReturnType<typeof setTimeout> };
type ToolEvent = Extract<ChatEvent, { type: 'tool' }>;
type ConfigOption = { id: string; category?: string; type?: string; currentValue?: string; options?: Array<{ value: string; name?: string; description?: string }> };

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const TOOL_KINDS: Record<string, ToolKind> = {
    read: 'read', list: 'read', write: 'write', edit: 'write', delete: 'write', move: 'write', search: 'search',
    execute: 'command', command: 'command', think: 'think', fetch: 'web', web: 'web', other: 'other'
};
const NAMED_TOOLS: Record<string, ToolKind> = {
    read_file: 'read', write_file: 'write', edit: 'write', grep: 'search', glob: 'search', find: 'search',
    list_dir: 'read', ls: 'read', run_terminal_cmd: 'command', shell: 'command', bash: 'command',
    fetch: 'web', web_search: 'search'
};

function object(value: unknown): JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function string(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function within(root: string, target: string): boolean {
    const part = relative(root, target);
    return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

function classify(error: RpcError, stderr = ''): ChatEvent & { type: 'error' } {
    const message = String(error.message || 'ACP エージェントのエラー');
    const kind = error.crashed ? 'crashed'
        : error.code === -32000 || /auth|login|log in|sign in|unauthenticated|credentials/i.test(`${message} ${stderr}`)
            ? 'auth' : /rate.?limit|quota|too many requests|\b429\b/i.test(message) ? 'rate-limit' : 'other';
    return { type: 'error', kind, message };
}

function safeReason(message: string): string {
    return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[伏せ字]')
        .replace(/[A-Za-z0-9]{32,}/g, '[伏せ字]').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export class AcpAdapter implements ChatAdapter {
    constructor(
        private readonly agent: AcpAgentDefinition,
        private readonly executableOverride?: string,
        private readonly environment: AcpDetectionEnvironment = {}
    ) { }

    private executable(): Promise<string | undefined> {
        if (!this.executableOverride) { return findAcpExecutable(this.agent, this.environment); }
        return access(this.executableOverride, constants.X_OK).then(() => this.executableOverride, () => undefined);
    }

    async info(): Promise<ChatAgentInfo> {
        const executable = await this.executable();
        return {
            id: this.agent.id, name: this.agent.name, installed: Boolean(executable),
            transport: 'acp', permissionModes: ['automatic', 'checkpoints'],
            permissionReasons: { every: '確認の頻度は相手側が決めるため選べません' },
            installHint: this.agent.installHint, loginHint: this.agent.loginHint
        };
    }

    async start(opts: { cwd: string; resume?: string; model?: string; effort?: string; permission: ChatAdapterPermission; signal?: AbortSignal }): Promise<ChatAdapterSession> {
        if (opts.permission === 'every') throw new Error('この相手は毎回確認に対応していません');
        const executable = await this.executable();
        const session = new AcpSession(this.agent, executable, opts);
        const cancel = (): void => { void session.close(); };
        opts.signal?.addEventListener('abort', cancel, { once: true });
        try { await session.open(); } finally { opts.signal?.removeEventListener('abort', cancel); }
        if (opts.signal?.aborted) { await session.close(); throw new Error('start-cancelled'); }
        return session;
    }
}

export class AcpSession implements ChatAdapterSession {
    private child?: ChildProcessWithoutNullStreams;
    private readonly listeners = new Set<(event: ChatEvent) => void>();
    private readonly pending = new Map<number, PendingRpc>();
    private readonly tools = new Map<string, ToolEvent>();
    private readonly toolTargets = new Map<string, string>();
    private readonly toolNames = new Map<string, string>();
    private sequence = 0;
    private lineBuffer = '';
    private stderr = '';
    private ref = '';
    private canonicalCwd = '';
    private model = '';
    initialError?: Extract<ChatEvent, { type: 'error' }>;
    private sessionAnnounced = false;
    private loadActive = false;
    private openingSession = false;
    private readonly openingUpdates: Array<{ sessionId: string; update: JsonObject }> = [];
    private closed = false;
    private turnActive = false;
    private interrupted = false;
    private messageId = '';
    private thoughtId = '';
    private thoughtText = '';
    private planId = '';
    private commands: Array<{ name: string; description?: string; kind: 'command' }> = [];
    private agentCapabilities: JsonObject = {};
    private sessionCapabilities: JsonObject = {};
    private configOptions: ConfigOption[] = [];
    private models: Array<{ modelId: string; name?: string }> = [];
    private modes: Array<{ id: string; name?: string }> = [];
    private pendingPermission?: { id: string | number; options: Array<{ optionId: string; name: string }> };
    private sendTail: Promise<void> = Promise.resolve();

    constructor(
        private readonly agent: AcpAgentDefinition,
        private readonly executable: string | undefined,
        private readonly opts: { cwd: string; resume?: string; model?: string; effort?: string; permission: ChatAdapterPermission }
    ) { }

    get sessionRef(): string { return this.ref; }

    onEvent(listener: (event: ChatEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    private emit(event: ChatEvent): void {
        if (!this.turnActive && event.type === 'error') { this.initialError = event; }
        for (const listener of this.listeners) {
            try { listener(event); } catch { /* A view listener cannot interrupt the transport. */ }
        }
    }

    async open(): Promise<void> {
        if (!this.executable) {
            this.emit({ type: 'error', kind: 'not-installed', message: this.agent.installHint });
            this.emit({ type: 'turn.end', ok: false, reason: 'not-installed' });
            return;
        }
        try {
            this.openingSession = true;
            this.canonicalCwd = await realpath(this.opts.cwd);
            const child = spawn(this.executable, [...this.agent.args, ...(this.opts.model && this.agent.modelArgs ? this.agent.modelArgs(this.opts.model) : [])], {
                cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32'
            });
            reapChildGroup(child);
            this.child = child;
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', data => this.receive(data));
            child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-2000); });
            child.on('error', error => this.processEnded(error.message));
            child.on('close', code => this.processEnded(`ACP エージェントが終了しました (${code})`));
            child.stdin.on('error', error => this.processEnded(error.message));
            const init = await this.request('initialize', {
                protocolVersion: 1,
                clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
                clientInfo: { name: 'akari-video', version: '0.0.1' }
            }, 600000);
            this.agentCapabilities = object(init.agentCapabilities);
            this.sessionCapabilities = object(this.agentCapabilities.sessionCapabilities);
            const canLoad = Boolean(this.agentCapabilities.loadSession);
            this.loadActive = Boolean(this.opts.resume && canLoad);
            const result = await this.request(this.loadActive ? 'session/load' : 'session/new', {
                ...(this.loadActive ? { sessionId: this.opts.resume } : {}), cwd: this.opts.cwd, mcpServers: []
            }, 600000);
            this.ref = string(result.sessionId) || (this.loadActive ? this.opts.resume || '' : '');
            this.readSessionOptions(result);
            this.openingSession = false;
            for (const pending of this.openingUpdates.splice(0)) {
                if (pending.sessionId && pending.sessionId !== this.ref) continue;
                const type = string(pending.update.sessionUpdate);
                if (!this.loadActive || ['available_commands_update', 'config_option_update',
                    'current_mode_update', 'model_update', 'current_model_update'].includes(type)) {
                    this.handleUpdate(pending.update);
                }
            }
            this.loadActive = false;
            if (this.opts.model && this.supportsInitialModel(this.opts.model)) {
                try { await this.setModel(this.opts.model); } catch { /* The session is usable with its current model. */ }
            }
            if (this.opts.effort) {
                try { await this.setEffort(this.opts.effort); } catch { /* The session is usable with its current effort. */ }
            }
        } catch (cause) {
            const missing = this.loadActive && !(cause as RpcError).crashed && !/timeout/i.test(String((cause as Error).message));
            this.openingSession = false;
            this.openingUpdates.length = 0;
            this.loadActive = false;
            this.fail(cause as RpcError, true, missing ? 'missing' : 'startup');
            await terminateChild(this.child);
            this.child = undefined;
        }
    }

    private processEnded(message: string): void {
        if (this.closed) { return; }
        const error = Object.assign(new Error(message), { crashed: true }) as RpcError;
        for (const [id, pending] of this.pending) {
            if (pending.timer) { clearTimeout(pending.timer); }
            pending.reject(error);
            this.pending.delete(id);
        }
        this.child = undefined;
    }

    private sendPacket(packet: JsonObject): void {
        if (!this.child?.stdin.writable) { throw Object.assign(new Error('ACP process closed'), { crashed: true }); }
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...packet }) + '\n');
    }

    private request(method: string, params: JsonObject, timeoutMs?: number): Promise<JsonObject> {
        return new Promise((resolvePromise, reject) => {
            const id = ++this.sequence;
            const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`ACP ${method} timeout`));
            }, timeoutMs);
            this.pending.set(id, { resolve: resolvePromise, reject, timer });
            try { this.sendPacket({ id, method, params }); }
            catch (error) { if (timer) { clearTimeout(timer); } this.pending.delete(id); reject(error); }
        });
    }

    private receive(chunk: string): void {
        this.lineBuffer += chunk;
        let end: number;
        while ((end = this.lineBuffer.indexOf('\n')) >= 0) {
            const line = this.lineBuffer.slice(0, end).trim();
            this.lineBuffer = this.lineBuffer.slice(end + 1);
            if (!line) { continue; }
            try { this.handlePacket(object(JSON.parse(line))); } catch { /* Ignore malformed output. */ }
        }
    }

    private handlePacket(packet: JsonObject): void {
        if (packet.id !== undefined && !packet.method) {
            const id = Number(packet.id);
            const pending = this.pending.get(id);
            if (!pending) { return; }
            if (pending.timer) { clearTimeout(pending.timer); }
            this.pending.delete(id);
            if (packet.error) {
                const rpc = object(packet.error);
                const error = new Error(string(rpc.message) || 'ACP request failed') as RpcError;
                error.code = typeof rpc.code === 'number' ? rpc.code : undefined;
                pending.reject(error);
            } else { pending.resolve(object(packet.result)); }
            return;
        }
        const method = string(packet.method);
        if (packet.id !== undefined) {
            void this.handleAgentRequest(packet.id as string | number, method, object(packet.params));
        } else if (method === 'session/update') {
            const params = object(packet.params);
            if (this.openingSession) {
                if (this.openingUpdates.length < 200) this.openingUpdates.push({
                    sessionId: string(params.sessionId), update: object(params.update)
                });
            } else if (!this.loadActive && (!params.sessionId || params.sessionId === this.ref)) {
                this.handleUpdate(object(params.update));
            }
        }
    }

    private reply(id: string | number, result: unknown): void {
        try { this.sendPacket({ id, result }); } catch { /* Process already exited. */ }
    }

    private rpcError(id: string | number, code: number, message: string): void {
        try { this.sendPacket({ id, error: { code, message } }); } catch { /* Process already exited. */ }
    }

    private async safePath(path: string, writing: boolean): Promise<string> {
        const root = await realpath(this.opts.cwd);
        const candidate = resolve(root, path);
        if (!within(root, candidate)) { throw new Error('プロジェクト外のパスは使えません'); }
        const checked = writing ? await realpath(resolve(candidate, '..')) : await realpath(candidate);
        if (!within(root, checked)) { throw new Error('プロジェクト外のパスは使えません'); }
        if (writing) {
            try {
                const entry = await lstat(candidate);
                if (entry.isSymbolicLink()) { throw new Error('シンボリックリンクには書き込めません'); }
                const existing = await realpath(candidate);
                if (!within(root, existing)) { throw new Error('プロジェクト外のパスは使えません'); }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
            }
        }
        return candidate;
    }

    private async handleAgentRequest(id: string | number, method: string, params: JsonObject): Promise<void> {
        try {
            if (method === 'session/request_permission') {
                if (this.interrupted) {
                    this.reply(id, { outcome: { outcome: 'cancelled' } });
                    return;
                }
                const options = Array.isArray(params.options) ? params.options.map(object) : [];
                const allow = this.opts.permission === 'all' ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always'];
                const selected = allow.map(kind => options.find(option => option.kind === kind)).find(Boolean);
                if (selected && this.opts.permission !== 'checkpoints') {
                    this.reply(id, { outcome: { outcome: 'selected', optionId: selected.optionId } });
                } else {
                    this.pendingPermission = {
                        id, options: options.map(option => ({ optionId: string(option.optionId), name: string(option.name) }))
                    };
                    this.emit({ type: 'ask', id: `permission-${id}`, question: string(object(params.toolCall).title) || '操作を許可しますか？',
                        options: this.pendingPermission.options.map(option => ({ label: option.name })) });
                }
                return;
            }
            if (method === 'fs/read_text_file' || method === 'fs/write_text_file') {
                if (params.sessionId !== this.ref) { throw new Error('セッションが一致しません'); }
                const path = await this.safePath(string(params.path), method === 'fs/write_text_file');
                if (method === 'fs/read_text_file') {
                    const content = await readFile(path, 'utf8');
                    const line = Math.max(1, Number(params.line) || 1);
                    const limit = Number(params.limit);
                    const lines = content.split('\n');
                    this.reply(id, { content: lines.slice(line - 1, Number.isFinite(limit) && limit >= 0 ? line - 1 + limit : undefined).join('\n') });
                } else {
                    const parent = await realpath(resolve(path, '..'));
                    if (!within(await realpath(this.opts.cwd), parent)) throw new Error('プロジェクト外のパスは使えません');
                    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o666);
                    try {
                        if (!(await file.stat()).isFile()) throw new Error('通常のファイルにのみ書き込めます');
                        await file.truncate(0);
                        await file.writeFile(string(params.content), 'utf8');
                    } finally { await file.close(); }
                    this.reply(id, null);
                }
                return;
            }
            this.rpcError(id, -32601, `Method not found: ${method}`);
        } catch (error) {
            this.rpcError(id, -32001, String((error as Error).message));
        }
    }

    private readSessionOptions(result: JsonObject): void {
        this.sessionCapabilities = { ...this.sessionCapabilities, ...object(result.sessionCapabilities) };
        if (Array.isArray(result.configOptions)) { this.configOptions = result.configOptions.map(item => object(item) as ConfigOption); }
        const models = object(result.models);
        if (Array.isArray(models.availableModels)) { this.models = models.availableModels.map(item => object(item) as { modelId: string; name?: string }); }
        this.model = string(models.currentModelId) || string(this.configOptions.find(item => item.category === 'model')?.currentValue);
        const modes = object(result.modes);
        if (Array.isArray(modes.availableModes)) { this.modes = modes.availableModes.map(item => object(item) as { id: string; name?: string }); }
    }

    private supportsInitialModel(model: string): boolean {
        return Boolean(this.configOptions.find(item => item.category === 'model')?.options?.some(option => option.value === model)
            || this.models.some(item => item.modelId === model));
    }

    async capabilities(): Promise<ChatCapabilities> {
        const modelConfig = this.configOptions.find(item => item.category === 'model');
        const effortConfig = this.configOptions.find(item => ['thought_level', 'effort'].includes(item.category || ''));
        return {
            models: modelConfig?.options?.map(option => ({ id: option.value, label: option.name || option.value, description: option.description }))
                || this.models.map(item => ({ id: item.modelId, label: item.name || item.modelId })),
            currentModel: this.model || undefined,
            efforts: effortConfig?.options?.map(option => option.value),
            images: Boolean(object(this.agentCapabilities.promptCapabilities).image),
            interrupt: true, clear: true, compact: this.commands.some(item => item.name === 'compact'),
            resume: Boolean(this.agentCapabilities.loadSession), ask: true
        };
    }

    private finishMessage(): void {
        if (this.messageId) { this.emit({ type: 'message.end', id: this.messageId }); this.messageId = ''; }
    }

    private finishThought(): void {
        if (this.thoughtId) {
            this.emit({ type: 'tool', id: this.thoughtId, kind: 'think', title: '考えました', status: 'done', detail: { text: this.thoughtText } });
            this.thoughtId = ''; this.thoughtText = '';
        }
    }

    private relativePath(path: string): string {
        const root = this.canonicalCwd || this.opts.cwd;
        if (!isAbsolute(path)) {
            const stripped = path.replace(/^\/+/, '');
            const rootStripped = root.replace(/^\/+/, '');
            if (stripped === rootStripped) return '.';
            if (stripped.startsWith(`${rootStripped}/`)) return stripped.slice(rootStripped.length + 1);
            return path;
        }
        const part = relative(root, path);
        return within(root, path) ? part || '.' : path;
    }

    private toolUpdate(update: JsonObject): void {
        const id = string(update.toolCallId);
        if (!id) { return; }
        const previous = this.tools.get(id);
        const raw = object(update.rawInput);
        const locations = Array.isArray(update.locations) ? update.locations.map(object) : [];
        const path = string(locations[0]?.path) || string(raw.path) || previous?.detail?.path || '';
        const command = (Array.isArray(raw.command) ? raw.command.map(string).filter(Boolean).join(' ') : string(raw.command))
            || previous?.detail?.command || '';
        const query = (string(raw.pattern) || string(raw.query)).replace(/\\([^\w\s])/g, '$1');
        const url = string(raw.url);
        const meta = object(object(update._meta)['x.ai/tool']);
        const title = string(update.title);
        const name = string(meta.name) || this.toolNames.get(id) || title;
        if (name) this.toolNames.set(id, name);
        const list = /^(list_dir|ls)$/.test(name.toLowerCase()) || string(meta.kind) === 'list'
            || string(update.kind) === 'list' || /^list\b/i.test(title);
        const declaredKind = TOOL_KINDS[string(meta.kind)] || TOOL_KINDS[string(update.kind)];
        const kind = NAMED_TOOLS[name.toLowerCase()] || (list ? 'read' : undefined)
            || (declaredKind === 'other' ? undefined : declaredKind) || previous?.kind || 'other';
        const status = ['completed', 'done'].includes(string(update.status)) ? 'done'
            : ['failed', 'error'].includes(string(update.status)) ? 'error' : 'running';
        const displayTarget = (value: string): string => {
            const unquoted = value.trim().replace(/^`+|`+$/g, '');
            const relative = unquoted ? this.relativePath(unquoted) : '';
            return relative === '.' || relative === './' ? '' : relative;
        };
        const titledTarget = list ? title.replace(/^list\b\s*/i, '') : title;
        const descriptiveTitle = title && title !== name ? displayTarget(titledTarget).replace(/\\([^\w\s])/g, '$1') : '';
        const location = displayTarget(path);
        const namedTarget = name.toLowerCase() === 'other' ? '' : displayTarget(name);
        const kindHint = [string(meta.kind), string(update.kind)].find(value => value && value !== 'other') || '';
        const target = (kind === 'command' ? command || descriptiveTitle || location
            : kind === 'read' || kind === 'write' ? location || descriptiveTitle
                : kind === 'search' ? query || location || descriptiveTitle
                    : kind === 'web' ? url || descriptiveTitle
                        : descriptiveTitle || location || namedTarget || displayTarget(kindHint)) || this.toolTargets.get(id) || '';
        if (kind === 'other' && !target && !namedTarget) return;
        this.toolTargets.set(id, target);
        const running: Record<ToolKind, string> = { read: '読んでいます', write: '書いています', command: '実行しています',
            search: '検索しています', web: '取得しています', think: '考えています', skill: '操作しています', other: '操作しています' };
        const done: Record<ToolKind, string> = { read: '読みました', write: '書きました', command: '実行しました',
            search: '検索しました', web: '取得しました', think: '考えました', skill: '操作しました', other: '操作しました' };
        const verb = status === 'error' ? '失敗しました' : list ? status === 'done' ? '一覧を見ました' : '一覧を見ています'
            : status === 'done' ? done[kind] : running[kind];
        const content = Array.isArray(update.content) ? update.content.map(object) : [];
        const output = content.filter(item => item.type === 'content' || item.type === 'text')
            .map(item => string(item.text) || string(object(item.content).text)).filter(Boolean).join('\n');
        const diffBlock = content.find(item => item.type === 'diff');
        const oldText = string(diffBlock?.oldText);
        const newText = string(diffBlock?.newText);
        const diff = diffBlock ? { added: newText ? newText.split('\n').length : 0, removed: oldText ? oldText.split('\n').length : 0,
            patch: `-${oldText}\n+${newText}`.slice(0, 4000) } : previous?.detail?.diff;
        const event: ToolEvent = {
            type: 'tool', id, kind, title: `${verb} ${target}`.trim().replace(/\s+/g, ' ').slice(0, 200), status,
            detail: { ...previous?.detail, ...(command ? { command } : {}), ...(location && location !== '.' ? { path: location } : {}),
                ...(output ? { output: output.slice(0, 8000) } : {}), ...(diff ? { diff } : {}) }
        };
        this.tools.set(id, event);
        this.emit(event);
    }

    private handleUpdate(update: JsonObject): void {
        const type = string(update.sessionUpdate);
        if (type !== 'agent_message_chunk') { this.finishMessage(); }
        if (type !== 'agent_thought_chunk') { this.finishThought(); }
        if (type === 'agent_message_chunk') {
            const text = string(object(update.content).text);
            if (!text) { return; }
            if (!this.messageId) {
                this.messageId = `acp-message-${++this.sequence}`;
                this.emit({ type: 'message.start', id: this.messageId, role: 'assistant' });
            }
            this.emit({ type: 'message.delta', id: this.messageId, text });
        } else if (type === 'agent_thought_chunk') {
            const text = string(object(update.content).text);
            if (!this.thoughtId) { this.thoughtId = `acp-thought-${++this.sequence}`; }
            this.thoughtText += text;
            if (text) this.emit({ type: 'thinking.delta', id: this.thoughtId, text });
            this.emit({ type: 'tool', id: this.thoughtId, kind: 'think', title: '考えています', status: 'running', detail: { text: this.thoughtText } });
        } else if (type === 'tool_call' || type === 'tool_call_update') {
            this.toolUpdate(update);
        } else if (type === 'plan') {
            if (!this.planId) { this.planId = `acp-plan-${++this.sequence}`; }
            const entries = Array.isArray(update.entries) ? update.entries.map(object) : [];
            this.emit({ type: 'tool', id: this.planId, kind: 'other', title: '計画', status: 'done',
                detail: { text: entries.map(item => `- [${string(item.status)}] ${string(item.content)}`).join('\n') } });
        } else if (type === 'available_commands_update') {
            this.commands = Array.isArray(update.availableCommands) ? update.availableCommands.map(item => ({
                name: string(object(item).name), description: string(object(item).description) || undefined,
                kind: 'command' as const
            })).filter(item => item.name) : [];
            this.emit({ type: 'commands.changed' });
        } else if (type === 'config_option_update') {
            if (Array.isArray(update.configOptions)) {
                this.configOptions = update.configOptions.map(item => object(item) as ConfigOption);
            } else {
                const option = object(update.configOption) as ConfigOption;
                if (option.id) { this.configOptions = [...this.configOptions.filter(item => item.id !== option.id), option]; }
            }
        } else if (type === 'model_update' || type === 'current_model_update') {
            this.model = string(update.modelId) || string(update.model) || this.model;
        } else if (type === 'current_mode_update') {
            // The active mode is carried by the agent; choices remain in modes.
        } else if (type === 'usage_update') {
            const usage = object(update.usage);
            const usedTokens = Number(usage.usedTokens ?? update.usedTokens ?? update.used);
            if (Number.isFinite(usedTokens)) {
                const contextWindow = Number(usage.contextWindow ?? update.contextWindow ?? update.size);
                this.emit({ type: 'usage', usedTokens, ...(Number.isFinite(contextWindow) ? { contextWindow } : {}) });
            }
        }
    }

    private fail(cause: RpcError, turn: boolean, resumeFailure?: 'missing' | 'startup'): void {
        const event = classify(cause, this.stderr);
        if (this.opts.resume && event.kind !== 'auth' && event.kind !== 'not-installed' && event.kind !== 'rate-limit') {
            event.resumeFailure = resumeFailure;
        }
        if (event.kind === 'auth') {
            const reason = safeReason(cause.message);
            event.message = `${this.agent.name} にログインしてください（ターミナルで ${this.agent.loginHint}）${reason ? ` — ${reason}` : ''}`;
        }
        if (cause.message.includes('ENOENT')) { event.kind = 'not-installed'; event.message = this.agent.installHint; }
        this.emit(event);
        if (turn) { this.emit({ type: 'turn.end', ok: false, reason: event.kind }); }
    }

    private async promptBlocks(text: string, attachments: ChatAttachment[]): Promise<JsonObject[]> {
        const blocks: JsonObject[] = [{ type: 'text', text: [text, describeAttachments(attachments)].filter(Boolean).join('\n\n') }];
        if (!object(this.agentCapabilities.promptCapabilities).image) { return blocks; }
        for (const attachment of attachments) {
            if (attachment.kind !== 'file') { continue; }
            const mimeType = IMAGE_TYPES[extname(attachment.path).toLowerCase()];
            if (!mimeType) { continue; }
            try {
                const path = await this.safePath(attachment.path, false);
                blocks.push({ type: 'image', mimeType, data: (await readFile(path)).toString('base64') });
            } catch { /* The textual path remains available to the agent. */ }
        }
        return blocks;
    }

    private async sendOne(text: string, attachments: ChatAttachment[]): Promise<void> {
        if (this.closed) { return; }
        if (!this.sessionAnnounced && this.ref) {
            this.sessionAnnounced = true;
            this.emit({ type: 'session', sessionId: this.ref, agent: this.agent.id, model: this.model || undefined, cwd: this.opts.cwd });
        }
        if (!this.child || !this.ref) {
            if (!this.initialError) {
                this.fail(new Error('ACP process closed'), true);
            } else {
                this.emit(this.initialError);
                this.emit({ type: 'turn.end', ok: false, reason: this.initialError.kind });
            }
            return;
        }
        this.turnActive = true;
        this.interrupted = false;
        this.planId = '';
        this.tools.clear();
        this.toolTargets.clear();
        this.toolNames.clear();
        try {
            const result = await this.request('session/prompt', { sessionId: this.ref, prompt: await this.promptBlocks(text, attachments) });
            this.finishMessage(); this.finishThought();
            const stopReason = string(result.stopReason);
            const ok = ['end_turn', 'max_tokens', 'max_turn_requests'].includes(stopReason);
            this.emit({ type: 'turn.end', ok, ...(!ok ? { reason: this.interrupted || stopReason === 'cancelled' ? 'interrupted' : stopReason || 'other' } : {}) });
        } catch (cause) {
            this.finishMessage(); this.finishThought();
            if (this.interrupted) this.emit({ type: 'turn.end', ok: false, reason: 'interrupted' });
            else this.fail(cause as RpcError, true);
        } finally { this.turnActive = false; }
    }

    send(text: string, attachments: ChatAttachment[]): Promise<void> {
        if (this.pendingPermission) {
            const pending = this.pendingPermission;
            this.pendingPermission = undefined;
            const selected = pending.options.find((option, index) => option.name === text.trim() || String(index + 1) === text.trim());
            this.reply(pending.id, { outcome: selected ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' } });
            if (selected) { return Promise.resolve(); }
        }
        const next = this.sendTail.then(() => this.sendOne(text, attachments));
        this.sendTail = next.catch(() => undefined);
        return next;
    }

    async interrupt(): Promise<void> {
        this.interrupted = true;
        if (this.pendingPermission) {
            this.reply(this.pendingPermission.id, { outcome: { outcome: 'cancelled' } });
            this.pendingPermission = undefined;
        }
        if (this.child && this.ref) { this.sendPacket({ method: 'session/cancel', params: { sessionId: this.ref } }); }
    }

    async setModel(model: string): Promise<void> {
        const config = this.configOptions.find(item => item.category === 'model');
        if (config) { await this.request('session/set_config_option', { sessionId: this.ref, configId: config.id, value: model }, 60000); }
        else if (this.models.length) { await this.request('session/set_model', { sessionId: this.ref, modelId: model }, 60000); }
        else throw new Error('この相手はモデル切替に対応していません');
        this.model = model;
    }

    async listCommands() {
        const skills = new Map((await projectSkills(this.opts.cwd,
            ['.claude/skills', '.agents/skills', '.opencode/skills', '.codex/skills', '.cursor/skills']))
            .map(item => [item.name, item]));
        return this.commands.map(command => {
            const name = command.name.replace(/^\//, '');
            const skill = skills.get(name);
            return { name, description: command.description || skill?.description,
                kind: skill ? 'skill' as const : 'command' as const };
        });
    }

    async setEffort(effort: string): Promise<void> {
        const config = this.configOptions.find(item => ['thought_level', 'effort'].includes(item.category || ''));
        if (config) { await this.request('session/set_config_option', { sessionId: this.ref, configId: config.id, value: effort }, 60000); }
        else if (this.modes.some(mode => mode.id === effort)) { await this.setMode(effort); }
        else throw new Error('この相手は深さの切替に対応していません');
    }

    async setMode(modeId: string): Promise<void> {
        if (this.modes.some(mode => mode.id === modeId)) { await this.request('session/set_mode', { sessionId: this.ref, modeId }, 60000); }
    }

    async clear(): Promise<void> {
        const result = await this.request('session/new', { cwd: this.opts.cwd, mcpServers: [] }, 600000);
        this.ref = string(result.sessionId);
        this.readSessionOptions(result);
        this.emit({ type: 'session', sessionId: this.ref, agent: this.agent.id, model: this.model || undefined, cwd: this.opts.cwd });
    }

    async compact(): Promise<void> {
        if (this.commands.some(item => item.name === 'compact')) { await this.send('/compact', []); }
    }

    async close(): Promise<void> {
        if (this.closed) { return; }
        this.closed = true;
        if (this.pendingPermission) {
            this.reply(this.pendingPermission.id, { outcome: { outcome: 'cancelled' } });
            this.pendingPermission = undefined;
        }
        if (this.child && this.sessionCapabilities.close && this.ref) {
            try { await this.request('session/close', { sessionId: this.ref }, 50); } catch { /* Shutdown continues. */ }
        }
        const child = this.child;
        this.child = undefined;
        await terminateChild(child);
        for (const pending of this.pending.values()) { if (pending.timer) { clearTimeout(pending.timer); } pending.reject(new Error('closed')); }
        this.pending.clear();
    }
}
