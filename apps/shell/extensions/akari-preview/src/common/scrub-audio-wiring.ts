export interface ScrubSeekInput {
    outputTime: number;
    sourceTime: number;
    src: string;
    isPlaying: boolean;
}

export interface ScrubSeekResolveParams {
    outputTime: number;
    isPlaying: boolean;
    mapped: { index: number; kind: 'src' | 'gap'; time?: number };
    segment: { kind?: string; src?: string } | undefined;
    isStill: boolean;
    videoSources: Record<string, string>;
    videoSourceOriginals: Record<string, string>;
    fallbackSrc: string;
}

export interface ScrubFetchGate {
    /** controller の deps.fetchFn に渡す。seek 中に発行された fetch を seek 世代で札付けする。 */
    fetchFn: (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
    /** onSeek() の直前に呼ぶ。以前の seek 世代で発行され、まだ終わっていない断片 fetch を abort する。 */
    beginSeek: () => void;
    /** テスト用: いま in-flight の fetch 数。 */
    inFlight: () => number;
}

export function createScrubFetchGate(deps: {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
    setTimeout: (fn: () => void, ms: number) => unknown;
    /** これより大きい Range（moov 取得など）は中止しない。既定 8192。 */
    keepRangeBytesAbove?: number;
}): ScrubFetchGate {
    let seq = 0;
    let active: number | null = null;
    const pending = new Map<number, Set<AbortController>>();
    const keepRangeBytesAbove = deps.keepRangeBytesAbove ?? 8192;

    const rangeValue = (headers: HeadersInit | undefined): string | undefined => {
        if (!headers) return undefined;
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            return headers.get('Range') ?? headers.get('range') ?? undefined;
        }
        if (Array.isArray(headers)) {
            const entry = headers.find(([name]) => String(name).toLowerCase() === 'range');
            return entry ? String(entry[1]) : undefined;
        }
        const record = headers as Record<string, string>;
        const key = Object.keys(record).find(name => name.toLowerCase() === 'range');
        return key ? String(record[key]) : undefined;
    };
    const isProtectedRange = (headers: HeadersInit | undefined): boolean => {
        const match = /^bytes=(\d+)-(\d+)$/u.exec(rangeValue(headers) ?? '');
        return Boolean(match && Number(match[2]) - Number(match[1]) + 1 > keepRangeBytesAbove);
    };
    const beginSeek = (): void => {
        seq += 1;
        for (const [generation, controllers] of pending) {
            if (generation >= seq) continue;
            for (const controller of controllers) controller.abort();
            pending.delete(generation);
        }
        const generation = seq;
        active = generation;
        deps.setTimeout(() => {
            if (active === generation) active = null;
        }, 0);
    };
    const fetchFn: ScrubFetchGate['fetchFn'] = async (input, init) => {
        const generation = active;
        if (generation === null || isProtectedRange(init?.headers)) {
            return deps.fetch(input, init);
        }
        const controller = new AbortController();
        let controllers = pending.get(generation);
        if (!controllers) {
            controllers = new Set();
            pending.set(generation, controllers);
        }
        controllers.add(controller);
        try {
            return await deps.fetch(input, { ...init, signal: controller.signal });
        } finally {
            controllers.delete(controller);
            if (controllers.size === 0) pending.delete(generation);
        }
    };
    const inFlight = (): number => {
        let count = 0;
        for (const controllers of pending.values()) count += controllers.size;
        return count;
    };
    return { fetchFn, beginSeek, inFlight };
}

/** タイムライン位置 → scrub 音の入力。gap / 静止画 / src 不明は null。プロキシを流すソースは原本 URL を優先する。 */
export function resolveScrubSeek(params: ScrubSeekResolveParams): ScrubSeekInput | null {
    const { outputTime, isPlaying, mapped, segment, isStill, videoSources, videoSourceOriginals, fallbackSrc } = params;
    if (mapped.kind !== 'src' || isStill || !Number.isFinite(mapped.time)) {
        return null;
    }
    const srcId = segment?.src;
    const src = (srcId && (videoSourceOriginals[srcId] || videoSources[srcId])) || fallbackSrc;
    if (!src) {
        return null;
    }
    return { outputTime, sourceTime: mapped.time as number, src, isPlaying };
}
