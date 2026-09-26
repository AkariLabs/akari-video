import {
    GenerationMetaV1,
    describeNextDraft as describeNextDraftHelper,
    resolveGenerationState as resolveGenerationStateHelper
} from '@akari-video/edit-store';

export interface GenerationBindingView {
    expected: string;
    actual: string | null;
    matches: boolean;
    source: 'result' | 'first_frame' | 'placeholder';
}

export type GenerationState = 'none' | 'planned' | 'generating' | 'stale' | 'done' | 'failed' | 'orphan';

// host の既定引数用。production build はこの名前も minify するため、
// toString() で webview へ渡した関数には helper を必ず引数で明示する。
const resolveGenerationStateV1 = resolveGenerationStateHelper;
const describeNextDraftV1 = describeNextDraftHelper;

/** webview に単体で注入し、ラッパー関数へ引数で渡す自己完結の helper。 */
export const generationStateHelperV1 = resolveGenerationStateV1;
export const generationNextDraftHelperV1 = describeNextDraftV1;

export interface GenerationOverlayDescription {
    tag: string | null;
    /** 動画予定の最後の絵（プロジェクト相対パス）。孤児の旧記述では省略。 */
    pip?: string | null;
    /** 生成中にぼかして表示する参照の絵。孤児の旧記述では省略。 */
    blurBackground?: string | null;
    band: { text: string; progress: number | null } | null;
    shimmer: boolean;
    aurora?: 'planned' | 'generating';
    maskRect: { x: number; y: number; w: number; h: number } | null;
}

export interface DescribeOverlayOptions {
    /** クリップのソースパス。生成中の参照画像が無い場合の背景に使う。 */
    sourcePath?: string;
    /** クリップ内のローカル時刻（秒）。kind:"frames" のコマ番号に使う。 */
    localTimeSec?: number;
    /** クリップの尺（秒）。kind:"frames" の総コマ数の推定に使う。 */
    clipDurationSec?: number;
    nowMs?: number;
}

export function resolveGenerationState(
    meta: unknown,
    nowMs: number,
    binding?: unknown,
    resolveHelper: typeof resolveGenerationStateHelper = resolveGenerationStateV1
): GenerationState {
    try {
        if (binding && typeof binding === 'object' && !Array.isArray(binding)
            && (binding as { matches?: unknown }).matches === false) return 'orphan';
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'none';
        const value = meta as { version?: unknown; status?: unknown };
        if (value.version !== undefined && value.version !== 1) return 'none';
        if (value.status !== 'planned' && value.status !== 'generating'
            && value.status !== 'done' && value.status !== 'failed') return 'none';
        const state = resolveHelper(meta as GenerationMetaV1, nowMs);
        if (state === 'none' || state === 'planned' || state === 'generating'
            || state === 'stale' || state === 'done' || state === 'failed' || state === 'orphan') return state;
        return 'none';
    } catch {
        return 'none';
    }
}

export function describeOverlay(
    state: GenerationState,
    meta: unknown,
    beatLabel: string,
    options: DescribeOverlayOptions = {},
    nextDraftHelper: typeof describeNextDraftHelper = describeNextDraftV1
): GenerationOverlayDescription {
    const empty = (): GenerationOverlayDescription => ({
        tag: null,
        band: null,
        shimmer: false,
        maskRect: null,
        pip: null,
        blurBackground: null
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

        if (state === 'orphan') {
            return { tag: `孤児 · ${beatLabel}`, band: null, shimmer: false, maskRect: null };
        }

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
                ...empty(),
                tag: `失敗 · ${reason} · 再試行は右パネル`
            };
        }

        if (state === 'generating') {
            const progress = objectAt(value, 'progress');
            const job = objectAt(value, 'job');
            const jobProgress = objectAt(job, 'progress');
            const percentCandidate = progress.percent ?? jobProgress.percent ?? job.progress_percent;
            const percentValue = finiteNumber(percentCandidate);
            const percent = percentValue !== undefined && percentValue >= 0 && percentValue <= 100
                ? percentValue : undefined;
            const etaCandidate = progress.eta_s ?? jobProgress.eta_s ?? job.eta_s;
            const etaValue = finiteNumber(etaCandidate);
            const eta = etaValue !== undefined && etaValue >= 0 ? Math.round(etaValue) : undefined;
            const text = percent !== undefined && eta !== undefined
                ? `生成中 ${percent}% · 残り約 ${eta} 秒`
                : percent !== undefined
                    ? `生成中 ${percent}%`
                    : eta !== undefined
                        ? `生成中 · 残り約 ${eta} 秒`
                        : (() => {
                            const startedAt = Date.parse(String(job.started_at ?? ''));
                            if (!Number.isFinite(startedAt)) return '生成中';
                            const seconds = Math.max(0, Math.floor(((options.nowMs ?? Date.now()) - startedAt) / 1000));
                            return `生成中 · ${seconds} 秒`;
                        })();
            const firstFramePath = objectAt(value.inputs, 'first_frame').path;
            return {
                ...empty(),
                tag: `生成中 · ${beatLabel}`,
                band: { text, progress: percent === undefined ? null : percent / 100 },
                shimmer: true,
                aurora: 'generating',
                blurBackground: value.kind === 'audio' ? null : typeof firstFramePath === 'string' && firstFramePath.trim()
                    ? firstFramePath : options.sourcePath || null
            };
        }
        if (state === 'stale') {
            return {
                ...empty(),
                tag: '応答なし · 再取得は右パネル',
                band: { text: '応答なし', progress: null }
            };
        }

        const next = nextDraftHelper(value as unknown as GenerationMetaV1);
        if (next) {
            const labels = { prompt: 'プロンプトだけ', first: '画像から', 'first-last': '最初→最後', references: '参照から' };
            return {
                ...empty(),
                tag: `▶ 動画予定 · ${labels[next.variety]}`,
                pip: typeof next.lastFrame?.path === 'string' && next.lastFrame.path.trim()
                    ? next.lastFrame.path : null
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
            return { ...empty(), tag, maskRect };
        }

        if (state === 'planned') {
            return { ...empty(), tag: `planned · ${beatLabel}`, aurora: 'planned' };
        }
        return empty();
    } catch {
        return empty();
    }
}
