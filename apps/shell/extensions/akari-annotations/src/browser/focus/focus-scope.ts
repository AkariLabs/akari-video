import { childRow, parentRow, TimelineTreeRow } from '../timeline/timeline-tree-model';

export interface FocusScopeState {
    rootId: string | null;
    breadcrumbs: string[];
    span: { at: number; duration: number };
}

export type TimelineDoubleClickAction = 'focus' | 'trimmer';

export function initialFocusScope(rows: readonly TimelineTreeRow[]): FocusScopeState {
    return { rootId: null, breadcrumbs: ['全体'], span: spanOfRows(rows) };
}

export function enterFocusScope(
    rows: readonly TimelineTreeRow[],
    targetId: string
): FocusScopeState {
    const target = rows.find(row => row.id === targetId);
    if (!target) throw new Error(`フォーカス対象が見つかりません: ${targetId}`);
    const lineage: TimelineTreeRow[] = [];
    let cursor: TimelineTreeRow | undefined = target;
    while (cursor) {
        lineage.unshift(cursor);
        cursor = parentRow(rows, cursor.id);
    }
    return {
        rootId: target.id,
        breadcrumbs: ['全体', ...lineage.map(row => row.label)],
        span: { at: target.at, duration: target.duration }
    };
}

export function exitFocusScope(
    rows: readonly TimelineTreeRow[],
    state: FocusScopeState
): FocusScopeState {
    if (state.rootId === null) return initialFocusScope(rows);
    const parent = parentRow(rows, state.rootId);
    return parent ? enterFocusScope(rows, parent.id) : initialFocusScope(rows);
}

export function focusScopeAtBreadcrumb(
    rows: readonly TimelineTreeRow[],
    state: FocusScopeState,
    breadcrumbIndex: number
): FocusScopeState {
    if (breadcrumbIndex <= 0 || state.rootId === null) return initialFocusScope(rows);
    const lineage: TimelineTreeRow[] = [];
    let cursor = rows.find(row => row.id === state.rootId);
    while (cursor) {
        lineage.unshift(cursor);
        cursor = parentRow(rows, cursor.id);
    }
    const target = lineage[breadcrumbIndex - 1];
    return target ? enterFocusScope(rows, target.id) : state;
}

export function rowsInFocusScope(
    rows: readonly TimelineTreeRow[],
    state: FocusScopeState
): TimelineTreeRow[] {
    if (state.rootId === null) return [...rows];
    const result: TimelineTreeRow[] = [];
    const visit = (id: string): void => {
        const row = rows.find(candidate => candidate.id === id);
        if (!row) return;
        result.push(row);
        for (let child = childRow(rows, id); child; child = nextSibling(rows, child)) visit(child.id);
    };
    visit(state.rootId);
    const rootDepth = result[0]?.depth ?? 0;
    return result.map(row => ({ ...row, depth: Math.max(0, row.depth - rootDepth) }));
}

export function timelineDoubleClickAction(
    itemKind: TimelineTreeRow['itemKind'],
    sourceKind?: string
): TimelineDoubleClickAction {
    return itemKind === 'media' || sourceKind === 'media' ? 'trimmer' : 'focus';
}

function nextSibling(rows: readonly TimelineTreeRow[], row: TimelineTreeRow): TimelineTreeRow | undefined {
    const index = rows.findIndex(candidate => candidate.id === row.id);
    return rows.slice(index + 1).find(candidate => candidate.parentId === row.parentId);
}

function spanOfRows(rows: readonly TimelineTreeRow[]): { at: number; duration: number } {
    if (rows.length === 0) return { at: 0, duration: 0 };
    const at = Math.min(...rows.map(row => row.at));
    const end = Math.max(...rows.map(row => row.at + row.duration));
    return { at, duration: Math.max(0, end - at) };
}
