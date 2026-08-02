/**
 * re-export シム。正本は packages/pen-visuals（Phase 2 共有カーネル抽出・2026-08-02）。
 *
 * ペンの視覚チューニング（PEN_TUNING）・描画プリミティブはここではなく
 * packages/pen-visuals/src/index.ts を変更すること。このファイルは既存 import 経路
 * （akari-preview/lib/common/pen-canvas-visuals — akari-annotations のダイアログ群と
 * 動画面ペンの `JSON.stringify(PEN_TUNING)` 埋め込み）を温存するためだけに残している。
 */
export * from '@akari-video/pen-visuals';
