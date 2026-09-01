/**
 * extraResources で配る CLI（packages/render-cut・packages/bake-layer・packages/gpu-export）が実行時に
 * import する npm パッケージの入口。推移依存はここに列挙しない（解決側が辿る）。
 *
 * この 1 本を 2 か所が共有する:
 * - bundle-cli-node-modules.mjs — 推移クロージャを resources/cli-node-modules へ staging する
 * - generate-third-party-notices.mjs — 同じクロージャをライセンス通知の対象に含める
 *
 * 片方だけを直すと「同梱しているのに通知に載っていない依存」が出るため、必ずここを直す。
 *
 * - （puppeteer-core は #130d〔legacy 合成経路の全撤去・2026-09-01〕で render-cut の依存ごと外れたため列挙しない。
 *   render-cut は gpu / osr の 2 出口だけになり、オーバーレイのラスタライズに puppeteer を使わない）
 * - puppeteer:      bake-layer の src/browser.mjs（トップレベル import）
 * - esbuild:        bake-layer の src/build-harness.mjs（トップレベル import）
 * - @webav/mp4box.js: gpu-export の src/electron-main.mjs → src/mp4-mux.mjs（トップレベル import・
 *                   GPU 直結出口の mp4 直書き。v0.1.25 で同梱漏れ → パッケージ版の --engine gpu が落ちた）
 *
 * hyperframes は**意図的に含めない**（依存クロージャが 406MB〔onnxruntime-node 246MB /
 * sharp のネイティブ .node〕に達し割に合わないため）。#130d 以降は render-cut の依存からも外れている。
 */
export const BUNDLED_CLI_NPM_ENTRIES = ['puppeteer', 'esbuild', '@webav/mp4box.js'];
