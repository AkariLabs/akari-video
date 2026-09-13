import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { createCamera } from "../../akari-tools/src/world/camera.mjs";
import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";
import { browserManifest, registryPath, runtimeRoot, runtimes } from "../runtimes.mjs";
import { launchBrowser } from "./fixtures/browser.mjs";

const map = JSON.parse(readFileSync(new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url), "utf8"));
const descriptor = {
  schemaVersion: 1,
  kind: "flat",
  frame: { width: 320, height: 180 },
  worlds: map.worlds,
  zones: map.zones,
  cameraStops: map.cameraStops,
  edges: map.edges,
  retainedNodes: map.retainedNodes,
};
const declaration = value => `<script type="application/json" data-akari-world-scene>${JSON.stringify(value)}</script>`;
const sheets = descriptor.worlds.map(world => `<div class="akari-world-sheet" data-world="${world.id}">${descriptor.zones.filter(zone => zone.world === world.id).map(zone => `<div class="akari-world-zone" data-zone="${zone.id}"></div>`).join("")}</div>`).join("");
const fragment = `<div style="position:relative;width:320px;height:180px">${sheets}${declaration(descriptor)}</div>`;
const md5 = value => createHash("md5").update(value).digest("hex");
const camera = createCamera(descriptor);
const stopTime = (descriptor.cameraStops[0].at + descriptor.cameraStops[0].leave) / 2;
const moveEdge = descriptor.edges.find(edge => edge.type === "move");
const moveTime = (moveEdge.t0 + moveEdge.t1) / 2;
const nonMoveEdges = descriptor.edges.filter(edge => edge.type !== "move");
const coverTimes = nonMoveEdges.flatMap(edge => [edge.switchTime - edge.transition.cover / 4, edge.switchTime + edge.transition.cover / 4]);
const outsideTimes = nonMoveEdges.map(edge => edge.switchTime + edge.transition.cover);
const observationTimes = [stopTime, moveTime, ...coverTimes, ...outsideTimes];

async function runtimePage(t) {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 400, deviceScaleFactor: 1 });
  await page.setContent(`<main id="stage"></main>`);
  await page.addScriptTag({ path: registryPath });
  await page.addScriptTag({ path: resolve(runtimeRoot, "src/vendor/world-camera.js") });
  await page.addScriptTag({ path: resolve(runtimeRoot, "src/world-runtime.js") });
  return page;
}

test("world registry loads exactly its two scripts and raster export injects both globals", { timeout: 10_000 }, async () => {
  assert.equal(runtimes.filter(entry => entry.id === "world").length, 1);
  const sheet = renderOverlaySheet({ overlays: [{ id: "world", start: 0, duration: 15, html: fragment, htmlPath: "fragment.html" }], edit: { output: { width: 320, height: 180, fps: 30 } }, projectRoot: process.cwd(), duration: 15 });
  assert.match(sheet, /window\.AkariWorldCamera/u);
  assert.match(sheet, /window\.akari\.worldRuntime/u);

  const manifest = browserManifest();
  const app = readFileSync(new URL("../../preview-server/public/app.js", import.meta.url), "utf8");
  const loader = app.slice(app.indexOf("// --- Declarative runtime loading ---"), app.indexOf("let itemKeyframesRuntimeReady"));
  const requests = [];
  const declarationNode = { textContent: JSON.stringify(descriptor) };
  const element = { querySelector: selector => selector.includes("data-akari-world-scene") ? declarationNode : null, querySelectorAll: selector => selector.includes("data-akari-world-scene") ? [declarationNode] : [], setAttribute() {} };
  const context = vm.createContext({
    window: { akari: {} },
    fetch: async path => ({ ok: true, async json() { requests.push(path); return manifest; } }),
    document: {
      createElement() { return { set src(value) { this._src = value; }, get src() { return this._src; }, remove() {} }; },
      head: { appendChild(node) { requests.push(node.src); queueMicrotask(node.onload); } },
    },
    Map, Set, Promise, Error, Array, JSON, queueMicrotask,
  });
  vm.runInContext(`window.akari={};${loader};globalThis.run=ensureRuntimes`, context);
  await context.run([{ el: element, fragmentUrl: null, runtimeIds: new Set() }]);
  const worldScripts = manifest.runtimes.find(entry => entry.id === "world").scripts.map(script => script.url);
  assert.deepEqual(requests.filter(path => worldScripts.includes(path)), worldScripts);
  assert.ok(!requests.some(path => ["/three-bundle.js", "/glass-runtime.js", "/vgpu-runtime.js"].includes(path)));
});

