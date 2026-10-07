// Observed in the local browser experiment.
export const OBSERVED_HOST_OVERLAY_SELECTORS = [
    '.quick-input-widget', '.dialogOverlay', '.theia-dialog-shell',
    '.theia-notification-list-item', '.lm-DockPanel-overlay'
] as const;
// Additional known Theia/Lumino/Monaco overlay surfaces; not yet observed locally.
export const OTHER_HOST_OVERLAY_SELECTORS = [
    '.lm-Menu', '.p-Menu', '.monaco-menu-container', '.theia-quick-input', '[data-akari-browser-menu]'
] as const;
export const HOST_OVERLAY_SELECTORS: readonly string[] = [...OBSERVED_HOST_OVERLAY_SELECTORS, ...OTHER_HOST_OVERLAY_SELECTORS];

export function shouldHide(matches: readonly { selector: string; display: string; rect: { w: number; h: number } }[]): boolean {
    return matches.some(match => HOST_OVERLAY_SELECTORS.includes(match.selector) && match.display !== 'none'
        && match.rect.w > 0 && match.rect.h > 0 &&
        (match.selector !== '.lm-DockPanel-overlay' || match.display === 'block'));
}
