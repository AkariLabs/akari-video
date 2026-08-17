import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

import { renderOverlaySheet } from "../src/rasterize.mjs";
import { findChromePath } from "../src/render-cut.mjs";

const fixtureUrl = new URL(
  "./fixtures/rasterize-waapi-fill-preserve/fragment.html",
  import.meta.url,
);

test("WAAPI clones preserve authored fill so a delayed outro does not hide the intro", async (t) => {
  const chromePath = await findChromePath();
  if (!chromePath) return t.skip("Chrome unavailable");

  const scratch = await mkdtemp(join(tmpdir(), "akari-waapi-fill-preserve-"));
  let browser;
  try {
    const fixture = await readFile(fixtureUrl, "utf8");
    const sheetPath = join(scratch, "overlay-sheet.html");
    await writeFile(sheetPath, renderOverlaySheet({
      overlays: [{
        id: "waapi-fill-preserve",
        start: 0,
        duration: 1.5,
        html: fixture,
        transform: {},
        vars: {},
      }],
      edit: { output: { width: 400, height: 180, fps: 30 } },
      projectRoot: scratch,
      duration: 1.5,
    }), "utf8");

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      pipe: true,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--single-process",
        "--no-zygote",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 180, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "load" });
    await page.evaluate(() => window.__akariReady);

    const captureAt = async (seconds, name) => {
      await page.evaluate((time) => window.__akariSeek(time), seconds);
      const observation = await page.evaluate(() => {
        const element = document.querySelector("[data-waapi-fill-fixture]");
        const style = getComputedStyle(element);
        const matrix = new DOMMatrixReadOnly(style.transform);
        return {
          opacity: Number(style.opacity),
          translateX: matrix.m41,
          fills: element.getAnimations().map((animation) => animation.effect.getTiming().fill),
        };
      });
      await page.screenshot({ path: join(scratch, `${name}.png`) });
      return observation;
    };

    const intro = await captureAt(0.05, "t-0.05-intro");
    assert.deepEqual(intro.fills, ["both", "forwards"]);
    assert.ok(intro.opacity > 0.2 && intro.opacity < 1, `intro opacity=${intro.opacity}`);
    assert.ok(
      intro.translateX > -120 && intro.translateX < 0,
      `intro translateX=${intro.translateX}`,
    );

    const outro = await captureAt(1.2, "t-1.2-outro");
    assert.equal(outro.opacity, 0);
    assert.equal(outro.translateX, 120);
  } finally {
    await browser?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
