// terrain の 3 つの警告（読み込み失敗・全画素無効・初回描画で視野外）が、実際の
// ブラウザで console.warn（capture / 書き出しが拾う既存の口）に出ることを確かめる。
//
//   既定の npm test では起動しない（他のブラウザテストと GPU / CPU を取り合わないため）。
//   AKARI_TERRAIN_WARNINGS_BROWSER=1 AKARI_TEST_CHROME_PATH=<chrome か edge> \
//     node packages/overlay-runtime/test-harness/terrain-warnings-browser.test.mjs
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

const VISIBLE_HEIGHTMAP = `data:image/png;base64,${readFileSync(join(HERE, "fixtures/terrain-4x4.png")).toString("base64")}`;
// 4 画素すべて無効値 (128,0,0) の 2x2 PNG。
const INVALID_HEIGHTMAP = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNoYGAAIgYIBQAQDgIBI2LNIgAAAABJRU5ErkJggg==";

function buildHtml(heightmap, camera) {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const runtime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  const scene = {
    terrain: { heightmap, encoding: "gsi-dem", size: [4, 4], meters: [400, 400] },
    camera,
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
  const tempDir = mkdtempSync(join(tmpdir(), "terrain-warnings-browser-"));
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    userDataDir: join(tempDir, "profile"),
    args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
      "--allow-file-access-from-files"],
  });
  const results = [];
  const check = (condition, message, detail = "") => {
    results.push({ ok: Boolean(condition), message: detail ? `${message}（${detail}）` : message });
    if (!condition) console.error(`NG: ${message} ${detail}`);
  };
  const visibleCamera = { position: [0, 4, 6], lookAt: [0, 0.5, 0], fov: 45 };
  const cases = [
    { label: "visible", heightmap: VISIBLE_HEIGHTMAP, camera: visibleCamera, warning: null },
    {
      label: "outside",
      heightmap: VISIBLE_HEIGHTMAP,
      camera: { position: [1000, 38, 1000], lookAt: [1000, 30, 900], fov: 45 },
      warning: /視野に入っていません/u,
    },
    { label: "all-invalid", heightmap: INVALID_HEIGHTMAP, camera: visibleCamera, warning: /すべて無効値/u },
    { label: "unreadable", heightmap: "data:image/png;base64,AAAA", camera: visibleCamera, warning: /読み込めません/u },
  ];
  try {
    for (const item of cases) {
      const htmlPath = join(tempDir, `${item.label}.html`);
      writeFileSync(htmlPath, buildHtml(item.heightmap, item.camera), "utf8");
      const page = await browser.newPage();
      const logs = [];
      page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "warn") logs.push(message.text());
      });
      await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      const status = await page.evaluate(async () => {
        const container = document.getElementById("scene");
        const runtime = window.akari.threeRuntime;
        runtime.render(container, 0);
        for (let attempt = 0; attempt < 600; attempt += 1) {
          const current = runtime.inspect(container).status;
          if (current === "ready" || current === "error") return current;
          await new Promise((done) => setTimeout(done, 20));
        }
        return "timeout";
      });
      await new Promise((done) => setTimeout(done, 300));
      const terrainLogs = logs.filter((line) => line.includes("[akari-three]"));
      check(status === "ready", `${item.label}: 警告しても描画は ready のまま`, status);
      check(terrainLogs.length === (item.warning ? 1 : 0),
        `${item.label}: 警告は ${item.warning ? "1" : "0"} 行`, JSON.stringify(terrainLogs));
      if (item.warning) check(terrainLogs.some((line) => item.warning.test(line)), `${item.label}: 警告文`, terrainLogs[0]);
      await page.close();
    }
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

if (process.env.AKARI_TERRAIN_WARNINGS_BROWSER === "1") {
  await main();
} else {
  console.log("terrain-warnings-browser: skipped (set AKARI_TERRAIN_WARNINGS_BROWSER=1 to run)");
}
