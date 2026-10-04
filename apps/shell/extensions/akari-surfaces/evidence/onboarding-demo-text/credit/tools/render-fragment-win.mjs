// 素材断片の QA レンダラ。
// packages/render-cut/src/rasterize.mjs のオーバーレイシートと同じ入れ子
// （.akari-overlay-container[inset:0] > .scene-content[inset:0] > 断片）を再現し、
// CSS アニメーションを WAAPI として指定時刻へ seek して静止画を撮る。
//
// 使い方:
//   node render-fragment.mjs <fragment.html> <out.png> [--vars "--board-width:900px;..."]
//     [--seek 2.5] [--size 1920x1080] [--backdrop "#1c1c1c"|none]

import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire("<WORKTREE>/packages/render-cut/");
const puppeteer = require("puppeteer-core");

// 3D（特に texts[] の troika SDF）は chrome-headless-shell + SwiftShader だと draw call は
// 走るのに出力が空になる（2026-08-12 実測）。sequence ツールと同じくフル Chrome を優先し、
// 無いときだけ shell へ落とす
const FULL_CHROME =
  "<HOME>/.cache/puppeteer/chrome/mac_arm-149.0.7827.22/chrome-mac-arm64/" +
  "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const SHELL_CHROME =
  "<HOME>/.cache/puppeteer/chrome-headless-shell/mac_arm-149.0.7827.22/" +
  "chrome-headless-shell-mac-arm64/chrome-headless-shell";
const CHROME = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const [fragmentPath, outPath] = process.argv.slice(2);
if (!fragmentPath || !outPath) {
  console.error("使い方: node render-fragment.mjs <fragment.html> <out.png> [--vars ...] [--seek 秒] [--size WxH] [--backdrop 色|none]");
  process.exit(2);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const vars = arg("--vars", "");
const seek = Number(arg("--seek", "3"));
const [width, height] = arg("--size", "1920x1080").split("x").map(Number);
const backdrop = arg("--backdrop", "#151515");

const fragment = readFileSync(fragmentPath, "utf8");

// 経路 A（Three.js オーバーレイ）の断片は宣言型の JSON シーンを持つ。その場合は
// render-cut/src/rasterize.mjs と同じく three ランタイムを注入しないと canvas が空のままになる
// （2D の断片には注入しない。776KB のバンドルを毎回読ませない）。
// 3D 断片は公開リポのランタイムで描く。共有チェックアウトが production 実装より前の
// ブランチにいることがあるので、--repo で当て先を切り替えられるようにしてある
const PUBLIC_REPO = (() => {
  const i = process.argv.indexOf("--repo");
  return i === -1 ? "<WORKTREE>" : process.argv[i + 1];
})();
const is3d = fragment.includes("data-akari-3d-scene");
// texts[]/physics（3D テキスト）は追加 vendor バンドルが要る。読み込み順は
// three-bundle → vendor-3d-text-bundle → three-runtime（公開リポ overlay-runtime/README の指定）
const VENDOR_3D_TEXT = `${PUBLIC_REPO}/packages/overlay-runtime/src/vendor/vendor-3d-text-bundle.js`;
const threeScripts = is3d
  ? `\n<script>${readFileSync(`${PUBLIC_REPO}/packages/overlay-runtime/src/vendor/three-bundle.js`, "utf8")}</script>` +
    (existsSync(VENDOR_3D_TEXT)
      ? `\n<script>${readFileSync(VENDOR_3D_TEXT, "utf8")}</script>`
      : "") +
    `\n<script>${readFileSync(`${PUBLIC_REPO}/packages/overlay-runtime/src/three-runtime.js`, "utf8")}</script>`
  : "";

// モーション語彙（var(--ease-*) / var(--anim-duration-*) の解決先）。本番のシート・
// プレビューと同じ定義を敷かないと、語彙参照の断片は animation 宣言ごと無効になる
const motionVocabCss = readFileSync(
  `${PUBLIC_REPO}/packages/overlay-runtime/src/motion-vocab.css`, "utf8");

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden;
    background: ${backdrop === "none" ? "transparent" : backdrop}; }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; }
  .akari-overlay-container { position: absolute; inset: 0;
    transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg));
    transform-origin: center; ${vars} }
  .akari-overlay-container > .scene-content { position: absolute; inset: 0; }
</style><style>${motionVocabCss}</style>${threeScripts}</head><body>
  <div id="stage"><div class="akari-overlay-container" data-akari-active><div class="scene-content">${fragment}</div></div></div>
