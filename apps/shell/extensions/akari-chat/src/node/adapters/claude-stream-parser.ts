import { basename, extname, isAbsolute, relative } from 'path';
import type { ChatEvent, ToolKind } from '../../common/chat-events';

type Json = Record<string, any>;

type StreamBlock = {
    index: number;
    messageId: string;
    type: string;
    id: string;
    name?: string;
    input: string;
    text: string;
    flushed: number;
    started: boolean;
    at: number;
    matchedAssistant: boolean;
};

type TrackedTool = {
    kind: ToolKind;
    title: string;
    detail: NonNullable<Extract<ChatEvent, { type: 'tool' }>['detail']>;
    at: number;
};

const ASK_FENCE = /```akari-ask\s*([\s\S]*?)```/g;

function valueText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(valueText).join('\n');
    }
    if (value && typeof value === 'object') {
        return JSON.stringify(value);
    }
    return '';
}

function toolKind(name: string): ToolKind {
    if (/^(Read|Glob|Grep)$/.test(name)) {
        return 'read';
    }
    if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) {
        return 'write';
    }
    if (name === 'Bash') {
        return 'command';
    }
    if (name === 'Skill') {
        return 'skill';
    }
    if (/^Web(Search|Fetch)$/.test(name)) {
        return 'web';
    }
    return 'other';
}

function fileKind(path: string): 'video' | 'image' | 'html' | 'audio' | 'other' {
    const extension = extname(path).toLowerCase();
    if (/\.(mp4|mov|webm)$/.test(extension)) {
        return 'video';
    }
    if (/\.(png|jpg|jpeg|webp)$/.test(extension)) {
        return 'image';
    }
    if (/\.(mp3|wav|m4a)$/.test(extension)) {
        return 'audio';
    }
    if (/\.(html|htm)$/.test(extension)) {
        return 'html';
    }
    return 'other';
}

function diffFromResult(result: Json): { added: number; removed: number; patch?: string } | undefined {
    if (!Array.isArray(result.structuredPatch)) {
        return undefined;
    }
    const lines: string[] = result.structuredPatch.flatMap((entry: Json) =>
        Array.isArray(entry.lines) ? entry.lines.map(valueText) : []
    );
    return {
        added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
        removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
        patch: lines.join('\n')
    };
}

export class ClaudeStreamParser {
    initialized = false;
    sessionId = '';
    model = '';
    slashCommands: string[] = [];
    skills: string[] = [];

    private currentMessageId = '';
    private blocks = new Map<number, StreamBlock>();
    private streamBlocks: StreamBlock[] = [];
    private tools = new Map<string, TrackedTool>();
    private emittedFiles = new Set<string>();
    private textCounter = 0;
    private compacted = false;
    private emittedError = false;

    constructor(
        private readonly cwd: string,
        private readonly emit: (event: ChatEvent) => void
    ) { }

    private displayPath(path: string): string {
        if (!isAbsolute(path)) {
            return path;
        }
        const candidate = relative(this.cwd, path);
        return candidate && candidate !== '..' && !candidate.startsWith('../') && !isAbsolute(candidate)
            ? candidate
            : path;
    }

    private error(kind: 'auth' | 'rate-limit' | 'other', message: string): void {
        if (!this.emittedError) {
            this.emit({ type: 'error', kind, message });
        }
        this.emittedError = true;
    }

    private emitAsk(id: string, json: string): boolean {
        try {
            const parsed = JSON.parse(json) as {
                question?: string;
                options?: { label: string; description?: string }[];
            };
            if (!parsed.question || !Array.isArray(parsed.options)) {
                return false;
            }
            this.emit({ type: 'ask', id, question: parsed.question, options: parsed.options });
            return true;
        } catch {
            return false;
        }
    }

    private emitVisible(block: StreamBlock, text: string): void {
        if (!text) {
            return;
        }
        if (!block.started) {
            this.emit({ type: 'message.start', id: block.id, role: 'assistant' });
            block.started = true;
        }
        this.emit({ type: 'message.delta', id: block.id, text });
    }

    private flushText(block: StreamBlock, final: boolean): void {
        const remaining = block.text.slice(block.flushed);
        const marker = remaining.indexOf('```akari-ask');
        let suffix = 0;
        if (!final && marker < 0) {
            const fence = '```akari-ask';
            for (let length = 1; length < fence.length; length++) {
                if (remaining.endsWith(fence.slice(0, length))) suffix = length;
            }
        }
        const safeLength = marker >= 0 ? marker : remaining.length - suffix;
        this.emitVisible(block, remaining.slice(0, safeLength));
        block.flushed += safeLength;
        if (!final) {
            return;
        }

        const tail = block.text.slice(block.flushed);
        let cursor = 0;
        for (const match of tail.matchAll(ASK_FENCE)) {
            this.emitVisible(block, tail.slice(cursor, match.index));
            this.emitAsk(`${block.id}-ask`, match[1]);
            cursor = (match.index || 0) + match[0].length;
        }
        const after = tail.slice(cursor);
        if (!after.startsWith('```akari-ask')) {
            this.emitVisible(block, after);
        }
        if (block.started) {
            this.emit({ type: 'message.end', id: block.id });
        }
    }

