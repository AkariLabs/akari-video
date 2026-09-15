// Canvas 2D flat-world runtime. Time is supplied exclusively by render(container, seconds).
window.akari = window.akari || {};
window.akari.worldRuntime = (() => {
  const instances = new Map();
  const DECLARATION_SELECTOR = 'script[type="application/json"][data-akari-world-scene]';
  const DEFAULT_RENDER = { dotStep: 90, margin: 0.25, hazeAlpha: 0.92 };

  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const string = value => typeof value === "string" && value.length > 0;
  const fail = message => { throw new TypeError(`world-runtime: ${message}`); };
  const keys = (value, allowed, label) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} は未知のキーです`);
  };
  const tuple = (value, length, label) => {
    if (!Array.isArray(value) || value.length !== length || !value.every(finite)) fail(`${label} は数値 ${length} 個の配列である必要があります`);
  };
  const objectArray = (value, label) => {
    if (!Array.isArray(value) || !value.every(record)) fail(`${label} は object の配列である必要があります`);
  };

  function validateDescriptor(value) {
    if (!record(value)) fail("宣言は JSON object である必要があります");
    // frame / render are build-time additions and inventory is intentionally projected out, so top-level keys do not mirror the map schema.
    keys(value, ["schemaVersion", "kind", "frame", "worlds", "zones", "cameraStops", "edges", "retainedNodes", "render"], "宣言");
    if (value.schemaVersion !== 1) fail("schemaVersion は 1 である必要があります");
    if (value.kind !== "flat") throw new TypeError("world-runtime v0 は kind: flat のみ");
    if (!record(value.frame)) fail("frame は object である必要があります");
    keys(value.frame, ["width", "height"], "frame");
    if (!finite(value.frame.width) || value.frame.width <= 0 || !finite(value.frame.height) || value.frame.height <= 0) fail("frame.width / frame.height は正の数である必要があります");
    objectArray(value.worlds, "worlds"); objectArray(value.zones, "zones");
    objectArray(value.cameraStops, "cameraStops"); objectArray(value.edges, "edges");
    if (!Array.isArray(value.retainedNodes)) fail("retainedNodes は配列である必要があります");
    for (const [index, world] of value.worlds.entries()) {
      keys(world, ["id", "label", "palette", "flat", "spatial"], `worlds[${index}]`);
      if (!string(world.id) || !record(world.palette) || !record(world.flat)) fail(`worlds[${index}] の id / palette / flat が不正です`);
      if (world.spatial !== undefined && !record(world.spatial)) fail(`worlds[${index}].spatial は object である必要があります`);
      keys(world.palette, ["background", "dots", "accent", "haze"], `worlds[${index}].palette`);
      if (![world.palette.background, world.palette.dots, world.palette.accent].every(string) || (world.palette.haze !== undefined && !string(world.palette.haze))) fail(`worlds[${index}].palette の色が不正です`);
      keys(world.flat, ["bounds", "pattern", "far"], `worlds[${index}].flat`);
      tuple(world.flat.bounds, 4, `worlds[${index}].flat.bounds`);
      if (!["dots", "grid", "none"].includes(world.flat.pattern)) fail(`worlds[${index}].flat.pattern が不正です`);
      if (world.flat.far !== undefined) {
        objectArray(world.flat.far, `worlds[${index}].flat.far`);
        for (const [farIndex, far] of world.flat.far.entries()) {
          keys(far, ["z", "color"], `worlds[${index}].flat.far[${farIndex}]`);
          if (!finite(far.z) || !string(far.color)) fail(`worlds[${index}].flat.far[${farIndex}] が不正です`);
        }
      }
    }
    for (const [index, zone] of value.zones.entries()) {
      keys(zone, ["id", "label", "world", "c"], `zones[${index}]`);
      if (!string(zone.id) || !string(zone.world)) fail(`zones[${index}] の id / world が不正です`);
      tuple(zone.c, 2, `zones[${index}].c`);
    }
    for (const [index, stop] of value.cameraStops.entries()) {
      keys(stop, ["id", "label", "world", "at", "leave", "c", "eye", "target"], `cameraStops[${index}]`);
      if (!string(stop.id) || !string(stop.world) || !finite(stop.at) || !finite(stop.leave)) fail(`cameraStops[${index}] が不正です`);
      if (stop.label !== undefined && !string(stop.label)) fail(`cameraStops[${index}].label は文字列である必要があります`);
      tuple(stop.c, 3, `cameraStops[${index}].c`);
      if (stop.eye !== undefined) tuple(stop.eye, 3, `cameraStops[${index}].eye`);
      if (stop.target !== undefined) tuple(stop.target, 3, `cameraStops[${index}].target`);
    }
    for (const [index, edge] of value.edges.entries()) {
      keys(edge, ["id", "from", "to", "type", "t0", "t1", "switchTime", "transition", "via", "carry", "easing"], `edges[${index}]`);
      if (![edge.id, edge.from, edge.to, edge.type].every(string) || !finite(edge.t0) || !finite(edge.t1) || !record(edge.transition)) fail(`edges[${index}] が不正です`);
      keys(edge.transition, ["kind", "cover"], `edges[${index}].transition`);
      if (!string(edge.transition.kind) || !finite(edge.transition.cover)) fail(`edges[${index}].transition が不正です`);
      if (edge.switchTime !== undefined && !finite(edge.switchTime)) fail(`edges[${index}].switchTime は数値である必要があります`);
      if (edge.via !== undefined && !string(edge.via)) fail(`edges[${index}].via は文字列である必要があります`);
      if (edge.carry !== undefined && (!Array.isArray(edge.carry) || !edge.carry.every(string))) fail(`edges[${index}].carry は文字列の配列である必要があります`);
      if (edge.easing !== undefined && !string(edge.easing)) fail(`edges[${index}].easing は文字列である必要があります`);
    }
    if (value.render !== undefined) {
      if (!record(value.render)) fail("render は object である必要があります");
      keys(value.render, ["dotStep", "margin", "hazeAlpha"], "render");
      for (const name of ["dotStep", "margin", "hazeAlpha"]) if (value.render[name] !== undefined && !finite(value.render[name])) fail(`render.${name} は数値である必要があります`);
    }
    if (!value.worlds.length || !value.cameraStops.length) fail("worlds / cameraStops は空にできません");
    return value;
  }

  function readDescriptor(container) {
    const node = container.querySelector(DECLARATION_SELECTOR);
    if (!node) fail("data-akari-world-scene 宣言が見つかりません");
    let value;
    try { value = JSON.parse(node.textContent); }
    catch (error) { fail(`宣言 JSON を読めません: ${error.message}`); }
    return validateDescriptor(value);
  }

  function mount(container) {
    let descriptor;
    try { descriptor = readDescriptor(container); }
    catch (error) {
      instances.set(container, { status: "error", message: error.message });
      throw error;
    }
    if (typeof window.AkariWorldCamera?.createCamera !== "function") fail("AkariWorldCamera.createCamera が見つかりません");
    const canvas = document.createElement("canvas");
    canvas.className = "akari-world-canvas";
    canvas.width = descriptor.frame.width;
    canvas.height = descriptor.frame.height;
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: `${descriptor.frame.width}px`, height: `${descriptor.frame.height}px`, pointerEvents: "none" });
    container.insertBefore(canvas, container.firstChild);
    const instance = { status: "ready", descriptor, canvas, ctx: canvas.getContext("2d"), camera: window.AkariWorldCamera.createCamera(descriptor), current: null };
    instances.set(container, instance);
    return instance;
  }

  function drawPattern(ctx, world, render) {
    const [x, y, width, height] = world.flat.bounds;
    const step = render.dotStep;
    if (world.flat.pattern === "dots") {
      ctx.fillStyle = world.palette.dots;
      for (let py = Math.ceil(y / step) * step; py <= y + height; py += step) for (let px = Math.ceil(x / step) * step; px <= x + width; px += step) {
        ctx.beginPath(); ctx.arc(px, py, Math.max(1.5, step * 0.035), 0, Math.PI * 2); ctx.fill();
      }
    } else if (world.flat.pattern === "grid") {
      ctx.strokeStyle = world.palette.dots; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let px = Math.ceil(x / step) * step; px <= x + width; px += step) { ctx.moveTo(px, y); ctx.lineTo(px, y + height); }
      for (let py = Math.ceil(y / step) * step; py <= y + height; py += step) { ctx.moveTo(x, py); ctx.lineTo(x + width, py); }
      ctx.stroke();
    }
  }

  function drawWorlds(ctx, descriptor, view) {
    const render = { ...DEFAULT_RENDER, ...descriptor.render };
    const zoneById = new Map(descriptor.zones.map(zone => [zone.id, zone]));
    for (const world of descriptor.worlds) {
      const [x, y, width, height] = world.flat.bounds;
      for (const far of world.flat.far ?? []) {
        ctx.save();
        ctx.setTransform(view.scale, 0, 0, view.scale, view.ox - view.x * view.scale * far.z, view.oy - view.y * view.scale * far.z);
        ctx.fillStyle = far.color; ctx.fillRect(x, y, width, height); ctx.restore();
      }
      ctx.save();
      ctx.setTransform(view.scale, 0, 0, view.scale, view.ox - view.x * view.scale, view.oy - view.y * view.scale);
      ctx.fillStyle = world.palette.background; ctx.fillRect(x, y, width, height);
      drawPattern(ctx, world, render);
      ctx.strokeStyle = world.palette.accent; ctx.lineWidth = 4 / view.scale;
      for (const edge of descriptor.edges) {
        if (edge.type !== "portal" || !edge.via) continue;
        const zone = zoneById.get(edge.via);
        if (!zone || zone.world !== world.id) continue;
        ctx.strokeRect(zone.c[0] - 18, zone.c[1] - 28, 36, 56);
      }
      ctx.restore();
    }
  }

  function coveringEdge(descriptor, seconds) {
    return descriptor.edges.find(edge => (edge.type === "cut" || edge.type === "portal") && finite(edge.switchTime) && edge.transition.cover > 0 && Math.abs(seconds - edge.switchTime) <= edge.transition.cover / 2);
  }

  function drawScene(ctx, descriptor, view, seconds) {
    const width = ctx.canvas?.width ?? descriptor.frame.width;
    const height = ctx.canvas?.height ?? descriptor.frame.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    drawWorlds(ctx, descriptor, view);
    if (coveringEdge(descriptor, seconds)) {
      const world = descriptor.worlds.find(item => item.id === view.world) ?? descriptor.worlds[0];
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height); ctx.globalAlpha = { ...DEFAULT_RENDER, ...descriptor.render }.hazeAlpha;
      ctx.fillStyle = world.palette.haze ?? world.palette.background; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1;
    }
  }

  function syncSheets(container, instance, camera) {
    const { width, height } = instance.descriptor.frame;
    const margin = { ...DEFAULT_RENDER, ...instance.descriptor.render }.margin;
    const zones = new Map(instance.descriptor.zones.map(zone => [zone.id, zone]));
    for (const sheet of container.querySelectorAll(".akari-world-sheet[data-world]")) {
      sheet.style.transform = `translate(${width / 2 - camera.x * camera.scale}px, ${height / 2 - camera.y * camera.scale}px) scale(${camera.scale})`;
      sheet.style.transformOrigin = "0 0";
      for (const node of sheet.querySelectorAll(".akari-world-zone[data-zone]")) {
        const zone = zones.get(node.dataset.zone);
        if (!zone) { node.style.display = "none"; continue; }
        const sx = width / 2 + (zone.c[0] - camera.x) * camera.scale;
        const sy = height / 2 + (zone.c[1] - camera.y) * camera.scale;
        node.style.display = sx < -width * margin || sx > width * (1 + margin) || sy < -height * margin || sy > height * (1 + margin) ? "none" : "";
      }
    }
  }

  function render(container, seconds) {
    const instance = instances.get(container) ?? mount(container);
    if (instance.status === "error") throw new TypeError(instance.message);
    const camera = instance.camera(seconds);
    instance.current = camera;
    drawScene(instance.ctx, instance.descriptor, { ...camera, ox: instance.descriptor.frame.width / 2, oy: instance.descriptor.frame.height / 2 }, seconds);
    syncSheets(container, instance, camera);
  }

  function drawOverview(ctx, descriptorValue, view, seconds, options = {}) {
    const descriptor = validateDescriptor(descriptorValue);
    if (!record(view) || !finite(view.scale) || !finite(view.ox) || !finite(view.oy)) fail("overview view が不正です");
    const camera = window.AkariWorldCamera.createCamera(descriptor)(seconds);
    const anchored = { ...camera, scale: view.scale, ox: view.ox + camera.x * view.scale, oy: view.oy + camera.y * view.scale };
    drawScene(ctx, descriptor, anchored, seconds);
    if (options.frame === true) {
      const width = descriptor.frame.width / camera.scale;
      const height = descriptor.frame.height / camera.scale;
      ctx.save(); ctx.setTransform(view.scale, 0, 0, view.scale, anchored.ox - camera.x * view.scale, anchored.oy - camera.y * view.scale);
      ctx.strokeStyle = "#EE82DF"; ctx.lineWidth = 3 / view.scale; ctx.strokeRect(camera.x - width / 2, camera.y - height / 2, width, height); ctx.restore();
    }
  }

  function inspect(container) {
    const instance = instances.get(container);
    if (!instance) return { status: "error", world: null, x: null, y: null, scale: null, phase: null, message: "未初期化です" };
    if (instance.status === "error") return { status: "error", world: null, x: null, y: null, scale: null, phase: null, message: instance.message };
    const value = instance.current ?? instance.camera(0);
    return { status: "ready", world: value.world, x: value.x, y: value.y, scale: value.scale, phase: value.phase };
  }

  function dispose(container) {
    const instance = instances.get(container);
    instance?.canvas?.remove();
    instances.delete(container);
  }

  return { drawOverview, dispose, inspect, readDescriptor, render };
})();

// Register with current hosts, or queue until a script-only host boots its registry.
(() => {
  const entry = { id: "world", selector: 'script[type="application/json"][data-akari-world-scene]',
    ...window.akari.worldRuntime };
  if (window.akari.runtimes) window.akari.runtimes.register(entry);
  else (window.akari.pendingRuntimes ??= []).push(entry);
})();
