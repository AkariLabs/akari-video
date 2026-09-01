/**
 * shell webview へインライン注入する共有カーネルの束（IIFE バンドルのエントリ）。
 *
 * webview は sandbox 制約で import できないため、ここから esbuild で
 * lib/webview-kernel.js（global: AkariEditKernel）を生成し、shell が
 * overlay-runtime と同じ経路（getOverlayRuntimeAssets → インライン <script>）で注入する。
 * ブラウザで動く純粋関数だけを export すること（Node API・ファイル IO は不可）。
 */
export * from './timeline-map';
export * from './caption-window';
export * from './caption-style-preset';
export * from './generated/textstyle-catalog';
export * from './transition-vocabulary';
export * from './transition-visual';
export * from './ducking';
export * from './audio-schedule';
export * from './item-anchor';
export { captionAnchorPositionVars } from './caption-display';
/** Browser selection is timeline-domain only. Segmentation stays in the Node caller. */
export declare function findActiveResolvedCaption<T extends {
    start: number;
    end: number;
}>(cues: readonly T[], outputTime: number): T | undefined;
