import type { ChatEvent } from '../common/chat-events';
import type { ChatAttachment } from '../common/chat-attachments';
import type { ChatCommand } from '../common/chat-protocol';

export type ChatMenuCommand = ChatCommand & { label?: string; local?: boolean };

export type TranscriptViewItem =
    | { type: 'user'; text: string; attachments: ChatAttachment[] }
    | { type: 'message'; id: string; text: string }
    | { type: 'thinking'; id: string; text: string; deltaText?: string; startedAt: number; open: boolean;
        status: 'running' | 'done' | 'error'; durationMs?: number }
    | { type: 'tool'; event: Extract<ChatEvent, { type: 'tool' }>; open?: boolean }
    | { type: 'files'; files: Extract<ChatEvent, { type: 'files' }>['files'] }
    | { type: 'ask'; event: Extract<ChatEvent, { type: 'ask' }> };

export function transcriptToItems(rows: { at: string; event: ChatEvent }[]): TranscriptViewItem[] {
    const items: TranscriptViewItem[] = [];
    let turnStart = 0;
    for (const { at, event } of rows) {
        if (event.type === 'user') items.push({ type: 'user', text: event.text, attachments: event.attachments });
        else if (event.type === 'message.start') items.push({ type: 'message', id: event.id, text: '' });
        else if (event.type === 'message.delta') {
            let item = items.slice(turnStart).reverse().find(row => row.type === 'message' && row.id === event.id);
            if (!item) { item = { type: 'message', id: event.id, text: '' }; items.push(item); }
            if (item.type === 'message') item.text += event.text;
        } else if (event.type === 'thinking.delta' || (event.type === 'tool' && event.kind === 'think')) {
            const previous = items.slice(turnStart).reverse().find(row => row.type === 'thinking' && row.id === event.id);
            const item = previous?.type === 'thinking' && (previous.status === 'running' || event.type === 'tool' && event.status !== 'running') ? previous : undefined;
            const thinking = item?.type === 'thinking' ? item : { type: 'thinking' as const,
                id: event.id, text: '', startedAt: Date.parse(at) || 0, open: false,
                status: 'running' as const };
            if (!item) items.push(thinking);
            if (event.type === 'thinking.delta') {
                thinking.deltaText = (thinking.deltaText || '') + event.text;
                if (thinking.deltaText.length > thinking.text.length) thinking.text = thinking.deltaText;
            }
            else {
                if (event.detail?.text && event.detail.text.length > thinking.text.length) thinking.text = event.detail.text;
                thinking.status = event.status;
                if (event.durationMs !== undefined) thinking.durationMs = event.durationMs;
            }
        } else if (event.type === 'tool') {
            let index = -1;
            for (let position = items.length - 1; position >= turnStart; position--) {
                const row = items[position];
                if (row.type === 'tool' && row.event.id === event.id
                    && (row.event.status === 'running' || event.status !== 'running')) { index = position; break; }
            }
            if (index < 0) items.push({ type: 'tool', event });
            else items[index] = { type: 'tool', event };
        } else if (event.type === 'files') items.push({ type: 'files', files: event.files });
        else if (event.type === 'ask') items.push({ type: 'ask', event });
        else if (event.type === 'turn.end') {
            for (const item of items) {
                if (item.type === 'thinking' && item.status === 'running') {
                    item.status = 'done';
                    item.durationMs = Math.max(0, Date.parse(at) - item.startedAt);
                }
            }
            turnStart = items.length;
        }
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

export function commandMatches(commands: ChatMenuCommand[], query: string): ChatMenuCommand[] {
    const needle = query.toLocaleLowerCase();
    if (!needle) return commands;
    const matches = [[], [], [], []] as ChatMenuCommand[][];
    for (const command of commands) {
        const name = command.name.toLocaleLowerCase();
        if (name.startsWith(needle)) matches[0].push(command);
        else if (name.split(':').slice(1).some(part => part.startsWith(needle))) matches[1].push(command);
        else if (name.includes(needle)) matches[2].push(command);
        else if (`${command.label || ''} ${command.description || ''}`.toLocaleLowerCase().includes(needle)) matches[3].push(command);
    }
    return matches.flat();
}

export function commandGroups(commands: ChatMenuCommand[]): { kind: 'skill' | 'command' | 'local'; label: string; rows: { command: ChatMenuCommand; index: number }[] }[] {
    return ([
        ['skill', 'スキル'], ['command', 'コマンド'], ['local', '会話操作']
    ] as const).map(([kind, label]) => ({
        kind, label,
        rows: commands.flatMap((command, index) =>
            (kind === 'local' ? !!command.local : command.kind === kind && !command.local) ? [{ command, index }] : [])
    })).filter(group => group.rows.length > 0);
}

export function commandMenuMaxHeight(panelTop: number, composerTop: number): number {
    return Math.max(0, Math.min(420, Math.floor(composerTop - panelTop - 88)));
}

export function thinkingLabel(startedAt: number, now: number, hasText: boolean, done = false, durationMs?: number): string {
    const seconds = Math.max(0, Math.floor((durationMs ?? now - startedAt) / 1000));
    if (done) return `考えました · ${seconds} 秒`;
    return hasText ? '考えています' : `考えています… ${seconds} 秒`;
}

export function showElapsedThinking(busy: boolean, turnHasActivity: boolean, hasThinking: boolean): boolean {
    return busy && !turnHasActivity && !hasThinking;
}

export function preparationReady(readyEventSeen: boolean): boolean {
    return readyEventSeen;
}

export function permissionLabel(permission: 'auto' | 'all' | 'checkpoints' | 'every'): string {
    return { auto: '自動', all: '自動', checkpoints: '要所で確認', every: '毎回確認' }[permission];
}

export function permissionSelection(permission: 'auto' | 'all' | 'checkpoints' | 'every'): 'automatic' | 'checkpoints' | 'every' {
    return permission === 'auto' || permission === 'all' ? 'automatic' : permission;
}

export function contextUsage(used?: number, limit?: number, completed = false): {
    state: 'known' | 'no-limit' | 'unavailable' | 'empty'; label: string; percentage: number
} {
    const number = (value: number): string => new Intl.NumberFormat('ja-JP').format(value);
    if (used === undefined) return completed
        ? { state: 'unavailable', label: 'この相手は使用量を表示できません', percentage: 0 }
        : { state: 'empty', label: 'まだ使用量はありません', percentage: 0 };
    if (!limit) return { state: 'no-limit', label: `使用量 ${number(used)} トークン（上限は分かりません）`, percentage: 0 };
    const percentage = Math.min(100, Math.round(used / limit * 100));
    return { state: 'known', label: `使用量 ${number(used)} / 上限 ${number(limit)} トークン · ${percentage}%`, percentage };
}

export function contextUsageLabel(used?: number, limit?: number, completed = false): string {
    return contextUsage(used, limit, completed).label;
}

export function restoreDraft<T>(queued: readonly { text: string; attachments: readonly T[] }[],
    currentText: string, currentAttachments: readonly T[]): { text: string; attachments: T[] } {
    return { text: [...queued.map(item => item.text).filter(Boolean), currentText].filter(Boolean).join('\n'),
        attachments: [...queued.flatMap(item => item.attachments), ...currentAttachments] };
}
