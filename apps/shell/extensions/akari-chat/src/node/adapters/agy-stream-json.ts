import { t } from '@akari-video/i18n';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { homedir } from 'os';
import { isAbsolute, relative } from 'path';
import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../../common/chat-agent';
import { describeAttachments, type ChatAttachment } from '../../common/chat-attachments';
import type { ChatEvent, ToolKind } from '../../common/chat-events';
import type { ChatAdapter, ChatAdapterSession } from './adapter';
import { acpCandidates, findAcpExecutable, type AcpAgentDefinition } from './acp-agents';
import { projectSkills } from './project-skills';
import { reapChildGroup, terminateChild } from './terminate';

const AGENT: AcpAgentDefinition = {
    id: 'antigravity', name: 'Antigravity', executable: 'agy', args: [], extraDirs: [],
    installHint: t('chat.agyStreamJson.ui.installAgyGoogleSCliLabel'), loginHint: 'agy'
};
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const authMessage = () => t('chat.agyStreamJson.ui.startAgyTerminalLogAction');
type Json = Record<string, any>;
type ToolEvent = Extract<ChatEvent, { type: 'tool' }>;

function safeErrorText(message: string): string {
    return message.replace(/Antigravity/gi, 'agy');
}

export function agyCandidates(home = homedir(), pathValue = process.env.PATH || ''): string[] {
    return acpCandidates(AGENT, { home, path: pathValue });
}

export function findAgy(candidates?: string[]): Promise<string | undefined> {
    if (!candidates) return findAcpExecutable(AGENT);
    return (async () => {
        for (const candidate of candidates) {
            try { await access(candidate, constants.X_OK); return candidate; }
            catch { /* Try the next candidate. */ }
        }
        return undefined;
    })();
}

export function parseAgyModels(output: string): ChatCapabilities['models'] {
    return output.split(/\r?\n/).flatMap(line => {
        const tab = line.indexOf('\t');
        if (tab < 1) return [];
        const id = line.slice(0, tab).trim();
        const label = line.slice(tab + 1).trim();
        return id && label ? [{ id, label }] : [];
    });
}

export function agyToolKind(name: string): ToolKind | 'ask' {
    if (['view_file', 'list_dir', 'find_by_name', 'grep_search'].includes(name)) return 'read';
    if (['replace_file_content', 'multi_replace_file_content', 'write_to_file', 'sed_file', 'notebook_edit'].includes(name)) return 'write';
    if (['run_command', 'send_command_input'].includes(name)) return 'command';
    if (['search_web', 'read_url_content'].includes(name)) return 'web';
    if (name === 'ask_question') return 'ask';
    return 'other';
}

export function agyArgs(opts: { model?: string; effort?: string; permission: ChatAdapterPermission }, conversation?: string): string[] {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print='];
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (conversation) args.push('--conversation', conversation);
    args.push('--dangerously-skip-permissions');
    return args;
}

export class AgyStreamParser {
    sessionId = '';
    model = '';
    private readonly messages = new Set<string>();
    private readonly tools = new Map<string, ToolEvent>();
    private readonly turnTools = new Map<string, ToolEvent>();
    private errored = false;

    constructor(private readonly cwd: string, private readonly emit: (event: ChatEvent) => void) { }

    private displayPath(path: string): string {
        if (!isAbsolute(path)) return path;
        const candidate = relative(this.cwd, path);
        return candidate && candidate !== '..' && !candidate.startsWith('../') && !isAbsolute(candidate) ? candidate : path;
    }

