import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import puppeteer from "puppeteer-core";
import { findChrome } from "../bin/avatar-vrm/find-chrome.mjs";
import { buildWorld } from "../src/world/build.mjs";
import { createCamera } from "../src/world/camera.mjs";
import { buildWorldOverview } from "../src/world/overview.mjs";

const mapFixture = new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url);
const assetFixture = new URL("../../schemas/examples/kit-manifest-v1-with-asset/assets/overlay/sample-kit-frame/", import.meta.url);

test("world overview atlas: 実断片・撮影枠・ジャンプ・view 操作を実ブラウザで測る", { timeout: 30_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-world-atlas-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await mkdir(path.join(root, "planning"), { recursive: true });
  await cp(mapFixture, path.join(root, "planning", "world-map.json"));
  const map = JSON.parse(await readFile(mapFixture, "utf8"));
  await writeFile(path.join(root, "edit.json"), `${JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [] }, null, 2)}\n`);
  await writeFile(path.join(root, "planning", "world-items.json"), `${JSON.stringify({ schemaVersion: 1, items: map.zones.map((zone, index) => ({ id: `frame-${index}`, zone: zone.id, asset: "overlay/sample-kit-frame" })) }, null, 2)}\n`);
  await buildWorld(root, { resolveAsset: async () => ({ category: "overlay", projectDir: fileURLToPath(assetFixture) }) });
  await mkdir(path.join(root, ".akari", "reports", "world-preview"), { recursive: true });
  await writeFile(path.join(root, ".akari", "reports", "world-preview", "camera-proof.json"), JSON.stringify({ frames: [{ time: 0, world: "attic", camera: { x: 570, y: 50, scale: 1 } }] }));
  const result = await buildWorldOverview(root);
  assert.equal(result.atlas, true); assert.equal(result.fallback, false);
  assert.doesNotMatch(result.html, /https?:\/\//);

  const chrome = findChrome();
  if (!chrome) return t.skip("Chrome が無いため atlas 実測を省略");
  let browser;
  try { browser = await puppeteer.launch({ executablePath: chrome, headless: "shell", pipe: true, args: ["--single-process", "--no-zygote", "--disable-gpu", "--use-angle=swiftshader", "--allow-file-access-from-files"] }); }
  catch { return t.skip("この実行環境では Chrome を起動できないため atlas 実測を省略"); }
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const errors = [], external = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", request => { const scheme = new URL(request.url()).protocol; if (!["file:", "data:", "about:", "blob:"].includes(scheme)) external.push(request.url()); });
    await page.goto(pathToFileURL(result.output).href, { waitUntil: "load" });
    await page.evaluate(() => window.__akariWorldOverview.ready);
    assert.equal(await page.evaluate(() => Array.from(window.frames).some(frame => frame.akariAtlasReady === true)), true);
    assert.equal(await page.evaluate(() => Array.from(window.frames).flatMap(frame => Array.from(frame.document?.querySelectorAll?.('[data-item]') ?? [])).every(node => node.getBoundingClientRect().width === 0)), true, "俯瞰専用の item 寸法を注入しない");
    assert.deepEqual(errors, []); assert.deepEqual(external, []);

    const wideLayout = await page.evaluate(() => { const stage = document.querySelector('.stage').getBoundingClientRect(), aside = document.querySelector('aside').getBoundingClientRect(); return { stage: { x: stage.x, width: stage.width }, aside: { x: aside.x } }; });
    assert.ok(wideLayout.aside.x >= wideLayout.stage.x + wideLayout.stage.width - 1, `wide aside が stage に重なっています: ${JSON.stringify(wideLayout)}`);

    const proofPixels = await page.evaluate(() => {
      const api = window.__akariWorldOverview, current = api.view(), canvas = document.getElementById('overlay'), dpr = devicePixelRatio || 1;
      const x = Math.round((current.ox + 570 * current.scale) * dpr), y = Math.round((current.oy + 50 * current.scale) * dpr), context = canvas.getContext('2d');
      const enabled = [...context.getImageData(x, y, 1, 1).data];
      const toggle = document.getElementById('camera-path'); toggle.checked = false; toggle.dispatchEvent(new Event('change'));
      const disabled = [...context.getImageData(x, y, 1, 1).data];
      return { enabled, disabled };
    });
    assert.notDeepEqual(proofPixels.enabled, proofPixels.disabled, "camera-proof 点もカメラ軌道 checkbox に従う");

    const geometry = await page.evaluate(() => ({ rects: window.__akariWorldOverview.worldRects(), origin: window.__akariWorldOverview.mapOrigin() }));
    await page.evaluate(() => { document.getElementById('overlay').style.visibility = 'hidden'; });
    const png = await page.screenshot({ encoding: "base64" });
    await page.evaluate(() => { document.getElementById('overlay').style.visibility = ''; });
    const orange = await page.evaluate(async (dataUrl, input) => {
      const image = new Image(); image.src = dataUrl; await image.decode();
      const bitmap = document.createElement("canvas"); bitmap.width = image.width; bitmap.height = image.height;
      const context = bitmap.getContext("2d"); context.drawImage(image, 0, 0);
      return input.rects.map(rect => {
        const x0 = Math.max(0, Math.floor(input.origin.x + rect.x)), y0 = Math.max(0, Math.floor(input.origin.y + rect.y));
        const width = Math.max(1, Math.min(bitmap.width - x0, Math.ceil(rect.width))), height = Math.max(1, Math.min(bitmap.height - y0, Math.ceil(rect.height)));
        const pixels = context.getImageData(x0, y0, width, height).data; let count = 0, nonTransparent = 0;
        for (let index = 0; index < pixels.length; index += 4) { if (Math.abs(pixels[index] - 255) <= 24 && Math.abs(pixels[index + 1] - 176) <= 24 && pixels[index + 2] <= 24) count += 1; if (pixels[index + 3]) nonTransparent += 1; }
        return { id: rect.id, count, nonTransparent };
      });
    }, `data:image/png;base64,${png}`, geometry);
    for (const world of orange) { assert.ok(world.count >= 50, `${world.id}: sample-kit-frame の橙画素 ${world.count}`); assert.ok(world.nonTransparent > 0); }

    const times = [(map.cameraStops[0].at + map.cameraStops[0].leave) / 2, (map.edges[0].t0 + map.edges[0].t1) / 2];
    const cameraAt = createCamera(map);
    for (const time of times) {
      const measured = await page.evaluate(t => window.__akariWorldOverview.seek(t).then(() => ({ rect: window.__akariWorldOverview.frameRect(), view: window.__akariWorldOverview.view() })), time);
      const camera = cameraAt(time), width = 1920 / camera.scale * measured.view.scale, height = 1080 / camera.scale * measured.view.scale;
      const expected = { x: measured.view.ox + camera.x * measured.view.scale - width / 2, y: measured.view.oy + camera.y * measured.view.scale - height / 2, width, height };
      for (const key of Object.keys(expected)) assert.ok(Math.abs(measured.rect[key] - expected[key]) <= 0.5, `${key}: ${measured.rect[key]} vs ${expected[key]}`);
    }
    const interaction = await page.evaluate(async () => {
      const api = window.__akariWorldOverview, before = api.view(); api.zoomBy(1.2); const zoomed = api.view(); api.panBy(40, 0); const panned = api.view(); api.fit(); const fitted = api.view();
      const targets = api.jumpTargets(); await api.jumpTo(targets[1].id); const jumped = api.seconds, scrubbed = Number(document.getElementById('scrub').value);
      api.follow(true); await api.seek(targets[2].time); const rect = api.frameRect(), size = api.mapSize();
      return { before, zoomed, panned, fitted, target: targets[1], jumped, scrubbed, rect, size, drawError: api.lastDrawError() };
    });
    assert.equal(interaction.drawError, null);
    assert.ok(Math.abs(interaction.zoomed.scale / interaction.before.scale - 1.2) < 1e-9);
    assert.ok(Math.abs(interaction.panned.ox - interaction.zoomed.ox - 40) < 1e-9);
    assert.deepEqual(interaction.fitted, interaction.before);
    assert.ok(Math.abs(interaction.jumped - interaction.target.time) < 0.001);
    assert.ok(Math.abs(interaction.scrubbed - interaction.target.time) < 0.001);
    assert.ok(Math.abs(interaction.rect.x + interaction.rect.width / 2 - interaction.size.width / 2) <= 1);
    assert.ok(Math.abs(interaction.rect.y + interaction.rect.height / 2 - interaction.size.height / 2) <= 1);

    await page.evaluate(() => window.__akariWorldOverview.follow(false));
    const original = await page.evaluate(() => window.__akariWorldOverview.stops()[0]);
    const point = await page.evaluate(id => { const p = window.__akariWorldOverview.screenOf(id), o = window.__akariWorldOverview.mapOrigin(); return { x: o.x + p.x, y: o.y + p.y }; }, original.id);
    await page.keyboard.down('Alt'); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 30, point.y + 20); await page.mouse.up(); await page.keyboard.up('Alt');
    assert.deepEqual(await page.evaluate(id => window.__akariWorldOverview.stops().find(stop => stop.id === id).c, original.id), original.c, "file 直開きでは移動座標を戻す");

    await page.evaluateOnNewDocument(() => { window.__hostMessages = []; window.acquireTheiaApi = () => ({ postMessage: message => window.__hostMessages.push(message) }); });
    await page.reload({ waitUntil: 'load' }); await page.evaluate(() => window.__akariWorldOverview.ready);
    const hostOriginal = await page.evaluate(() => window.__akariWorldOverview.stops()[0]);
    const hostPoint = await page.evaluate(id => { const p = window.__akariWorldOverview.screenOf(id), o = window.__akariWorldOverview.mapOrigin(); return { x: o.x + p.x, y: o.y + p.y }; }, hostOriginal.id);
    await page.keyboard.down('Alt'); await page.mouse.move(hostPoint.x, hostPoint.y); await page.mouse.down(); await page.mouse.move(hostPoint.x + 25, hostPoint.y + 15); await page.mouse.up(); await page.keyboard.up('Alt');
    const sent = await page.evaluate(() => ({ message: window.__hostMessages[0], pending: window.__akariWorldOverview.pending() }));
    assert.equal(sent.message.type, 'akari-world-move-stop'); assert.equal(sent.pending.stopId, hostOriginal.id);
    await page.evaluate(requestId => window.postMessage({ type: 'akari-world-move-failed', requestId, reason: 'rejected' }, '*'), sent.message.requestId);
    await page.waitForFunction(() => window.__akariWorldOverview.pending() === null);
    assert.deepEqual(await page.evaluate(id => window.__akariWorldOverview.stops().find(stop => stop.id === id).c, hostOriginal.id), hostOriginal.c, "ホスト拒否でも移動座標を戻す");

    await page.setViewport({ width: 380, height: 540, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'load' }); await page.evaluate(() => window.__akariWorldOverview.ready);
    const narrow = await page.evaluate(() => {
      const rect = selector => { const value = document.querySelector(selector).getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
      return {
        innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth,
        stage: rect('.stage'), map: rect('.map'), band: rect('.band'), aside: rect('aside'), scrub: rect('#scrub'),
        worlds: window.__akariWorldOverview.worldRects().length,
        drawError: window.__akariWorldOverview.lastDrawError(),
      };
    });
    assert.ok(narrow.scrollWidth <= narrow.innerWidth + 1, `scrollWidth ${narrow.scrollWidth} > ${narrow.innerWidth}`);
    for (const [name, rect] of Object.entries({ map: narrow.map, band: narrow.band, aside: narrow.aside, scrub: narrow.scrub })) {
      assert.ok(rect.x >= -1 && rect.x + rect.width <= narrow.innerWidth + 1, `${name} が横にはみ出しています: ${JSON.stringify(rect)}`);
    }
    for (const [name, rect] of Object.entries({ map: narrow.map, band: narrow.band })) {
      assert.ok(narrow.stage.x - 1 <= rect.x && rect.x + rect.width <= narrow.stage.x + narrow.stage.width + 1 && narrow.stage.y - 1 <= rect.y && rect.y + rect.height <= narrow.stage.y + narrow.stage.height + 1, `${name} が stage 外です: ${JSON.stringify(narrow)}`);
    }
    assert.ok(narrow.aside.y >= narrow.stage.y + narrow.stage.height - 1, `aside が stage に重なっています: ${JSON.stringify(narrow)}`);
    assert.equal(narrow.worlds, map.worlds.length); assert.equal(narrow.drawError, null);
  } finally { await browser.close(); }
});
