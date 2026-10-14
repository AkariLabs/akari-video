/**
 * S3 ペン基盤の視覚チューニングと
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
 * ペンの線はオレンジの芯と暗い縁取りを重ね、きらめきだけを控えめに残す。
 * 描き味のフェードは 600ms とする。
 * 描線の表示寿命も PEN_TUNING が単一正本で、visibleWindowSec が不透明な窓、fadeOutMs が
 * 窓を過ぎた後の消失時間を定める。描き味の fadeDurationMs とは別の表示規則である。
 */
export interface PenTuning {
    maxDevicePixelRatio: number;
    coreWidthPx: number;
    staticCoreWidthPx: number;
    coreColor: string;
    outlineColor: string;
    outlineExtraWidthPx: number;
    sparkleColor: string;
    sparkleSpritePx: number;
    sparklesPerSegment: number;
    sparkleProbability: number;
    sparkleMaxPoolSize: number;
    sparkleJitterPx: number;
    sparkleMinSizePx: number;
    sparkleMaxSizePx: number;
    sparkleLifetimeMs: number;
    sparkleTwinkleHz: number;
    /** 完了済み描線を不透明で表示する時間窓。 */
    visibleWindowSec: number;
    /** 表示時間窓を過ぎた描線が消失するまでの時間。fadeDurationMs の描き味演出とは別。 */
    fadeOutMs: number;
    /** pointerup 直後の既存の描き味演出。表示寿命の fadeOutMs とは別。 */
    fadeDurationMs: number;
}
export type PersistentStrokeItem = {
    tool: 'pen';
    points: Array<[number, number]>;
    id?: string;
    recTStart?: number;
    recTEnd?: number;
    frame?: {
        timelineT?: number;
    };
} | {
    tool: 'rect';
    box: [number, number, number, number];
    id?: string;
    recTStart?: number;
    recTEnd?: number;
    frame?: {
        timelineT?: number;
    };
};
export interface StrokeLifetimeContext {
    /** 録音中か（録音中 = recT 基準、録音外 = playheadT 基準） */
    recording: boolean;
    /** 「描線を表示」トグル。false なら全部 alpha 0 */
    visible: boolean;
    /** 録音中の現在録音時計（秒）。録音外では未使用 */
    recT?: number;
    /** 録音外のプレイヘッド（タイムライン秒） */
    playheadT?: number;
}
export interface StrokeLifetimeTuning {
    visibleWindowSec: number;
    fadeOutMs: number;
}
/**
 * Persistent overlay input is intentionally a tolerant boundary. Unknown/old entries are skipped,
 * valid pen/rect geometry is copied, and coordinates remain normalized to the preview frame.
 * The function is dependency-free so the shell can serialize it into its sandboxed webview.
 */
export declare function normalizePersistentStrokeItems(value: unknown): PersistentStrokeItem[];
/** 0（非表示）〜1（不透明）。webview 注入用のため外側の識別子を参照しない。 */
export declare function resolveStrokeLifetimeAlpha(item: PersistentStrokeItem, context: StrokeLifetimeContext, tuning: StrokeLifetimeTuning): number;
/** alpha が残る描線を入力順で返す。 */
export declare function selectVisibleStrokeItems(items: readonly PersistentStrokeItem[], context: StrokeLifetimeContext, tuning?: StrokeLifetimeTuning): Array<{
    item: PersistentStrokeItem;
    alpha: number;
}>;
export declare const PEN_TUNING: PenTuning;
/** きらめき用スプライト（動画面 `createSparkleSprite` と同一実装 — 十字の光条つき）。 */
export declare function createSparkleSprite(size: number): HTMLCanvasElement;
/**
 * 正規化された点列を一つのパスにし、縁取り全体の後に芯全体を描く。
 * 描画中の更新も点列全体で呼び直すことで継ぎ目を作らない。
 */
export declare function drawPenStroke(ctx: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>, canvasWidth: number, canvasHeight: number, coreWidthPx?: number): void;
