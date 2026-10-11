import type { ChatCapabilities } from './chat-agent';
import type { ChatEvent } from './chat-events';

export function modelChoices(models: ChatCapabilities['models'], query: string, recent: readonly string[], current?: string): {
    frequent: ChatCapabilities['models']; matches: ChatCapabilities['models']
} {
    const needle = query.trim().toLocaleLowerCase();
    const matches = models.filter(model => `${model.id} ${model.label}`.toLocaleLowerCase().includes(needle));
    const ids = [...new Set([current, ...recent].filter((id): id is string => !!id))].slice(0, 5);
    const frequent = needle ? [] : ids.map(id => models.find(model => model.id === id))
        .filter((model): model is ChatCapabilities['models'][number] => !!model);
    return { frequent, matches };
}

export function modelLabel(models: ChatCapabilities['models'], chosen?: string, actual?: string): string {
    const exact = (id?: string): ChatCapabilities['models'][number] | undefined =>
        id ? models.find(model => model.id.toLocaleLowerCase() === id.toLocaleLowerCase()) : undefined;
    const selected = exact(chosen) || exact(actual);
    if (selected) return selected.label;
    const current = actual?.toLocaleLowerCase();
    const contained = current ? models.find(model => current.includes(model.id.toLocaleLowerCase())) : undefined;
    return contained?.label || actual || chosen || '既定';
}

export function chatErrorPresentation(error: Extract<ChatEvent, { type: 'error' }>, agentName: string, initial: boolean): {
    heading?: string; reason: string; nextStep: boolean
} {
    const unsupported = /no longer supported|Antigravity/i.test(error.message);
    return {
        ...(error.kind === 'auth' ? { heading: `${agentName} にログインが必要です` } : {}),
        reason: unsupported
            ? 'Gemini CLI は個人向けの Google ログインでは使えなくなりました（Antigravity へ移行）。'
            : error.message,
        nextStep: initial || error.kind === 'auth' || error.kind === 'not-installed'
    };
}

export function latestResumableHistory<T extends { agent: string; sessionRef: string; updatedAt: string }>(
    history: readonly T[], installedAgents: ReadonlySet<string>
): T | undefined {
    return history.filter(entry => !!entry.sessionRef && installedAgents.has(entry.agent))
        .reduce<T | undefined>((latest, entry) => !latest || entry.updatedAt > latest.updatedAt ? entry : latest, undefined);
}

export function isCurrentHistory(historyId: string, chatId?: string, openingHistoryId?: string): boolean {
    return historyId === chatId || historyId === openingHistoryId;
}

export type ChatPermission = 'automatic' | 'checkpoints' | 'every';
export type PartnerPermission = 'auto' | 'ask' | 'bypass';

export function partnerPermission(value: unknown): PartnerPermission {
    return value === 'ask' || value === 'bypass' ? value : 'auto';
}

export function initialChatPermission(preference: PartnerPermission): ChatPermission {
    return preference === 'ask' ? 'checkpoints' : 'automatic';
}

export function partnerPermissionAfterChoice(mode: ChatPermission, current: PartnerPermission): PartnerPermission {
    if (mode === 'checkpoints') return current;
    if (mode === 'every') return 'ask';
    return current === 'bypass' ? 'bypass' : 'auto';
}

export function permissionOption(mode: ChatPermission, preference: PartnerPermission, capabilities?: ChatCapabilities): {
    permission: 'auto' | 'all'; available: boolean; reason?: string
} {
    if (mode === 'automatic') return { permission: preference === 'bypass' ? 'all' : 'auto', available: true };
    if (mode === 'checkpoints') return { permission: 'auto', available: true };
    return { permission: 'auto', available: false,
        reason: capabilities?.ask ? 'この相手は毎回確認の開始設定に対応していません'
            : 'この相手は毎回の確認に対応していません' };
}

export function connectorPrefill(name: string, example?: string): string {
    const text = example?.trim() || '素材を作って';
    return text.startsWith(name) ? text : `${name} で${text}`;
}

export function runningTools(events: readonly ChatEvent[]): Extract<ChatEvent, { type: 'tool' }>[] {
    const latest = new Map<string, Extract<ChatEvent, { type: 'tool' }>>();
    for (const event of events) if (event.type === 'tool') latest.set(event.id, event);
    return [...latest.values()].filter(event => event.status === 'running');
}
