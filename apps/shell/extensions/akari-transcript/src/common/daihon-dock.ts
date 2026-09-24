export type DockKind = 'row' | 'placed';
export type DockTab = 'text' | 'template' | 'look' | 'anim' | 'emphasis' | 'time';
export type DockAction = 'cut' | 'split' | 'merge-selected' | 'merge-next' | 'speech-tight' | 'insert-below' | 'delete' | 'all' | 'duplicate';
export type LookField = 'color' | 'background' | 'fit' | 'size' | 'spacing' | 'stroke';

export function dockTabs(kind: DockKind): DockTab[] {
    return kind === 'row' ? ['template', 'look', 'anim', 'emphasis', 'time']
        : ['text', 'template', 'look', 'anim'];
}

export function rowDockTitle(count: number, text: string): string {
    return count > 1 ? `${count} 行を選択中` : text;
}

export function dockActions(kind: DockKind, available: Partial<Record<DockAction, boolean>>): DockAction[] {
    const order: DockAction[] = kind === 'row'
        ? ['cut', 'split', 'merge-selected', 'merge-next', 'speech-tight', 'insert-below', 'delete']
        : ['all', 'duplicate', 'delete'];
    return order.filter(action => available[action]);
}

export function clampDockHeight(height: number, panelHeight: number, rowsHeight = panelHeight): number {
    return Math.round(Math.min(rowsHeight, Math.max(140, panelHeight * .8), Math.max(140, height)));
}

export function readDockHeight(saved: string | null, panelHeight: number, rowsHeight = panelHeight): number | null {
    if (!saved || !/^(?:\d+)(?:\.\d+)?px$/.test(saved)) return null;
    const value = Number(saved.slice(0, -2));
    return Number.isFinite(value) ? clampDockHeight(value, panelHeight, rowsHeight) : null;
}

export function shouldCloseDockOnEscape(key: string, open: boolean, focusInPanel: boolean, focusOnBody: boolean): boolean {
    return key === 'Escape' && open && (focusInPanel || focusOnBody);
}

export function lookPatch(field: LookField, value: string | number, presetStyle?: unknown, defaultStyle?: unknown): Record<string, unknown> {
    switch (field) {
        case 'color': return { color: String(value) };
        case 'background': return value === 'none'
            ? { background: { opacity: 0 } } : { background: { color: String(value), opacity: 1 } };
        case 'fit': return { background: { fit: value === currentLookFit(undefined, presetStyle, defaultStyle) ? null : value } };
        case 'size': return { sizePx: Number(value) };
        case 'spacing': return { letterSpacingEm: Number(value) };
        case 'stroke': return { stroke: { widthPx: Number(value), color: '#000000' } };
    }
}

export function currentLookFit(textStyle: unknown, presetStyle: unknown, defaultStyle?: unknown): 'text' | 'frame' {
    const direct = object(object(textStyle).background);
    const preset = object(object(presetStyle).background);
    const fallback = object(object(defaultStyle).background);
    return (direct.fit ?? preset.fit ?? fallback.fit) === 'frame' ? 'frame' : 'text';
}

export function hasLookCushion(textStyle: unknown, presetStyle: unknown, defaultStyle?: unknown): boolean {
    const background = {
        ...object(object(defaultStyle).background),
        ...object(object(presetStyle).background),
        ...object(object(textStyle).background)
    };
    if (background.opacity === 0) return false;
    return typeof background.color === 'string' || typeof background.opacity === 'number' && background.opacity > 0;
}

export interface DockLookState {
    textColor: string | undefined;
    backgroundColor: string | undefined;
    fit: 'text' | 'frame';
    fitDisabled: boolean;
}

export function dockLookState(
    rows: ReadonlyArray<{ textStyle?: unknown; presetStyle?: unknown }>,
    defaultStyle?: unknown
): DockLookState {
    const single = rows.length === 1 ? rows[0] : undefined;
    return {
        textColor: currentLookSwatch(single?.textStyle, single?.presetStyle, 'color', defaultStyle),
        backgroundColor: currentLookSwatch(single?.textStyle, single?.presetStyle, 'background', defaultStyle),
        fit: currentLookFit(single?.textStyle, single?.presetStyle, defaultStyle),
        fitDisabled: rows.length === 0 || rows.every(row =>
            !hasLookCushion(row.textStyle, row.presetStyle, defaultStyle))
    };
}

export function shouldRefreshLookDock(kind: DockKind | undefined, tab: DockTab, open: boolean): boolean {
    return kind === 'row' && tab === 'look' && open;
}

const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function currentLookSwatch(textStyle: unknown, presetStyle: unknown, field: 'color' | 'background', defaultStyle?: unknown): string | undefined {
    const direct = object(textStyle);
    const preset = object(presetStyle);
    const fallback = object(defaultStyle);
    if (field === 'color') {
        return typeof direct.color === 'string' ? direct.color
            : typeof preset.color === 'string' ? preset.color
                : typeof fallback.color === 'string' ? fallback.color : undefined;
    }
    const background = {
        ...object(fallback.background),
        ...object(preset.background),
        ...object(direct.background)
    };
    if (background.opacity === 0) return 'none';
    return typeof background.color === 'string' ? background.color : 'none';
}
