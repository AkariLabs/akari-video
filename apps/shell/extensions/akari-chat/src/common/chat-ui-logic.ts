import type { ChatAgentInfo, ChatCapabilities, ChatAdapterPermission } from './chat-agent';
import type { ChatEvent } from './chat-events';

export function modelChoices(models: ChatCapabilities['models'], query: string, recent: readonly string[], current?: string): {
    frequent: ChatCapabilities['models']; matches: ChatCapabilities['models']
} {
    const needle = query.trim().toLocaleLowerCase();
    const matches = models.filter(model => `${model.id} ${model.label}`.toLocaleLowerCase().includes(needle));
    const ids = [...new Set([current, ...recent].filter((id): id is string => !!id))].slice(0, 3);
    const frequent = needle ? [] : ids.map(id => models.find(model => model.id === id))
        .filter((model): model is ChatCapabilities['models'][number] => !!model);
    return { frequent, matches };
}

export function modelLabel(models: ChatCapabilities['models'], chosen?: string, actual?: string): string {
    const exact = (id?: string): ChatCapabilities['models'][number] | undefined =>
        id ? models.find(model => model.id.toLocaleLowerCase() === id.toLocaleLowerCase()) : undefined;
    const label = (id?: string): string | undefined => {
        if (!id) return undefined;
        const normalized = id.toLocaleLowerCase();
        return exact(id)?.label || models.find(model => normalized.includes(model.id.toLocaleLowerCase()))?.label
            || (['opus', 'sonnet', 'haiku', 'fable'] as const).find(family =>
            new RegExp(`(?:^|[-_/:.])${family}(?:[-_/:.]|$)`, 'i').test(normalized)
        )?.replace(/^./, first => first.toUpperCase());
    };
    const fallback = (id?: string): string | undefined => id?.split(/[/:]/).filter(Boolean).pop();
    return label(chosen) || label(actual) || fallback(chosen) || fallback(actual) || '既定';
}

export function resumeFailure(error: Extract<ChatEvent, { type: 'error' }>, beforeReady: boolean, firstTurn: boolean): boolean {
    if (error.kind === 'auth' || error.kind === 'not-installed' || error.kind === 'rate-limit') return false;
    return beforeReady || /no (?:conversation|rollout|thread|session) found/i.test(error.message)
        || firstTurn && /error_during_execution/i.test(error.message);
}

export function chatErrorPresentation(error: Extract<ChatEvent, { type: 'error' }>, agentName: string, initial: boolean, agentId: string, resumeFailed = false): {
    heading?: string; reason: string; nextStep: boolean
} {
    const unsupported = agentId === 'gemini' && /no longer supported|Antigravity/i.test(error.message);
    return {
        ...(error.kind === 'auth' ? { heading: `${agentName} にログインが必要です` } : {}),
        reason: resumeFailed ? 'この会話は開けません。相手側に会話が残っていません。' : unsupported
            ? 'Gemini CLI は個人向けの Google ログインでは使えなくなりました（Antigravity へ移行）。'
            : error.message,
        nextStep: resumeFailed || initial || error.kind === 'auth' || error.kind === 'not-installed'
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

export function permissionOption(mode: ChatPermission, preference: PartnerPermission, agent?: ChatAgentInfo): {
    permission: ChatAdapterPermission; available: boolean; reason?: string
} {
    if (mode === 'automatic') return { permission: preference === 'bypass' ? 'all' : 'auto', available: true };
    const supported = agent?.permissionModes || ['automatic'];
    return supported.includes(mode) ? { permission: mode, available: true }
        : { permission: mode, available: false,
            reason: agent?.permissionReasons?.[mode] || 'この相手では選べません' };
}

export function availableChatPermission(mode: ChatPermission, preference: PartnerPermission, agent?: ChatAgentInfo): ChatAdapterPermission {
    const option = permissionOption(mode, preference, agent);
    return option.available ? option.permission : permissionOption('automatic', 'auto', agent).permission;
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
