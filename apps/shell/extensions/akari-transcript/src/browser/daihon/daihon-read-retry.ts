const RETRY_DELAYS_MS = [100, 200, 300];

export function isMissingDaihonFile(error: unknown): boolean {
    const value = error as { code?: unknown; name?: unknown; message?: unknown } | null;
    const code = value?.code;
    const name = value?.name;
    const message = value?.message;
    return code === 'ENOENT' || code === 'EntryNotFound' || code === 'FileNotFound'
        || name === 'EntryNotFound' || name === 'FileNotFound'
        || typeof message === 'string' && /\b(?:ENOENT|EntryNotFound|FileNotFound)\b/u.test(message);
}

function isRetryableDaihonRead(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    const message = (error as { message?: unknown } | null)?.message;
    return isMissingDaihonFile(error) || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
        || typeof message === 'string' && /\b(?:EPERM|EBUSY|EACCES)\b/u.test(message)
        || error instanceof SyntaxError;
}

export async function retryDaihonRead<T>(read: () => Promise<T>,
    wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    shouldRetry: (error: unknown) => boolean = () => true): Promise<T> {
    for (const delay of RETRY_DELAYS_MS) {
        try { return await read(); }
        catch (error) {
            if (!isRetryableDaihonRead(error) || !shouldRetry(error)) throw error;
            await wait(delay);
        }
    }
    return read();
}
