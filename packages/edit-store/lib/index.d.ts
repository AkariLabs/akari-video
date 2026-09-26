/**
 * ブラウザ安全なエントリポイント（テキスト手術のみ）。
 * lint ゲート付き書き込み（Node 専用）は './write-gate' を明示的に import すること
 * （ここから re-export すると browser バンドルに node builtins が混入するため分離している）。
 */
export * from './edit-store';
export * from './caption-store';
export * from './caption-style-preset';
export * from './generated/textstyle-catalog';
export * from './caption-words-rederive';
export * from './caption-window';
export * from './caption-clock';
export * from './timeline-map';
export * from './caption-display';
export * from './caption-runs';
export * from './generation-meta';
export * from './edit-v2';
export * from './edit-v2-item-write';
export * from './internal-model';
export * from './legacy-audio-view';
export * from './retime';
export * from './track-order';
export * from './track-z';
export * from './media-planes';
export * from './track-transition-compatibility';
export * from './cut-adjacency';
export * from './transition-vocabulary';
export * from './transition-visual';
export * from './ducking';
export * from './envelope';
export * from './audio-schedule';
export * from './audio-ownership';
export * from './cut-audio-split-ops';
export * from './canonical';
export * from './tree-ops';
export * from './item-anchor';
export * from './shape-markup';
export * from './shape-preset';
export * from './cut-ranges';
export * from './adjust-css-approx';
export { parseEdit } from './migrate/legacy-parse';
export { LegacyEditVersionError } from './migrate/error';
export * from './adjust-css-visual';
export { effectiveScale, normalizeTransform } from './transform';
export * from './transform-keyframe-edit';
export declare const SAVED_BY_PATH = ".akari/saved-by.json";
export interface SavedByStamp {
    version: 1;
    app: 'akari-video';
    appVersion: string;
    savedAt: string;
}
export declare function parseSavedBy(text: string | undefined): SavedByStamp | undefined;
export declare function newerSavedByVersion(text: string | undefined, currentVersion: string | undefined): string | undefined;
export declare function isUnknownKeyEditError(error: unknown): boolean;
export declare function newerVersionOpenNotice(savedVersion: string, currentVersion: string): string;
export declare function newerVersionLintPrefix(savedVersion: string): string;
export declare function withNewerVersionLintPrefix(message: string, savedVersion?: string): string;