    private tool(step: Json): void {
        const name = String(step.tool_name || step.tool_info?.name || 'tool');
        const kind = agyToolKind(name);
        const id = `agy-tool-${step.step_index}`;
        const parameters: Json = step.tool_info?.parameters || {};
        if (kind === 'ask') {
            if (step.state === 'ACTIVE') {
                const question = String(parameters.Question || parameters.question || t('chat.agyStreamJson.ui.chooseLabel'));
                const rawOptions = parameters.Options || parameters.options || [];
                const options = Array.isArray(rawOptions) ? rawOptions.map((value: unknown) =>
                    typeof value === 'string' ? { label: value } : value as { label: string; description?: string }) : [];
                this.emit({ type: 'ask', id, question, options });
            }
            return;
        }
        const raw = parameters.AbsolutePath || parameters.TargetFile || parameters.CommandLine ||
            parameters.Path || parameters.Query || parameters.Url || name;
        const target = kind === 'read' || kind === 'write' ? this.displayPath(String(raw)) : String(raw);
        const verbs: Record<ToolKind, string> = {
            think: t('chat.agyStreamJson.ui.thoughtLabel'), read: t('chat.agyStreamJson.ui.readLabel'), write: t('chat.agyStreamJson.ui.wroteLabel'), command: t('chat.agyStreamJson.ui.ranLabel'),
            search: t('chat.agyStreamJson.ui.searchedLabel'), skill: t('chat.agyStreamJson.ui.usedLabel'), web: t('chat.agyStreamJson.ui.searchedLabel'), other: t('chat.agyStreamJson.ui.usedLabel')
        };
        const detail: NonNullable<ToolEvent['detail']> = {};
        if (kind === 'read' || kind === 'write') detail.path = target;
        else if (kind === 'command') detail.command = String(parameters.CommandLine || raw);
        else detail.text = String(raw);
        if (step.state === 'DONE' && step.tool_info?.output !== undefined) detail.output = String(step.tool_info.output);
        const previous = this.tools.get(id);
        const event: ToolEvent = {
            type: 'tool', id, kind, title: previous?.title || `${verbs[kind]} ${target}`,
            status: step.state === 'DONE' ? 'done' : 'running',
            detail: { ...previous?.detail, ...detail },
            ...(step.state === 'DONE' && typeof step.duration_seconds === 'number'
                ? { durationMs: Math.round(step.duration_seconds * 1000) } : {})
        };
        if (step.state === 'DONE') this.tools.delete(id);
        else this.tools.set(id, event);
        this.turnTools.set(id, event);
        this.emit(event);
    }

    private deniedActions(actions: Json[]): void {
        const matched = new Set<string>();
        const descriptions: string[] = [];
        for (const action of actions) {
            const name = String(action.action || '').toLowerCase();
            const kind: ToolKind | undefined = name.includes('command') ? 'command'
                : /edit|write|file/.test(name) ? 'write' : undefined;
            const candidates = [...this.turnTools.values()].reverse().filter(tool =>
                tool.status === 'done' && !matched.has(tool.id) &&
                (kind === undefined ? tool.detail?.output === undefined : tool.kind === kind)
            );
            const tool = candidates.find(candidate => candidate.detail?.output === undefined) || candidates[0];
            if (tool) {
                matched.add(tool.id);
                this.emit({ ...tool, status: 'error', title: tool.title.replace(/^[^ ]+/, t('chat.agyStreamJson.ui.wasStoppedLabel')) });
            }
            const label = kind === 'command' ? t('chat.agyStreamJson.ui.executeCommandLabel') : kind === 'write' ? t('chat.agyStreamJson.ui.fileChangesLabel') : t('chat.agyStreamJson.ui.actionLabel');
            const displayName = safeErrorText(String(action.display_name || action.action || ''));
            descriptions.push(`${label}${displayName ? `（${displayName}）` : ''}`);
        }
        this.emit({ type: 'error', kind: 'other',
            message: t('chat.agyStreamJson.ui.descriptionsStoppedBecauseAgyCannotIssueConfirmationError', { descriptions: descriptions.join('、') }) });
    }

    accept(row: Json): void {
        if (row.event === 'init') {
            this.sessionId = row.conversation_id || this.sessionId;
            this.model = row.init?.model || this.model;
            this.emit({ type: 'session', sessionId: this.sessionId, agent: 'antigravity', model: this.model, cwd: this.cwd });
            return;
        }
        if (row.event === 'step_update') {
            const step: Json = row.step_update || {};
            if (step.step_type === 'tool' && ['ACTIVE', 'DONE'].includes(step.state)) this.tool(step);
            if (step.step_type === 'agent_response') {
                const id = `agy-message-${step.step_index}`;
                if (typeof step.text_delta === 'string' && step.text_delta.length) {
                    if (!this.messages.has(id)) {
                        this.messages.add(id);
                        this.emit({ type: 'message.start', id, role: 'assistant' });
                    }
                    this.emit({ type: 'message.delta', id, text: step.text_delta });
                }
                if (step.state === 'DONE') {
                    if (this.messages.delete(id)) this.emit({ type: 'message.end', id });
                    const usage = step.usage;
                    if (usage && typeof usage.input_tokens === 'number') {
                        this.emit({ type: 'usage', usedTokens: usage.input_tokens + (usage.output_tokens || 0) });
                    }
                }
            }
            return;
        }
        if (row.event === 'result') {
            const result: Json = row.result || {};
            if (result.conversation_id) this.sessionId = result.conversation_id;
            const ok = result.status === 'SUCCESS';
            const reason = String(result.error || result.status || 'unknown error');
            const auth = /authenticat|log.?in|login/i.test(reason);
            if (Array.isArray(result.denied_actions) && result.denied_actions.length) {
                this.deniedActions(result.denied_actions);
            }
            if (!ok) {
                for (const tool of this.tools.values()) this.emit({ ...tool, status: 'error' });
            }
            if (!ok && !this.errored && !result.denied_actions?.length) {
                this.emit({ type: 'error', kind: auth ? 'auth' : 'other', message: auth ? authMessage() : safeErrorText(reason) });
                this.errored = true;
            }
            this.emit({ type: 'turn.end', ok, ...(!ok ? { reason: auth ? 'auth' : reason } : {}) });
            this.errored = false;
            this.messages.clear();
            this.tools.clear();
            this.turnTools.clear();
        }
    }
}

