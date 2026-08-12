// texts[] flat モード（task 2026-08-12-3d-text-flat）の検証ハーネス共通ヘルパー。
// puppeteer-core はこの worktree の devDependency ではないため、
// packages/overlay-runtime/test-harness/projection-knobs.test.mjs と同じ流儀で
// メイン checkout の node_modules 解決を読み取り専用で借りる（メイン checkout は無改変）。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findChromePath } from "../../../src/render-cut.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const RENDER_CUT_ROOT = resolve(HERE, "../../..");
export const REPO_ROOT = resolve(RENDER_CUT_ROOT, "../..");
export const OVERLAY_RUNTIME_SRC = resolve(REPO_ROOT, "packages/overlay-runtime/src");
export const FONT_SOURCE = resolve(
  REPO_ROOT,
  "packages/overlay-runtime/test-harness/fonts/ZenKakuGothicNew-Black.ttf",
);
const MAIN_CHECKOUT_CANDIDATES = [
  REPO_ROOT,
  resolve(REPO_ROOT, "../../akari-video"),
  ...(process.env.AKARI_MAIN_CHECKOUT ? [process.env.AKARI_MAIN_CHECKOUT] : []),
];

export async function loadPuppeteerModule() {
  for (const candidate of MAIN_CHECKOUT_CANDIDATES) {
    const packageJsonPath = join(candidate, "apps/shell/package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const require = createRequire(packageJsonPath);
      return require("puppeteer-core");
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "puppeteer-core が見つかりません（メイン checkout の apps/shell/node_modules を確認してください）",
  );
}

export async function resolveChromePath() {
  const chromePath = await findChromePath();
  if (!chromePath) throw new Error("headless Chrome が見つかりません");
  return chromePath;
}

export async function makeProjectRoot(prefix) {
  const projectRoot = await mkdtemp(join(tmpdir(), `3d-text-flat-${prefix}-`));
  await mkdir(join(projectRoot, "fonts"), { recursive: true });
  await copyFile(FONT_SOURCE, join(projectRoot, "fonts/ZenKakuGothicNew-Black.ttf"));
  return projectRoot;
}

// preview.mjs 用: overlay-runtime パッケージのランタイム 4 本を projectRoot 配下へ複製する。
// preview は（実ホストと同じく）ローカル HTTP 越しに読ませる必要がある — file:// では
// troika の XHR フォントロードが Chrome のファイル間 XHR 制限に阻まれる（実測: preview.mjs
// 初期実装で "Failure loading font file://..." を確認）。README.md に追記した「texts[] を
// 扱うホストは vendor-3d-text-bundle.js を three-bundle.js の直後に読み込む」の実証でもある
export async function stageRuntimeScripts(projectRoot) {
  const runtimeDir = join(projectRoot, "_runtime");
  await mkdir(join(runtimeDir, "vendor"), { recursive: true });
  await copyFile(
    join(OVERLAY_RUNTIME_SRC, "vendor/three-bundle.js"),
    join(runtimeDir, "vendor/three-bundle.js"),
  );
  await copyFile(
    join(OVERLAY_RUNTIME_SRC, "vendor/vendor-3d-text-bundle.js"),
    join(runtimeDir, "vendor/vendor-3d-text-bundle.js"),
  );
  await copyFile(join(OVERLAY_RUNTIME_SRC, "three-runtime.js"), join(runtimeDir, "three-runtime.js"));
  await copyFile(join(OVERLAY_RUNTIME_SRC, "overlay-runtime.js"), join(runtimeDir, "overlay-runtime.js"));
  return "_runtime";
}

const MIME_BY_EXTENSION = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".png", "image/png"],
]);

