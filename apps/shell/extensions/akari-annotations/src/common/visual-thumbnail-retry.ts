export interface VisualThumbnailRetryPlan {
    kind: 'transient' | 'permanent' | 'stale';
    nextAttemptAt?: number;
}

/** attempt is the number of failed captures, starting at one (three retries maximum). */
export function visualThumbnailRetryPlan(failure: unknown, attempt: number, now: number): VisualThumbnailRetryPlan {
    const message = String(failure);
    if (/Stale visual thumbnail input/i.test(message)) return { kind: 'stale' };
    // Explicit renderer/input failures take precedence over the generic IPC timeout wording.
    if (/Invalid visual thumbnail page|Visual renderer failed|Visual renderer readiness timed out|edit snapshot mismatch|no renderable overlay|Thumbnail input is outside|thumbnail stylesheet|ENOENT|SyntaxError|TypeError/i.test(message)) {
        return { kind: 'permanent' };
    }
    // Even after four samples, transparent captures may race rendering; the caller bounds retries to three.
    const delay = [5000, 15000, 45000][attempt - 1];
    return { kind: 'transient', ...(Number.isInteger(attempt) && delay !== undefined && Number.isFinite(now)
        ? { nextAttemptAt: now + delay } : {}) };
}
