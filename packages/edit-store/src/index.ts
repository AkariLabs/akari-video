/**
 * ブラウザ安全なエントリポイント（テキスト手術のみ）。
 * lint ゲート付き書き込み（Node 専用）は './write-gate' を明示的に import すること
 * （ここから re-export すると browser バンドルに node builtins が混入するため分離している）。
 */
export * from './edit-store';
export * from './caption-store';
export * from './caption-window';
export * from './timeline-map';
export * from './caption-display';
export * from './edit-v2';
export * from './edit-v2-item-write';
export * from './internal-model';
export * from './legacy-audio-view';
export * from './retime';
export * from './track-order';
export * from './track-transition-compatibility';
export * from './cut-adjacency';
export * from './transition-vocabulary';
export * from './transition-visual';
export * from './ducking';
// Legacy parser implementation lives in the frozen migration unit. This re-export keeps
// text-surgery consumers source-compatible while preventing legacy knowledge from returning
// to edit-store.ts.
export { parseEdit } from './migrate/legacy-parse';
export { LegacyEditVersionError } from './migrate/error';
