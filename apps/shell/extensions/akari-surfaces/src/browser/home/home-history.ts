export interface HomeHistoryEntry { label: string; time: number; kind: 'event' | 'export' }

const EVENT_LABELS: Record<string, string> = {
    'project-created': 'プロジェクトを作った',
    project_created: 'プロジェクトを作った',
    'assets-imported': '素材を入れた',
    assets_imported: '素材を入れた',
    'plan-created': '企画書を作った',
    plan_created: '企画書を作った',
    'edit-created': '編集を始めた',
    edit_created: '編集を始めた',
    'report-created': '分析レポートを作った',
    report_created: '分析レポートを作った',
    'export-created': '書き出した',
    export_created: '書き出した'
};

export function eventHistoryEntry(value: unknown, fallbackTime = 0): HomeHistoryEntry | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const event = value as Record<string, unknown>;
    if (typeof event.type !== 'string' || !event.type) return undefined;
    const rawTime = event.timestamp ?? event.at ?? event.created_at ?? event.createdAt;
    const parsedTime = typeof rawTime === 'number' ? rawTime : Date.parse(String(rawTime ?? ''));
    return { label: EVENT_LABELS[event.type] ?? event.type, time: Number.isFinite(parsedTime) ? parsedTime : fallbackTime, kind: 'event' };
}

export function exportHistoryEntry(name: string, time: number): HomeHistoryEntry {
    return { label: `書き出し（${name}）`, time, kind: 'export' };
}

export function sortHomeHistory(entries: HomeHistoryEntry[]): HomeHistoryEntry[] {
    return [...entries].sort((a, b) => b.time - a.time || a.label.localeCompare(b.label, 'ja'));
}
