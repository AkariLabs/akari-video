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
 * - puppeteer-core: render-cut のオーバーレイ・ラスタライザ（動的 import）
 * - puppeteer:      bake-layer の src/browser.mjs（トップレベル import）
 * - esbuild:        bake-layer の src/build-harness.mjs（トップレベル import）
 * - @webav/mp4box.js: gpu-export の src/electron-main.mjs → src/mp4-mux.mjs（トップレベル import・
 *                   GPU 直結出口の mp4 直書き。v0.1.25 で同梱漏れ → パッケージ版の --engine gpu が落ちた）
 *
 * hyperframes は**意図的に含めない**（render-cut の package.json には依存として
 * 宣言されているが同梱しない）。依存クロージャが 406MB（onnxruntime-node 246MB /
 * sharp のネイティブ .node）に達し割に合わないため。render-cut のラスタライザ優先順位は
 * [hyperframes, puppeteer-core, static-screenshot] なので、puppeteer-core があれば
 * アニメーションを 1 フレームずつ撮る本経路と 3D オーバーレイの両方が成立する。
 */
export const BUNDLED_CLI_NPM_ENTRIES = ['puppeteer-core', 'puppeteer', 'esbuild', '@webav/mp4box.js'];
