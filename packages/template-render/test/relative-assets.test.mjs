import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import puppeteer from "puppeteer-core";

import { findChrome } from "../src/find-chrome.mjs";
import { buildHarnessHtml, shootFrames } from "../src/render.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = join(PACKAGE_ROOT, "bin", "akari-template-render.mjs");
const RELATIVE_FRAGMENT = join(PACKAGE_ROOT, "test", "fixtures", "relative", "fragment.html");
const MISSING_FRAGMENT = join(PACKAGE_ROOT, "test", "fixtures", "missing", "fragment.html");
const GREEN_ASSET = join(PACKAGE_ROOT, "test", "fixtures", "relative", "assets", "green.svg");
const temporaryDirectories = [];
const chromePath = findChrome();

let pixelBrowser;

after(async () => {
  if (pixelBrowser) await pixelBrowser.close();
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeTemporaryDirectory(label) {
  const directory = mkdtempSync(join(tmpdir(), `template-render-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

function frameOptions(fragmentPath, outDir, prefix) {
  return {
    fragmentPath,
    outDir,
    prefix,
    width: 32,
    height: 32,
    fps: 1,
    frames: 1,
    vars: "",
    backdrop: "#000000",
    under: null,
    transparent: false,
    chromePath,
  };
}

async function measurePng(pngPath) {
  pixelBrowser ??= await puppeteer.launch({
    executablePath: chromePath,
    headless: "shell",
    args: ["--allow-file-access-from-files", "--force-color-profile=srgb", "--disable-lcd-text"],
  });
  const page = await pixelBrowser.newPage();
  try {
    await page.goto(pathToFileURL(pngPath).href, { waitUntil: "load" });
    return await page.evaluate(async () => {
      const image = document.querySelector("img");
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlackPixels = 0;
      let greenPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        if (alpha > 0 && (red > 0 || green > 0 || blue > 0)) nonBlackPixels += 1;
        if (alpha > 0 && green > red * 2 && green > blue * 2) greenPixels += 1;
      }
      return { width: canvas.width, height: canvas.height, nonBlackPixels, greenPixels };
    });
  } finally {
    await page.close();
  }
}

function runCli(args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: PACKAGE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

test("harness の base URL は fragment ディレクトリを末尾区切り付きで指す", () => {
  const html = buildHarnessHtml({
    fragment: "<div></div>",
    fragmentPath: RELATIVE_FRAGMENT,
    width: 32,
    height: 32,
    vars: "",
    backdrop: "#000000",
    under: null,
    transparent: false,
  });
  const fragmentDirectory = dirname(resolve(RELATIVE_FRAGMENT));
  const expectedBase = pathToFileURL(
    fragmentDirectory.endsWith(sep) ? fragmentDirectory : `${fragmentDirectory}${sep}`,
  ).href;
  assert.ok(html.includes(`<base href="${expectedBase}">`));
});

test("一時 workDir でも相対 img を fragment ディレクトリ基準で描画する", async () => {
  const outDir = makeTemporaryDirectory("temporary-workdir");
  await shootFrames(frameOptions(RELATIVE_FRAGMENT, outDir, "relative"));
  const metrics = await measurePng(join(outDir, "relative-00000.png"));
  assert.deepEqual(
    metrics,
    { width: 32, height: 32, nonBlackPixels: 1024, greenPixels: 1024 },
  );
});

test("--png-sequence の固定 workDir でも相対 img を描画する", async () => {
  const outDir = makeTemporaryDirectory("png-sequence");
  const result = await runCli([
    RELATIVE_FRAGMENT,
    "--png-sequence", outDir,
    "--duration", "1",
    "--fps", "1",
    "--size", "32x32",
    "--backdrop", "#000000",
    "--chrome", chromePath,
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const metrics = await measurePng(join(outDir, "frame-00000.png"));
  assert.deepEqual(
    metrics,
    { width: 32, height: 32, nonBlackPixels: 1024, greenPixels: 1024 },
  );
});

test("存在しない相対 src は失敗 URL を stderr に警告し、処理を続ける", async () => {
  const outDir = makeTemporaryDirectory("missing-relative");
  const result = await runCli([
    MISSING_FRAGMENT,
    "--png-sequence", outDir,
    "--duration", "1",
    "--fps", "1",
    "--size", "32x32",
    "--backdrop", "#000000",
    "--chrome", chromePath,
  ]);
  const missingUrl = new URL("./assets/does-not-exist.png", pathToFileURL(MISSING_FRAGMENT)).href;
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /素材の読み込みに失敗しました/);
  assert.ok(result.stderr.includes(missingUrl), `stderr に失敗 URL がありません:\n${result.stderr}`);
});

test("絶対 file URL の img は base URL 追加後も描画する", async () => {
  const fixtureDir = makeTemporaryDirectory("absolute-file-url");
  const fragmentPath = join(fixtureDir, "fragment.html");
  const outDir = join(fixtureDir, "output");
  writeFileSync(
    fragmentPath,
    `<img src="${pathToFileURL(GREEN_ASSET).href}" alt="green fixture" `
      + 'style="display:block;width:32px;height:32px">',
  );
  await shootFrames(frameOptions(fragmentPath, outDir, "absolute"));
  const metrics = await measurePng(join(outDir, "absolute-00000.png"));
  assert.deepEqual(
    metrics,
    { width: 32, height: 32, nonBlackPixels: 1024, greenPixels: 1024 },
  );
});
