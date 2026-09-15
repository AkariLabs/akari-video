import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { createCamera } from "../../akari-tools/src/world/camera.mjs";
import { renderWorldHtml } from "../../akari-tools/src/world/build.mjs";
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
const movingFrame = `<style>@keyframes world-item-clock-slide { from { transform: translateX(-40px); background: #ffb000; } to { transform: translateX(40px); background: #0088ff; } }
  .clock-frame { width: 36px; height: 28px; animation: world-item-clock-slide 3s linear 1 both; }</style><div class="clock-frame"></div>`;
const descriptorCases = [
  ["cameraStops[].label", value => { value.cameraStops[0].label = "Atelier"; }],
  ["worlds[].spatial", value => { value.worlds[0].spatial = { c: [10, 12, 0] }; }],
  ["cameraStops[].eye", value => { value.cameraStops[0].eye = [10, 12, 100]; }],
  ["cameraStops[].target", value => { value.cameraStops[0].target = [10, 12, 0]; }],
].map(([label, mutate]) => {
  const value = JSON.parse(JSON.stringify(descriptor));
  mutate(value);
  return [label, value];
});
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

test("world item clocks use arrival in default and overview rendering, including reverse seeks", { timeout: 30_000 }, async t => {
  const page = await runtimePage(t);
  const stop = map.cameraStops.find(stop => stop.id === "garden-pond");
  const html = renderWorldHtml(map, [{ id: "clock", zone: stop.id }], new Map([["clock", movingFrame]]), descriptor.frame);
  await page.evaluate(html => { document.querySelector("#stage").innerHTML = html; }, html);
  for (const [time, overview, expected] of [[stop.at - 1, false, 0], [stop.at + 1, false, 1000], [stop.at + 1, true, 1000], [stop.at - 1, true, 0]]) {
    const result = await page.evaluate(({ time, overview }) => {
      const container = document.querySelector("#stage");
      window.akari.worldRuntime.render(container, time, overview ? { overview: { scale: 0.5, ox: 40, oy: 30 } } : {});
      return container.querySelector(".clock-frame").getAnimations().map(animation => ({ time: animation.currentTime, state: animation.playState }));
    }, { time, overview });
    assert.equal(result.length, 1);
    assert.ok(Math.abs(result[0].time - expected) < 1e-6, JSON.stringify(result));
    assert.equal(result[0].state, "paused");
  }
  const restored = await page.evaluate(at => {
    const container = document.querySelector("#stage");
    window.akari.worldRuntime.render(container, 0); // Cull the zone and cancel its animation.
    window.akari.worldRuntime.render(container, at + 1);
    const animation = container.querySelector(".clock-frame").getAnimations()[0];
    const time = animation.currentTime;
    container.querySelector('[data-akari-item-start]').dataset.akariItemStart = "NaN";
    window.akari.worldRuntime.render(container, 2, { overview: { scale: 1, ox: 0, oy: 0 } });
    return { time, fallback: container.querySelector(".clock-frame").getAnimations()[0].currentTime };
  }, stop.at);
  assert.ok(Math.abs(restored.time - 1000) < 1e-6);
  assert.equal(restored.fallback, 2000);
});

test("background zones retain display outside the camera while ordinary zones are culled", { timeout: 30_000 }, async t => {
  const page = await runtimePage(t);
  const result = await page.evaluate(html => {
    const container = document.querySelector("#stage"); container.innerHTML = html;
    const background = container.querySelector('[data-zone="attic-ladder"]');
    background.innerHTML = '<div data-akari-role="background"></div>';
    background.style.display = "block";
    window.akari.worldRuntime.render(container, 1);
    const normal = [background.style.display, container.querySelector('[data-zone="attic-window"]').style.display];
    window.akari.worldRuntime.render(container, 1, { overview: { scale: 0.5, ox: 40, oy: 30 } });
    return { normal, overview: [...container.querySelectorAll('[data-zone]')].map(node => node.style.display) };
  }, fragment);
  assert.deepEqual(result.normal, ["block", "none"]);
  assert.ok(result.overview.every(display => display === ""));
});

