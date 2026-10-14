import { t } from '@akari-video/i18n';
import { childRow, parentRow, TimelineTreeRow } from '../timeline/timeline-tree-model';

export interface FocusScopeState {
    rootId: string | null;
    breadcrumbs: string[];
    span: { at: number; duration: number };
}

export type TimelineDoubleClickAction = 'focus' | 'trimmer';

export function initialFocusScope(rows: readonly TimelineTreeRow[]): FocusScopeState {
    return { rootId: null, breadcrumbs: [t('annotationscommon.focusScope.label.overall')], span: spanOfRows(rows) };
}

export function enterFocusScope(
    rows: readonly TimelineTreeRow[],
    targetId: string
): FocusScopeState {
    const target = rows.find(row => row.id === targetId);
    if (!target) throw new Error(t('annotationscommon.focusScope.error.focusedTargetsNotFound', { targetId: targetId }));
    const lineage: TimelineTreeRow[] = [];
    let cursor: TimelineTreeRow | undefined = target;
    while (cursor) {
        lineage.unshift(cursor);
        cursor = parentRow(rows, cursor.id);
    }
    return {
        rootId: target.id,
        breadcrumbs: [t('annotationscommon.focusScope.label.overall'), ...lineage.map(row => row.label)],
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

export function selectionLeavesFocus(
    rows: readonly TimelineTreeRow[], rootId: string | null, selectedId: string | null
): boolean {
    if (rootId === null) return false;
    if (selectedId === null) return true;
    const visited = new Set<string>();
    let cursor = rows.find(row => row.id === selectedId);
    while (cursor && !visited.has(cursor.id)) {
        if (cursor.id === rootId) return false;
        visited.add(cursor.id);
        cursor = cursor.parentId ? rows.find(row => row.id === cursor!.parentId) : undefined;
    }
    return true;
}

export function timelineDoubleClickAction(
    itemKind: TimelineTreeRow['itemKind'],
    sourceKind?: string,
    isMainCut = false
): TimelineDoubleClickAction {
    return isMainCut && (itemKind === 'media' || sourceKind === 'media') ? 'trimmer' : 'focus';
}

/** プレビューの合成 Escape は keyCode=0。実際の打鍵（27）は短い窓の中でも通す。 */
export function isPreviewSelectionEscapeEcho(
    key: string, isWebviewKeydown: boolean, focusedRootId: string | null,
    now: number, lastPublishedAt: number, keyCode = 0, windowMs = 500
): boolean {
    return key === 'Escape' && keyCode === 0 && isWebviewKeydown && focusedRootId !== null
        && lastPublishedAt > 0 && now >= lastPublishedAt && now - lastPublishedAt < windowMs;
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
