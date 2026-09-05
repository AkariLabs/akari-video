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
// Includes AdjustV1 and its curve/wheel/hue types; AdjustV0 remains an alias.
export * from './edit-v2';
export * from './edit-v2-item-write';
export * from './internal-model';
export * from './legacy-audio-view';
export * from './retime';
export * from './track-order';
export * from './track-z';
export * from './track-transition-compatibility';
export * from './cut-adjacency';
export * from './transition-vocabulary';
export * from './transition-visual';
export * from './ducking';
export * from './envelope';
export * from './audio-schedule';
export * from './canonical';
export * from './tree-ops';
export * from './item-anchor';
export * from './shape-markup';
export * from './cut-ranges';
export * from './adjust-css-approx';
// Legacy parser implementation lives in the frozen migration unit. This re-export keeps
// text-surgery consumers source-compatible while preventing legacy knowledge from returning
// to edit-store.ts.
export { parseEdit } from './migrate/legacy-parse';
export { LegacyEditVersionError } from './migrate/error';
export * from './adjust-css-visual';