export class AgyStreamJsonAdapter implements ChatAdapter {
    private models?: ChatCapabilities['models'];
    constructor(private readonly executableOverride?: string) { }

    async info(): Promise<ChatAgentInfo> {
        const executable = this.executableOverride || await findAgy();
        return {
            id: 'antigravity', name: 'Antigravity', installed: !!executable,
            installHint: AGENT.installHint, loginHint: 'agy',
            transport: 'agy-stream-json', permissionModes: ['automatic'],
            permissionReasons: { checkpoints: t('chat.agyStreamJson.ui.partnerCannotUseModeBecauseHeadlessSessionsCannotError'),
                every: t('chat.agyStreamJson.ui.partnerCannotUseModeBecauseHeadlessSessionsCannotError') }
        };
    }

    async start(opts: { cwd: string; resume?: string; model?: string; effort?: string; permission: ChatAdapterPermission }): Promise<ChatAdapterSession> {
        if (opts.permission === 'checkpoints' || opts.permission === 'every') {
            throw new Error(t('chat.agyStreamJson.ui.partnerDoesNotSupportConfirmationModeMessage'));
        }
        const executable = this.executableOverride || await findAgy();
        if (!executable) throw new Error('not-installed');
        const session = new AgySession(executable, opts, () => this.getModels(executable, opts.cwd));
        await session.warm();
        return session;
    }

    private async getModels(executable: string, cwd: string): Promise<ChatCapabilities['models']> {
        if (this.models) return this.models;
        this.models = await new Promise(resolve => {
            const child = spawn(executable, ['models'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], shell: false,
                detached: process.platform !== 'win32' });
            reapChildGroup(child);
            child.stdout.setEncoding('utf8');
            let output = '';
            let settled = false;
            const finish = (models: ChatCapabilities['models']): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(models);
            };
            const timeout = setTimeout(() => { void terminateChild(child); finish([]); }, 10000);
            child.stdout.on('data', chunk => { output = (output + chunk).slice(0, 100000); });
            child.on('error', () => finish([]));
            child.on('close', code => finish(code === 0 ? parseAgyModels(output) : []));
        });
        return this.models;
    }
}

type Pending = { child: ChildProcessWithoutNullStreams; resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };

class AgySession implements ChatAdapterSession {
    private child?: ChildProcessWithoutNullStreams;
    private parser: AgyStreamParser;
    private readonly listeners = new Set<(event: ChatEvent) => void>();
    private pending?: Pending;
    private sendTail: Promise<void> = Promise.resolve();
    private ref: string;
    private stderr = '';
    private restart = false;
    private interrupted = false;
    private closed = false;

    constructor(private readonly executable: string, private readonly opts: {
        cwd: string; resume?: string; model?: string; effort?: string; permission: ChatAdapterPermission
    }, private readonly getModels: () => Promise<ChatCapabilities['models']>) {
        this.ref = opts.resume || '';
        this.parser = new AgyStreamParser(opts.cwd, event => this.publish(event));
    }

    get sessionRef(): string { return this.ref; }

    async capabilities(): Promise<ChatCapabilities> {
        return { models: await this.getModels(), efforts: EFFORTS, images: false, interrupt: true,
            clear: true, compact: false, resume: true, ask: true, currentModel: this.opts.model || this.parser.model || undefined };
    }

    listCommands() { return projectSkills(this.opts.cwd, ['.agents/skills', '.agent/skills', '.agy/skills', 'skills']); }

    warm(): Promise<void> {
        const child = this.launch();
        return new Promise((resolve, reject) => {
            child.once('spawn', () => resolve());
            child.once('error', reject);
        });
    }

    private restartIdle(): void {
        if (this.pending || this.closed) { this.restart = true; return; }
        const child = this.child;
        this.child = undefined;
        void terminateChild(child);
        this.launch();
    }

