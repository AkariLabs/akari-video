import type { ChatCapabilities } from './chat-agent';
import type { ChatEvent } from './chat-events';

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
