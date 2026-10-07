export const ROUGH_CANVAS_COMMANDS = {
    open: { id: 'akari.sketch.open' }, close: { id: 'akari.sketch.close' },
    next: { id: 'akari.sketch.next' }, backdrop: { id: 'akari.sketch.backdrop' },
    tool: { id: 'akari.sketch.tool' }, deleteSelected: { id: 'akari.sketch.deleteSelected' },
    submit: { id: 'akari.sketch.submit' }
};
export const SKETCH_NOT_OPEN = { ok: false, reason: 'sketch-not-open' } as const;
export function withOpenRoughCanvas<P extends { isOpen: boolean }, T>(popup: P | undefined,
    action: (popup: P) => T): T | typeof SKETCH_NOT_OPEN {
    return popup?.isOpen ? action(popup) : SKETCH_NOT_OPEN;
}
export function validRoughCanvasTool(value: unknown): value is { tool: 'select' | 'pen' | 'arrow' | 'text' } {
    const tool = (value as { tool?: unknown } | undefined)?.tool;
    return tool === 'select' || tool === 'pen' || tool === 'arrow' || tool === 'text';
}
export function confirmRoughCanvasSend(armed: boolean): { execute: boolean; armed: boolean } {
    return armed ? { execute: true, armed: false } : { execute: false, armed: true };
}
