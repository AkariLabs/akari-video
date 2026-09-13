export type GenerationState = 'none' | 'planned' | 'generating' | 'stale' | 'done' | 'failed';

export interface GenerationOverlayDescription {
    tag: string | null;
    band: { text: string; progress: number | null } | null;
    shimmer: boolean;
    maskRect: { x: number; y: number; w: number; h: number } | null;
}

export interface DescribeOverlayOptions {
    /** クリップのソースパス。サイドカー無しの静止画判定に使う（png/jpg/jpeg/webp）。 */
    sourcePath?: string;
    /** クリップ内のローカル時刻（秒）。kind:"frames" のコマ番号に使う。 */
    localTimeSec?: number;
    /** クリップの尺（秒）。kind:"frames" の総コマ数の推定に使う。 */
    clipDurationSec?: number;
}

export function resolveGenerationState(meta: unknown, nowMs: number): GenerationState {
    try {
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'none';
        const value = meta as { status?: unknown; job?: unknown };
        if (value.status === 'planned' || value.status === 'done' || value.status === 'failed') {
            return value.status;
        }
        if (value.status !== 'generating') return 'none';
        const job = value.job && typeof value.job === 'object' && !Array.isArray(value.job)
            ? value.job as { started_at?: unknown; stale_after_s?: unknown }
            : undefined;
        const startedAt = typeof job?.started_at === 'string' ? Date.parse(job.started_at) : Number.NaN;
        const declaredStaleAfter = job?.stale_after_s;
        const staleAfterSeconds = typeof declaredStaleAfter === 'number'
            && Number.isFinite(declaredStaleAfter) && declaredStaleAfter >= 0
            ? declaredStaleAfter : 900;
        if (Number.isFinite(startedAt) && Number.isFinite(nowMs)
            && nowMs - startedAt > staleAfterSeconds * 1000) {
            return 'stale';
        }
        return 'generating';
    } catch {
        return 'none';
    }
}

export function describeOverlay(
    state: GenerationState,
    meta: unknown,
    beatLabel: string,
    options: DescribeOverlayOptions = {}
): GenerationOverlayDescription {
    const empty = (): GenerationOverlayDescription => ({
        tag: null,
        band: null,
        shimmer: false,
        maskRect: null
    });
    try {
        const value = meta && typeof meta === 'object' && !Array.isArray(meta)
            ? meta as Record<string, unknown> : {};
        const objectAt = (parent: unknown, key: string): Record<string, unknown> => {
            if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return {};
            const child = (parent as Record<string, unknown>)[key];
            return child && typeof child === 'object' && !Array.isArray(child)
                ? child as Record<string, unknown> : {};
        };
        const finiteNumber = (candidate: unknown): number | undefined =>
            typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;

        if (state === 'failed') {
            const error = objectAt(value, 'error');
            const history = Array.isArray(value.history) ? value.history : [];
            const lastHistory = history.length > 0 && history[history.length - 1]
                && typeof history[history.length - 1] === 'object' && !Array.isArray(history[history.length - 1])
                ? history[history.length - 1] as Record<string, unknown> : {};
            const reasonValue = error.reason ?? error.message ?? lastHistory.reason ?? 'unknown';
            const reason = typeof reasonValue === 'string' || typeof reasonValue === 'number'
                ? String(reasonValue) : 'unknown';
            return {
                tag: `失敗 · ${reason} · 再試行は右パネル`,
                band: null,
                shimmer: false,
                maskRect: null
            };
        }

        if (value.kind === 'frames') {
            const output = objectAt(value, 'output');
            const inputs = objectAt(value, 'inputs');
            const extra = objectAt(inputs, 'extra');
            const result = objectAt(value, 'result');
            const fpsCandidate = output.fps ?? extra.fps;
            const fpsValue = finiteNumber(fpsCandidate);
            const fps = fpsValue !== undefined && fpsValue > 0 ? fpsValue : undefined;
            const explicitFrames = finiteNumber(result.frames);
            const estimatedFrames = fps !== undefined && typeof options.clipDurationSec === 'number'
                && Number.isFinite(options.clipDurationSec) && options.clipDurationSec >= 0
                ? Math.round(fps * options.clipDurationSec) : undefined;
            const totalFramesCandidate = explicitFrames ?? estimatedFrames;
            const totalFrames = totalFramesCandidate !== undefined && totalFramesCandidate >= 1
                ? Math.round(totalFramesCandidate) : undefined;
            const localTime = typeof options.localTimeSec === 'number' && Number.isFinite(options.localTimeSec)
                ? Math.max(0, options.localTimeSec) : 0;
            const rawFrame = fps === undefined ? 1 : Math.floor(localTime * fps) + 1;
            const frame = totalFrames === undefined
                ? Math.max(1, rawFrame) : Math.min(totalFrames, Math.max(1, rawFrame));
            const rawMask = extra.mask_rect;
            let maskRect: GenerationOverlayDescription['maskRect'] = null;
            if (rawMask && typeof rawMask === 'object' && !Array.isArray(rawMask)) {
                const mask = rawMask as Record<string, unknown>;
                const x = finiteNumber(mask.x);
                const y = finiteNumber(mask.y);
                const w = finiteNumber(mask.w);
                const h = finiteNumber(mask.h);
                if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
                    maskRect = { x, y, w, h };
                }
            }
            const tag = fps === undefined
                ? `パラパラ · ${beatLabel}`
                : totalFrames === undefined
                    ? `パラパラ ${fps}fps · コマ ${frame}`
                    : `パラパラ ${fps}fps · コマ ${frame}/${totalFrames}`;
            return { tag, band: null, shimmer: false, maskRect };
        }

        if (state === 'none') {
            return typeof options.sourcePath === 'string' && /\.(?:png|jpe?g|webp)$/iu.test(options.sourcePath)
                ? { tag: `静止画（仮枠） · ${beatLabel}`, band: null, shimmer: false, maskRect: null }
                : empty();
        }
        if (state === 'planned') {
            return { tag: `planned · ${beatLabel}`, band: null, shimmer: false, maskRect: null };
        }
        if (state === 'generating') {
            const progress = objectAt(value, 'progress');
            const job = objectAt(value, 'job');
            const percentCandidate = progress.percent ?? job.progress_percent;
            const percentValue = finiteNumber(percentCandidate);
            const percent = percentValue !== undefined && percentValue >= 0 && percentValue <= 100
                ? percentValue : undefined;
            const etaCandidate = progress.eta_s ?? job.eta_s;
            const etaValue = finiteNumber(etaCandidate);
            const eta = etaValue !== undefined && etaValue >= 0 ? Math.round(etaValue) : undefined;
            const text = percent !== undefined && eta !== undefined
                ? `生成中 ${percent}% · 残り約 ${eta} 秒`
                : percent !== undefined
                    ? `生成中 ${percent}%`
                    : eta !== undefined
                        ? `生成中 · 残り約 ${eta} 秒`
                        : '生成中';
            return {
                tag: `生成中 · ${beatLabel}`,
                band: { text, progress: percent === undefined ? null : percent / 100 },
                shimmer: true,
                maskRect: null
            };
        }
        if (state === 'stale') {
            return {
                tag: '応答なし · 再取得は右パネル',
                band: { text: '応答なし', progress: null },
                shimmer: false,
                maskRect: null
            };
        }
        if (state === 'done' && value.kind === 'still') {
            return { tag: `静止画（仮枠） · ${beatLabel}`, band: null, shimmer: false, maskRect: null };
        }
        return empty();
    } catch {
        return { tag: null, band: null, shimmer: false, maskRect: null };
    }
}