    private emitCompleteText(text: string, id: string): void {
        const block: StreamBlock = {
            index: 0,
            messageId: '',
            type: 'text',
            id,
            input: '',
            text,
            flushed: 0,
            started: false,
            at: Date.now(),
            matchedAssistant: false
        };
        this.flushText(block, true);
    }

    private toolTitle(kind: ToolKind, input: Json, name: string): string {
        const raw = input.file_path || input.path || input.pattern || input.command ||
            input.skill || input.query || input.url || name;
        const target = kind === 'read' || kind === 'write'
            ? this.displayPath(String(raw))
            : String(raw);
        const verbs: Record<ToolKind, string> = {
            think: '考えました',
            read: '読みました',
            write: '書きました',
            command: '実行しました',
            search: '調べました',
            skill: '使いました',
            web: '調べました',
            other: '使いました'
        };
        return `${verbs[kind]} ${target}`;
    }

    private tool(block: Json): void {
        const id = block.id || `tool-${this.tools.size}`;
        const name = block.name || 'Tool';
        const input = block.input || {};
        if (name === 'AskUserQuestion') {
            const question = input.questions?.[0] || input;
            this.emit({
                type: 'ask',
                id,
                question: question.question || '選んでください',
                options: question.options || []
            });
            return;
        }
        if (this.tools.has(id)) {
            return;
        }

        const kind = toolKind(name);
        const title = this.toolTitle(kind, input, name);
        const detail: TrackedTool['detail'] = kind === 'command'
            ? { command: input.command }
            : kind === 'read' || kind === 'write'
                ? { path: input.file_path || input.path ? this.displayPath(input.file_path || input.path) : undefined }
                : { text: valueText(input) };
        this.tools.set(id, { kind, title, detail, at: Date.now() });
        this.emit({ type: 'tool', id, kind, title, status: 'running', detail });
    }

    private toolStatusTitle(tracked: TrackedTool, verb: string): string {
        const target = tracked.title.split(' ').slice(1).join(' ');
        return [verb, target].filter(Boolean).join(' ');
    }

    permissionPending(toolUseId: string, name: string, input: Json): void {
        if (!toolUseId) return;
        if (!this.tools.has(toolUseId)) this.tool({ id: toolUseId, name, input });
        const tracked = this.tools.get(toolUseId);
        if (!tracked) return;
        const verbs: Record<ToolKind, string> = { think: '考えています', read: '読んでいます', write: '書いています',
            command: '実行しています', search: '調べています', skill: '使っています', web: '調べています', other: '操作しています' };
        this.emit({ type: 'tool', id: toolUseId, kind: tracked.kind,
            title: this.toolStatusTitle(tracked, verbs[tracked.kind]), status: 'running', detail: tracked.detail });
    }

    private completeTool(block: Json, outer: Json): void {
        const tracked = this.tools.get(block.tool_use_id);
        if (!tracked) {
            return;
        }
        const diff = diffFromResult(outer.tool_use_result || {});
        const detail = {
            ...tracked.detail,
            output: valueText(block.content),
            ...(diff ? { diff } : {})
        };
        const blocked = block.is_error && /permission|denied|rejected|拒否|許可/i.test(valueText(block.content));
        this.emit({
            type: 'tool',
            id: block.tool_use_id,
            kind: tracked.kind,
            title: block.is_error ? this.toolStatusTitle(tracked, blocked ? '止められました' : '失敗しました') : tracked.title,
            status: block.is_error ? 'error' : 'done',
            detail,
            durationMs: Date.now() - tracked.at
        });

        if (block.is_error || tracked.kind !== 'write' || !detail.path || this.emittedFiles.has(detail.path)) {
            return;
        }
        this.emittedFiles.add(detail.path);
        this.emit({
            type: 'files',
            files: [{ path: detail.path, label: basename(detail.path), kind: fileKind(detail.path) }]
        });
    }