test("item animation caches are independent, expire after 250 ms and tolerate replaced animations", { timeout: 30_000 }, async t => {
  const page = await runtimePage(t);
  const result = await page.evaluate(html => {
    const container = document.querySelector("#stage"); container.innerHTML = html;
    const zone = container.querySelector('[data-zone="garden-pond"]');
    zone.innerHTML = '<div data-akari-item-start="5.6"></div><div data-akari-item-start="6.1"></div>';
    const items = [...zone.children], calls = [0, 0], times = [null, null];
    items.forEach((item, index) => {
      item.getAnimations = options => {
        if (options.subtree !== true) throw new Error("subtree is required");
        calls[index]++;
        return [{ pause() {}, set currentTime(_) { throw new Error("replaced CSS animation"); } },
          { pause() {}, set currentTime(time) { times[index] = time; } }];
      };
    });
    let now = 1000;
    const clock = performance.now;
    performance.now = () => now;
    const snapshots = [];
    try {
      for (const elapsed of [0, 100, 250, 251]) {
        now = 1000 + elapsed;
        window.akari.worldRuntime.render(container, 6.6, { overview: { scale: 1, ox: 0, oy: 0 } });
        snapshots.push([...calls]);
      }
    } finally { performance.now = clock; }
    return { snapshots, times };
  }, fragment);
  assert.deepEqual(result.snapshots, [[1, 1], [1, 1], [1, 1], [2, 2]]);
  result.times.forEach((time, index) => assert.ok(Math.abs(time - [1000, 500][index]) < 1e-6));
});

