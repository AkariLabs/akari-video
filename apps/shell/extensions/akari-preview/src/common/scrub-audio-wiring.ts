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
