import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { constants } from 'fs';
import { access, readFile } from 'fs/promises';
import { homedir } from 'os';
import { extname, join } from 'path';
import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from '../../common/chat-agent';
import { describeAttachments, type ChatAttachment } from '../../common/chat-attachments';
import type { ChatEvent } from '../../common/chat-events';
import type { ChatAdapter, ChatAdapterSession } from './adapter';
import { ClaudeStreamParser } from './claude-stream-parser';

export { ClaudeStreamParser } from './claude-stream-parser';

const ASK_RULE = '選択肢を出すときは ```akari-ask と JSON {"question":"…","options":[{"label":"…","description":"…"}]} のフェンスで出してください。フェンス以外に選択肢の説明を繰り返さないでください。';
const MODELS = [
    { id: 'opus', label: 'Opus' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'haiku', label: 'Haiku' }
];
const EFFORTS = ['low', 'medium', 'high', 'max'];
const IMAGE_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
};

type ClaudeUserMessage = {
    type: 'user';
    message: {
        role: 'user';
        content: Array<
            { type: 'text'; text: string } |
            { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
        >;
    };
};

type PendingTurn = {
    child: ChildProcessWithoutNullStreams;
    resolve: () => void;
    reject: (error: Error) => void;
    writeAcknowledged: boolean;
    timeout: ReturnType<typeof setTimeout>;
    onWriteError: (error: Error & { code?: string }) => void;
};

export function claudeCandidates(home = homedir(), pathValue = process.env.PATH || ''): string[] {
    const separator = process.platform === 'win32' ? ';' : ':';
    const directories = [
        ...pathValue.split(separator),
        join(home, '.local', 'bin'),
        join(home, '.claude', 'bin'),
        join(home, '.claude', 'local'),
        '/opt/homebrew/bin',
        '/usr/local/bin'
    ];
    const executable = process.platform === 'win32' ? 'claude.exe' : 'claude';
    return [...new Set(directories.filter(Boolean).map(directory => join(directory, executable)))];
}

export async function findClaude(candidates = claudeCandidates()): Promise<string | undefined> {
    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        } catch {
            // Continue with the next executable candidate.
        }
    }
    return undefined;
}

export async function claudeUserMessage(
    text: string,
    attachments: ChatAttachment[],
    cwd: string
): Promise<ClaudeUserMessage> {
    const content: ClaudeUserMessage['message']['content'] = [{
        type: 'text',
        text: [text, describeAttachments(attachments)].filter(Boolean).join('\n\n')
    }];
    for (const item of attachments) {
        if (item.kind !== 'file') {
            continue;
        }
        const mediaType = IMAGE_TYPES[extname(item.path).toLowerCase()];
        if (!mediaType) {
            continue;
        }
        try {
            const path = item.path.startsWith('/') ? item.path : join(cwd, item.path);
            const bytes = await readFile(path);
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: bytes.toString('base64')
                }
            });
        } catch {
            // The file path remains in the text so the agent can try reading it.
        }
    }
    return { type: 'user', message: { role: 'user', content } };
}

export class ClaudeStreamJsonAdapter implements ChatAdapter {
    constructor(private readonly executableOverride?: string) { }

    async info(): Promise<ChatAgentInfo> {
        const executable = this.executableOverride || await findClaude();
        if (!executable) {
            return {
                id: 'claude',
                name: 'Claude Code',
                installed: false,
                installHint: 'Claude Code をインストールしてください（npm install -g @anthropic-ai/claude-code）',
                transport: 'claude-stream-json', permissionModes: ['automatic', 'checkpoints'],
                permissionReasons: { every: '読み取りは確認しないため選べません' }
            };
        }
        return {
            id: 'claude',
            name: 'Claude Code',
            installed: true,
            installHint: 'Claude Code をインストールしてください（npm install -g @anthropic-ai/claude-code）',
            transport: 'claude-stream-json', permissionModes: ['automatic', 'checkpoints'],
            permissionReasons: { every: '読み取りは確認しないため選べません' }
        };
    }

