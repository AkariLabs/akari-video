// SFX 尺プローブの共有・同時数制限・打ち切り（2026-09-02 preview-perf）。
//
// akari-preview-open-handler.ts の probeSfxDurations は summary.audio.sfx[] の *挿入ごと* に
// `new Audio()` を作って loadedmetadata を待ち、その Promise.all を初回描画のゲート
// （Promise.all([__akariCaptionFontReady, runtime.mount(summary), sfxDurationsReady])）に入れて
// いた。同じ素材を 159 か所に挿した案件（ユニーク URL は 37）では 159 本のプローブが同時に
// 走り、しかも loadedmetadata が永久に来ないプローブが 1 本あるだけで初回描画が永久に
// 待たされる。
//
// createSharedDurationProbe(probe, options) は「URL → 尺 Promise」を 1 つの Map に共有し
// （同じ URL の 2 回目以降は同じ Promise を返す = プローブ本数はユニーク URL 数）、同時に走る
// プローブを maxInFlight（既定 4）本に制限し、1 本ごとに timeoutMs（既定 8 s）で打ち切って
// null（尺不明）で解決する。打ち切ったプローブは同時数の枠を解放するので、残りを塞がない。
// 素材の *実尺* だけを共有し、挿入ごとの [in, out) 切り出し
// （docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2）は呼び出し側で従来どおり計算する。
//
// Serialized into the preview webview via Function.prototype.toString() -- same pattern as
// raf-throttle.ts's createRafThrottle. Keep this self-contained: no closures over module
// state, no calls to sibling functions in this file, no imports. scheduleTimeout/cancelTimeout
// default to the global setTimeout/clearTimeout, resolved lazily at call time, so Node-side unit
// tests can pass explicit stubs and never wait on real timers.

export interface SharedDurationProbeOptions {
    /** 同時に走らせるプローブ数の上限（既定 4）。 */
    maxInFlight?: number;
    /** 1 プローブあたりの打ち切り時間 ms（既定 8000）。超えたら null で解決し、枠を解放する。 */
    timeoutMs?: number;
    /** 打ち切られた URL ごとに 1 回呼ばれる（同じ URL は 1 本しか走らないため）。警告の頻度は呼び出し側で決める。 */
    onTimeout?: (src: string) => void;
    scheduleTimeout?: (callback: () => void, ms: number) => unknown;
    cancelTimeout?: (handle: unknown) => void;
}

export function createSharedDurationProbe(
    probe: (src: string) => Promise<number | null>,
    options: SharedDurationProbeOptions = {}
): (src: string) => Promise<number | null> {
    const maxInFlight = Number.isFinite(options.maxInFlight) && options.maxInFlight >= 1
        ? Math.floor(options.maxInFlight) : 4;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;
    const scheduleTimeout = options.scheduleTimeout
        || ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
    const cancelTimeout = options.cancelTimeout || ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const onTimeout = options.onTimeout;
    const shared = new Map<string, Promise<number | null>>();
    const queue: Array<() => void> = [];
    let inFlight = 0;
    const pump = (): void => {
        while (inFlight < maxInFlight && queue.length > 0) {
            inFlight += 1;
            const start = queue.shift();
            start();
        }
    };
    const startProbe = (src: string, resolve: (value: number | null) => void): void => {
        let settled = false;
        let timer: unknown = null;
        const finish = (value: number | null): void => {
            if (settled) return;
            settled = true;
            cancelTimeout(timer);
            inFlight -= 1;
            resolve(value);
            pump();
        };
        timer = scheduleTimeout(() => {
            if (settled) return;
            if (onTimeout) onTimeout(src);
            finish(null);
        }, timeoutMs);
        let result: Promise<number | null>;
        try {
            result = Promise.resolve(probe(src));
        } catch (_error) {
            result = Promise.resolve(null);
        }
        result.then(
            value => finish(typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null),
            () => finish(null)
        );
    };
    return (src: string): Promise<number | null> => {
        const existing = shared.get(src);
        if (existing) return existing;
        const pending = new Promise<number | null>(resolve => {
            queue.push(() => startProbe(src, resolve));
            pump();
        });
        shared.set(src, pending);
        return pending;
    };
}
