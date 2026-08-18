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
