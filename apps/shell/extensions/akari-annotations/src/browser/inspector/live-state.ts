export interface InspectorViewState {
    selectionKey?: string;
    scrollTop: number;
    tabId?: string;
    focusField?: string;
    focusPart?: number;
    selectionStart?: number;
    selectionEnd?: number;
    inputValue?: string;
}

export function retainedInspectorView(previous: InspectorViewState, selectionKey?: string): InspectorViewState {
    return previous.selectionKey === selectionKey
        ? previous : { selectionKey, scrollTop: 0 };
}

export function viewForInspectorSelection(
    previous: InspectorViewState, selectionKey: string | undefined,
    lastRealKey: string | undefined
): InspectorViewState {
    if (!selectionKey || selectionKey === lastRealKey) return previous;
    return { selectionKey, scrollTop: 0 };
}

export function shouldDeferInspectorEmpty(
    selectionKey: string | undefined, renderedKey: string | undefined,
    materialSelected: boolean, forceEmpty: boolean
): boolean {
    return !selectionKey && !!renderedKey && !materialSelected && !forceEmpty;
}

export function rememberedInspectorScroll(
    previous: number, measured: number, sameSelection: boolean, restoring: boolean, userScrolled = false
): number {
    if (!sameSelection) return previous;
    return restoring || !userScrolled ? previous : measured;
}

export function withoutInspectorFocus(view: InspectorViewState): InspectorViewState {
    return { ...view, focusField: undefined, focusPart: undefined,
        selectionStart: undefined, selectionEnd: undefined, inputValue: undefined };
}

export function focusForInspectorRender(
    view: InspectorViewState, focusedInside: boolean, pendingTab: boolean, restoring: boolean
): InspectorViewState {
    return focusedInside || pendingTab || restoring ? view : withoutInspectorFocus(view);
}

export function shouldRememberInspectorScroll(
    restoring: boolean, now: number, ignoreUntil: number, lastIntentAt: number, renderAt: number
): boolean {
    return !restoring && (now >= ignoreUntil || lastIntentAt > renderAt);
}

export function inspectorHeldHeight(previous: number, scrollHeight: number, bodyHeight: number,
    clientHeight: number, desiredScroll: number): number {
    return Math.max(previous, scrollHeight, bodyHeight, clientHeight + desiredScroll);
}

export interface LiveValues {
    id: string;
    values: Readonly<Record<string, number>>;
}

export function mergeLiveValues(current: LiveValues | undefined, next: LiveValues): LiveValues {
    return { id: next.id, values: {
        ...(current?.id === next.id ? current.values : {}), ...next.values
    } };
}

export function visibleLiveValues(
    id: string, committed: Readonly<Record<string, number>>, live?: LiveValues
): Readonly<Record<string, number>> {
    return live?.id === id ? { ...committed, ...live.values } : committed;
}
