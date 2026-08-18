/**
 * re-export シム。正本は packages/edit-store（Phase 2 共有カーネル抽出・2026-08-02）。
 *
 * edit.json のテキスト手術はここではなく packages/edit-store/src/edit-store.ts を変更すること。
 * このファイルは既存 import 経路（common/edit-store）と extension テストの import を
 * 温存するためだけに残している。移動 + 空トラック整理も正本側の単一手術を再 export する。
 */
export * from '@akari-video/edit-store/lib/edit-store';