    async start(opts: {
        cwd: string;
        resume?: string;
        model?: string;
        effort?: string;
        permission: ChatAdapterPermission;
    }): Promise<ChatAdapterSession> {
        if (opts.permission === 'every') throw new Error('Claude Code は毎回確認に対応していません');
        const executable = this.executableOverride || await findClaude();
        if (!executable) {
            throw new Error('not-installed');
        }
        return new ClaudeSession(executable, opts);
    }
}

class ClaudeSession implements ChatAdapterSession {
    private child?: ChildProcessWithoutNullStreams;
    private readonly parser: ClaudeStreamParser;
    private readonly listeners = new Set<(event: ChatEvent) => void>();
    private pending?: PendingTurn;
    private sendTail: Promise<void> = Promise.resolve();
    private ref: string;
    private stderr = '';
    private closed = false;
    private restart = false;
    private interrupted = false;
    private permissionRequest?: { id: string; input: Record<string, unknown>; child: ChildProcessWithoutNullStreams };

    constructor(
        private readonly executable: string,
        private readonly opts: {
            cwd: string;
            resume?: string;
            model?: string;
            effort?: string;
            permission: ChatAdapterPermission;
        }
    ) {
        this.ref = opts.resume || '';
        this.parser = new ClaudeStreamParser(opts.cwd, event => this.publish(event));
    }

    get sessionRef(): string {
        return this.ref;
    }

    async capabilities(): Promise<ChatCapabilities> {
        return {
            models: MODELS,
            efforts: EFFORTS,
            images: true,
            interrupt: true,
            clear: true,
            compact: true,
            resume: true,
            ask: true
        };
    }

    onEvent(listener: (event: ChatEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    private publish(event: ChatEvent): void {
        if (this.interrupted && this.pending && event.type === 'error') return;
        if (this.interrupted && this.pending && event.type === 'turn.end' && !event.ok) {
            event = { type: 'turn.end', ok: false, reason: 'interrupted' };
        }
        if (event.type === 'session') {
            this.ref = event.sessionId;
        }
        if (event.type === 'turn.end') {
            const pending = this.pending;
            if (pending) {
                clearTimeout(pending.timeout);
            }
            this.pending = undefined;
            if (event.ok) {
                pending?.resolve();
            } else {
                if (event.reason === 'interrupted') pending?.resolve();
                else pending?.reject(new Error(event.reason || 'turn failed'));
            }
        }
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // A disconnected frontend must not hold the process turn open.
            }
        }
    }

    private failTurn(child: ChildProcessWithoutNullStreams, message: string, reason = 'crashed'): void {
        if (!this.pending || this.pending.child !== child) {
            return;
        }
        const auth = /Not logged in|authentication_failed/i.test(message + this.stderr);
        if (!this.interrupted) {
            this.publish({
                type: 'error',
                kind: auth ? 'auth' : 'crashed',
                message: auth ? 'Claude Code でログインしてください' : message
            });
        }
        this.publish({
            type: 'turn.end',
            ok: false,
            reason: this.interrupted ? 'interrupted' : auth ? 'auth' : reason
        });
        this.restart = true;
    }

    private answerPermission(allow: boolean): Promise<void> {
        const pending = this.permissionRequest;
        this.permissionRequest = undefined;
        if (!pending || !pending.child.stdin.writable) return Promise.resolve();
        return new Promise(resolve => {
            pending.child.stdin.write(JSON.stringify({ type: 'control_response', response: {
                subtype: 'success', request_id: pending.id, response: allow
                    ? { behavior: 'allow', updatedInput: pending.input }
                    : { behavior: 'deny', message: '許可されませんでした' }
            } }) + '\n', () => resolve());
        });
    }

