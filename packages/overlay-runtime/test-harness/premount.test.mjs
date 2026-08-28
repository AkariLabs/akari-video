// ライブプレビュー専用 3D premount を実ブラウザで検証する。
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
    .flatMap((build) =>
      directoriesIn(join(root, build)).map((platform) =>
        join(root, build, platform, "chrome-headless-shell")))
    .filter((candidate) => existsSync(candidate));
}

const CHROME_CANDIDATES = [
  ...puppeteerCacheCandidates(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("headless Chrome が見つかりません（CHROME_CANDIDATES を確認）");
}

function buildMinimalGlb() {
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "akari-video premount test fixture" },
    scene: 0,
    scenes: [{ nodes: [] }],
  });
  const jsonBytes = Buffer.from(json, "utf8");
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

const MODEL_DATA_URI = `data:model/gltf-binary;base64,${buildMinimalGlb().toString("base64")}`;

function buildHtml() {
  const bundle = readFileSync(join(SRC, "vendor/three-bundle.js"), "utf8");
  const threeRuntime = readFileSync(join(SRC, "three-runtime.js"), "utf8");
  const overlayRuntime = readFileSync(join(SRC, "overlay-runtime.js"), "utf8");
  const inlineScript = (source) => source.replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  #overlay-stage { position: relative; width: 1280px; height: 720px; overflow: hidden; }
  .scene-root, .scene-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
</style></head><body>
<div id="overlay-stage"></div>
<script>${inlineScript(bundle)}</script>
<script>${inlineScript(threeRuntime)}</script>
<script>${inlineScript(overlayRuntime)}</script>
</body></html>`;
}

function overlay(id, start, duration) {
  return {
    id,
    start,
    duration,
    html: `<div class="scene-root"><canvas></canvas><script type="application/json" data-akari-3d-scene>{"model":"${MODEL_DATA_URI}"}<\/script></div>`,
  };
}

async function main() {
  const puppeteer = require("puppeteer-core");
  const tempDir = mkdtempSync(join(tmpdir(), "premount-test-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    args: [
      "--no-sandbox",
      "--no-zygote",
      "--single-process",
      "--allow-file-access-from-files",
      "--disable-gpu",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
    ],
  });

  const results = [];
  const assertTrue = (condition, message) => {
    results.push({ ok: Boolean(condition), message });
    if (!condition) console.error(`NG: ${message}`);
  };

  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error(`[page.error] ${error}`));
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    const waitForState = (kind, timeout = 15000) =>
      page.evaluate(async ({ stateKind, timeoutMilliseconds }) => {
        const predicate = () => {
          const state = window.akari.threeRuntime.premountState();
          if (stateKind === "lead-ready") {
            const item = state.live.find((entry) => entry.overlayId === "lead");
            return item?.status === "ready" && item.premounted && state.prepared >= 1;
          }
          if (stateKind === "four-ready") {
            return state.live.length === 4
              && state.live.every((entry) => entry.status === "ready");
          }
          return false;
        };
        const deadline = Date.now() + timeoutMilliseconds;
        for (;;) {
          if (predicate()) return true;
          if (Date.now() > deadline) return false;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }, { stateKind: kind, timeoutMilliseconds: timeout });

    // (a) lead 外では作らず、lead 内へ入った tick で hidden のまま instance を準備する。
    await page.evaluate(async (item) => {
      await window.akari.runtime.mount({ overlays: [item] });
      window.akari.runtime.configure({ premount: { leadSeconds: 2, maxInstances: 4 } });
      window.akari.runtime.tick(7.0);
    }, overlay("lead", 10, 1));
    const outside = await page.evaluate(() => window.akari.threeRuntime.premountState());
    assertTrue(!outside.live.some((entry) => entry.overlayId === "lead"), "(a) lead 外では instance を作らない");

    const inside = await page.evaluate(() => {
      window.akari.runtime.tick(8.5);
      const container = document.querySelector('[data-overlay-id="lead"]');
      return {
        state: window.akari.threeRuntime.premountState(),
        visibility: container.style.visibility,
      };
    });
    assertTrue(
      inside.state.live.some((entry) => entry.overlayId === "lead"),
      "(a) distance=1.5 秒で instance が作られる",
    );
    assertTrue(inside.visibility === "hidden", "(a) prepare 中も container は visibility:hidden のまま");
    const leadReady = await waitForState("lead-ready");
    assertTrue(leadReady, "(a) オフスクリーン draw まで完了して prepared が増える");

    // (b) 近い非表示区間では捨てず、巻き戻しても作り直さない。
    const shortGap = await page.evaluate(() => {
      window.akari.runtime.tick(10.5);
      const before = window.akari.threeRuntime.premountState();
      window.akari.runtime.tick(11.5);
      const hidden = window.akari.threeRuntime.premountState();
      window.akari.runtime.tick(10.6);
      const returned = window.akari.threeRuntime.premountState();
      return { before, hidden, returned };
    });
    assertTrue(
      shortGap.hidden.disposed === shortGap.before.disposed
        && shortGap.hidden.live.some((entry) => entry.overlayId === "lead"),
      "(b) 0.5 秒の非表示では dispose せず live に保持する",
    );
    assertTrue(
      shortGap.returned.created === shortGap.before.created,
      "(b) 再表示へ戻しても created は増えず作り直し 0 回",
    );

    // (c) 4 instance を作った後に上限を 2 へ絞り、距離が遠い 2 件から破棄する。
    await page.evaluate(async (items) => {
      await window.akari.runtime.mount({ overlays: items });
      window.akari.runtime.configure({ premount: { leadSeconds: 2, maxInstances: 4 } });
      window.akari.runtime.tick(9.8);
    }, [
      overlay("near-1", 10, 0.4),
      overlay("near-2", 10.5, 0.4),
      overlay("far-1", 11, 0.4),
      overlay("far-2", 11.5, 0.4),
    ]);
    const fourReady = await waitForState("four-ready");
    assertTrue(fourReady, "(c) 比較前に lead 内の 4 instance がすべて作られる");
    const capped = await page.evaluate(() => {
      const before = window.akari.threeRuntime.premountState();
      window.akari.runtime.configure({ premount: { leadSeconds: 2, maxInstances: 2 } });
      window.akari.runtime.tick(9.8);
      return { before, after: window.akari.threeRuntime.premountState() };
    });
    const remaining = capped.after.live.map((entry) => entry.overlayId).sort();
    assertTrue(capped.after.live.length <= 2, "(c) maxInstances=2 を超えて保持しない");
    assertTrue(
      JSON.stringify(remaining) === JSON.stringify(["near-1", "near-2"]),
      "(c) 距離が近い 2 instance を残し、最遠から破棄する",
    );
    assertTrue(
      capped.after.disposed - capped.before.disposed === 2,
      "(c) 上限超過ぶんの 2 instance を dispose する",
    );

    await page.evaluate(() => {
      window.akari.runtime.unmount();
      window.akari.runtime.configure({ premount: false });
    });
  } finally {
    const process = browser.process();
    if (process) process.kill("SIGKILL");
    else await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "OK  " : "NG  "} ${result.message}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

await main();
