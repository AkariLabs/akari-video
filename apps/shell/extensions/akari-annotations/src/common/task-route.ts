export interface DeliveryRoute { route: 'pty' | 'clipboard' | 'none'; pasteHint: boolean }

export function chooseRoute(input: { target: 'cli' | 'extension' | 'none'; count: number }): DeliveryRoute {
    if (!Number.isSafeInteger(input.count) || input.count < 1) return { route: 'none', pasteHint: false };
    if (input.target === 'cli') return { route: 'pty', pasteHint: false };
    if (input.target === 'extension') return { route: 'clipboard', pasteHint: true };
    return { route: 'none', pasteHint: false };
}