    onEvent(listener: (event: ChatEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    private publish(event: ChatEvent): void {
        if (this.interrupted && this.pending && event.type === 'error') return;
        if (event.type === 'session') this.ref = event.sessionId;
        if (event.type === 'turn.end') {
            if (this.interrupted) event = { type: 'turn.end', ok: false, reason: 'interrupted' };
            if (!event.ok) this.restart = true;
            const pending = this.pending;
            if (pending) clearTimeout(pending.timeout);
            this.pending = undefined;
            if (this.restart && !this.closed) queueMicrotask(() => this.restartIdle());
            if (event.ok || event.reason === 'interrupted') pending?.resolve();
            else pending?.reject(new Error(event.reason || 'turn failed'));
        }
        for (const listener of this.listeners) {
            try { listener(event); } catch { /* A disconnected listener must not block the turn. */ }
        }
    }

    private failTurn(child: ChildProcessWithoutNullStreams, message: string): void {
        if (this.pending?.child !== child) return;
        const auth = /authentication required|authentication failed|log.?in/i.test(message + this.stderr);
        if (!this.interrupted) this.publish({ type: 'error', kind: auth ? 'auth' : 'crashed',
            message: auth ? authMessage() : safeErrorText(message) });
        this.publish({ type: 'turn.end', ok: false, reason: this.interrupted ? 'interrupted' : auth ? 'auth' : message });
        this.restart = true;
    }

    private launch(): ChildProcessWithoutNullStreams {
        const child = spawn(this.executable, agyArgs(this.opts, this.ref), {
            cwd: this.opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32'
        });
        reapChildGroup(child);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        this.child = child;
        this.parser = new AgyStreamParser(this.opts.cwd, event => this.publish(event));
        this.restart = false;
        this.interrupted = false;
        this.stderr = '';
        let buffer = '';
        child.stdout.on('data', chunk => {
            if (this.child !== child) return;
            buffer += chunk;
            let end: number;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (!line) continue;
                try { this.parser.accept(JSON.parse(line)); } catch { /* Keep parsing later lines. */ }
            }
        });
        child.stderr.on('data', chunk => { if (this.child === child) this.stderr = (this.stderr + chunk).slice(-4000); });
        child.stdin.on('error', error => this.failTurn(child, t('chat.agyStreamJson.ui.couldNotSendAgyError', { error: error.message })));
        child.on('error', error => {
            if (!this.pending && !this.closed) this.publish({ type: 'error', kind: 'crashed', message: t('chat.agyStreamJson.ui.failedStartAgyError', { error: error.message }) });
            this.failTurn(child, t('chat.agyStreamJson.ui.failedStartAgyError', { error: error.message }));
            if (this.child === child) this.child = undefined;
        });
        child.on('close', code => {
            if (this.child !== child) return;
            this.failTurn(child, t('chat.agyStreamJson.ui.agyTerminatedCodeLabel', { code: String(code) }));
            this.child = undefined;
            this.restart = true;
        });
        return child;
    }

    private sendOne(text: string, attachments: ChatAttachment[]): Promise<void> {
        if (this.closed) return Promise.reject(new Error('closed'));
        let child = this.child;
        if (this.restart || !child || !child.stdin.writable || child.stdin.destroyed) {
            void terminateChild(child);
            child = this.launch();
        }
        const content = [text, describeAttachments(attachments)].filter(Boolean).join('\n\n');
        const line = JSON.stringify({ event: 'user', message: { role: 'user', content } }) + '\n';
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => this.failTurn(child, t('chat.agyStreamJson.ui.agyDidNotRespondMessage')), 300000);
            timeout.unref();
            this.pending = { child, resolve, reject, timeout };
            child.stdin.write(line, error => { if (error) this.failTurn(child, t('chat.agyStreamJson.ui.couldNotSendAgyError', { error: error.message })); });
        });
    }

    send(text: string, attachments: ChatAttachment[]): Promise<void> {
        const next = this.sendTail.then(() => this.sendOne(text, attachments));
        this.sendTail = next.catch(() => undefined);
        return next;
    }

    async interrupt(): Promise<void> {
        const child = this.child;
        this.interrupted = true;
        this.restart = true;
        if (!child) return;
        child.kill('SIGINT');
        if (this.pending?.child === child) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([this.sendTail, new Promise<void>(resolve => { timeout = setTimeout(resolve, 5000); })]);
            if (timeout) clearTimeout(timeout);
            if (this.pending?.child === child) {
                this.failTurn(child, 'interrupted');
                void terminateChild(child);
            }
        }
    }

    async setModel(model: string): Promise<void> { this.opts.model = model; this.restartIdle(); }
    async setEffort(effort: string): Promise<void> { this.opts.effort = effort; this.restartIdle(); }
    async clear(): Promise<void> { this.ref = ''; this.restart = true; }

    async close(): Promise<void> {
        this.closed = true;
        const child = this.child;
        this.child = undefined;
        await terminateChild(child);
        if (this.pending) {
            clearTimeout(this.pending.timeout);
            this.pending.reject(new Error('closed'));
            this.pending = undefined;
        }
    }
}
