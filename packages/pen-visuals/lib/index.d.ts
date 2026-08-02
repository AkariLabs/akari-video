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
export declare const PEN_TUNING: PenTuning;
/** グロー用スプライト（動画面 `createGlowSprite` と同一実装）。 */
export declare function createGlowSprite(size: number): HTMLCanvasElement;
/** きらめき用スプライト（動画面 `createSparkleSprite` と同一実装 — 十字の光条つき）。 */
export declare function createSparkleSprite(size: number): HTMLCanvasElement;
/** プラチナ調グラデーション（動画面 `rebuildPlatinumGradient` と同一実装）。 */
export declare function createPlatinumGradient(ctx: CanvasRenderingContext2D, width: number, height: number): CanvasGradient;
/**
 * ペン 1 セグメント分の描画（グロー + プラチナ調コア線）。動画面 `drawSegment` と同一の
 * 見た目ロジック（正規化座標 → キャンバス px 変換・lighter 合成のグロー・プラチナ調ストローク）。
 */
export declare function drawPenSegment(ctx: CanvasRenderingContext2D, glowSprite: HTMLCanvasElement, platinumGradient: CanvasGradient | null, from: readonly [number, number], to: readonly [number, number], canvasWidth: number, canvasHeight: number, coreWidthPx?: number, glowSizePx?: number): void;
