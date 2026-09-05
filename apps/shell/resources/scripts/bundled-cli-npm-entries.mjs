/**
 * extraResources で配る CLI（packages/render-cut・packages/gpu-export）が実行時に
 * import する npm パッケージの入口。推移依存はここに列挙しない（解決側が辿る）。
 *
 * この 1 本を 2 か所が共有する:
 * - bundle-cli-node-modules.mjs — 推移クロージャを resources/cli-node-modules へ staging する
 * - generate-third-party-notices.mjs — 同じクロージャをライセンス通知の対象に含める
 *
 * 片方だけを直すと「同梱しているのに通知に載っていない依存」が出るため、必ずここを直す。
 *
 * - @webav/mp4box.js: gpu-export の src/electron-main.mjs → src/mp4-mux.mjs（トップレベル import・
 *                   GPU 直結出口の mp4 直書き。v0.1.25 で同梱漏れ → パッケージ版の --engine gpu が落ちた）
 *
 * 外した入口とその理由（同じ判断を繰り返さないための記録）:
 * - puppeteer-core:  #130d〔legacy 合成経路の全撤去・2026-09-01〕で render-cut の依存ごと外れた。
 *                   render-cut は gpu / osr の 2 出口だけになり、オーバーレイのラスタライズに使わない
 * - puppeteer:       bake-layer の src/browser.mjs（トップレベル import）が唯一の理由だった。
 *                   2026-09-05 の ATF 退役で bake-layer ごと消えたため列挙しない
 * - esbuild:         bake-layer の src/build-harness.mjs（トップレベル import）が唯一の理由だった。
 *                   同上で外したが、esbuild 自体は apps/shell の Theia build・bundle-frame-engine.mjs・
 *                   drift 検査・各パッケージの build script が使うので、package.json の allowScripts と
 *                   CI の approve-scripts からは外さない（build 時専用 = 実行時 import ではない、が理由）
 *
 * hyperframes は**意図的に含めない**（依存クロージャが 406MB〔onnxruntime-node 246MB /
 * sharp のネイティブ .node〕に達し割に合わないため）。#130d 以降は render-cut の依存からも外れている。
 */
export const BUNDLED_CLI_NPM_ENTRIES = ['@webav/mp4box.js'];