test("raster export seeks animate a late stop in real Chrome with distinct PNG pixels", { timeout: 30_000 }, async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 180, deviceScaleFactor: 1 });
  const stop = map.cameraStops.find(stop => stop.id === "attic-ladder");
  assert.ok(stop.at >= 10 && stop.at + 1.5 < stop.leave);
  const html = renderWorldHtml(map, [{ id: "clock", zone: stop.id }], new Map([["clock", movingFrame]]), descriptor.frame);
  const sheet = renderOverlaySheet({ overlays: [{ id: "world", start: 0, duration: 15, html, htmlPath: "fragment.html" }], edit: { output: { ...descriptor.frame, fps: 30 } }, projectRoot: process.cwd(), duration: 15 });
  await page.setContent(sheet, { waitUntil: "load" });
  await page.evaluate(() => window.__akariReady);
  const capture = async offset => {
    const state = await page.evaluate(async time => {
      await window.__akariSeek(time);
      const container = document.querySelector('.akari-overlay-container > .scene-content');
      return { time: container.querySelector('.clock-frame').getAnimations()[0].currentTime, camera: window.akari.worldRuntime.inspect(container) };
    }, stop.at + offset);
    assert.ok(Math.abs(state.time - offset * 1000) < 1e-6);
    assert.equal(state.camera.phase, "stop");
    return { state, png: await page.screenshot({ encoding: "base64" }) };
  };
  const early = await capture(0.3), late = await capture(1.5);
  assert.deepEqual(early.state.camera, late.state.camera, "カメラの移動による画素差ではない");
  assert.notEqual(md5(Buffer.from(early.png, "base64")), md5(Buffer.from(late.png, "base64")));
  const changedPixels = await page.evaluate(async pngs => {
    const pixels = await Promise.all(pngs.map(async png => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }));
    let changed = 0;
    for (let i = 0; i < pixels[0].length; i += 4) if ([0, 1, 2, 3].some(c => pixels[0][i + c] !== pixels[1][i + c])) changed++;
    return changed;
  }, [early.png, late.png]);
  assert.ok(changedPixels > 100, `素材の画素差: ${changedPixels}`);
  assert.equal((await capture(0.3)).png, early.png, "逆シークも同じ姿勢を再現する");
});

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
  const capture = async seconds => page.evaluate(async time => {
    const container = document.querySelector("#world");
    window.akari.worldRuntime.render(container, time);
    const canvas = container.querySelector("canvas");
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const png = [...new Uint8Array(await blob.arrayBuffer())];
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const channels = [[], [], []]; for (let index = 0; index < data.length; index += 4) for (let channel = 0; channel < 3; channel += 1) channels[channel].push(data[index + channel]);
    const spread = Math.max(...channels.map(values => { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); }));
    return { png, spread, inspect: window.akari.worldRuntime.inspect(container), transforms: [...container.querySelectorAll(".akari-world-sheet")].map(node => node.style.transform), origins: [...container.querySelectorAll(".akari-world-sheet")].map(node => node.style.transformOrigin), displays: [...container.querySelectorAll(".akari-world-zone")].map(node => node.style.display) };
  }, seconds);
  const observations = new Map();
  for (const seconds of observationTimes) observations.set(seconds, await capture(seconds));
  const stop = observations.get(stopTime); const stopAgain = await capture(stopTime); const move = observations.get(moveTime);
  assert.equal(md5(Buffer.from(stop.png)), md5(Buffer.from(stopAgain.png)));
  assert.equal(md5(Buffer.from(stop.png)), "f4907e4fedc9db621a848cb006b0ef1f", "options 無しの既定描画を固定する");
  assert.notEqual(md5(Buffer.from(stop.png)), md5(Buffer.from(move.png)));
  assert.deepEqual(stop.inspect, { status: "ready", world: "atelier", x: 10, y: 12, scale: 1.1, phase: "stop" });
  assert.equal(move.inspect.phase, "move");

  for (const [label, value] of descriptorCases) {
    const png = await page.evaluate(async ({ html, seconds }) => {
      const container = document.createElement("section");
      container.innerHTML = html;
      document.querySelector("#stage").appendChild(container);
      window.akari.worldRuntime.render(container, seconds);
      const blob = await new Promise(resolve => container.querySelector("canvas").toBlob(resolve, "image/png"));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, { html: `${sheets}${declaration(value)}`, seconds: stopTime });
    assert.equal(md5(Buffer.from(png)), md5(Buffer.from(stop.png)), `${label} must not change flat rendering`);
  }

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

  const atlasState = await page.evaluate(async ({ time, view }) => {
    const container = document.querySelector("#world");
    window.akari.worldRuntime.render(container, time);
    const defaultDisplays = [...container.querySelectorAll(".akari-world-zone")].map(node => node.style.display);
    window.akari.worldRuntime.render(container, time, { overview: view });
    const canvas = container.querySelector("canvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 4) if (data[index + 3]) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    return {
      defaultDisplays,
      displays: [...container.querySelectorAll(".akari-world-zone")].map(node => node.style.display),
      transforms: [...container.querySelectorAll(".akari-world-sheet")].map(node => node.style.transform),
      colors: [...colors], canvas: { width: canvas.width, height: canvas.height },
    };
  }, { time: nonMoveEdges[0].switchTime, view: { scale: 0.5, ox: 40, oy: 30, width: 640, height: 360 } });
  assert.ok(atlasState.defaultDisplays.includes("none"));
  assert.ok(atlasState.displays.every(value => value !== "none"));
  assert.ok(atlasState.transforms.every(value => value === "translate(40px, 30px) scale(0.5)"));
  assert.deepEqual(atlasState.canvas, { width: 640, height: 360 });
  assert.ok(atlasState.colors.length > 2, "overview は cover 時刻でも全面単色にしない");

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
  const frameWidth = descriptor.frame.width / overviewCamera.scale;
  const frameHeight = descriptor.frame.height / overviewCamera.scale;
  const expectedFrame = {
    minX: overview.view.ox + (overviewCamera.x - frameWidth / 2) * overview.view.scale,
    maxX: overview.view.ox + (overviewCamera.x + frameWidth / 2) * overview.view.scale,
    minY: overview.view.oy + (overviewCamera.y - frameHeight / 2) * overview.view.scale,
    maxY: overview.view.oy + (overviewCamera.y + frameHeight / 2) * overview.view.scale,
  };
  for (const key of ["minX", "maxX", "minY", "maxY"]) assert.ok(Math.abs(overview.pinkBounds[key] - expectedFrame[key]) <= 3, `${key}: ${overview.pinkBounds[key]} vs ${expectedFrame[key]}`);
  assert.equal(overview.cornerAlpha, 0, "overview clears outside descriptor.frame");
  assert.deepEqual(overview.hazeCorner, [247, 255, 233, 235], "overview haze fills the full target canvas");

  const invalids = ["{", JSON.stringify({ ...descriptor, kind: "spatial" }), JSON.stringify({ ...descriptor, surprise: true }), JSON.stringify({ ...descriptor, frame: { width: "320", height: 180 } })];
  for (const json of invalids) assert.equal(await page.evaluate(value => {
    const container = document.createElement("div"); container.innerHTML = `<script type="application/json" data-akari-world-scene>${value}</script>`;
    try { window.akari.worldRuntime.render(container, 0); return false; } catch (error) { return error instanceof TypeError; }
  }, json), true);
  const unknown = JSON.parse(JSON.stringify(descriptor));
  unknown.cameraStops[0].__drift__ = true;
  const unknownError = await page.evaluate(value => {
    const container = document.createElement("div");
    container.innerHTML = `<script type="application/json" data-akari-world-scene>${JSON.stringify(value)}</script>`;
    try { window.akari.worldRuntime.readDescriptor(container); return null; }
    catch (error) { return { name: error.name, message: error.message }; }
  }, unknown);
  assert.deepEqual(unknownError, { name: "TypeError", message: "world-runtime: cameraStops[0].__drift__ は未知のキーです" });
  assert.equal(await page.evaluate(() => { const container = document.querySelector("#world"); window.akari.worldRuntime.dispose(container); return container.querySelector("canvas") === null; }), true);
});
