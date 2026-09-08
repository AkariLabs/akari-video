export const INIT_LAYOUT_TIMEOUT_MS = 2000;

export type InitLayoutResult = 'completed' | 'failed' | 'timed-out';

export function normalizeInitLayoutTimeout(timeoutMs = INIT_LAYOUT_TIMEOUT_MS): number {
    return Number.isFinite(timeoutMs) ? Math.max(0, Math.min(timeoutMs, 2147483647)) : INIT_LAYOUT_TIMEOUT_MS;
}

export function classifyInitLayoutResult(timedOut: boolean, failed: boolean): InitLayoutResult {
    if (timedOut) return 'timed-out';
    return failed ? 'failed' : 'completed';
}

export function formatInitLayoutWarning(name: string, result: Exclude<InitLayoutResult, 'completed'>,
    timeoutMs: number, late = false): string {
    return result === 'timed-out'
        ? `[${name}] layout initialization timed out after ${timeoutMs}ms; continuing in background`
        : `[${name}] layout initialization failed${late ? ' after timeout' : ''}`;
}

/** Bound the layout wait, not the work: timed-out work keeps running with a rejection handler.
 * Like all JS timers, this deadline requires the event loop to remain responsive.
 */
export function guardInitLayout(name: string, fn: () => void | Promise<void>,
    options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = normalizeInitLayoutTimeout(options.timeoutMs);
    return new Promise(resolve => {
        let finished = false;
        let timedOut = false;
        const warn = (result: 'failed' | 'timed-out', error?: unknown): void => {
            // Logging must never turn a handled failure into an unhandled rejection.
            try {
                console.warn(formatInitLayoutWarning(name, result, timeoutMs, timedOut && result === 'failed'), error);
            } catch { /* A replaced console must not block application startup. */ }
        };
        const timeout = (): void => {
            if (finished) return;
            finished = timedOut = true;
            warn('timed-out');
            resolve();
        };
        const timer = setTimeout(timeout, timeoutMs);
        const settle = (failed: boolean, error?: unknown): void => {
            if (!finished) {
                clearTimeout(timer);
                // Only the timer callback establishes a timeout; elapsed wall time does not.
                finished = true;
                resolve();
            }
            if (failed) warn('failed', error);
        };
        try {
            Promise.resolve(fn()).then(() => settle(false), error => settle(true, error));
        } catch (error) {
            settle(true, error);
        }
    });
}
