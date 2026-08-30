import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readRenderEdit } from "../src/internal-render.mjs";
import { renderOverlaySheet } from "../src/rasterize.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const fixtureRoot = join(packageRoot, "test", "fixtures", "item-keyframes");
const require = createRequire(`${packageRoot}/`);

test("sheet seek evaluates item-relative frames for OSR and legacy consumers", async (t) => {
  const source = readFileSync(join(fixtureRoot, "edit.json"), "utf8");
  const { edit } = readRenderEdit(source, join(fixtureRoot, ".akari", "render-tmp"), {
    projectRoot: fixtureRoot,
  });
  const overlays = edit.overlays.map((overlay) => ({
    ...overlay,
    html: overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : readFileSync(join(fixtureRoot, overlay.html), "utf8"),
  }));
  const sheet = renderOverlaySheet({ overlays, edit, projectRoot: fixtureRoot, duration: 5 });

  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    args: ["--no-sandbox", "--single-process", "--no-zygote", "--disable-gpu"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
  await page.setContent(sheet, { waitUntil: "load" });
  await page.evaluate(() => window.__akariReady);

  const observe = async (seconds) => page.evaluate(async (value) => {
    await window.__akariSeek(value);
    const read = (id) => document.querySelector(`[data-overlay-id="${id}"]`);
    return {
      plainX: Number.parseFloat(read("plain").style.getPropertyValue("--x")),
      bagX: Number.parseFloat(read("s01.B").style.getPropertyValue("--x")),
      groupOpacity: Number.parseFloat(read("g1.first").style.opacity),
    };
  }, seconds);

  const first = await observe(1.1);
  const second = await observe(2.4);
  assert.ok(Math.abs(first.plainX - 110) <= 1, JSON.stringify(first));
  assert.ok(Math.abs(second.plainX - 240) <= 1, JSON.stringify(second));
  assert.notEqual(first.bagX, second.bagX);
  assert.ok(second.groupOpacity > first.groupOpacity, `${first.groupOpacity} -> ${second.groupOpacity}`);
});

function findChrome() {
  const cacheRoot = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  const candidates = [process.env.CHROME_PATH];
  if (existsSync(cacheRoot)) {
    const directories = path => readdirSync(path, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const build of directories(cacheRoot).sort().reverse()) {
      for (const platform of directories(join(cacheRoot, build))) {
        candidates.push(join(cacheRoot, build, platform, "chrome-headless-shell"));
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const chrome = candidates.find(candidate => candidate && existsSync(candidate));
  if (!chrome) throw new Error(`headless Chrome was not found under ${repositoryRoot}`);
  return chrome;
}