// 使い捨てのローカル静的サーバ（node:http のみ、追加依存なし）。preview.mjs が
// file:// の XHR 制限を避けて実ホストと同じ http 越しの読み込みを再現するために使う
export async function startStaticServer(rootDir) {
  const { createServer } = await import("node:http");
  const { extname, join: joinPath, normalize } = await import("node:path");
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const relative = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
      const filePath = joinPath(rootDir, relative);
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      const mimeType = MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
      res.writeHead(200, { "content-type": mimeType }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

export const FONT_RELATIVE_PATH = "fonts/ZenKakuGothicNew-Black.ttf";

// 単一ルート + canvas + fallback + data-akari-3d-scene 宣言（skills/overlay-authoring/3d.md の
// 宣言型 fragment スキーマ）。canvas は overlay フレーム全面を覆う CSS を持たせる
// （「canvas は CSS で表示寸法を必ず与える」）
export function textsSceneHtml(scene) {
  const json = JSON.stringify(scene).replaceAll("</script", "<\\/script").replaceAll("<", "\\u003c");
  return (
    '<div style="position:absolute;inset:0;">'
    + '<canvas style="position:absolute;inset:0;width:100%;height:100%;display:block;"></canvas>'
    + '<div data-akari-3d-fallback style="position:absolute;inset:0;"></div>'
    + `<script type="application/json" data-akari-3d-scene>${json}</script>`
    + "</div>"
  );
}

export function overlayFor(id, scene, { start = 0, duration = 2 } = {}) {
  return {
    id,
    start,
    duration,
    html: textsSceneHtml(scene),
    transform: {},
    vars: {},
  };
}

export function editFor({ width = 480, height = 270, fps = 10 } = {}) {
  return { output: { width, height, fps } };
}

export async function sha256File(path) {
  const buffer = await readFile(path);
  return createHash("sha256").update(buffer).digest("hex");
}

// ffmpeg で PNG を raw RGBA へ落として直接読む（pngjs 等の追加依存を避ける。
// evidence/track-z-interleaved-stack 等、既存 evidence スクリプトと同じ流儀）
export function readRgba(pngPath, ffmpegCommand = "ffmpeg") {
  const result = spawnSync(ffmpegCommand, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    pngPath,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed to decode ${pngPath}: ${result.stderr?.toString() ?? ""}`);
  }
  return result.stdout;
}

export function countNonTransparentPixels(rgba) {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 8) count += 1;
  }
  return count;
}

export async function launchBrowser() {
  const puppeteerModule = await loadPuppeteerModule();
  const puppeteer = puppeteerModule.default ?? puppeteerModule;
  const chromePath = await resolveChromePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  return { browser, puppeteerModule, chromePath };
}

// overlay-runtime.js の実プレビュー経路（mount → tick）を、apps/shell を介さず
// 直接ブートするページ。標準ツマミ・パリティ節（3d.md）どおり「同じ three-runtime.js を
// 同じ断片 DOM 構造へ注入する」ことだけを確かめる — apps/shell 自体は編集境界外なので
// 生成しない（README.md に追記したホスト側の読み込み順ドキュメントの直接の実証になる）
export function previewPageHtml({ overlay, edit }) {
  // overlay.html は data-akari-3d-scene の </script> を内包するので、埋め込み script の
  // 早期終了を避けるため escape する（rasterize.mjs の inlineScript と同じ理由）
  const summary = JSON.stringify({ output: edit.output, overlays: [overlay] }).replaceAll(
    "</script",
    "<\\/script",
  );
  const scriptUrl = (relative) => `_runtime/${relative}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  #overlay-stage {
    position: absolute; left: 0; top: 0;
    width: ${edit.output.width}px; height: ${edit.output.height}px;
    transform-origin: 0 0; overflow: hidden;
  }
</style>
</head>
<body>
<div id="overlay-stage"></div>
<script>
  window.akari = window.akari || {};
  window.akari.state = { editPath: null, summary: { output: ${JSON.stringify(edit.output)} } };
  window.akari.engine = { overlayWrite: () => Promise.resolve({ ok: true }) };
  window.akari.stageScale = () => 1;
</script>
<script src="${scriptUrl("vendor/three-bundle.js")}"></script>
<script src="${scriptUrl("vendor/vendor-3d-text-bundle.js")}"></script>
<script src="${scriptUrl("three-runtime.js")}"></script>
<script src="${scriptUrl("overlay-runtime.js")}"></script>
<script>
  window.__akariPreviewReady = (async function() {
    window.akari.runtime.mount(${summary});
    return true;
  })();
</script>
</body>
</html>
`;
}

export function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${result.signal ?? `exited ${result.status}`}: ${result.stderr ?? ""}`);
  }
  return result;
}

export function pngSize(pngPath, ffprobeCommand = "ffprobe") {
  const result = spawnSync(ffprobeCommand, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    pngPath,
  ], { encoding: "utf8" });
  const [width, height] = result.stdout.trim().split("x").map(Number);
  return { width, height };
}

// 検証本体は omitBackground:true（実書き出しと同じ透過 PNG）のハッシュ一致で完結するが、
// 人が目視するための証跡は透過のままだと薄色テキストが見えづらい。目視用コピーだけ
// 不透明背景に合成する（判定には使わない — あくまで報告用の可読化）
export function compositeOverBackground(pngPath, outPath, bgColor = "0x14161c", ffmpegCommand = "ffmpeg") {
  const { width, height } = pngSize(pngPath, "ffprobe");
  const result = spawnSync(ffmpegCommand, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${bgColor}:s=${width}x${height}`,
    "-i",
    pngPath,
    "-filter_complex",
    "[0:v][1:v]overlay=0:0:format=auto",
    "-frames:v",
    "1",
    outPath,
  ]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg composite failed for ${pngPath}: ${result.stderr?.toString() ?? ""}`);
  }
}
