// terrain + lines の実ブラウザ配線を検証する（補間・高さ変位そのものは terrain-lines.test.mjs の純関数テスト）。
//
//   - 地形の高さマップ PNG を読み終えてから status=ready になる
//   - inspect().terrain が画像サイズ・segments・高さの範囲を返す
//   - lines[].keys の progress が時刻で伸び、同じ t の再描画で同じ頂点数になる
//   - t の違う 2 コマのスクリーンショットが実際に違う（地形 + 伸びる線が描かれている）
//
//   既定の npm test では起動しない（既存のブラウザテストと GPU / CPU を取り合わないため）。
//   AKARI_TERRAIN_LINES_BROWSER=1 AKARI_TEST_CHROME_PATH=<chrome か edge> \
//     node packages/overlay-runtime/test-harness/three-terrain-lines-browser.test.mjs
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const require = createRequire(`${resolve(HERE, "../../render-cut")}/`);

function puppeteerCacheCandidates() {
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (!existsSync(root)) return [];
  const directoriesIn = (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  return directoriesIn(root)
    .sort()
    .reverse()
    .flatMap((build) => directoriesIn(join(root, build)).map((platform) => join(root, build, platform, "chrome-headless-shell")))
    .filter((candidate) => existsSync(candidate));
}

function findChrome() {
  const candidates = [
    process.env.AKARI_TEST_CHROME_PATH,
    ...puppeteerCacheCandidates(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error("headless Chrome が見つかりません（AKARI_TEST_CHROME_PATH を指定）");
}

const HEIGHTMAP = `data:image/png;base64,${readFileSync(join(HERE, "fixtures/terrain-4x4.png")).toString("base64")}`;

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  const scene = {
    terrain: { heightmap: HEIGHTMAP, size: [4, 4], exaggeration: 2, segments: 2 },
    lines: [{
      points: [[-1.5, 2, -1.5], [0, 3.4, 0], [1.5, 2, 1.5]],
      color: "#ff3366",
      width: 8,
      keys: [
        { t: 0, progress: 0.15 },
        { t: 1, progress: 1, ease: "easeInOut" },
      ],
    }],
    camera: { position: [0, 4, 6], lookAt: [0, 0.5, 0], fov: 45 },
    background: { color: "#101820" },
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #101820; }
  #scene { position: relative; width: 320px; height: 180px; }
  #scene canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style><script>${inlineScript(bundle)}</script><script>${inlineScript(runtime)}</script></head><body>
<div id="scene"><div class="root"><canvas data-akari-3d-canvas></canvas>
<script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script></div></div>
</body></html>`;
}

async function main() {
  const puppeteer = require("puppeteer-core");
  const tempDir = mkdtempSync(join(tmpdir(), "three-terrain-lines-browser-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    userDataDir: join(tempDir, "profile"),
    args: ["--no-sandbox", "--no-zygote", "--single-process", "--allow-file-access-from-files",
      "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  });
  const results = [];
  const check = (condition, message, detail = "") => {
    results.push({ ok: Boolean(condition), message: detail ? `${message}（${detail}）` : message });
    if (!condition) console.error(`NG: ${message} ${detail}`);
  };
  const close = (actual, expected, epsilon = 1e-6) => typeof actual === "number"
    && typeof expected === "number" && Math.abs(actual - expected) <= epsilon;

  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[page.console] ${message.text()}`);
    });
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    const result = await page.evaluate(async () => {
      const container = document.getElementById("scene");
      const runtime = window.akari.threeRuntime;
      runtime.render(container, 0);
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const status = runtime.inspect(container).status;
        if (status === "ready" || status === "error") break;
        await new Promise((done) => setTimeout(done, 20));
      }
      const sample = (seconds) => {
        runtime.render(container, seconds);
        const info = runtime.inspect(container);
        return {
          status: info.status,
          terrain: info.terrain,
          lines: info.lines,
          camera: info.cameraWorldPosition,
        };
      };
      return {
        initial: sample(0),
        middle: sample(0.5),
        end: sample(1),
        again: sample(0),
      };
    });
    check(result.initial.status === "ready", "terrain + lines だけで ready", result.initial.status);
    const terrain = result.initial.terrain;
    check(terrain && terrain.segments === 2 && terrain.width === 4 && terrain.height === 4,
      "inspect().terrain が画像サイズと segments を返す", JSON.stringify(terrain));
    check(terrain && close(terrain.minHeight, 0) && close(terrain.maxHeight, 2 * (255 / 255)),
      "地形の高さの範囲が既知の PNG と exaggeration から期待どおり", JSON.stringify(terrain));
    check(result.initial.lines?.length === 1 && result.initial.lines[0].vertexCount > 0,
      "lines が 1 本描かれている", JSON.stringify(result.initial.lines));
    check(result.initial.lines[0].progress === 0.15, "t=0 の progress は最初のキー", String(result.initial.lines[0].progress));
    check(result.middle.lines[0].progress > 0.15 && result.middle.lines[0].progress < 1,
      "t=0.5 の progress はキー間の補間値", String(result.middle.lines[0].progress));
    check(result.end.lines[0].progress === 1, "t=1 の progress は最後のキー", String(result.end.lines[0].progress));
    check(result.end.lines[0].vertexCount > result.initial.lines[0].vertexCount,
      "伸びた線の頂点数が増える", `${result.initial.lines[0].vertexCount} -> ${result.end.lines[0].vertexCount}`);
    check(result.again.lines[0].vertexCount === result.initial.lines[0].vertexCount
      && result.again.lines[0].progress === result.initial.lines[0].progress,
    "同じ t の再描画は同じ頂点数・progress（決定論）");

    const clip = { x: 0, y: 0, width: 320, height: 180 };
    const first = await page.screenshot({ clip });
    await page.evaluate(() => window.akari.threeRuntime.render(document.getElementById("scene"), 1));
    const last = await page.screenshot({ clip });
    check(Buffer.compare(Buffer.from(first), Buffer.from(last)) !== 0,
      "t=0 と t=1 のスクリーンショットが違う（線が実際に伸びている）");
  } finally {
    const child = browser.process();
    if (child) child.kill("SIGKILL");
    else await browser.close();
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) console.log(`  ${entry.ok ? "OK  " : "NG  "} ${entry.message}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

if (process.env.AKARI_TERRAIN_LINES_BROWSER === "1") {
  await main();
} else {
  console.log("three-terrain-lines-browser: skipped (set AKARI_TERRAIN_LINES_BROWSER=1 to run)");
}
