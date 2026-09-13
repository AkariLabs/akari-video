"use strict";
/**
 * ブラウザ安全な生成サイドカーの型と純粋関数。
 * fs / crypto を使う読み取りは './generation-meta-node' を明示的に import すること
 * （ここへ Node 専用依存を戻すと browser バンドルに node builtins が混入するため分離している）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sidecarPathFor = sidecarPathFor;
exports.resolveGenerationState = resolveGenerationState;
function sidecarPathFor(sourcePath) {
    return `${sourcePath}.meta.json`;
}
/** fs に触れず、サイドカー自身が表す状態だけを解決する。 */
function resolveGenerationState(meta, now) {
    if (!meta)
        return 'none';
    if (meta.status === 'failed')
        return 'failed';
    if (meta.status === 'generating') {
        const nowMs = timeValue(now);
        const startedMs = Date.parse(String(meta.job?.started_at ?? ''));
        const staleAfterS = meta.job?.stale_after_s;
        if (Number.isFinite(nowMs)
            && Number.isFinite(startedMs)
            && typeof staleAfterS === 'number'
            && nowMs - startedMs > staleAfterS * 1000)
            return 'stale';
    }
    return meta.status;
}
function timeValue(value) {
    return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
}
