import { t, compareText } from '@akari-video/i18n';
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

export function eventHistoryEntry(value: unknown, fallbackTime = 0): HomeHistoryEntry | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const event = value as Record<string, unknown>;
    if (typeof event.type !== 'string' || !event.type) return undefined;
    const rawTime = event.timestamp ?? event.at ?? event.created_at ?? event.createdAt;
    const parsedTime = typeof rawTime === 'number' ? rawTime : Date.parse(String(rawTime ?? ''));
    const eventLabel = EVENT_LABELS[event.type] ?? event.type;
    const label = event.by === 'partner' ? t('surfaces.home.partnerEvent.label', { event: eventLabel }) : event.by === 'user' ? t('surfaces.home.userEvent.label', { event: eventLabel }) : eventLabel;
    return { label, time: Number.isFinite(parsedTime) ? parsedTime : fallbackTime, kind: 'event' };
}

export function exportHistoryEntry(name: string, time: number): HomeHistoryEntry {
    return { label: t('surfaces.home.exportHistoryEntryExport.label', { name: name }), time, kind: 'export' };
}

export function sortHomeHistory(entries: HomeHistoryEntry[]): HomeHistoryEntry[] {
    return [...entries].sort((a, b) => b.time - a.time || compareText(a.label, b.label));
}