    private launch(): ChildProcessWithoutNullStreams {
        const args = [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',
            '--include-partial-messages'
        ];
        if (this.opts.permission === 'all') {
            args.push('--dangerously-skip-permissions');
        } else if (this.opts.permission === 'checkpoints') {
            args.push('--permission-mode', 'default', '--permission-prompt-tool', 'stdio');
        } else {
            args.push('--permission-mode', 'auto');
        }
        if (this.opts.model) {
            args.push('--model', this.opts.model);
        }
        if (this.opts.effort) {
            args.push('--effort', this.opts.effort);
        }
        if (this.ref) {
            args.push('--resume', this.ref);
        }
        args.push('--append-system-prompt', ASK_RULE);

        const child = spawn(this.executable, args, {
            cwd: this.opts.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false
        });
        this.child = child;
        this.restart = false;
        this.interrupted = false;
        this.stderr = '';
        let buffer = '';

        child.stdout.on('data', data => {
            if (this.child !== child) {
                return;
            }
            buffer += String(data);
            let end: number;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                if (!line.trim()) {
                    continue;
                }
                try {
                    const row = JSON.parse(line);
                    if (row.type === 'control_request' && row.request?.subtype === 'can_use_tool') {
                        if (this.permissionRequest) void this.answerPermission(false);
                        this.permissionRequest = { id: String(row.request_id), input: row.request.input || {}, child };
                        this.parser.permissionPending(String(row.request.tool_use_id || ''),
                            String(row.request.tool_name || 'Tool'), row.request.input || {});
                        const description = String(row.request.description || '').trim();
                        this.publish({ type: 'ask', id: `permission-${row.request_id}`,
                            question: `${row.request.tool_name || '操作'} を許可しますか？${description ? ` ${description}` : ''}`,
                            options: [{ label: '許可' }, { label: '拒否' }] });
                    } else this.parser.accept(row);
                } catch {
                    // A malformed line is isolated from the rest of the stream.
                }
            }
        });
        child.stderr.on('data', data => {
            if (this.child === child) {
                this.stderr = (this.stderr + String(data)).slice(-4000);
            }
        });
        child.stdin.on('close', () => {
            if (this.child !== child) {
                return;
            }
            this.restart = true;
            if (this.pending?.child === child && !this.pending.writeAcknowledged) {
                const error = Object.assign(new Error('input closed'), { code: 'EPIPE' });
                this.pending.onWriteError(error);
            }
        });
        child.stdin.on('error', error => {
            if (this.pending?.child === child && !this.pending.writeAcknowledged) {
                this.pending.onWriteError(error);
            } else {
                this.failTurn(child, `Claude Code に送れませんでした: ${error.message}`, 'write-failed');
            }
        });
        child.on('error', error => {
            this.failTurn(child, `Claude Code を起動できませんでした: ${error.message}`);
            if (this.child === child) {
                this.child = undefined;
            }
        });
        child.on('close', code => {
            if (this.child !== child) {
                return;
            }
            if (this.permissionRequest?.child === child) this.permissionRequest = undefined;
            if (this.pending?.child === child && !this.pending.writeAcknowledged) {
                const error = Object.assign(new Error(`process exited (${code})`), { code: 'EPIPE' });
                this.pending.onWriteError(error);
            } else {
                this.failTurn(child, `Claude Code が終了しました (${code})`);
            }
            if (this.child === child) {
                this.child = undefined;
            }
            this.restart = true;
        });
        return child;
    }

    private writableChild(): ChildProcessWithoutNullStreams {
        let child = this.child;
        if (this.restart || !child || child.stdin.destroyed || child.stdin.writableEnded || !child.stdin.writable) {
            if (child) {
                child.stdin.end();
                child.kill();
            }
            this.child = undefined;
            child = this.launch();
        }
        if (!child.stdin.writable || child.stdin.destroyed || child.stdin.writableEnded) {
            throw new Error('Claude Code の入力を開けませんでした');
        }
        return child;
    }

    private async sendOne(text: string, attachments: ChatAttachment[]): Promise<void> {
        if (this.closed) {
            throw new Error('closed');
        }
        const message = await claudeUserMessage(text, attachments, this.opts.cwd);
        let child: ChildProcessWithoutNullStreams;
        try {
            child = this.writableChild();
        } catch (error) {
            const messageText = String(error);
            this.publish({ type: 'error', kind: 'crashed', message: messageText });
            this.publish({ type: 'turn.end', ok: false, reason: 'write-failed' });
            throw error;
        }
        const line = JSON.stringify(message) + '\n';
        await new Promise<void>((resolve, reject) => {
            const attempt = (target: ChildProcessWithoutNullStreams, retries: number): void => {
                const timeout = setTimeout(() => {
                    this.failTurn(target, 'Claude Code の応答がありません', 'timeout');
                }, 300000);
                timeout.unref();
                const onWriteError = (error: Error & { code?: string }): void => {
                    if (this.pending?.child !== target) {
                        return;
                    }
                    const recoverable = ['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(error.code || '');
                    if (recoverable && retries === 0 && this.ref) {
                        clearTimeout(timeout);
                        this.pending = undefined;
                        if (this.child === target) {
                            this.child = undefined;
                        }
                        target.kill();
                        try {
                            attempt(this.launch(), 1);
                        } catch (launchError) {
                            this.publish({ type: 'error', kind: 'crashed', message: 'Claude Code を再起動できませんでした' });
                            this.publish({ type: 'turn.end', ok: false, reason: 'write-failed' });
                            reject(launchError);
                        }
                        return;
                    }
                    this.failTurn(target, `Claude Code に送れませんでした: ${error.message}`, 'write-failed');
                };
                this.pending = {
                    child: target,
                    resolve,
                    reject,
                    writeAcknowledged: false,
                    timeout,
                    onWriteError
                };
                try {
                    target.stdin.write(line, error => {
                        if (error) {
                            onWriteError(error);
                        } else if (this.pending?.child === target) {
                            this.pending.writeAcknowledged = true;
                        }
                    });
                } catch (error) {
                    onWriteError(error as Error);
                }
            };
            attempt(child, 0);
        });
    }

    send(text: string, attachments: ChatAttachment[]): Promise<void> {
        if (this.permissionRequest) {
            return this.answerPermission(text.trim() === '許可');
        }
        const next = this.sendTail.then(() => this.sendOne(text, attachments));
        this.sendTail = next.catch(() => undefined);
        return next;
    }

    async interrupt(): Promise<void> {
        await this.answerPermission(false);
        this.interrupted = true;
        this.restart = true;
        const child = this.child;
        if (!child) {
            return;
        }
        const finished = new Promise<void>(resolve => {
            const subscription = this.onEvent(event => {
                if (event.type === 'turn.end') {
                    subscription.dispose();
                    resolve();
                }
            });
            setTimeout(() => {
                subscription.dispose();
                resolve();
            }, 5000);
        });
        child.kill('SIGINT');
        await finished;
    }

    async setModel(model: string): Promise<void> {
        this.opts.model = model;
        this.restart = true;
    }

    async setEffort(effort: string): Promise<void> {
        this.opts.effort = effort;
        this.restart = true;
    }

    async clear(): Promise<void> {
        this.ref = '';
        this.restart = true;
    }

    async compact(): Promise<void> {
        await this.send('/compact', []);
    }

    async close(): Promise<void> {
        await this.answerPermission(false);
        this.closed = true;
        const child = this.child;
        this.child = undefined;
        child?.stdin.end();
        child?.kill();
        if (this.pending) {
            const pending = this.pending;
            if (pending) {
                clearTimeout(pending.timeout);
            }
            this.pending = undefined;
            clearTimeout(pending.timeout);
            pending.reject(new Error('closed'));
        }
    }
}
