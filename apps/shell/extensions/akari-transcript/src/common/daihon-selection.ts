export interface DaihonSelection {
    readonly selected: readonly string[];
    readonly anchorId: string | null;
}

export const EMPTY_SELECTION: DaihonSelection = Object.freeze({
    selected: Object.freeze([]) as readonly string[],
    anchorId: null
});

export interface DaihonSelectionClickModifiers {
    shift: boolean;
    meta: boolean;
}

function orderedSelection(order: readonly string[], selected: ReadonlySet<string>): string[] {
    return order.filter(id => selected.has(id));
}

function range(order: readonly string[], anchorId: string, targetId: string): string[] | null {
    const anchorIndex = order.indexOf(anchorId);
    const targetIndex = order.indexOf(targetId);
    if (anchorIndex < 0 || targetIndex < 0) return null;
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return order.slice(start, end + 1);
}

export function applySelectionClick(
    state: DaihonSelection,
    order: readonly string[],
    targetId: string,
    modifiers: DaihonSelectionClickModifiers
): DaihonSelection {
    if (!order.includes(targetId)) return state;
    if (modifiers.meta) {
        const selected = new Set(state.selected);
        if (selected.has(targetId)) selected.delete(targetId);
        else selected.add(targetId);
        return { selected: orderedSelection(order, selected), anchorId: targetId };
    }
    if (modifiers.shift && state.anchorId !== null) {
        const selected = range(order, state.anchorId, targetId);
        if (selected) return { selected, anchorId: state.anchorId };
    }
    return { selected: [targetId], anchorId: targetId };
}

export function applyDragRange(
    state: DaihonSelection,
    order: readonly string[],
    anchorId: string,
    targetId: string
): DaihonSelection {
    const selected = range(order, anchorId, targetId);
    return selected ? { selected, anchorId } : state;
}

export function pruneSelection(state: DaihonSelection, order: readonly string[]): DaihonSelection {
    const available = new Set(order);
    const selected = orderedSelection(order, new Set(state.selected));
    const anchorId = state.anchorId !== null && available.has(state.anchorId) ? state.anchorId : null;
    if (anchorId === state.anchorId
        && selected.length === state.selected.length
        && selected.every((id, index) => id === state.selected[index])) {
        return state;
    }
    return selected.length === 0 && anchorId === null ? EMPTY_SELECTION : { selected, anchorId };
}

export function selectAll(order: readonly string[]): DaihonSelection {
    return order.length === 0 ? EMPTY_SELECTION : { selected: [...order], anchorId: null };
}

export function clearSelection(): DaihonSelection {
    return EMPTY_SELECTION;
}

export function planSelectionUpdate(
    previous: DaihonSelection,
    next: DaihonSelection
): { add: string[]; remove: string[] } {
    const previousIds = new Set(previous.selected);
    const nextIds = new Set(next.selected);
    return {
        add: next.selected.filter(id => !previousIds.has(id)),
        remove: previous.selected.filter(id => !nextIds.has(id))
    };
}
