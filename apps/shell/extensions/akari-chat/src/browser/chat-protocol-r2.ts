// Temporary browser contract; move to common when the engine lane is integrated.
import type { ChatEvent } from '../common/chat-events';
import type { ChatAttachment } from '../common/chat-attachments';
import type { AkariChatService } from '../common/chat-protocol';
import type { ChatCapabilities } from '../common/chat-agent';

export type ChatEventR2 = ChatEvent
    | { type: 'ready' }
    | { type: 'capabilities'; capabilities: ChatCapabilities }
    | { type: 'model'; model?: string; effort?: string }
    | { type: 'thinking.delta'; id: string; text: string }
    | { type: 'user'; text: string; attachments: ChatAttachment[] };

export interface ChatServiceR2 extends AkariChatService {
    listCommands(chatId: string): Promise<ChatCommand[]>;
    contextInfo(chatId: string): Promise<ChatContextInfo>;
    getDefaults(agent: string): Promise<{ model?: string; effort?: string }>;
    setDefaults(agent: string, defaults: { model?: string; effort?: string }): Promise<void>;
    loadTranscript(cwd: string, historyId: string): Promise<{ at: string; event: ChatEventR2 }[]>;
}

export interface ChatCommand { name: string; label?: string; description?: string; kind: 'skill' | 'command'; local?: boolean }
export interface ChatContextInfo { usedTokens?: number; contextWindow?: number; model?: string; canCompact: boolean }

export type TranscriptViewItem =
    | { type: 'user'; text: string; attachments: ChatAttachment[] }
    | { type: 'message'; id: string; text: string }
    | { type: 'tool'; event: Extract<ChatEvent, { type: 'tool' }>; open?: boolean }
    | { type: 'files'; files: Extract<ChatEvent, { type: 'files' }>['files'] }
    | { type: 'ask'; event: Extract<ChatEvent, { type: 'ask' }> };

export function transcriptToItems(rows: { at: string; event: ChatEventR2 }[]): TranscriptViewItem[] {
    const items: TranscriptViewItem[] = [];
    for (const { event } of rows) {
        if (event.type === 'user') items.push({ type: 'user', text: event.text, attachments: event.attachments });
        else if (event.type === 'message.start') items.push({ type: 'message', id: event.id, text: '' });
        else if (event.type === 'message.delta') {
            let item = items.find(row => row.type === 'message' && row.id === event.id);
            if (!item) { item = { type: 'message', id: event.id, text: '' }; items.push(item); }
            if (item.type === 'message') item.text += event.text;
        } else if (event.type === 'tool') {
            const index = items.findIndex(row => row.type === 'tool' && row.event.id === event.id);
            if (index < 0) items.push({ type: 'tool', event });
            else items[index] = { type: 'tool', event };
        } else if (event.type === 'files') items.push({ type: 'files', files: event.files });
        else if (event.type === 'ask') items.push({ type: 'ask', event });
    }
    return items;
}

export async function optionalRpc<T>(call: () => Promise<T>, timeoutMs = 700): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([call(), new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), timeoutMs);
        })]);
    } catch { return undefined; }
    finally { if (timer) clearTimeout(timer); }
}

export function commandMatches(commands: ChatCommand[], query: string): ChatCommand[] {
    const needle = query.toLocaleLowerCase();
    return commands.filter(command => `${command.name} ${command.label || ''} ${command.description || ''}`.toLocaleLowerCase().includes(needle));
}

export function commandGroups(commands: ChatCommand[]): { kind: 'skill' | 'command' | 'local'; label: string; rows: { command: ChatCommand; index: number }[] }[] {
    return ([
        ['skill', 'スキル'], ['command', 'コマンド'], ['local', '会話操作']
    ] as const).map(([kind, label]) => ({
        kind, label,
        rows: commands.flatMap((command, index) =>
            (kind === 'local' ? !!command.local : command.kind === kind && !command.local) ? [{ command, index }] : [])
    })).filter(group => group.rows.length > 0);
}

export function thinkingLabel(startedAt: number, now: number, hasText: boolean): string {
    return hasText ? '考えています' : `考えています… ${Math.max(0, Math.floor((now - startedAt) / 1000))} 秒`;
}

export function showElapsedThinking(busy: boolean, turnHasActivity: boolean, hasThinking: boolean): boolean {
    return busy && !turnHasActivity && !hasThinking;
}

export function preparationReady(startReturned: boolean, r2Known: boolean, readyEventSeen: boolean): boolean {
    return readyEventSeen || (startReturned && !r2Known);
}

export function permissionLabel(permission: 'auto' | 'all' | 'checkpoints' | 'every'): string {
    return { auto: '自動', all: '自動', checkpoints: '要所で確認', every: '毎回確認' }[permission];
}

export function permissionSelection(permission: 'auto' | 'all' | 'checkpoints' | 'every'): 'automatic' | 'checkpoints' | 'every' {
    return permission === 'auto' || permission === 'all' ? 'automatic' : permission;
}

export function contextUsageLabel(used?: number, limit?: number): string {
    const number = (value: number): string => new Intl.NumberFormat('ja-JP').format(value);
    const percentage = limit && used !== undefined ? `${Math.min(100, Math.round(used / limit * 100))}%` : '—%';
    return `使用量 ${used === undefined ? '—' : number(used)} / 上限 ${limit ? number(limit) : '—'} トークン · ${percentage}`;
}
