import { t, compareText } from '@akari-video/i18n';
import { GATE_TYPES } from 'akari-project/lib/common/automation-events';
export interface HomeHistoryEntry { label: string; time: number; kind: 'event' | 'export' }

const EVENT_LABELS: Record<string, string> = {
    'project-created': t('surfaces.home.createdProject.label'),
    project_created: t('surfaces.home.createdProject.label'),
    'material-transcript': t('surfaces.home.transcription.label'),
    'report-generated': t('surfaces.home.analysisReport.label'),
    'report-approved': t('surfaces.home.approveReport.label'),
    'edit-completed': t('surfaces.home.finishedEditing.label'),
    'export-completed': t('surfaces.home.export.label'),
    'assets-imported': t('surfaces.home.assetsAdded.label'),
    assets_imported: t('surfaces.home.assetsAdded.label'),
    'plan-created': t('surfaces.home.madePlan.label'),
    plan_created: t('surfaces.home.madePlan.label'),
    'edit-created': t('surfaces.home.startedEditing.label'),
    edit_created: t('surfaces.home.startedEditing.label'),
    'report-created': t('surfaces.home.createdAnalysisReport.label'),
    report_created: t('surfaces.home.createdAnalysisReport.label'),
    'export-created': t('surfaces.home.exported.label'),
    export_created: t('surfaces.home.exported.label')
};

const requestedGates = new Map<string, string>();
const knownGates = new Set<string>(GATE_TYPES);
const gateLabel = (gate: string): string => knownGates.has(gate)
    ? t(`project.automation.gate.${gate.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())}`)
    : gate;

export function eventHistoryEntry(value: unknown, fallbackTime = 0): HomeHistoryEntry | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const event = value as Record<string, unknown>;
    if (typeof event.type !== 'string' || !event.type) return undefined;
    const rawTime = event.occurredAt ?? event.timestamp ?? event.at ?? event.created_at ?? event.createdAt;
    const parsedTime = typeof rawTime === 'number' ? rawTime : Date.parse(String(rawTime ?? ''));
    const time = Number.isFinite(parsedTime) ? parsedTime : fallbackTime;
    if (event.type === 'agent-action' && typeof event.summary === 'string') {
        const actor = event.actor === 'partner' ? 'partner' : event.actor === 'external' ? 'external' : event.actor === 'unattended' ? 'unattended' : undefined;
        if (actor) return { label: t('surfaces.home.history.agentAction', { actor: t(`surfaces.home.history.actor.${actor}`), summary: event.summary }), time, kind: 'event' };
    }
    if (event.type === 'gate-requested' && typeof event.gate === 'string' && typeof event.summary === 'string') {
        if (typeof event.requestId === 'string') requestedGates.set(event.requestId, event.gate);
        return { label: t('surfaces.home.history.gateRequested', { gate: gateLabel(event.gate), summary: event.summary }), time, kind: 'event' };
    }
    if (event.type === 'gate-resolved' && (event.decision === 'approved' || event.decision === 'declined')) {
        // Files are read concurrently; resolve the request ID after every event has been loaded.
        return { get label() {
            const gate = typeof event.gate === 'string' ? event.gate : requestedGates.get(String(event.requestId));
            return t(`surfaces.home.history.${event.decision}`, { gate: gate ? gateLabel(gate) : t('surfaces.home.history.gateUnknown') });
        }, time, kind: 'event' };
    }
    const eventLabel = EVENT_LABELS[event.type] ?? event.type;
    const label = event.by === 'partner' ? t('surfaces.home.partnerEvent.label', { event: eventLabel }) : event.by === 'user' ? t('surfaces.home.userEvent.label', { event: eventLabel }) : eventLabel;
    return { label, time, kind: 'event' };
}

export function exportHistoryEntry(name: string, time: number): HomeHistoryEntry {
    return { label: t('surfaces.home.exportHistoryEntryExport.label', { name: name }), time, kind: 'export' };
}

export function sortHomeHistory(entries: HomeHistoryEntry[]): HomeHistoryEntry[] {
    return [...entries].sort((a, b) => b.time - a.time || compareText(a.label, b.label));
}
