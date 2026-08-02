"use strict";
/**
 * S3 ペン基盤（review セッション契約 §4.4「プラチナ調 + 控えめなきらめき」）の視覚チューニングと
 * 描画プリミティブの**単一正本**（パリティ契約 §2.8、Phase 2 共有カーネル抽出・2026-08-02）。
 *
 * 消費者は 3 面:
 *   1. shell 画像注釈/キャンバス（akari-annotations のダイアログ）— CJS lib を直接 import
 *   2. shell 動画面ペン（akari-preview-open-handler.ts の previewBootstrapScript）— webview は
 *      サンドボックスのためモジュール import 不能。`JSON.stringify(PEN_TUNING)` で生成時に埋め込む
 *      （描画ロジックのインライン実装は webview 側に残るが、チューニング値はここが正本）
 *   3. Web UI（packages/preview-server）— esbuild で public/pen-visuals.bundle.js（ESM）に
 *      バンドルして app.js が import する（preview-engine.bundle.js と同じ供給経路）
 *
 * チューニング裁定（オーナー 2026-08-02）: フェードは 600ms（Web UI 現行値）を正とする。
 * それ以外の値は shell 従来値が正本（契約 §2.8）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PEN_TUNING = void 0;
exports.createGlowSprite = createGlowSprite;
exports.createSparkleSprite = createSparkleSprite;
exports.createPlatinumGradient = createPlatinumGradient;
exports.drawPenSegment = drawPenSegment;
exports.PEN_TUNING = {
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
    fadeDurationMs: 600
};
/** グロー用スプライト（動画面 `createGlowSprite` と同一実装）。 */
function createGlowSprite(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.4, 'rgba(226,234,255,0.55)');
    gradient.addColorStop(1, 'rgba(226,234,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
}
/** きらめき用スプライト（動画面 `createSparkleSprite` と同一実装 — 十字の光条つき）。 */
function createSparkleSprite(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, size * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(center, center - size * 0.42);
    ctx.lineTo(center, center + size * 0.42);
    ctx.moveTo(center - size * 0.42, center);
    ctx.lineTo(center + size * 0.42, center);
    ctx.stroke();
    return canvas;
}
/** プラチナ調グラデーション（動画面 `rebuildPlatinumGradient` と同一実装）。 */
function createPlatinumGradient(ctx, width, height) {
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
function drawPenSegment(ctx, glowSprite, platinumGradient, from, to, canvasWidth, canvasHeight, coreWidthPx = exports.PEN_TUNING.coreWidthPx, glowSizePx = exports.PEN_TUNING.glowSizePx) {
    const fromPx = [from[0] * canvasWidth, from[1] * canvasHeight];
    const toPx = [to[0] * canvasWidth, to[1] * canvasHeight];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = exports.PEN_TUNING.glowAlpha;
    ctx.drawImage(glowSprite, toPx[0] - glowSizePx / 2, toPx[1] - glowSizePx / 2, glowSizePx, glowSizePx);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = exports.PEN_TUNING.coreAlpha;
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
