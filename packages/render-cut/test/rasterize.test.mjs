import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  parseFfmpegOutTime,
  renderOverlaySheet,
  runChecked,
} from "../src/rasterize.mjs";

test("renderOverlaySheet embeds declared overlays deterministically", () => {
  const input = {
    overlays: [{ id: "o1", start: 0, duration: 1, html: "<div>Hello</div>" }],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/tmp/project",
    duration: 1,
  };
  assert.equal(renderOverlaySheet(input), renderOverlaySheet(input));
  assert.match(renderOverlaySheet(input), /data-overlay-id="o1"/);
});

test("HTML comments cannot enable the render-cut 3D runtime", () => {
  const html = "<div>2D only</div><!-- 3D scene declarations (data-akari-3d-scene): 0 -->";
  const sheet = renderOverlaySheet({
    overlays: [{ id: "comment-only", start: 0, duration: 1, html }],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/tmp/project",
    duration: 1,
  });
  assert.match(sheet, /3D scene declarations \(data-akari-3d-scene\): 0/u);
  assert.doesNotMatch(sheet, /window\.akari\.threeRuntime/u);
});

test("a genuine 3D declaration still embeds its model as a data URI", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-comment-safe-three-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(join(projectRoot, "models"));
  await writeFile(join(projectRoot, "models", "scene.glb"), "glb");
  const html = '<div><canvas></canvas><script type="application/json" data-akari-3d-scene>{"model":"models/scene.glb"}</script></div>';
  const sheet = renderOverlaySheet({
    overlays: [{ id: "three", start: 0, duration: 1, html }],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot,
    duration: 1,
  });
  assert.match(sheet, /"model":"data:model\/gltf-binary;base64,Z2xi"/u);
  assert.doesNotMatch(sheet, /"model":"models\/scene\.glb"/u);
  assert.match(sheet, /window\.akari\.threeRuntime/u);
});

test("generated __akariSeek toggles data-akari-active with visibility", async () => {
  const overlays = [
    { id: "first", start: 0, duration: 2, html: '<div class="x">first</div>' },
    { id: "second", start: 2, duration: 2, html: '<div class="x">second</div>' },
  ];
  const sheet = renderOverlaySheet({
    overlays,
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/tmp/project",
    duration: 4,
  });
  const scriptStart = sheet.lastIndexOf("  <script>") + "  <script>".length;
  const scriptEnd = sheet.indexOf("  </script>", scriptStart);
  assert.ok(scriptStart >= "  <script>".length && scriptEnd > scriptStart);

  const containers = overlays.map((overlay) => {
    const attributes = new Set();
    return {
      attributes,
      dataset: { start: String(overlay.start), duration: String(overlay.duration) },
      style: { visibility: "hidden" },
      getAnimations: () => [],
      toggleAttribute(name, force) {
        if (force) attributes.add(name);
        else attributes.delete(name);
      },
    };
  });
  const document = {
    fonts: { ready: Promise.resolve() },
    images: [],
    querySelectorAll(selector) {
      return selector === ".akari-overlay-container" ? containers : [];
    },
  };
  const context = {
    clearTimeout,
    console,
    document,
    setTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  context.window = context;
  vm.runInNewContext(sheet.slice(scriptStart, scriptEnd), context);
  await context.window.__akariReady;

  await context.window.__akariSeek(1);
  assert.equal(containers[0].style.visibility, "visible");
  assert.equal(containers[0].attributes.has("data-akari-active"), true);
  assert.equal(containers[1].style.visibility, "hidden");
  assert.equal(containers[1].attributes.has("data-akari-active"), false);

  await context.window.__akariSeek(3);
  assert.equal(containers[0].style.visibility, "hidden");
  assert.equal(containers[0].attributes.has("data-akari-active"), false);
  assert.equal(containers[1].style.visibility, "visible");
  assert.equal(containers[1].attributes.has("data-akari-active"), true);
});

test("renderOverlaySheet は generatedFrom や legacy track を見ず z だけで DOM 順を決める", () => {
  const sheet = renderOverlaySheet({
    overlays: [
      { id: "front", z: 2, track: 0, start: 0, duration: 1, html: "<div>front</div>" },
      { id: "caption", z: 0, track: 99, generatedFrom: "c1", start: 0, duration: 1, html: "<div>caption</div>" },
      { id: "middle", z: 1, track: 0, start: 0, duration: 1, html: "<div>middle</div>" },
    ],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/tmp/project",
    duration: 1,
  });
  const order = ["caption", "middle", "front"].map((id) => sheet.indexOf(`data-overlay-id="${id}"`));
  assert.ok(order[0] < order[1] && order[1] < order[2]);
});

test("parseFfmpegOutTime accepts timestamps and rejects malformed input", () => {
  assert.equal(parseFfmpegOutTime("00:01:02.5"), 62.5);
  assert.equal(parseFfmpegOutTime("bad"), null);
});

test("runChecked returns a successful child result", () => {
  const result = runChecked(process.execPath, ["-e", "process.stdout.write('ok')"]);
  assert.equal(result.stdout, "ok");
});
