import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expandBagOverlays } from "../src/parts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = join(repositoryRoot, "packages/render-cut/test/fixtures/object-tree-html-bag");
const require = createRequire(`${join(repositoryRoot, "packages/render-cut")}/`);
const { readInternalEdit } = require(join(repositoryRoot, "packages/edit-store/lib/index.js"));

test("mounted clone masks expose only their target part and retain projected geometry", async (t) => {
  const internal = readInternalEdit(readFileSync(join(fixtureRoot, "edit.json"), "utf8"));
  const overlays = expandBagOverlays(internal, reference =>
    reference.trimStart().startsWith("<")
      ? reference
      : readFileSync(join(fixtureRoot, reference), "utf8"))
    .map(overlay => ({
      ...overlay,
      html: overlay.html.trimStart().startsWith("<")
        ? overlay.html
        : readFileSync(join(fixtureRoot, overlay.html), "utf8"),
    }));

  const temp = mkdtempSync(join(tmpdir(), "akari-part-mask-mount-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const runtime = readFileSync(join(packageRoot, "src/overlay-runtime.js"), "utf8");
  const interaction = readFileSync(join(packageRoot, "src/interaction.js"), "utf8");
  const htmlPath = join(temp, "index.html");
  writeFileSync(htmlPath, buildPage(runtime, interaction), "utf8");

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
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.evaluate(async summaryOverlays => {
    await window.akari.runtime.mount({ overlays: summaryOverlays });
    window.akari.runtime.tick(1, true);
  }, overlays);

  const atOne = await observe(page);
  const atOnePng = await page.screenshot({ type: "png" });
  assert.deepEqual(atOne.visibleIds, ["g1.first", "plain", "s01#A", "s01.B", "s01.C"]);
  assert.deepEqual(atOne.visibleParts, {
    "s01#A": ["A"],
    "s01.B": ["B"],
    "s01.C": ["C"],
  });
  assert.equal(atOne.hiddenSiblingPointerEvents, "none");
  assert.deepEqual(atOne.bTransform, { x: "0px", y: "-40px" });
  assert.deepEqual(atOne.groupTransform, { x: "90px", y: "70px" });

  await page.evaluate(() => window.akari.runtime.tick(3, true));
  const atThree = await observe(page);
  const atThreePng = await page.screenshot({ type: "png" });
  assert.deepEqual(atThree.visibleIds, ["g1.second", "plain", "s01#A", "s01.B", "s01.C"]);
  assert.deepEqual(atThree.visibleParts, atOne.visibleParts);
  assert.equal(Buffer.from(atOnePng).subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(Buffer.from(atThreePng).subarray(1, 4).toString("ascii"), "PNG");
  assert.notEqual(
    createHash("sha256").update(atOnePng).digest("hex"),
    createHash("sha256").update(atThreePng).digest("hex"),
    "the deterministic t=1s and t=3s frames exercise different group children",
  );
});

async function observe(page) {
  return page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll("[data-overlay-id]"));
    const visibleIds = containers
      .filter(container => getComputedStyle(container).visibility === "visible")
      .map(container => container.dataset.overlayId)
      .sort();
    const visibleParts = {};
    for (const container of containers.filter(entry => entry.querySelector("[data-akari-part-mask]"))) {
      visibleParts[container.dataset.overlayId] = Array.from(container.querySelectorAll("[data-akari-part]"))
        .filter(part => getComputedStyle(part).visibility === "visible")
        .map(part => part.getAttribute("data-akari-part"));
    }
    const b = document.querySelector('[data-overlay-id="s01.B"]');
    const group = document.querySelector('[data-overlay-id="g1.first"]');
    return {
      visibleIds,
      visibleParts,
      hiddenSiblingPointerEvents: getComputedStyle(
        b.querySelector('[data-akari-part="A"]')
      ).pointerEvents,
      bTransform: {
        x: b.style.getPropertyValue("--x"),
        y: b.style.getPropertyValue("--y"),
      },
      groupTransform: {
        x: group.style.getPropertyValue("--x"),
        y: group.style.getPropertyValue("--y"),
      },
    };
  });
}

function buildPage(runtime, interaction) {
  const inline = source => source.replaceAll("</script", "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#preview-pane,#overlay-stage{margin:0;width:640px;height:360px;overflow:hidden}
    #preview-pane{position:relative;background:#000}
    #overlay-stage{position:absolute;inset:0;pointer-events:none}
  </style></head><body><div id="preview-pane"><div id="overlay-stage"></div></div>
  <script>window.akari={state:{summary:{output:{width:640,height:360,fps:30}}},engine:{overlayWrite:async()=>({ok:true})},stageScale:()=>1};</script>
  <script>${inline(runtime)}</script><script>${inline(interaction)}</script></body></html>`;
}

function findChrome() {
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  const candidates = [process.env.CHROME_PATH];
  if (existsSync(root)) {
    const directories = path => readdirSync(path, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const build of directories(root).sort().reverse()) {
      for (const platform of directories(join(root, build))) {
        candidates.push(join(root, build, platform, "chrome-headless-shell"));
      }
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const chrome = candidates.find(candidate => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}
