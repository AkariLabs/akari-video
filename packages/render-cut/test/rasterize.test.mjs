import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

import { renderOverlaySheet } from "../src/rasterize.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("non-3D overlay sheets remain byte-identical", () => {
  const sheet = renderOverlaySheet({
    overlays: [
      {
        id: "plain",
        start: 0.25,
        duration: 1.5,
        html: "<div>plain</div>\n",
        transform: { x: 2, y: -3, scale: 1.2, rotate: 4 },
        vars: { "--tone": "red" },
      },
    ],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 2,
  });

  assert.equal(sheet.length, 8960);
  assert.equal(
    createHash("sha256").update(sheet).digest("hex"),
    "c13acd01d098bc14bb0a750237040dec6294c209f9135ef5f0b9405f00c3f2c9",
  );
  assert.doesNotMatch(sheet, /threeRuntime|AkariThree|data:model\/gltf-binary/);
});

test("overlay sheet holds container animations to the HyperFrames transport clock", () => {
  const sheet = renderOverlaySheet({
    overlays: [
      {
        id: "cap",
        start: 0.5,
        duration: 3,
        html: "<div>cap</div>\n",
        transform: {},
        vars: {},
      },
    ],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 4,
  });
  const script = sheet.match(/<script>\n([\s\S]*?)\n  <\/script>/u)?.[1];
  assert.ok(script);

  const animation = {
    currentTime: null,
    pauseCalls: 0,
    pause() {
      this.pauseCalls += 1;
    },
  };
  const container = {
    dataset: { start: "0.5", duration: "3" },
    getAnimations() {
      return [animation];
    },
  };
  const never = new Promise(() => {});
  const document = {
    fonts: { ready: never },
    images: [],
    querySelectorAll(selector) {
      if (selector === ".akari-overlay-container") return [container];
      return [];
    },
  };
  const scheduled = [];
  const window = {
    __player: { getTime: () => 0.55 },
    requestAnimationFrame(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
  };
  vm.runInNewContext(script, {
    document,
    window,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  assert.equal(scheduled.length, 1, "the hold loop must schedule itself at parse time");
  scheduled[0]();
  assert.ok(Math.abs(animation.currentTime - 550) < 1e-6, "sync must write composition time");
  assert.ok(animation.pauseCalls >= 1);
  assert.equal(scheduled.length, 2, "the hold loop must keep running while the player exists");

  window.__player.getTime = () => 2;
  scheduled[1]();
  assert.equal(animation.currentTime, 2000);

  window.__player.getTime = () => 0;
  scheduled[2]();
  assert.equal(animation.currentTime, 0);
});

test("transport hold loop keeps polling until the HyperFrames player appears", () => {
  const sheet = renderOverlaySheet({
    overlays: [
      {
        id: "cap",
        start: 0.5,
        duration: 3,
        html: "<div>cap</div>\n",
        transform: {},
        vars: {},
      },
    ],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 4,
  });
  const script = sheet.match(/<script>\n([\s\S]*?)\n  <\/script>/u)?.[1];
  assert.ok(script);

  const animation = {
    currentTime: null,
    pause() {},
  };
  const container = {
    dataset: { start: "0.5", duration: "3" },
    getAnimations() {
      return [animation];
    },
  };
  const never = new Promise(() => {});
  const document = {
    fonts: { ready: never },
    images: [],
    querySelectorAll(selector) {
      if (selector === ".akari-overlay-container") return [container];
      return [];
    },
  };
  const queue = [];
  const window = {
    requestAnimationFrame(callback) {
      queue.push(callback);
      return queue.length;
    },
  };
  vm.runInNewContext(script, {
    document,
    window,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  // Setup can burn an unbounded number of ticks before the player appears; the loop
  // must survive all of them (a finite tick budget died in production, issue #3).
  for (let tick = 0; tick < 1000; tick += 1) {
    assert.ok(queue.length > 0, "the hold loop must keep rescheduling without a player");
    queue.shift()();
  }
  assert.equal(animation.currentTime, null, "no player means no sync writes");

  window.__player = { getTime: () => 1.25 };
  queue.shift()();
  assert.ok(Math.abs(animation.currentTime - 1250) < 1e-6, "sync must start once the player appears");
});

test("__akariSeek waits for requestVideoFrameCallback before resolving", async () => {
  const sheet = renderOverlaySheet({
    overlays: [],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 1,
  });
  const script = sheet.match(/<script>\n([\s\S]*?)\n  <\/script>/u)?.[1];
  assert.ok(script);

  const events = [];
  const listeners = new Map();
  const video = {
    seeking: false,
    currentTime: 0,
    pause() {
      events.push("pause");
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    requestVideoFrameCallback(callback) {
      events.push("frame-requested");
      setTimeout(() => {
        events.push("frame-presented");
        callback();
      }, 10);
      return 1;
    },
    cancelVideoFrameCallback() {},
  };
  Object.defineProperty(video, "currentTime", {
    get() {
      return this._currentTime ?? 0;
    },
    set(value) {
      this._currentTime = value;
      this.seeking = true;
      events.push("currentTime-set");
      setTimeout(() => {
        this.seeking = false;
        events.push("seeked");
        listeners.get("seeked")?.();
      }, 5);
    },
  });
  const never = new Promise(() => {});
  const document = {
    fonts: { ready: never },
    images: [],
    querySelectorAll(selector) {
      if (selector === "video") return [video];
      return [];
    },
  };
  const window = {
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    },
    cancelAnimationFrame: clearTimeout,
  };
  vm.runInNewContext(script, {
    document,
    window,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  let resolved = false;
  const seek = window.__akariSeek(0.5).then((result) => {
    resolved = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 7));
  assert.equal(resolved, false, "seek must remain pending until the decoded frame is presented");
  assert.deepEqual(events.slice(0, 4), [
    "pause",
    "currentTime-set",
    "frame-requested",
    "seeked",
  ]);
  assert.deepEqual(Array.from((await seek).warnings), []);
  assert.equal(events.at(-1), "frame-presented");
});

test("__akariSeek registers the video frame callback after changing currentTime", async () => {
  const sheet = renderOverlaySheet({
    overlays: [],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 1,
  });
  const script = sheet.match(/<script>\n([\s\S]*?)\n  <\/script>/u)?.[1];
  assert.ok(script);

  const events = [];
  const video = {
    seeking: false,
    readyState: 4,
    currentTime: 0,
    pause() {},
    addEventListener() {},
    removeEventListener() {},
    requestVideoFrameCallback(callback) {
      events.push("frame-requested");
      setTimeout(() => {
        events.push("frame-presented");
        callback();
      }, 2);
      return 1;
    },
    cancelVideoFrameCallback() {},
  };
  Object.defineProperty(video, "currentTime", {
    get() {
      return this._currentTime ?? 0;
    },
    set(value) {
      this._currentTime = value;
      this.seeking = true;
      events.push("currentTime-set");
      setTimeout(() => {
        this.seeking = false;
        events.push("seeked");
      }, 5);
    },
  });
  const never = new Promise(() => {});
  const document = {
    fonts: { ready: never },
    images: [],
    querySelectorAll(selector) {
      if (selector === "video") return [video];
      return [];
    },
  };
  const window = {
    requestAnimationFrame(callback) {
      return setTimeout(callback, 0);
    },
    cancelAnimationFrame: clearTimeout,
  };
  vm.runInNewContext(script, {
    document,
    window,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  assert.deepEqual(Array.from((await window.__akariSeek(0.5)).warnings), []);
  assert.deepEqual(events.slice(0, 3), [
    "currentTime-set",
    "frame-requested",
    "frame-presented",
  ]);
});

test("__akariSeek falls back to two animation frames after seeked when video frame callbacks are unavailable", async () => {
  const sheet = renderOverlaySheet({
    overlays: [],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 1,
  });
  const script = sheet.match(/<script>\n([\s\S]*?)\n  <\/script>/u)?.[1];
  assert.ok(script);

  const events = [];
  const listeners = new Map();
  const video = {
    seeking: false,
    readyState: 4,
    currentTime: 0,
    pause() {},
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };
  Object.defineProperty(video, "currentTime", {
    get() {
      return this._currentTime ?? 0;
    },
    set(value) {
      this._currentTime = value;
      this.seeking = true;
      setTimeout(() => {
        this.seeking = false;
        events.push("seeked");
        listeners.get("seeked")?.();
      }, 0);
    },
  });
  const never = new Promise(() => {});
  const document = {
    fonts: { ready: never },
    images: [],
    querySelectorAll(selector) {
      if (selector === "video") return [video];
      return [];
    },
  };
  const window = {
    requestAnimationFrame(callback) {
      const id = setTimeout(() => {
        events.push("animation-frame");
        callback();
      }, 0);
      return id;
    },
    cancelAnimationFrame: clearTimeout,
  };
  vm.runInNewContext(script, {
    document,
    window,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  assert.deepEqual(Array.from((await window.__akariSeek(0.5)).warnings), []);
  assert.deepEqual(events, ["seeked", "animation-frame", "animation-frame"]);
});

test("__akariSeek returns immediately for an already-decoded target frame", async () => {
  const sheet = renderOverlaySheet({
    overlays: [],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 1,
  });
  const script = sheet.match(/<script>\n([\s\S]*?)\n  <\/script>/u)?.[1];
  assert.ok(script);

  const events = [];
  const video = {
    seeking: false,
    readyState: 4,
    currentTime: 0.5,
    pause() {
      events.push("pause");
    },
    addEventListener() {
      events.push("listener-added");
    },
    requestVideoFrameCallback() {
      events.push("frame-requested");
    },
  };
  const never = new Promise(() => {});
  const document = {
    fonts: { ready: never },
    images: [],
    querySelectorAll(selector) {
      if (selector === "video") return [video];
      return [];
    },
  };
  const window = {};
  vm.runInNewContext(script, {
    document,
    window,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  });

  assert.deepEqual(Array.from((await window.__akariSeek(0.5)).warnings), []);
  assert.deepEqual(events, ["pause"]);
});

test("overlay sheet orders tracks back-to-front while preserving order within a track", () => {
  const overlay = (id, track) => ({
    id,
    track,
    start: 0,
    duration: 1,
    html: `<div>${id}</div>`,
    transform: {},
    vars: {},
  });
  const sheet = renderOverlaySheet({
    overlays: [overlay("front-a", 2), overlay("back", 0), overlay("front-b", 2), overlay("middle", 1)],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/unused",
    duration: 1,
  });
  const positions = ["back", "middle", "front-a", "front-b"].map(
    (id) => sheet.indexOf(`data-overlay-id="${id}"`),
  );
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("3D overlay sheets inline the shared runtime and embed GLB data", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-3d-日本語 path-"));
  try {
    const modelBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x01, 0x02, 0x03]);
    const textureBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(join(projectRoot, "model.glb"), modelBytes);
    await writeFile(join(projectRoot, "screen.png"), textureBytes);
    const sheet = renderOverlaySheet({
      overlays: [
        {
          id: "model",
          start: 1.25,
          duration: 2,
          html: `<div class="model"><canvas></canvas><div data-akari-3d-fallback>fallback</div><script data-akari-3d-scene type="application/json">{
            "model": "model.glb",
            "materialOverrides": {
              "ScreenMaterial": { "texture": "screen.png" }
            },
            "camera": { "position": [0, 0, 3] }
          }</script></div>`,
          transform: {},
          vars: {},
        },
      ],
      edit: { output: { width: 320, height: 180, fps: 30 } },
      projectRoot,
      duration: 4,
    });

    const bundleSource = await readFile(
      join(packageRoot, "..", "overlay-runtime", "src", "vendor", "three-bundle.js"),
      "utf8",
    );
    const runtimeSource = await readFile(
      join(packageRoot, "..", "overlay-runtime", "src", "three-runtime.js"),
      "utf8",
    );
    assert.ok(sheet.includes(bundleSource));
    assert.ok(sheet.includes(runtimeSource));
    assert.doesNotMatch(sheet, /"model"\s*:\s*"model\.glb"/);

    const declaration = sheet.match(
      /<script data-akari-3d-scene type="application\/json">([\s\S]*?)<\/script>/u,
    );
    assert.ok(declaration);
    const descriptor = JSON.parse(declaration[1]);
    assert.equal(
      descriptor.model,
      `data:model/gltf-binary;base64,${modelBytes.toString("base64")}`,
    );
    assert.deepEqual(descriptor.materialOverrides, {
      ScreenMaterial: {
        texture: `data:image/png;base64,${textureBytes.toString("base64")}`,
      },
    });
    assert.match(sheet, /querySelector\(':scope > \.scene-content'\)/);
    assert.match(
      sheet,
      /pendingThreeDraws\.push\(\[threeContainer, seconds - start\]\)/,
    );
    assert.match(sheet, /threeRuntime\.render\(container, 0\)/);
    assert.match(sheet, /threeRuntime\.inspect\(container\)\.status/);
    assert.match(sheet, /Promise\.all\(threeContainers\.map\(waitForThreeContainer\)\)/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("3D overlays are drawn after the video seek, not before it", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-3d-order-"));
  try {
    await writeFile(join(projectRoot, "model.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46]));
    const sheet = renderOverlaySheet({
      overlays: [
        {
          id: "model",
          start: 0,
          duration: 2,
          html: `<div class="model"><canvas></canvas><script data-akari-3d-scene type="application/json">{
            "model": "model.glb"
          }</script></div>`,
          transform: {},
          vars: {},
        },
      ],
      edit: { output: { width: 320, height: 180, fps: 30 } },
      projectRoot,
      duration: 2,
    });

    // 3D を先に描くと <video> がまだ前フレームの絵のままテクスチャへ上がる。
    // 収集 → 動画シークの await → 描画、の順序が崩れていないことを位置で確かめる
    const collected = sheet.indexOf("pendingThreeDraws.push(");
    const awaited = sheet.indexOf("Array.from(document.querySelectorAll('video'), waitForVideo)");
    const drawn = sheet.indexOf("window.akari.threeRuntime.render(threeContainer, localSeconds)");
    assert.ok(collected > 0 && awaited > 0 && drawn > 0);
    assert.ok(collected < awaited, "3D の収集は動画シークより前であること");
    assert.ok(awaited < drawn, "3D の描画は動画シークの完了より後であること");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("3D overlays embed video textures and an equirectangular environment map", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-3d-video-"));
  try {
    const modelBytes = Buffer.from([0x67, 0x6c, 0x54, 0x46]);
    const videoBytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const environmentBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(projectRoot, "model.glb"), modelBytes);
    await writeFile(join(projectRoot, "screen.mp4"), videoBytes);
    await writeFile(join(projectRoot, "studio.png"), environmentBytes);
    const sheet = renderOverlaySheet({
      overlays: [
        {
          id: "model",
          start: 0,
          duration: 2,
          html: `<div class="model"><canvas></canvas><script data-akari-3d-scene type="application/json">{
            "model": "model.glb",
            "environment": { "intensity": 2.8, "map": "studio.png" },
            "shadows": true,
            "animationClip": "*",
            "materialOverrides": {
              "ScreenMaterial": { "texture": "screen.mp4" }
            }
          }</script></div>`,
          transform: {},
          vars: {},
        },
      ],
      edit: { output: { width: 320, height: 180, fps: 30 } },
      projectRoot,
      duration: 2,
    });

    const declaration = sheet.match(
      /<script data-akari-3d-scene type="application\/json">([\s\S]*?)<\/script>/u,
    );
    assert.ok(declaration);
    const descriptor = JSON.parse(declaration[1]);
    assert.equal(
      descriptor.materialOverrides.ScreenMaterial.texture,
      `data:video/mp4;base64,${videoBytes.toString("base64")}`,
    );
    assert.deepEqual(descriptor.environment, {
      intensity: 2.8,
      map: `data:image/png;base64,${environmentBytes.toString("base64")}`,
    });
    assert.equal(descriptor.shadows, true);
    assert.equal(descriptor.animationClip, "*");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("environment.map rejects absolute paths and non-image sources", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-3d-envmap-"));
  try {
    await writeFile(join(projectRoot, "model.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46]));
    await writeFile(join(projectRoot, "studio.mp4"), Buffer.from([0x00]));
    const sheetWith = (environment) => () =>
      renderOverlaySheet({
        overlays: [
          {
            id: "model",
            start: 0,
            duration: 2,
            html: `<div class="model"><canvas></canvas><script data-akari-3d-scene type="application/json">{
              "model": "model.glb",
              "environment": ${JSON.stringify(environment)}
            }</script></div>`,
            transform: {},
            vars: {},
          },
        ],
        edit: { output: { width: 320, height: 180, fps: 30 } },
        projectRoot,
        duration: 2,
      });

    assert.throws(sheetWith({ map: "/etc/passwd.png" }), /must be a relative path/u);
    assert.throws(sheetWith({ map: "https://example.com/studio.png" }), /must be a relative path/u);
    // 正距円筒は画像。動画を差されたら黙って通さない
    assert.throws(sheetWith({ map: "studio.mp4" }), /must be an equirectangular image/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("looping videos wrap the seek time instead of freezing on the last frame", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-cut-loop-"));
  try {
    await writeFile(join(projectRoot, "model.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46]));
    const sheet = renderOverlaySheet({
      overlays: [
        {
          id: "model",
          start: 0,
          duration: 2,
          html: `<div class="model"><canvas></canvas><script data-akari-3d-scene type="application/json">{
            "model": "model.glb"
          }</script></div>`,
          transform: {},
          vars: {},
        },
      ],
      edit: { output: { width: 320, height: 180, fps: 30 } },
      projectRoot,
      duration: 2,
    });

    assert.match(sheet, /video\.loop && Number\.isFinite\(video\.duration\) && video\.duration > 0/);
    assert.match(sheet, /\? seconds % video\.duration/);
    assert.match(sheet, /video\.currentTime = target;/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
