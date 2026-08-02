/**
 * re-export シム。正本は packages/edit-store（Phase 2 共有カーネル抽出・2026-08-02）。
 *
 * captions.json のテキスト手術はここではなく packages/edit-store/src/caption-store.ts を
 * 変更すること。このファイルは既存 import 経路（common/caption-store）と extension テストの
 * import を温存するためだけに残している。
 */
export * from '@akari-video/edit-store/lib/caption-store';
