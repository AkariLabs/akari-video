export interface SourceDimensions { width?: number; height?: number }

/** 取得直後の参照台帳とメディア実体が揃うまで、短い間隔で引き直す。 */
export async function probePreviewMediaDimensions(options: {
    resolveUri: () => Promise<string>;
    probe: (uri: string) => Promise<SourceDimensions>;
    maxWaitMs?: number;
    intervalMs?: number;
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
}): Promise<SourceDimensions | undefined> {
    const now = options.now ?? Date.now;
    const wait = options.wait ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
    const deadline = now() + (options.maxWaitMs ?? 15000);
    const interval = options.intervalMs ?? 400;
    for (;;) {
        try {
            const uri = await options.resolveUri();
            const dimensions = await options.probe(uri);
            if (typeof dimensions.width === 'number' && dimensions.width > 0
                && typeof dimensions.height === 'number' && dimensions.height > 0) return dimensions;
        } catch { /* 参照の反映・取得中なら次の試行で読む。 */ }
        const remaining = deadline - now();
        if (remaining <= 0) return undefined;
        await wait(Math.min(interval, remaining));
    }
}
