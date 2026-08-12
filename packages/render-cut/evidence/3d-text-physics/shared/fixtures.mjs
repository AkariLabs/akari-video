// physics 検証ハーネス共通ヘルパー。3d-text-flat/lib/fixtures.mjs 相当の役割だが、
// このリポの .gitignore はどの深さの `lib/` ディレクトリも無条件で除外する
// （ルート .gitignore の 3 行目、`packages/edit-store` 等の明示的な `!lib/` 例外に本ディレクトリは
// 含まれない）ため、同じ名前で作ると本ハーネス自身が同じ「コミットされない」事故を起こす。
// `git check-ignore` で実測確認済み。ディレクトリ名を shared/ にしているのはそのため
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_FONT_PATH = join(
  HERE,
  "../../../../overlay-runtime/test-harness/fonts/ZenKakuGothicNew-Black.ttf",
);
export const FONT_RELATIVE_PATH = "fonts/ZenKakuGothicNew-Black.ttf";

// puppeteer-core はこの worktree の devDependency ではない（node_modules 自体が無い）。
// packages/render-cut/evidence/3d-text-flat/README.md と同じ流儀で、メイン checkout
// （/Users/ryoma/_edit/30_products/akari-video）の apps/shell/node_modules/puppeteer-core を
// 読み取り専用で借りる（メイン checkout は無改変）
const MAIN_CHECKOUT_PUPPETEER_CORE_ENTRY =
  "/Users/ryoma/_edit/30_products/akari-video/apps/shell/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";

export function editFor({ width, height, fps }) {
  return { output: { width, height, fps } };
}

// 3D overlay fragment（単一ルート + canvas + fallback + data-akari-3d-scene 宣言）を
// overlay オブジェクトへ包む。skills/overlay-authoring/3d.md の fragment スキーマに合わせる
export function overlayFor(id, sceneDescriptor, { start, duration }) {
  const html = `<div class="akari-3d-physics-fixture" style="width:100%;height:100%;">`
    + `<canvas style="width:100%;height:100%;display:block;"></canvas>`
    + `<div data-akari-3d-fallback style="display:none;"></div>`
    + `<script type="application/json" data-akari-3d-scene>${JSON.stringify(sceneDescriptor)}</script>`
    + `</div>`;
  return { id, html, start, duration, transform: {}, vars: {} };
}

export async function makeProjectRoot(label) {
  const root = await mkdtemp(join(tmpdir(), `3d-text-physics-${label}-`));
  await mkdir(join(root, "fonts"), { recursive: true });
  await copyFile(REPO_FONT_PATH, join(root, "fonts", "ZenKakuGothicNew-Black.ttf"));
  return root;
}

export async function loadPuppeteerModule() {
  return import(pathToFileURL(MAIN_CHECKOUT_PUPPETEER_CORE_ENTRY).href);
}

export async function resolveChromePath() {
  const candidate = process.env.CHROME_PATH
    ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  await access(candidate);
  return candidate;
}

export async function launchBrowser(extraArgs = []) {
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
      ...extraArgs,
    ],
  });
  return { browser, puppeteerModule, chromePath };
}

export async function sha256File(path) {
  const buffer = await readFile(path);
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// scene 空間 (x, y, z=0) の頂点列を、CAMERA（position [0,0,d] から lookAt [0,0,0] を向く
// 無回転の PerspectiveCamera。three-runtime.js createCamera と同じ仕様）でスクリーン px へ投影する。
// **評価ハーネス専用の目視補助**（collider は本番ランタイムでは非表示のまま — production の
// three-runtime.js には手を入れない）。人物シルエット collider の輪郭を SVG で重ね描きし、
// 「凹みに文字が入り込む」を確認する際にどこが notch なのか視認できるようにする
export function projectPolygonToScreenSvgPoints(points, { width, height, fov = 45, distance = 8.2 }) {
  const halfFovRadians = (fov * Math.PI) / 180 / 2;
  const aspect = width / height;
  return points
    .map(([x, y]) => {
      const ndcX = (x / distance) / (Math.tan(halfFovRadians) * aspect);
      const ndcY = (y / distance) / Math.tan(halfFovRadians);
      const screenX = (ndcX * 0.5 + 0.5) * width;
      const screenY = (1 - (ndcY * 0.5 + 0.5)) * height;
      return `${screenX.toFixed(2)},${screenY.toFixed(2)}`;
    })
    .join(" ");
}

// 透過 PNG を不透明背景に合成した目視用コピーを作る（判定には使わない。判定は透過 PNG の
// SHA-256/画素比較そのもの。3d-text-flat の *-viewable.png と同じ位置づけ）
export function compositeOverBackground(srcPath, destPath, colorHex = "0x11151c") {
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    srcPath,
  ], { encoding: "utf8" });
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed for ${srcPath}: ${probe.stderr}`);
  }
  const [width, height] = probe.stdout.trim().split("x");
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${colorHex}:s=${width}x${height}`,
    "-i", srcPath,
    "-filter_complex", "overlay=format=auto",
    "-frames:v", "1",
    destPath,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg composite failed for ${srcPath}: ${result.stderr}`);
  }
}
