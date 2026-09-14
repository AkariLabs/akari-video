import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import puppeteer from "puppeteer-core";
import { findChrome } from "../bin/avatar-vrm/find-chrome.mjs";
import { buildWorldOverview } from "../src/world/overview.mjs";

const fixture = new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url);

test("world overview: 自己完結 HTML に帯と非 move マーカーを描き JS エラー 0", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-world-overview-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(path.join(root, "planning"), { recursive: true });
  await cp(fixture, path.join(root, "planning", "world-map.json"));
  await writeFile(path.join(root, "edit.json"), `${JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [] }, null, 2)}\n`);
  const result = await buildWorldOverview(root);
  assert.doesNotMatch(result.html, /https?:\/\//);
  assert.equal((result.html.match(/data-world-band/g) ?? []).length, 3);
  assert.equal((result.html.match(/data-edge-marker/g) ?? []).length, 2);
  for (const [index, match] of [...result.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries()) {
    const scriptFile = path.join(root, `inline-${index}.js`);
    await writeFile(scriptFile, match[1], "utf8");
    const checked = spawnSync(process.execPath, ["--check", scriptFile], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  }
  const chrome = findChrome();
  if (!chrome) return t.skip("Chrome が無いため file:// JS 検査を省略");
  let browser;
  try { browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] }); }
  catch { return t.skip("この実行環境では Chrome を起動できないため file:// JS 検査を省略"); }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(result.output).href, { waitUntil: "load" });
    assert.deepEqual(errors, []);
    assert.equal((await page.$$("[data-world-band]")).length, 3);
    assert.equal((await page.$$("[data-edge-marker]")).length, 2);
  } finally { await browser.close(); }
});
