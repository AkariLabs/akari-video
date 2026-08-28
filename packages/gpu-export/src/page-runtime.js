(function () {
  "use strict";

  const pageConfig = window.__AKARI_GPU_CONFIG__;
  const FE = window.AkariFrameEngine;
  const bridge = window.akariGpu;
  const warnings = [];
  const pools = new Map();
  const lookahead = new Map();
  const images = new Map();

  const macrotaskResolvers = [];
  const macrotaskChannel = new MessageChannel();
  macrotaskChannel.port1.onmessage = () => macrotaskResolvers.shift()?.();

  function yieldMacrotask() {
    return new Promise((resolve) => {
      macrotaskResolvers.push(resolve);
      macrotaskChannel.port2.postMessage(0);
    });
  }

  async function waitForEncoderQueueBelow(encoder, limit) {
    if (typeof encoder.waitForQueueBelow === "function") {
      await encoder.waitForQueueBelow(limit);
      return;
    }
    while (encoder.encodeQueueSize > limit) await yieldMacrotask();
  }

  function warn(message) {
    warnings.push(String(message));
    console.warn("[akari-gpu]", message);
  }

  function mediaUrl(value) {
    return "/media/" + String(value).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  }

  function normalizedCuts(edit) {
    return (Array.isArray(edit.cuts) ? edit.cuts : []).map((cut, index) => {
      const copy = Object.assign({}, cut);
      delete copy.at;
      delete copy.track;
      copy.src = cut.src || (Array.isArray(edit.sources) ? edit.sources[0] && edit.sources[0].id : "default") || "default";
      copy.in = Number(cut.in || 0);
      copy.out = Number(cut.out ?? cut.in ?? 0);
      copy.transition_out = cut.transition_out || cut.transitionOut;
      copy.id = cut.id || "cut-" + index;
      return copy;
    });
  }

  function isImage(value) {
    return /\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/i.test(value);
  }

  class GpuFrameEngineRuntime {
    constructor(config) {
      this.canvas = document.getElementById("akari-engine");
      this.compositor = new FE.WebGL2Compositor(this.canvas, { synchronization: "flush", uploadPath: "direct" });
      this.metrics = new FE.FrameMetrics();
      const urls = new Map();
      if (Array.isArray(config.edit.sources)) {
        for (const source of config.edit.sources) {
          if (source && source.id && (source.proxy || source.path)) urls.set(String(source.id), mediaUrl(source.proxy || source.path));
        }
      } else if (config.edit.source && config.edit.source.path) {
        urls.set("default", mediaUrl(config.edit.source.path));
      }
      for (const layer of Array.isArray(config.edit.layers) ? config.edit.layers : []) {
        if (!layer || !layer.src) continue;
        if (!urls.has(String(layer.src))) urls.set(String(layer.src), mediaUrl(layer.src));
        if (layer.mask && !urls.has(String(layer.mask))) urls.set(String(layer.mask), mediaUrl(layer.mask));
      }
      const videoSources = new Map();
      for (const [id, url] of urls) {
        if (isImage(url)) {
          const image = new FE.CachedStillImageSource(url);
          images.set(id, image);
        } else {
          const pool = new FE.ClipSessionPool(id, url, { onWarning: warn });
          const source = new FE.LookaheadFrameSource(pool, { fps: config.fps, capacity: 12 });
          pools.set(id, pool);
          lookahead.set(id, source);
          videoSources.set(id, source);
        }
      }
      this.sources = new Map([...videoSources, ...images]);
      this.timeline = FE.buildResolvedTimelinePlan(normalizedCuts(config.edit), {
        fps: config.fps,
        layers: Array.isArray(config.edit.layers) ? config.edit.layers : [],
        onWarning: warn,
      });
      const look = config.look && typeof config.look.cubeText === "string"
        ? { lut: FE.parseCube(config.look.cubeText), intensity: Math.max(0, Math.min(1, Number(config.look.intensity ?? 1))) }
        : null;
      this.output = { width: config.width, height: config.height, colorSpace: "bt709-limited", look };
    }

    async frameAt(seconds) {
      const clamped = Math.max(0, Math.min(Number(seconds) || 0, this.timeline.totalDuration));
      const plan = FE.evaluationPlanFromResolvedTimeline(this.timeline, Math.round(clamped * 1e6), this.sources, this.output);
      if (plan.base.length === 0 && plan.layers.length === 0) throw new Error(`frame-engine produced an empty plan at ${seconds}s`);
      return FE.evaluateFrame(plan, { compositor: this.compositor, metrics: this.metrics });
    }

    dispose() {
      for (const source of lookahead.values()) source.clear();
      for (const source of images.values()) source.destroy();
      for (const pool of pools.values()) pool.destroy();
      this.compositor.dispose();
    }
  }

  function serializeHtmlToXhtml(html) {
    const documentValue = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    return new XMLSerializer().serializeToString(documentValue.body)
      .replace(/^<body[^>]*>/u, "")
      .replace(/<\/body>$/u, "");
  }

  function varsCss(vars) {
    return Object.entries(vars || {})
      .filter(([name]) => /^--[a-z0-9_-]+$/i.test(name))
      .map(([name, value]) => `${name}:${String(value).replace(/[;{}]/g, "")}`)
      .join(";");
  }

  function foreignObjectSvg(html, width, height, extraCss, vars) {
    const xhtml = serializeHtmlToXhtml(html);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" class="akari-sprite-root" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;background:transparent;container-type:size;${varsCss(vars)}">
          <style>html,body{margin:0;width:100%;height:100%;overflow:hidden}${extraCss}</style>${xhtml}
        </div>
      </foreignObject>
    </svg>`;
  }

  async function rasterizeSprite(value, config) {
    const settled = value.motion?.in?.duration_sec ?? value.motion?.in?.durationSec ?? 0.18;
    const css = `.akari-sprite-root,.akari-sprite-root *{animation-play-state:paused!important;animation-delay:-${Math.max(0, Number(settled) || 0)}s!important}`;
    const svg = foreignObjectSvg(value.html, config.width, config.height, css, value.vars);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const parserError = parsed.querySelector("parsererror");
    if (parserError) throw new Error(`sprite ${value.id} SVG parsererror: ${parserError.textContent}`);
    const image = new Image();
    image.decoding = "sync";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`sprite ${value.id} image load failed`));
    });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await loaded;
    if (image.naturalWidth === 0 || image.naturalHeight === 0) throw new Error(`sprite ${value.id} decoded empty`);
    const canvas = document.createElement("canvas");
    canvas.width = config.width;
    canvas.height = config.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("sprite 2D canvas is unavailable");
    context.clearRect(0, 0, config.width, config.height);
    context.drawImage(image, 0, 0, config.width, config.height);
    return canvas;
  }

  async function embeddedCaptionFont() {
    const response = await fetch("/caption-font.ttf");
    if (!response.ok) throw new Error(`caption font fetch failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return `data:font/ttf;base64,${btoa(binary)}`;
  }

  function installReadbackTraps(counters) {
    const patches = [];
    const replace = (target, name, label) => {
      if (!target || typeof target[name] !== "function") return;
      const original = target[name];
      target[name] = function () {
        counters[label] = (counters[label] || 0) + 1;
        throw new Error(`${label} is forbidden in GPU-direct export`);
      };
      patches.push(() => { target[name] = original; });
    };
    replace(window.WebGL2RenderingContext?.prototype, ["read", "Pixels"].join(""), "webglReadbackCalls");
    replace(window.VideoFrame?.prototype, ["copy", "To"].join(""), "videoFrameCopyCalls");
    replace(window.HTMLCanvasElement?.prototype, ["to", "Blob"].join(""), "canvasBlobCalls");
    replace(window.HTMLCanvasElement?.prototype, ["to", "DataURL"].join(""), "canvasDataUrlCalls");
    replace(window.CanvasRenderingContext2D?.prototype, ["get", "ImageData"].join(""), "canvasPixelReadCalls");
    replace(window, ["create", "ImageBitmap"].join(""), "bitmapCreationCalls");
    return () => { for (const restore of patches.reverse()) restore(); };
  }

  function activeAt(entry, seconds) {
    return seconds >= entry.start && seconds < entry.start + entry.duration;
  }

  async function waitForThreeReady(threeRuntime, container, id) {
    while (true) {
      const inspected = threeRuntime.inspect(container);
      if (inspected?.status === "ready") return;
      if (inspected?.status === "error") {
        throw new Error(`3D overlay ${id} failed to initialize: threeRuntime status=error`);
      }
      if (inspected?.status !== "loading") {
        throw new Error(`3D overlay ${id} failed to initialize: unexpected threeRuntime status=${inspected?.status ?? "missing"}`);
      }
      await yieldMacrotask();
    }
  }

  function summarize(values) {
    if (values.length === 0) return { count: 0, p50: null, p95: null };
    const sorted = [...values].sort((left, right) => left - right);
    return { count: values.length, p50: sorted[Math.floor((sorted.length - 1) * 0.5)], p95: sorted[Math.floor((sorted.length - 1) * 0.95)] };
  }

  function sentinelColor(frameNumber) {
    const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
    return [
      16 + mod(frameNumber, 224),
      16 + mod(frameNumber * 5 + 37, 224),
      16 + mod(frameNumber * 11 + 73, 224),
    ];
  }

  function parseRgb(value) {
    const match = String(value).match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function sameRgb(left, right) {
    return Array.isArray(left) && left.length === 3 && left.every((value, index) => value === right[index]);
  }

  function chooseSettlePolicy(host) {
    return typeof host?.requestPaint === "function" ? "raf2-paint-event" : "sync-layout";
  }

  function runActiveAt(run, seconds) {
    return run.entries.some((value) => activeAt(value, seconds));
  }

  function orderedSpriteDraws(manifest, seconds, domRuntime) {
    const values = [];
    for (const value of manifest.statics) {
      if (activeAt(value, seconds)) values.push({ index: value.index, id: value.id, opacity: 1 });
    }
    for (const value of manifest.three) {
      if (activeAt(value, seconds)) values.push({ index: value.index, id: value.id, opacity: 1 });
    }
    for (const run of manifest.dom ?? []) {
      if (domRuntime.activeAt(run, seconds)) values.push({ index: run.index, id: run.runId, opacity: 1 });
    }
    return values.sort((left, right) => left.index - right.index)
      .map(({ id, opacity }) => ({ id, opacity }));
  }

  function styleVariables(element, vars) {
    for (const [name, value] of Object.entries(vars ?? {})) {
      if (/^--[a-z0-9_-]+$/i.test(name)) element.style.setProperty(name, String(value).replace(/[;{}]/g, ""));
    }
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  class DomLayerRuntime {
    constructor(config, runs, spriteCompositor, verifier = null) {
      this.config = config;
      this.runs = runs ?? [];
      this.spriteCompositor = spriteCompositor;
      this.verifier = verifier;
      this.records = new Map();
      this.settlePolicy = null;
      this.api = { drawElementImage: null, devicePixelRatio: window.devicePixelRatio };
      this.metrics = { timeFixMs: [], waitMs: [], drawElementMs: [], uploadMs: [], domLayerCostMs: [], frameCostMs: [] };
      this.sentinel = {
        checked: Boolean(config.verifyFrames && this.runs.length > 0),
        mode: config.verifyFrames && this.runs.length > 0 ? "css-mod" : "disabled",
        tolerance: 8,
        requested: 0,
        matched: 0,
        mismatchCount: 0,
        mismatches: [],
      };
    }

    async mount() {
      if (this.runs.length === 0) return;
      if (window.devicePixelRatio !== 1) {
        throw new Error(`GPU DOM layer requires devicePixelRatio 1, got ${window.devicePixelRatio}`);
      }
      const stage = document.getElementById("akari-dom-stage");
      if (!stage) throw new Error("GPU DOM layer stage is missing");
      if (this.runs.some((run) => run.entries.some((entry) => entry.html.includes("/caption-font.ttf")))) {
        const fontStyle = document.createElement("style");
        fontStyle.textContent = "@font-face{font-family:'Noto Sans JP';src:url('/caption-font.ttf') format('truetype');font-display:block}";
        stage.appendChild(fontStyle);
      }
      for (const run of this.runs) {
        const host = document.createElement("canvas");
        host.className = "akari-dom-host";
        host.setAttribute("layoutsubtree", "");
        host.width = this.config.width;
        host.height = this.config.height;
        stage.appendChild(host);
        const context = host.getContext("2d", { alpha: true });
        const overlayIds = run.entries.map((entry) => entry.id).join(", ");
        if (!context || typeof context.drawElementImage !== "function") {
          this.api.drawElementImage = false;
          throw new Error(`GPU DOM layer requires CanvasRenderingContext2D.drawElementImage (--enable-features=CanvasDrawElement); overlays: ${overlayIds}`);
        }
        this.api.drawElementImage = true;
        const root = document.createElement("div");
        root.className = "akari-dom-root";
        host.appendChild(root);
        const tick = document.createElement("div");
        tick.setAttribute("aria-hidden", "true");
        host.appendChild(tick);
        let sentinel = null;
        if (this.config.verifyFrames) {
          sentinel = document.createElement("div");
          sentinel.className = "akari-dom-sentinel";
          sentinel.setAttribute("aria-hidden", "true");
          sentinel.style.background = "rgb(calc(16 + mod(var(--frame), 224)) calc(16 + mod(var(--frame) * 5 + 37, 224)) calc(16 + mod(var(--frame) * 11 + 73, 224)))";
          root.prepend(sentinel);
        }
        const containers = [];
        for (const entry of run.entries) {
          const container = document.createElement("div");
          container.className = "akari-dom-container scene clip";
          container.dataset.overlayId = entry.id;
          container.dataset.start = String(entry.start);
          container.dataset.duration = String(entry.duration);
          if (entry.params && typeof entry.params === "object") container.dataset.akariParams = JSON.stringify(entry.params);
          styleVariables(container, entry.vars);
          const content = document.createElement("div");
          content.className = "scene-content";
          content.insertAdjacentHTML("beforeend", entry.html);
          container.appendChild(content);
          root.appendChild(container);
          containers.push({ entry, container });
        }
        this.records.set(run.runId, { host, context, root, tick, sentinel, containers });
        this.spriteCompositor.registerSprite(run.runId, host);
        if (this.settlePolicy === null) this.settlePolicy = chooseSettlePolicy(host);
      }
      await document.fonts.ready;
      if (this.config.verifyFrames) this.verifySentinelCss();
    }

    verifySentinelCss() {
      for (const record of this.records.values()) {
        for (const frameNumber of [0, 17, 223]) {
          record.sentinel.style.setProperty("--frame", String(frameNumber));
          if (!sameRgb(parseRgb(getComputedStyle(record.sentinel).backgroundColor), sentinelColor(frameNumber))) {
            this.sentinel.mode = "js-channels";
            break;
          }
        }
      }
    }

    activeAt(run, seconds) {
      return runActiveAt(run, seconds);
    }

    async settle(record) {
      if (this.settlePolicy === "sync-layout") {
        const active = record.containers.find(({ container }) => container.hasAttribute("data-akari-active"));
        if (active) void getComputedStyle(active.container).backgroundColor;
        void record.root.getBoundingClientRect();
        void record.host.offsetHeight;
        return;
      }
      await nextAnimationFrame();
      await nextAnimationFrame();
      await new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          record.host.removeEventListener("paint", onPaint);
          resolve();
        };
        const onPaint = () => finish();
        const timer = setTimeout(finish, 250);
        record.host.addEventListener("paint", onPaint, { once: true });
        record.tick.style.opacity = record.tick.style.opacity === "0" ? "0.001" : "0";
        try { record.host.requestPaint(); } catch { finish(); }
      });
    }

    setSentinelFrame(record, frameNumber) {
      if (!record.sentinel) return;
      const color = sentinelColor(frameNumber);
      if (this.sentinel.mode === "css-mod") {
        record.sentinel.style.setProperty("--frame", String(frameNumber));
      } else {
        record.sentinel.style.setProperty("--frame-r", String(color[0]));
        record.sentinel.style.setProperty("--frame-g", String(color[1]));
        record.sentinel.style.setProperty("--frame-b", String(color[2]));
        record.sentinel.style.background = "rgb(var(--frame-r) var(--frame-g) var(--frame-b))";
      }
    }

    async captureRun(run, seconds, frameNumber) {
      const record = this.records.get(run.runId);
      if (!record) throw new Error(`GPU DOM layer record is missing: ${run.runId}`);
      const started = performance.now();
      for (const { entry, container } of record.containers) {
        const active = activeAt(entry, seconds);
        container.style.visibility = active ? "visible" : "hidden";
        container.toggleAttribute("data-akari-active", active);
        if (!active) continue;
        for (const animation of container.getAnimations({ subtree: true })) {
          try { animation.pause(); } catch {}
          try { animation.currentTime = Math.max(0, seconds - entry.start) * 1000; } catch {}
        }
      }
      this.setSentinelFrame(record, frameNumber);
      const timeFixMs = performance.now() - started;
      const waitStarted = performance.now();
      await this.settle(record);
      const waitMs = performance.now() - waitStarted;
      const drawStarted = performance.now();
      const context = record.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.clearRect(0, 0, this.config.width, this.config.height);
      const computed = getComputedStyle(record.root);
      const opacity = Number.parseFloat(computed.opacity);
      if (Number.isFinite(opacity)) context.globalAlpha = Math.max(0, Math.min(1, opacity));
      if (computed.transform && computed.transform !== "none") {
        const matrix = new DOMMatrix(computed.transform);
        const origin = computed.transformOrigin.split(" ");
        const x = Number.parseFloat(origin[0]) || 0;
        const y = Number.parseFloat(origin[1]) || 0;
        context.translate(x, y);
        context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
        context.translate(-x, -y);
      }
      await Promise.resolve(context.drawElementImage(record.root, 0, 0));
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      const drawElementMs = performance.now() - drawStarted;
      const uploadStarted = performance.now();
      this.spriteCompositor.updateSprite(run.runId, record.host);
      const uploadMs = performance.now() - uploadStarted;
      const domLayerCostMs = timeFixMs + waitMs + drawElementMs + uploadMs;
      for (const [name, value] of Object.entries({ timeFixMs, waitMs, drawElementMs, uploadMs, domLayerCostMs })) {
        this.metrics[name].push(value);
      }
      if (this.verifier && record.sentinel) {
        const expected = sentinelColor(frameNumber);
        const result = this.verifier.verify(record.host, expected, this.sentinel.tolerance);
        this.sentinel.requested += 1;
        if (result.matched) this.sentinel.matched += 1;
        else {
          this.sentinel.mismatchCount += 1;
          if (this.sentinel.mismatches.length < 10) this.sentinel.mismatches.push({ frame: frameNumber, runId: run.runId, expected, actual: result.actual });
        }
      }
      return { timeFixMs, waitMs, drawElementMs, uploadMs, domLayerCostMs };
    }

    recordFrameCost(value) {
      this.metrics.frameCostMs.push(value);
    }

    summary() {
      const totals = summarize(this.metrics.frameCostMs);
      return {
        runs: this.runs.length,
        overlays: this.runs.reduce((sum, run) => sum + run.entries.length, 0),
        policy: this.settlePolicy,
        flags: Array.isArray(this.config.domLayerFlags) ? [...this.config.domLayerFlags] : [],
        api: { ...this.api, available: this.api.drawElementImage, settlePolicy: this.settlePolicy },
        cost: {
          p50: totals.p50,
          p95: totals.p95,
          breakdown: Object.fromEntries(Object.entries(this.metrics).map(([name, values]) => [name, summarize(values)])),
        },
        sentinel: this.sentinel,
      };
    }

    dispose() {
      this.verifier?.dispose?.();
      for (const record of this.records.values()) record.host.remove();
      this.records.clear();
    }
  }

  window.__akariGpuDomInternals = { sentinelColor, chooseSettlePolicy, runActiveAt, orderedSpriteDraws };

  window.__akariGpuRun = async function () {
    if (!FE || !bridge) throw new Error("GPU page dependencies are unavailable");
    const runtimeConfig = await bridge.config();
    const config = { ...pageConfig, ...runtimeConfig };
    if (config.trapReadback && config.verifyFrames) throw new Error("trapReadback and verifyFrames are mutually exclusive");
    const counters = {
      webglReadbackCalls: 0,
      videoFrameCopyCalls: 0,
      canvasBlobCalls: 0,
      canvasDataUrlCalls: 0,
      canvasPixelReadCalls: 0,
      bitmapCreationCalls: 0,
    };
    const restoreTraps = config.trapReadback ? installReadbackTraps(counters) : () => {};
    const engine = new GpuFrameEngineRuntime(config);
    const finalCanvas = document.getElementById("akari-final");
    const spriteCompositor = new FE.SpriteCompositor(finalCanvas, { width: config.width, height: config.height });
    const stages = { evaluate: [], three: [], dom: [], composite: [], encode: [], backpressure: [] };
    const frameHashes = [];
    const threeRecords = new Map();
    let threeRuntime = null;
    let queueWaits = 0;
    let encoder = null;
    let supported = false;
    let hashFrame = null;
    let domRuntime = null;
    const started = performance.now();
    try {
      if (config.spriteManifest.captions.length > 0) {
        const font = await embeddedCaptionFont();
        for (const caption of config.spriteManifest.captions) caption.html = caption.html.replaceAll("/caption-font.ttf", font);
      }
      for (const value of [...config.spriteManifest.statics, ...config.spriteManifest.captions]) {
        spriteCompositor.registerSprite(value.id, await rasterizeSprite(value, config));
      }
      const overlayFrame = document.getElementById("akari-overlays");
      if (overlayFrame) {
        await new Promise((resolve) => {
          if (overlayFrame.contentDocument?.readyState === "complete") resolve();
          else overlayFrame.addEventListener("load", resolve, { once: true });
        });
        await overlayFrame.contentWindow.__akariReady;
        threeRuntime = overlayFrame.contentWindow.akari?.threeRuntime;
        if (!threeRuntime || typeof threeRuntime.render !== "function" || typeof threeRuntime.inspect !== "function") {
          throw new Error("3D overlays require window.akari.threeRuntime with render() and inspect()");
        }
        for (const value of config.spriteManifest.three) {
          const container = overlayFrame.contentDocument.querySelector(`[data-overlay-id="${CSS.escape(value.id)}"] > .scene-content`);
          if (!container) throw new Error(`3D overlay container is missing: ${value.id}`);
          container.parentElement.style.visibility = "visible";
          await waitForThreeReady(threeRuntime, container, value.id);
          const canvas = container.querySelector("canvas");
          if (!canvas) throw new Error(`3D sprite canvas is missing: ${value.id}`);
          threeRecords.set(value.id, { container, canvas });
          spriteCompositor.registerSprite(value.id, canvas);
        }
      }
      let verifyModule = null;
      if (config.verifyFrames) {
        const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(config.verifyReadbackModule)}`;
        verifyModule = await import(moduleUrl);
        hashFrame = verifyModule.hashCanvasFrame;
      }
      const sentinelVerifier = config.verifyFrames && config.spriteManifest.dom?.length > 0
        ? verifyModule.createDomLayerSentinelVerifier(config.width, config.height)
        : null;
      domRuntime = new DomLayerRuntime(config, config.spriteManifest.dom, spriteCompositor, sentinelVerifier);
      await domRuntime.mount();
      const hardwareAcceleration = config.soft ? "prefer-software" : "prefer-hardware";
      supported = await FE.WebCodecsH264Encoder.isSupported({
        width: config.width, height: config.height, fps: config.fps, bitrate: config.bitrate,
        hardwareAcceleration,
      });
      if (supported) {
        await bridge.startChunks({ width: config.width, height: config.height, fps: config.fps, frames: config.frames });
        encoder = new FE.WebCodecsH264Encoder({
          write: (bytes, chunk) => bridge.writeChunk({ bytes, ...chunk }),
        }, {
          width: config.width,
          height: config.height,
          fps: config.fps,
          bitrate: config.bitrate,
          keyframeIntervalFrames: config.fps * 2,
          hardwareAcceleration,
        });
      } else if (!config.verifyFrames) {
        throw new Error(`WebCodecs H.264 config is unsupported: ${hardwareAcceleration}`);
      }
      for (let frameNumber = 0; frameNumber < config.frames; frameNumber += 1) {
        const timeUs = Math.round(frameNumber / config.fps * 1e6);
        const seconds = timeUs / 1e6;
        const evaluateStarted = performance.now();
        const frame = await engine.frameAt(seconds);
        stages.evaluate.push(performance.now() - evaluateStarted);
        try {
          if (frame.uploadPath !== "direct" || engine.compositor.uploadPath !== "direct") {
            throw new Error(`direct upload fallback at frame ${frameNumber}`);
          }
          const threeStarted = performance.now();
          if (threeRuntime) {
            for (const value of config.spriteManifest.three) {
              if (!activeAt(value, seconds)) continue;
              const record = threeRecords.get(value.id);
              if (!record) throw new Error(`3D overlay record is missing: ${value.id}`);
              threeRuntime.render(record.container, seconds - value.start);
              spriteCompositor.updateSprite(value.id, record.canvas);
            }
          }
          stages.three.push(performance.now() - threeStarted);
          const domStarted = performance.now();
          let activeDomRuns = 0;
          for (const run of config.spriteManifest.dom ?? []) {
            if (!domRuntime.activeAt(run, seconds)) continue;
            activeDomRuns += 1;
            await domRuntime.captureRun(run, seconds, frameNumber);
          }
          const domFrameCost = performance.now() - domStarted;
          stages.dom.push(domFrameCost);
          if (activeDomRuns > 0) domRuntime.recordFrameCost(domFrameCost);
          const draws = orderedSpriteDraws(config.spriteManifest, seconds, domRuntime);
          for (const value of config.spriteManifest.captions) {
            if (!activeAt(value, seconds)) continue;
            const state = FE.captionMotionAt(value.motion, seconds - value.start, value.duration, value.emPx);
            draws.push({ id: value.id, ...state });
          }
          const compositeStarted = performance.now();
          spriteCompositor.compose(frame.surface.canvas, draws);
          stages.composite.push(performance.now() - compositeStarted);
          if (hashFrame) frameHashes.push(await hashFrame(finalCanvas));
          if (encoder) {
            const encodeStarted = performance.now();
            encoder.encode({ ...frame, surface: { ...frame.surface, canvas: finalCanvas } });
            stages.encode.push(performance.now() - encodeStarted);
            const backpressureStarted = performance.now();
            if (encoder.encodeQueueSize > config.queueDepth) {
              queueWaits += 1;
              await waitForEncoderQueueBelow(encoder, config.queueDepth);
            }
            stages.backpressure.push(performance.now() - backpressureStarted);
          }
        } finally {
          frame.close();
        }
        if ((frameNumber + 1) % 30 === 0 || frameNumber + 1 === config.frames) {
          await bridge.checkpoint({
            status: "running",
            framesCompleted: frameNumber + 1,
            framesRequested: config.frames,
            stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, summarize(values)])),
            gpu: {
              uploadPath: spriteCompositor.uploadPath,
              quality: config.quality,
              bitrate: config.bitrate,
              queueDepth: config.queueDepth,
              queueWaits,
              readbackCounters: counters,
            },
            domLayer: domRuntime.summary(),
          });
        }
      }
      const encoderFinish = encoder ? await encoder.finish() : null;
      const mux = encoder ? await bridge.finishChunks({ encoderFinish }) : null;
      return {
        status: supported ? "completed" : "unsupported",
        framesRequested: config.frames,
        framesCompleted: config.frames,
        frameHashes,
        elapsedMs: performance.now() - started,
        stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, summarize(values)])),
        frameEngineMetrics: engine.metrics.toJSON(),
        gpu: {
          encoder: supported ? "WebCodecsH264Encoder" : "unsupported",
          hardware: hardwareAcceleration,
          uploadPath: spriteCompositor.uploadPath,
          quality: config.quality,
          bitrate: config.bitrate,
          queueDepth: config.queueDepth,
          queueWaits,
          trapReadback: Boolean(config.trapReadback),
          readbackCounters: counters,
        },
        domLayer: domRuntime.summary(),
        mux,
        eligibility: config.eligibility,
        warnings,
      };
    } finally {
      restoreTraps();
      encoder?.close();
      domRuntime?.dispose();
      spriteCompositor.dispose();
      engine.dispose();
    }
  };
})();