</body></html>`;

// 3D の .glb は GLTFLoader が **fetch** で取りに行く。fetch は file:// を拒む
// （--allow-file-access-from-files は <img> 等には効くが fetch には効かない）ので、
// 3D のときだけローカル HTTP でファイルシステムをそのまま配る。ハーネス html は実際の
// パスへ置いたまま同じ場所を http で開くので、断片内の**相対パスも絶対パスも両方**解決する。
const MIME = {
  ".html": "text/html; charset=utf-8", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".hdr": "application/octet-stream", ".exr": "application/octet-stream", ".bin": "application/octet-stream",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
};
const fileServer = is3d
  ? await new Promise((ready) => {
      const server = createServer((request, response) => {
        const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        try {
          if (!statSync(path).isFile()) throw new Error("not a file");
        } catch {
          response.writeHead(404).end("not found");
          return;
        }
        response.writeHead(200, { "content-type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream" });
        createReadStream(path).pipe(response);
      });
      server.listen(0, "127.0.0.1", () => ready(server));
    })
  : null;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true, userDataDir: "C:/t/credit-text/edge-profile",
  pipe: true,
  args: [
    "--no-sandbox", "--allow-file-access-from-files",
    "--force-color-profile=srgb", "--disable-lcd-text",
    // chrome-headless-shell は GPU を持たないので WebGL は SwiftShader で回すしかない。
    // この 3 つが無いと WebGLRenderer の生成が落ち（BindToCurrentSequence failed）、
    // ランタイムは status=disposed を返す。**2D 断片には影響しない**ので常時付ける。
    // 本番の書き出し器（render-cut/src/rasterize.mjs）と同じ流儀に揃えてある
    "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
  ],
});
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width, height, deviceScaleFactor: 1 });
  // setContent（about:blank 相当）だと file:// のサブリソースが読めず、media スロットの
  // 検証ができない。実ファイルへ書いて file:// で開く。
  // 3D は .glb / テクスチャを断片からの相対パスで引くので、ハーネスも**断片の隣**へ置く。
  const harnessPath = is3d
    ? `${dirname(resolve(fragmentPath))}/.render-fragment.harness.html`
    : `${resolve(outPath)}.harness.html`;
  writeFileSync(harnessPath, page);
  const harnessUrl = fileServer
    ? `http://127.0.0.1:${fileServer.address().port}${harnessPath.split("/").map(encodeURIComponent).join("/")}`
    : pathToFileURL(harnessPath).href;
  await tab.goto(harnessUrl, { waitUntil: "load" });
  // 3D では document.fonts.ready / WAAPI シークの evaluate を挟まない。
  // これらを先に挟むと troika worker のフォント XHR が待機ループ終了まで 30 秒
  // ディスパッチされない（2026-08-12 実測。texts[] 素材で全滅した根因）。
  // 3D のアニメは WAAPI ではなくランタイム時刻駆動なので、そもそも不要
  let seeked = 0;
  if (!is3d) {
    await tab.evaluate(() => document.fonts.ready);
    // 断片は `animation: ... paused` で書かれる規約。指定時刻へ seek して静止させる。
    seeked = await tab.evaluate((seconds) => {
      const animations = document.getAnimations();
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = seconds * 1000;
      }
      return animations.length;
    }, seek);
  }
  if (is3d) {
    // 3D は WAAPI ではなくランタイムへローカル時刻を渡して描く（AnimationMixer.setTime）。
    // 読み込み完了を待たずに撮ると空の canvas が「成功」として保存される
    // texts[]（troika sync 待ち）は render() を呼ばないと ready へ遷移しない。さらに
    // ページ内の長い evaluate ループでは遷移が観測できない（2026-08-12 実測 — Node 側から
    // 短い evaluate を繰り返すと即 ready になる）ため、待機ポンプは Node 側で回す
    let status = "loading";
    {
      const deadline = Date.now() + 30_000;
      while (status === "loading" && Date.now() <= deadline) {
        status = await tab.evaluate((seconds) => {
          const container = document.querySelector(".akari-overlay-container > .scene-content");
          window.akari.threeRuntime.render(container, seconds);
          return window.akari.threeRuntime.inspect(container).status;
        }, seek);
        if (status === "loading") await new Promise((r) => setTimeout(r, 100));
      }
      if (status === "loading") status = "timeout";
    }
    if (status !== "ready") {
      console.error(`3D シーンを描画できません: status=${status}`);
      process.exitCode = 1;
    }
    // ready 後にもう一度 seek して、待機中に進んだ状態ではなく指定時刻を描く
    await tab.evaluate((seconds) => {
      const container = document.querySelector(".akari-overlay-container > .scene-content");
      window.akari.threeRuntime.render(container, seconds);
    }, seek);
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  const buffer = await tab.screenshot({ omitBackground: backdrop === "none" });
  writeFileSync(outPath, buffer);
  console.log(JSON.stringify({ ok: true, out: outPath, animations: seeked, seek, size: `${width}x${height}`, vars: vars || null }));
  // ハーネス html は必ず消す。残すと validate-asset が「実体ファイル」として拾い、
  // 参照切れで NG を出す（3D で実際に踏んだ）。2D も出力先が素材ディレクトリなら
  // 同じことが起きる（`preview.png.harness.html` が素材に残っていた）ので分岐しない
  try { unlinkSync(harnessPath); } catch {}
} finally {
  const browserProcess = browser.process();
  if (browserProcess) browserProcess.kill("SIGKILL");
  else await browser.close();
  if (fileServer) fileServer.close();
}
