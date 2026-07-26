/**
 * S3 ペン基盤（review セッション契約 §4.4「プラチナ調 + 控えめなきらめき」）の視覚チューニングと
 * 描画プリミティブの共有元（画像注釈ポップアップタスク・契約 2026-07-26 §4-2「質感は S3 準拠」）。
 *
 * 統合点調査の結論: 動画面ペン（akari-preview-open-handler.ts の previewBootstrapScript が返す
 * webview 内インライン JS 文字列）はサンドボックス化された webview 内で動くため、コンパイル済み
 * モジュールを import できない（webview はバンドラを介さない素の <script> テキストのため）。
 * そのため実描画ロジックそのものを完全共有することはできない — ここでの「最小 export」は:
 *   1. チューニング定数（PEN_TUNING）を単一の正本にし、動画面側は生成時に
 *      `JSON.stringify(PEN_TUNING)` で埋め込む（値は完全一致・動画面の挙動は無変更）
 *   2. 描画プリミティブ（グロー・プラチナ調グラデーション・1 セグメント描画）は実際に
 *      TypeScript として import できる形でここに置き、サンドボックスを介さない
 *      画像注釈ポップアップ（akari-annotations、通常の DOM ウィジェット）が実際に呼び出す
 * 動画面のインライン実装（グロー・スパークル一式）はこのファイルに移行しない
 * （サンドボックス制約により import 不能・動画面の記録/揮発/座標の既存挙動を変えないため
 * 現状のまま維持する — 契約の「akari-preview の変更は流用に必要な最小限のみ」に対応）。
 */

/** 動画面インライン実装（previewBootstrapScript 内 `PEN_TUNING`）と 1:1 一致させる。 */
export interface PenTuning {
    maxDevicePixelRatio: number;
    coreWidthPx: number;
    staticCoreWidthPx: number;
    coreAlpha: number;
    glowAlpha: number;
    glowSizePx: number;
    sparkleSpritePx: number;
    sparklesPerSegment: number;
    sparkleMaxPoolSize: number;
    sparkleJitterPx: number;
    sparkleMinSizePx: number;
    sparkleMaxSizePx: number;
    sparkleLifetimeMs: number;
    sparkleTwinkleHz: number;
    fadeDurationMs: number;
}

/**
 * 単一の正本。動画面（previewBootstrapScript）はこの値を `JSON.stringify` して
 * webview 内へ埋め込む（生成元が同じになるだけで、動画面の実行はサンドボックス内で完結する）。
 * 画像ポップアップはこのオブジェクトを直接 import して使う（グロー/プラチナ調に関わる
 * フィールドのみ消費 — スパークル/フェード系は画像面では使わない。§4-2「確定まで保持」）。
 */
export const PEN_TUNING: PenTuning = {
    maxDevicePixelRatio: 2,
    coreWidthPx: 3.4,
    staticCoreWidthPx: 3,
    coreAlpha: 0.98,
    glowAlpha: 0.5,
    glowSizePx: 30,
    sparkleSpritePx: 32,
    sparklesPerSegment: 2,
    sparkleMaxPoolSize: 220,
    sparkleJitterPx: 9,
    sparkleMinSizePx: 5,
    sparkleMaxSizePx: 13,
    sparkleLifetimeMs: 620,
    sparkleTwinkleHz: 2.2,
    fadeDurationMs: 1500
};

/** グロー用スプライト（動画面 `createGlowSprite` と同一実装）。 */
export function createGlowSprite(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.4, 'rgba(226,234,255,0.55)');
    gradient.addColorStop(1, 'rgba(226,234,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
}

/** プラチナ調グラデーション（動画面 `rebuildPlatinumGradient` と同一実装）。 */
export function createPlatinumGradient(
    ctx: CanvasRenderingContext2D, width: number, height: number
): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.48, '#d9deea');
    gradient.addColorStop(0.72, '#ffffff');
    gradient.addColorStop(1, '#c8cfdd');
    return gradient;
}

/**
 * ペン 1 セグメント分の描画（グロー + プラチナ調コア線）。動画面 `drawSegment` と同一の
 * 見た目ロジック（正規化座標 → キャンバス px 変換・lighter 合成のグロー・プラチナ調ストローク）。
 */
export function drawPenSegment(
    ctx: CanvasRenderingContext2D,
    glowSprite: HTMLCanvasElement,
    platinumGradient: CanvasGradient | null,
    from: readonly [number, number],
    to: readonly [number, number],
    canvasWidth: number,
    canvasHeight: number,
    coreWidthPx: number = PEN_TUNING.coreWidthPx,
    glowSizePx: number = PEN_TUNING.glowSizePx
): void {
    const fromPx: [number, number] = [from[0] * canvasWidth, from[1] * canvasHeight];
    const toPx: [number, number] = [to[0] * canvasWidth, to[1] * canvasHeight];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = PEN_TUNING.glowAlpha;
    ctx.drawImage(glowSprite, toPx[0] - glowSizePx / 2, toPx[1] - glowSizePx / 2, glowSizePx, glowSizePx);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = PEN_TUNING.coreAlpha;
    ctx.strokeStyle = platinumGradient ?? '#eef2fb';
    ctx.lineWidth = coreWidthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(fromPx[0], fromPx[1]);
    ctx.lineTo(toPx[0], toPx[1]);
    ctx.stroke();
    ctx.restore();
}
