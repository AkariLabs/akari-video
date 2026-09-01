import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadAndBuildOsrPage } from "../src/page-builder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../render-cut/test/fixtures/caption-item-render");

test("OSR page keeps the detached caption item window and renders its inline HTML", async () => {
  const result = await loadAndBuildOsrPage({
    projectRoot: fixtureRoot,
    editPath: join(fixtureRoot, "edit.json"),
    fps: 30,
    width: 640,
    height: 360,
    duration: 5,
  });

  const overlay = result.edit.overlays.find(candidate => candidate.id === "c2-out");
  assert.equal(overlay.start, 61 / 30);
  assert.equal(overlay.duration, 1);
  assert.equal(overlay.transform.y, -200);
  assert.equal(Object.hasOwn(overlay, "z"), false);
  assert.equal((result.overlaySheetHtml.match(/data-overlay-id="c2-out"/gu) ?? []).length, 1);
  const order = ["c1-01", "c3-01", "c2-out", "order-html"]
    .map(id => result.overlaySheetHtml.indexOf(`data-overlay-id="${id}"`));
  assert.ok(order.every(position => position >= 0));
  assert.ok(order.every((position, index) => index === 0 || order[index - 1] < position));
  const detachedStart = result.overlaySheetHtml.indexOf('data-overlay-id="c2-out"');
  const nextOverlay = result.overlaySheetHtml.indexOf("data-overlay-id=", detachedStart + 1);
  const detachedBlock = result.overlaySheetHtml.slice(
    detachedStart,
    nextOverlay === -1 ? undefined : nextOverlay,
  );
  assert.equal((detachedBlock.match(/分離された字幕/gu) ?? []).length, 1);
});