    private acceptStream(event: Json): void {
        if (event.type === 'message_start') {
            this.currentMessageId = event.message?.id || '';
            return;
        }
        if (event.type === 'content_block_start') {
            const content = event.content_block || {};
            const index = Number(event.index);
            const messageId = this.currentMessageId;
            const block: StreamBlock = {
                index,
                messageId,
                type: content.type,
                id: content.id || `m-${messageId || ++this.textCounter}-${index}`,
                name: content.name,
                input: content.input && Object.keys(content.input).length ? JSON.stringify(content.input) : '',
                text: content.text || '',
                flushed: 0,
                started: false,
                at: Date.now(),
                matchedAssistant: false
            };
            this.blocks.set(index, block);
            this.streamBlocks.push(block);
            return;
        }
        if (event.type === 'content_block_delta') {
            const block = this.blocks.get(Number(event.index));
            if (!block) {
                return;
            }
            if (event.delta?.type === 'text_delta' || event.delta?.type === 'thinking_delta') {
                const delta = event.delta.text || event.delta.thinking || '';
                block.text += delta;
                if (block.type === 'text') {
                    this.flushText(block, false);
                } else if (block.type === 'thinking' && delta) {
                    this.emit({ type: 'thinking.delta', id: block.id, text: delta });
                }
            }
            if (event.delta?.type === 'input_json_delta') {
                block.input += event.delta.partial_json || '';
            }
            return;
        }
        if (event.type !== 'content_block_stop') {
            return;
        }
        const block = this.blocks.get(Number(event.index));
        if (!block) {
            return;
        }
        if (block.type === 'text') {
            this.flushText(block, true);
        } else if (block.type === 'thinking') {
            this.emit({
                type: 'tool',
                id: block.id,
                kind: 'think',
                title: '考えました',
                status: 'done',
                detail: { text: block.text || '考えました' },
                durationMs: Date.now() - block.at
            });
        } else if (block.type === 'tool_use') {
            let input: Json = {};
            try {
                input = JSON.parse(block.input);
            } catch {
                // The assistant row can still contain the complete input.
            }
            this.tool({ id: block.id, name: block.name, input });
        }
        this.blocks.delete(Number(event.index));
    }

    private acceptAssistant(row: Json): void {
        const content = row.message?.content || [];
        if (row.error === 'authentication_failed' ||
            content.some((block: Json) => /Not logged in/i.test(valueText(block.text)))) {
            this.error('auth', 'Claude Code でログインしてください');
        }
        for (const [index, block] of content.entries()) {
            const streamed = this.streamBlocks.find(candidate =>
                !candidate.matchedAssistant &&
                candidate.messageId === (row.message?.id || candidate.messageId) &&
                candidate.type === block.type &&
                (block.type !== 'tool_use' || candidate.id === block.id)
            );
            if (streamed) {
                streamed.matchedAssistant = true;
                continue;
            }
            if (block.type === 'thinking') {
                this.emit({
                    type: 'tool',
                    id: `think-${row.message?.id || 'fallback'}-${index}`,
                    kind: 'think',
                    title: '考えました',
                    status: 'done',
                    detail: { text: block.thinking || '考えました' }
                });
            } else if (block.type === 'tool_use') {
                this.tool(block);
            } else if (block.type === 'text' && row.error !== 'authentication_failed') {
                this.emitCompleteText(block.text || '', `m-${row.message?.id || ++this.textCounter}-${index}`);
            }
        }
    }

    private acceptResult(row: Json): void {
        if (/Not logged in/i.test(row.result || '')) {
            this.error('auth', 'Claude Code でログインしてください');
        }
        const usage = row.usage?.iterations?.at(-1) || row.usage;
        const usedTokens = [
            'input_tokens',
            'cache_read_input_tokens',
            'cache_creation_input_tokens',
            'output_tokens'
        ].reduce((total, key) => total + (usage?.[key] || 0), 0);
        if (usage && !(this.compacted && usedTokens === 0)) {
            this.emit({
                type: 'usage',
                usedTokens,
                contextWindow: row.modelUsage?.[this.model]?.contextWindow
            });
        }
        this.emit({
            type: 'turn.end',
            ok: !row.is_error && row.subtype !== 'error_during_execution',
            reason: row.is_error || row.subtype === 'error_during_execution' ? row.result || row.subtype : undefined
        });
        this.compacted = false;
        this.emittedError = false;
        this.emittedFiles.clear();
        this.streamBlocks = [];
        this.blocks.clear();
        this.tools.clear();
    }

    accept(row: Json): void {
        if (row.type === 'system' && row.subtype === 'init') {
            this.initialized = true;
            this.sessionId = row.session_id || this.sessionId;
            this.model = row.model || this.model;
            this.slashCommands = row.slash_commands || [];
            this.skills = row.skills || [];
            this.emit({
                type: 'session',
                sessionId: this.sessionId,
                agent: 'claude',
                model: this.model,
                cwd: this.cwd
            });
            return;
        }
        if (row.type === 'system' && row.subtype === 'compact_boundary') {
            const post = row.compact_metadata?.post_tokens;
            if (typeof post === 'number') {
                this.emit({ type: 'usage', usedTokens: post });
            }
            this.compacted = true;
            return;
        }
        if (row.type === 'rate_limit_event') {
            const status = row.rate_limit_info?.status || row.status || '';
            if (/reject|error|limit/i.test(String(status))) {
                this.error('rate-limit', '利用制限に達しました');
            }
            return;
        }
        if (row.type === 'stream_event') {
            this.acceptStream(row.event || {});
            return;
        }
        if (row.type === 'assistant') {
            this.acceptAssistant(row);
            return;
        }
        if (row.type === 'user') {
            for (const block of row.message?.content || []) {
                if (block.type === 'tool_result') {
                    this.completeTool(block, row);
                }
            }
            return;
        }
        if (row.type === 'result') {
            this.acceptResult(row);
        }
    }
}