test("world canvas, DOM sheets, overview, inspection and validation are deterministic", { timeout: 90_000 }, async t => {
  const page = await runtimePage(t);
  assert.equal(await page.evaluate(() => window.akari.runtimes.list().some(entry => entry.id === "world")), true);
  await page.evaluate(html => { const container = document.createElement("section"); container.id = "world"; container.innerHTML = html; document.querySelector("#stage").appendChild(container); }, fragment);
  const capture = async seconds => page.evaluate(time => {
    const container = document.querySelector("#world");
    window.akari.worldRuntime.render(container, time);
    const canvas = container.querySelector("canvas");
    const bytes = atob(canvas.toDataURL("image/png").split(",")[1]);
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const channels = [[], [], []]; for (let index = 0; index < data.length; index += 4) for (let channel = 0; channel < 3; channel += 1) channels[channel].push(data[index + channel]);
    const spread = Math.max(...channels.map(values => { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); }));
    return { png: Array.from(bytes, char => char.charCodeAt(0)), spread, inspect: window.akari.worldRuntime.inspect(container), transforms: [...container.querySelectorAll(".akari-world-sheet")].map(node => node.style.transform), origins: [...container.querySelectorAll(".akari-world-sheet")].map(node => node.style.transformOrigin), displays: [...container.querySelectorAll(".akari-world-zone")].map(node => node.style.display) };
  }, seconds);
  const observations = new Map();
  for (const seconds of observationTimes) observations.set(seconds, await capture(seconds));
  const stop = observations.get(stopTime); const stopAgain = await capture(stopTime); const move = observations.get(moveTime);
  assert.equal(md5(Buffer.from(stop.png)), md5(Buffer.from(stopAgain.png)));
  assert.notEqual(md5(Buffer.from(stop.png)), md5(Buffer.from(move.png)));
  assert.deepEqual(stop.inspect, { status: "ready", world: "atelier", x: 10, y: 12, scale: 1.1, phase: "stop" });
  assert.equal(move.inspect.phase, "move");

  for (const seconds of observationTimes) {
    const state = camera(seconds);
    const result = observations.get(seconds);
    const expected = await page.evaluate(({ frame, cameraState }) => {
      const style = document.createElement("div").style;
      style.transform = `translate(${frame.width / 2 - cameraState.x * cameraState.scale}px, ${frame.height / 2 - cameraState.y * cameraState.scale}px) scale(${cameraState.scale})`;
      return style.transform;
    }, { frame: descriptor.frame, cameraState: state });
    assert.ok(result.transforms.length > 0 && result.transforms.every(value => value === expected), `t=${seconds} transform: ${JSON.stringify(result.transforms)} vs ${expected}`);
    assert.ok(result.origins.every(value => value === "0px 0px"), `t=${seconds} transform-origin`);
    assert.ok(result.displays.includes(""), `t=${seconds} has an in-frame zone`);
    assert.ok(result.displays.includes("none"), `t=${seconds} has an out-of-frame zone`);
  }

  for (const edge of nonMoveEdges) {
    const before = observations.get(edge.switchTime - edge.transition.cover / 4);
    const after = observations.get(edge.switchTime + edge.transition.cover / 4);
    const outside = observations.get(edge.switchTime + edge.transition.cover);
    assert.ok(before.spread <= 2, `${edge.id} before haze stddev ${before.spread}`);
    assert.ok(after.spread <= 2, `${edge.id} after haze stddev ${after.spread}`);
    assert.notEqual(md5(Buffer.from(before.png)), md5(Buffer.from(outside.png)));
    assert.notEqual(md5(Buffer.from(after.png)), md5(Buffer.from(outside.png)));
  }

  const overview = await page.evaluate(value => {
    const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 500;
    const view = { scale: 1, ox: 400, oy: 200 };
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    window.akari.worldRuntime.drawOverview(ctx, value, view, 1, { frame: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set(); const pink = [];
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
      if (data[index] === 238 && data[index + 1] === 130 && data[index + 2] === 223) pink.push([(index / 4) % canvas.width, Math.floor(index / 4 / canvas.width)]);
    }
    const pinkBounds = { minX: Math.min(...pink.map(point => point[0])), maxX: Math.max(...pink.map(point => point[0])), minY: Math.min(...pink.map(point => point[1])), maxY: Math.max(...pink.map(point => point[1])) };
    const cornerAlpha = data[3];
    window.akari.worldRuntime.drawOverview(ctx, value, view, 5, {});
    const hazeCorner = [...ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data];
    return { colors: [...colors], pinkBounds, cornerAlpha, hazeCorner, view };
  }, descriptor);
  for (const rgb of ["244,239,230", "232,242,222", "48,45,61", "238,130,223"]) assert.ok(overview.colors.includes(rgb), rgb);
  const overviewCamera = camera(1);
  const expectedFrame = { minX: overview.view.ox - descriptor.frame.width / overviewCamera.scale * overview.view.scale / 2, maxX: overview.view.ox + descriptor.frame.width / overviewCamera.scale * overview.view.scale / 2, minY: overview.view.oy - descriptor.frame.height / overviewCamera.scale * overview.view.scale / 2, maxY: overview.view.oy + descriptor.frame.height / overviewCamera.scale * overview.view.scale / 2 };
  for (const key of ["minX", "maxX", "minY", "maxY"]) assert.ok(Math.abs(overview.pinkBounds[key] - expectedFrame[key]) <= 3, `${key}: ${overview.pinkBounds[key]} vs ${expectedFrame[key]}`);
  assert.equal(overview.cornerAlpha, 0, "overview clears outside descriptor.frame");
  assert.deepEqual(overview.hazeCorner, [247, 255, 233, 235], "overview haze fills the full target canvas");

  const invalids = ["{", JSON.stringify({ ...descriptor, kind: "spatial" }), JSON.stringify({ ...descriptor, surprise: true }), JSON.stringify({ ...descriptor, frame: { width: "320", height: 180 } })];
  for (const json of invalids) assert.equal(await page.evaluate(value => {
    const container = document.createElement("div"); container.innerHTML = `<script type="application/json" data-akari-world-scene>${value}</script>`;
    try { window.akari.worldRuntime.render(container, 0); return false; } catch (error) { return error instanceof TypeError; }
  }, json), true);
  assert.equal(await page.evaluate(() => { const container = document.querySelector("#world"); window.akari.worldRuntime.dispose(container); return container.querySelector("canvas") === null; }), true);
});
