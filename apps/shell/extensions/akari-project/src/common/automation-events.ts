/** The gate vocabulary is deliberately closed. */
export const GATE_TYPES = [
    'publish', 'lab-submit', 'paid', 'external-send', 'delete-original',
    'license', 'playbook-checkpoint', 'human-asked'
] as const;
export type GateType = typeof GATE_TYPES[number];
export type ActionActor = 'partner' | 'external' | 'unattended';

interface EventBase { version: 1; id: string; occurredAt: string; [key: string]: unknown }
export interface AgentActionEvent extends EventBase {
    type: 'agent-action'; actor: ActionActor; summary: string; files: string[]; skill?: string;
}
export interface GateRequestedEvent extends EventBase {
    type: 'gate-requested'; gate: GateType; requestId: string; summary: string; detail?: string;
}
export interface GateResolvedEvent extends EventBase {
    type: 'gate-resolved'; requestId: string; decision: 'approved' | 'declined'; by: 'human';
}
export type AutomationEvent = AgentActionEvent | GateRequestedEvent | GateResolvedEvent;

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** Unknown types and damaged files are ignored; additional fields survive parsing. */
export function readAutomationEvent(value: unknown): AutomationEvent | undefined {
    if (!record(value) || value.version !== 1 || !nonempty(value.id) || !nonempty(value.occurredAt)) return undefined;
    if (value.type === 'agent-action' && ['partner', 'external', 'unattended'].includes(String(value.actor))
        && nonempty(value.summary) && !/[\r\n]/.test(value.summary)
        && Array.isArray(value.files) && value.files.every(nonempty)) {
        return value as unknown as AgentActionEvent;
    }
    if (value.type === 'gate-requested' && GATE_TYPES.includes(value.gate as GateType)
        && nonempty(value.requestId) && nonempty(value.summary)
        && (value.detail === undefined || typeof value.detail === 'string')) {
        return value as unknown as GateRequestedEvent;
    }
    if (value.type === 'gate-resolved' && nonempty(value.requestId)
        && (value.decision === 'approved' || value.decision === 'declined') && value.by === 'human') {
        return value as unknown as GateResolvedEvent;
    }
    return undefined;
}

export function readAutomationEvents(contents: readonly string[]): AutomationEvent[] {
    return contents.flatMap(content => {
        try { const event = readAutomationEvent(JSON.parse(content)); return event ? [event] : []; }
        catch { return []; }
    });
}

export function unresolvedGates(events: readonly AutomationEvent[]): GateRequestedEvent[] {
    const resolved = new Set(events.filter((event): event is GateResolvedEvent => event.type === 'gate-resolved')
        .map(event => event.requestId));
    const seen = new Set<string>();
    return events.filter((event): event is GateRequestedEvent => {
        if (event.type !== 'gate-requested' || resolved.has(event.requestId) || seen.has(event.requestId)) return false;
        seen.add(event.requestId);
        return true;
    }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}
