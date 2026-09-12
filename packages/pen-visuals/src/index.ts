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
 * 描線の表示寿命も PEN_TUNING が単一正本で、visibleWindowSec が不透明な窓、fadeOutMs が
 * 窓を過ぎた後の消失時間を定める。描き味の fadeDurationMs とは別の表示規則である。
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
    /** 完了済み描線を不透明で表示する時間窓。 */
    visibleWindowSec: number;
    /** 表示時間窓を過ぎた描線が消失するまでの時間。fadeDurationMs の描き味演出とは別。 */
    fadeOutMs: number;
    /** pointerup 直後の既存の描き味演出。表示寿命の fadeOutMs とは別。 */
    fadeDurationMs: number;
}

export type PersistentStrokeItem =
    | {
        tool: 'pen'; points: Array<[number, number]>; id?: string; recTStart?: number; recTEnd?: number;
        frame?: { timelineT?: number };
    }
    | {
        tool: 'rect'; box: [number, number, number, number]; id?: string; recTStart?: number; recTEnd?: number;
        frame?: { timelineT?: number };
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
export function normalizePersistentStrokeItems(value: unknown): PersistentStrokeItem[] {
    if (!Array.isArray(value)) return [];
    const normalized: PersistentStrokeItem[] = [];
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const item = candidate as Record<string, unknown>;
        const metadata = {
            ...(typeof item.id === 'string' ? { id: item.id } : {}),
            ...(Number.isFinite(item.recTStart) ? { recTStart: item.recTStart as number } : {}),
            ...(Number.isFinite(item.recTEnd) ? { recTEnd: item.recTEnd as number } : {}),
            ...(item.frame && typeof item.frame === 'object' && !Array.isArray(item.frame)
                && Number.isFinite((item.frame as Record<string, unknown>).timelineT)
                ? { frame: { timelineT: (item.frame as Record<string, unknown>).timelineT as number } }
                : {})
        };
        if ((item.tool === 'pen' || item.tool === undefined) && Array.isArray(item.points)) {
            const points = item.points.filter((point): point is [number, number] => (
                Array.isArray(point) && point.length === 2
                && point.every(coordinate => Number.isFinite(coordinate)
                    && coordinate >= 0 && coordinate <= 1)
            )).map(point => [point[0], point[1]] as [number, number]);
            if (points.length >= 2) normalized.push({ tool: 'pen', points, ...metadata });
            continue;
        }
        if (item.tool === 'rect' && Array.isArray(item.box) && item.box.length === 4
            && item.box.every(coordinate => Number.isFinite(coordinate))) {
            const [x, y, width, height] = item.box as number[];
            if (x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1) {
                normalized.push({ tool: 'rect', box: [x, y, width, height], ...metadata });
            }
        }
    }
    return normalized;
}

/** 0（非表示）〜1（不透明）。webview 注入用のため外側の識別子を参照しない。 */
export function resolveStrokeLifetimeAlpha(
    item: PersistentStrokeItem,
    context: StrokeLifetimeContext,
    tuning: StrokeLifetimeTuning
): number {
    if (context.visible !== true) return 0;
    if (!Number.isFinite(tuning.visibleWindowSec) || tuning.visibleWindowSec < 0) return 1;

    let distance: number;
    if (context.recording === true) {
        const base = Number.isFinite(item.recTEnd) ? item.recTEnd : item.recTStart;
        if (!Number.isFinite(base) || !Number.isFinite(context.recT)) return 1;
        distance = Math.max(0, (context.recT as number) - (base as number));
    } else {
        const timelineT = item.frame?.timelineT;
        if (!Number.isFinite(timelineT) || !Number.isFinite(context.playheadT)) return 1;
        distance = Math.abs((context.playheadT as number) - (timelineT as number));
    }

    if (distance <= tuning.visibleWindowSec) return 1;
    const fadeSec = Math.max(0, tuning.fadeOutMs) / 1000;
    if (fadeSec === 0) return 0;
    const alpha = distance < tuning.visibleWindowSec + fadeSec
        ? 1 - (distance - tuning.visibleWindowSec) / fadeSec
        : 0;
    return Math.max(0, Math.min(1, alpha));
}

/** alpha が残る描線を入力順で返す。 */
export function selectVisibleStrokeItems(
    items: readonly PersistentStrokeItem[],
    context: StrokeLifetimeContext,
    tuning: StrokeLifetimeTuning = PEN_TUNING
): Array<{ item: PersistentStrokeItem; alpha: number }> {
    const selected: Array<{ item: PersistentStrokeItem; alpha: number }> = [];
    for (const item of items) {
        const alpha = resolveStrokeLifetimeAlpha(item, context, tuning);
        if (alpha > 0) selected.push({ item, alpha });
    }
    return selected;
}

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
    visibleWindowSec: 8,
    fadeOutMs: 1500,
    fadeDurationMs: 600
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

/** きらめき用スプライト（動画面 `createSparkleSprite` と同一実装 — 十字の光条つき）。 */
export function createSparkleSprite(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
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
