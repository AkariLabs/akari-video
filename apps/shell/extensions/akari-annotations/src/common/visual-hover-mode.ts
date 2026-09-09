/** Disabling band thumbnails still allows an on-demand hover preview. */
export function visualHoverMode(enabled: boolean): 'band+hover' | 'hover-only' {
    return enabled ? 'band+hover' : 'hover-only';
}
