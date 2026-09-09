export const MATERIAL_PREVIEW_WIDGET_ID_PREFIXES: readonly string[] = [
    'akari-preview-', 'akari-image-', 'akari-audio-', 'akari-fragment-preview-', 'akari-font-specimen-'
];

export function isMaterialPreviewWidgetId(id: string): boolean {
    return MATERIAL_PREVIEW_WIDGET_ID_PREFIXES.some(prefix => id.startsWith(prefix));
}

export interface MaterialSlotOccupant {
    readonly id: string;
    readonly uri?: string;
    readonly disposed: boolean;
    readonly attached: boolean;
}

export type MaterialSlotAction =
    | { readonly kind: 'reveal' }
    | { readonly kind: 'add' }
    | { readonly kind: 'replace'; readonly closeId: string };

export function decideMaterialSlotAction(
    current: MaterialSlotOccupant | undefined,
    next: { readonly id: string }
): MaterialSlotAction {
    if (!current || current.disposed || !current.attached) {
        return { kind: 'add' };
    }
    return current.id === next.id ? { kind: 'reveal' } : { kind: 'replace', closeId: current.id };
}

export function isSameMaterialUri(a: string | undefined, b: string | undefined): boolean {
    return typeof a === 'string' && typeof b === 'string' && a === b;
}

export function chooseRestoredMaterialPreviewSurvivor(
    registered: readonly MaterialSlotOccupant[]
): { readonly keepId?: string; readonly closeIds: string[] } {
    const live = registered.filter(widget => !widget.disposed && widget.attached);
    if (!live.length) {
        return { closeIds: [] };
    }
    return { keepId: live[live.length - 1].id, closeIds: live.slice(0, -1).map(widget => widget.id) };
}
