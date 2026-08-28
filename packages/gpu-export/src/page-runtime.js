(function () {
  "use strict";

  const pageConfig = window.__AKARI_GPU_CONFIG__;
  const FE = window.AkariFrameEngine;
  const bridge = window.akariGpu;
  const warnings = [];
  const pools = new Map();
  const lookahead = new Map();
  const images = new Map();
  let captionFontDataUrlPromise = null;

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

  const CAPTION_WORD_FREEZE_CSS = `
    .akari-caption__tok--karaoke{animation:none!important}
    .akari-caption__tok--pop{animation:none!important}
    .akari-caption__tok--reveal-word{animation:none!important;opacity:1!important}
    .akari-caption__emphasis-char{animation:none!important;opacity:1!important}
    .akari-caption__tok--size-pulse{animation:none!important}
    .akari-caption__reveal-group{animation:none!important;opacity:1!important}`;

  function captionHtmlWithUnitMarkers(html) {
    if (!html.includes("akari-caption__reveal-group")) return html;
    const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    for (const [index, group] of [...parsed.body.querySelectorAll(".akari-caption__reveal-group")].entries()) {
      group.setAttribute("data-akari-unit", String(index));
    }
    return parsed.body.innerHTML;
  }

  function captionUnitCss(unitIndex) {
    return unitIndex === null ? "" : `
      .akari-caption__reveal-group[data-akari-unit]:not([data-akari-unit="${unitIndex}"]){visibility:hidden!important}`;
  }

  function captionRoot(value, config, html, extraCss) {
    const root = document.createElement("div");
    root.className = "akari-measure-root";
    root.style.cssText = `position:fixed;left:0;top:0;width:${config.width}px;height:${config.height}px;overflow:hidden;`
      + `background:transparent;container-type:size;visibility:hidden;pointer-events:none;${varsCss(value.vars)}`;
    root.innerHTML = `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}${extraCss}</style>${html}`;
    document.body.appendChild(root);
    return root;
  }

  function relativeRect(rect, origin) {
    return {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
    };
  }

  function tokenRole(element) {
    if (element.classList.contains("akari-caption__emphasis-char")) return "emphasis-bang";
    if (element.classList.contains("akari-caption__tok--size-pulse")) return "emphasis-pulse";
    if (element.classList.contains("akari-caption__tok--karaoke")) return "karaoke";
    if (element.classList.contains("akari-caption__tok--pop")) return "pop";
    if (element.classList.contains("akari-caption__tok--reveal-word")) return "reveal-word";
    return "plain";
  }

  function tokenStyle(element, role) {
    if (role === "karaoke" || role === "pop" || role === "reveal-word") return role;
    const token = element.closest(".akari-caption__tok") ?? element;
    for (const style of [
      "one-char-bang", "one-char-jumble", "size-pulse", "color-accent", "color-only",
      "outline-bold", "danger", "positive", "highlight",
    ]) {
      if (token.classList.contains(`akari-caption__tok--${style}`)) return style;
    }
    return null;
  }

  function cssSeconds(element, property, fallback) {
    const value = Number.parseFloat(element.style.getPropertyValue(property).replace(/s$/u, ""));
    return Number.isFinite(value) ? value : fallback;
  }

  function tokenTiming(element, role, emPx) {
    if (role === "plain") return null;
    if (role === "karaoke") return {
      role, delaySec: cssSeconds(element, "--akari-tok-delay", 0),
      durationSec: cssSeconds(element, "--akari-tok-dur", 0.2), emPx,
    };
    if (role === "pop") return {
      role, delaySec: cssSeconds(element, "--akari-tok-delay", 0), durationSec: 0.2, emPx,
    };
    if (role === "reveal-word") return {
      role, delaySec: cssSeconds(element, "--akari-tok-delay", 0), durationSec: 0.01, emPx,
    };
    return {
      role,
      delaySec: cssSeconds(element, "--akari-emphasis-delay", 0),
      durationSec: cssSeconds(element, "--akari-emphasis-dur", role === "emphasis-bang" ? 0.1 : 0.2),
      emPx,
    };
  }

  function measureCaptionUnit(root, unitIndex) {
    const origin = root.getBoundingClientRect();
    const groups = [...root.querySelectorAll(".akari-caption__reveal-group")];
    const unitElement = groups.length > 0 ? groups[unitIndex] : root;
    if (!unitElement) throw new Error(`caption reveal unit is missing: ${unitIndex}`);
    const typographyElement = groups.length > 0
      ? unitElement
      : unitElement.querySelector(".akari-caption") ?? unitElement;
    const emPx = Number.parseFloat(getComputedStyle(typographyElement).fontSize) || 0;
    const elements = [...unitElement.querySelectorAll(".akari-caption__tok, .akari-caption__emphasis-char")]
      .filter((element) => !(element.classList.contains("akari-caption__tok")
        && element.querySelector(".akari-caption__emphasis-char")));
    const tokens = elements.flatMap((element, tokenIndex) => {
      const role = tokenRole(element);
      const line = element.closest(".akari-caption__line");
      const lineIndex = line ? [...unitElement.querySelectorAll(".akari-caption__line")].indexOf(line) : 0;
      return [...element.getClientRects()].map((rect, rectIndex) => ({
        tokenIndex,
        rectIndex,
        role,
        style: tokenStyle(element, role),
        timing: tokenTiming(element, role, emPx),
        rect: relativeRect(rect, origin),
        lineIndex: Math.max(0, lineIndex),
      }));
    });
    const lines = [...unitElement.querySelectorAll(".akari-caption__line")]
      .map((line) => relativeRect(line.getBoundingClientRect(), origin));
    const plateElement = root.querySelector(".akari-caption__plate");
    const plate = plateElement ? relativeRect(plateElement.getBoundingClientRect(), origin) : null;
    const revealDelay = groups.length > 0 ? cssSeconds(unitElement, "--akari-reveal-delay", 0) : 0;
    const revealDuration = groups.length > 0 ? cssSeconds(unitElement, "--akari-reveal-dur", 0.2) : 0;
    const wordCount = unitElement.querySelectorAll(".akari-caption__tok").length;
    return { tokens, lines, plate, emPx, wordCount, reveal: groups.length > 0, revealDelay, revealDuration };
  }

  function compareCaptionLayouts(left, right, id) {
    if (left.tokens.length !== right.tokens.length) throw new Error(`caption ${id} layout token count mismatch`);
    let maximum = 0;
    for (let index = 0; index < left.tokens.length; index += 1) {
      const a = left.tokens[index].rect;
      const b = right.tokens[index].rect;
      for (const key of ["x", "y", "width", "height"]) maximum = Math.max(maximum, Math.abs(a[key] - b[key]));
    }
    if (maximum > 0.01) throw new Error(`caption ${id} two-raster layout mismatch: ${maximum}px`);
    return maximum;
  }

  async function measureCaptionVariants(value, config, html, cssVariants, unitIndex) {
    const root = captionRoot(value, config, html, cssVariants[0]);
    try {
      const styleElement = root.querySelector("style");
      if (!styleElement) throw new Error(`caption ${value.id} measurement style is missing`);
      const typography = root.querySelector(".akari-caption");
      let fontDeclaration = null;
      let fontSample = "字幕";
      if (typography && typeof document.fonts.load === "function") {
        const computed = getComputedStyle(typography);
        fontDeclaration = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        fontSample = typography.textContent || fontSample;
        await document.fonts.load(fontDeclaration, fontSample);
      }
      await document.fonts.ready;
      if (fontDeclaration !== null && !document.fonts.check(fontDeclaration, fontSample)) {
        throw new Error(`caption ${value.id} font is not ready for measurement`);
      }
      const measurements = [];
      for (const css of cssVariants) {
        styleElement.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden}${css}`;
        void root.getBoundingClientRect();
        measurements.push(measureCaptionUnit(root, unitIndex));
      }
      return measurements;
    } finally {
      root.remove();
    }
  }

  function captionRasterSvg(value, config, html, extraCss) {
    const xhtml = serializeHtmlToXhtml(html);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" class="akari-sprite-root" style="position:relative;width:${config.width}px;height:${config.height}px;overflow:hidden;background:transparent;container-type:size;${varsCss(value.vars)}">
          <style>html,body{margin:0;width:100%;height:100%;overflow:hidden}${extraCss}</style>${xhtml}
        </div>
      </foreignObject>
    </svg>`;
  }

  function assertCaptionSvg(svg, id) {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const parserError = parsed.querySelector("parsererror");
    if (parserError) throw new Error(`caption ${id} SVG parsererror: ${parserError.textContent}`);
  }

  function assignCaptionImageSource(image, svg, fontDataUrl) {
    const embeddedSvg = svg.replaceAll("/caption-font.ttf", fontDataUrl);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(embeddedSvg)}`;
  }

  async function decodeCaptionSvg(svg, id) {
    const image = new Image();
    image.decoding = "sync";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`caption ${id} image load failed`));
    });
    assignCaptionImageSource(image, svg, await embeddedCaptionFont());
    await loaded;
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error(`caption ${id} decoded empty`);
    }
    return image;
  }

  async function rasterizeCaptionState(value, config, html, extraCss, textureRect) {
    const settled = value.motion?.in?.duration_sec ?? value.motion?.in?.durationSec ?? 0.18;
    const settleCss = `.akari-sprite-root,.akari-sprite-root *{animation-play-state:paused!important;animation-delay:-${Math.max(0, Number(settled) || 0)}s!important}`;
    const svg = captionRasterSvg(value, config, html, `${settleCss}${extraCss}`);
    assertCaptionSvg(svg, value.id);
    const image = await decodeCaptionSvg(svg, value.id);
    const canvas = document.createElement("canvas");
    canvas.width = textureRect.width;
    canvas.height = textureRect.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("caption 2D canvas is unavailable");
    context.clearRect(0, 0, textureRect.width, textureRect.height);
    context.drawImage(image, 0, -textureRect.y);
    image.src = "";
    return canvas;
  }

  async function registerCaptionUnit(unit, config, spriteCompositor) {
    if (unit.registered || unit.released) throw new Error(`caption unit cannot be registered: ${unit.id}`);
    for (const [index, css] of unit.rasterCss.entries()) {
      const canvas = await rasterizeCaptionState(unit.value, config, unit.html, css, unit.textureRect);
      const id = index === 0 ? unit.id : unit.secondaryId;
      if (!id) throw new Error(`caption unit secondary id is missing: ${unit.id}`);
      spriteCompositor.registerSprite(id, canvas);
      canvas.width = 0;
      canvas.height = 0;
      await yieldMacrotask();
    }
    unit.registered = true;
    unit.html = "";
    unit.rasterCss = [];
    unit.value = null;
  }

  function releaseCaptionUnit(unit, spriteCompositor) {
    if (unit.released) return;
    if (unit.registered) {
      spriteCompositor.releaseSprite(unit.id);
      if (unit.secondaryId) spriteCompositor.releaseSprite(unit.secondaryId);
    }
    unit.registered = false;
    unit.released = true;
    unit.html = "";
    unit.rasterCss = [];
    unit.value = null;
  }

  async function buildCaptionUnits(value, config) {
    const html = captionHtmlWithUnitMarkers(value.html);
    const probe = captionRoot(value, config, html, CAPTION_WORD_FREEZE_CSS);
    let unitCount;
    try {
      await document.fonts.ready;
      unitCount = Math.max(1, probe.querySelectorAll(".akari-caption__reveal-group").length);
    } finally {
      probe.remove();
    }
    const units = [];
    let layoutMaxDeltaPx = 0;
    for (let unitIndex = 0; unitIndex < unitCount; unitIndex += 1) {
      const revealIndex = unitCount > 1 || html.includes("akari-caption__reveal-group") ? unitIndex : null;
      const unitCss = `${CAPTION_WORD_FREEZE_CSS}${captionUnitCss(revealIndex)}`;
      const [probeMeasurement] = await measureCaptionVariants(value, config, html, [unitCss], unitIndex);
      const roles = new Set(probeMeasurement.tokens.map((token) => token.role));
      const hasColor = roles.has("karaoke");
      const hasGeometry = ["pop", "reveal-word", "emphasis-bang", "emphasis-pulse"].some((role) => roles.has(role));
      if (hasColor && hasGeometry) throw new Error(`caption ${value.id} contains mixed color and geometry word roles`);
      const mode = hasColor ? "color" : hasGeometry ? "geometry" : "sprite";
      const id = `${value.id}::unit-${unitIndex}`;
      let secondaryId = null;
      let rasterCss;
      let tiles = null;
      let unitMeasurement = probeMeasurement;
      if (mode === "color") {
        const baseCss = `${unitCss}.akari-caption__tok--karaoke{color:var(--caption-color,#fff)!important}`;
        const highlightCss = `${unitCss}.akari-caption__tok--karaoke{color:var(--caption-highlight-color,#ffd94a)!important}`;
        const [baseMeasurement, highlightMeasurement] = await measureCaptionVariants(
          value,
          config,
          html,
          [baseCss, highlightCss],
          unitIndex,
        );
        // Keep the strict threshold: measuring variants in one root removes insertion jitter
        // instead of hiding a real layout mismatch by widening the tolerance.
        layoutMaxDeltaPx = Math.max(layoutMaxDeltaPx, compareCaptionLayouts(baseMeasurement, highlightMeasurement, id));
        unitMeasurement = baseMeasurement;
        rasterCss = [baseCss, highlightCss];
        secondaryId = `${id}::b`;
      } else if (mode === "geometry") {
        const plateCss = `${unitCss}.akari-caption__tok,.akari-caption__emphasis-char{visibility:hidden!important}`;
        const textCss = `${unitCss}.akari-caption__line,.akari-caption__block{background:transparent!important}`
          + `.akari-caption__line::before{background:transparent!important}`;
        const [plateMeasurement, textMeasurement] = await measureCaptionVariants(
          value,
          config,
          html,
          [plateCss, textCss],
          unitIndex,
        );
        layoutMaxDeltaPx = Math.max(layoutMaxDeltaPx, compareCaptionLayouts(plateMeasurement, textMeasurement, id));
        unitMeasurement = plateMeasurement;
        rasterCss = [plateCss, textCss];
        secondaryId = `${id}::b`;
      } else {
        rasterCss = [unitCss];
      }
      const textureRect = FE.captionWordTextureRect(unitMeasurement, config);
      tiles = mode === "sprite"
        ? null
        : FE.buildCaptionWordTiles(unitMeasurement, { ...config, textureRect });
      units.push({
        id,
        secondaryId,
        value: { id: value.id, motion: value.motion, vars: value.vars },
        html,
        rasterCss,
        textureRect,
        tiles,
        mode,
        cueId: value.id,
        cueStart: value.start,
        cueDuration: value.duration,
        motion: value.motion,
        emPx: unitMeasurement.emPx || value.emPx,
        wordCount: unitMeasurement.wordCount,
        style: [...new Set([
          ...(unitMeasurement.reveal ? ["reveal"] : []),
          ...unitMeasurement.tokens.map((token) => token.style).filter(Boolean),
        ])],
        reveal: unitMeasurement.reveal,
        revealDelay: unitMeasurement.revealDelay,
        revealDuration: unitMeasurement.revealDuration,
        registered: false,
        released: false,
      });
    }
    return { units, layoutMaxDeltaPx };
  }

  function embeddedCaptionFont() {
    captionFontDataUrlPromise ??= (async () => {
      const response = await fetch("/caption-font.ttf");
      if (!response.ok) throw new Error(`caption font fetch failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      return `data:font/ttf;base64,${btoa(binary)}`;
    })();
    return captionFontDataUrlPromise;
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
    const stages = { evaluate: [], three: [], captionRaster: [], captions: [], composite: [], encode: [], backpressure: [] };
    const frameHashes = [];
    const threeRecords = new Map();
    const captionUnits = [];
    const captionRecords = [];
    let captionLayoutMaxDeltaPx = 0;
    let threeRuntime = null;
    let queueWaits = 0;
    let encoder = null;
    let supported = false;
    let hashFrame = null;
    const started = performance.now();
    try {
      for (const value of config.spriteManifest.statics) {
        spriteCompositor.registerSprite(value.id, await rasterizeSprite(value, config));
      }
      for (const value of config.spriteManifest.captions) {
        const built = await buildCaptionUnits(value, config);
        captionLayoutMaxDeltaPx = Math.max(captionLayoutMaxDeltaPx, built.layoutMaxDeltaPx);
        let rasters = 0;
        let tiles = 0;
        let words = 0;
        for (const unit of built.units) {
          rasters += unit.rasterCss.length;
          tiles += unit.tiles?.length ?? 0;
          words += unit.wordCount;
          captionUnits.push(unit);
        }
        const usedStyles = [...new Set(built.units.flatMap((unit) => unit.style))];
        captionRecords.push({
          id: value.id,
          mode: built.units.some((unit) => unit.tiles !== null) ? "words-native" : "sprite",
          style: usedStyles.length > 0 ? usedStyles.join("+") : null,
          units: built.units.length,
          words,
          rasters,
          tiles,
        });
        value.html = "";
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
      if (config.verifyFrames) {
        const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(config.verifyReadbackModule)}`;
        hashFrame = (await import(moduleUrl)).hashCanvasFrame;
      }
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
          const draws = [];
          for (const value of config.spriteManifest.statics) if (activeAt(value, seconds)) draws.push({ id: value.id, opacity: 1 });
          for (const value of config.spriteManifest.three) if (activeAt(value, seconds)) draws.push({ id: value.id, opacity: 1 });
          for (const unit of captionUnits) {
            if (seconds >= unit.cueStart + unit.cueDuration) {
              releaseCaptionUnit(unit, spriteCompositor);
            }
            if (seconds < unit.cueStart || seconds >= unit.cueStart + unit.cueDuration) continue;
            if (!unit.registered) {
              const rasterStarted = performance.now();
              await registerCaptionUnit(unit, config, spriteCompositor);
              stages.captionRaster.push(performance.now() - rasterStarted);
            }
          }
          const captionStarted = performance.now();
          for (const unit of captionUnits) {
            if (seconds < unit.cueStart || seconds >= unit.cueStart + unit.cueDuration) continue;
            const localSeconds = seconds - unit.cueStart;
            const revealState = unit.reveal
              ? FE.captionRevealGroupStateAt(unit.revealDelay, unit.revealDuration, localSeconds, unit.emPx)
              : null;
            const state = revealState
              ? {
                  opacity: revealState.opacity,
                  translateY: revealState.translateY,
                  translateX: 0,
                  scaleX: 1,
                  scaleY: 1,
                  rotateDeg: 0,
                }
              : FE.captionMotionAt(unit.motion, localSeconds, unit.cueDuration, unit.emPx);
            if (state.opacity <= 0) continue;
            if (unit.tiles === null) {
              draws.push({ id: unit.id, textureRect: unit.textureRect, ...state });
              continue;
            }
            const tiles = unit.tiles.map((tile) => {
              if (tile.timing === null) return tile.static;
              const wordState = FE.captionWordStateAt(tile.timing, localSeconds);
              return {
                ...tile.static,
                mix: wordState.mix,
                visible: wordState.visible,
                opacity: wordState.opacity,
                translateX: wordState.translateX,
                translateY: wordState.translateY,
                scaleX: wordState.scaleX,
                scaleY: wordState.scaleY,
              };
            });
            if (unit.mode === "geometry") {
              draws.push({ id: unit.id, textureRect: unit.textureRect, ...state });
              draws.push({ id: unit.secondaryId, textureRect: unit.textureRect, tiles, ...state });
            } else {
              draws.push({
                id: unit.id,
                secondaryId: unit.secondaryId,
                textureRect: unit.textureRect,
                tiles,
                ...state,
              });
            }
          }
          const compositeStarted = performance.now();
          spriteCompositor.compose(frame.surface.canvas, draws);
          stages.composite.push(performance.now() - compositeStarted);
          if (captionUnits.length > 0) stages.captions.push(compositeStarted - captionStarted);
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
              captions: captionRecords,
              captionLayoutMaxDeltaPx,
            },
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
          captions: captionRecords,
          captionLayoutMaxDeltaPx,
        },
        mux,
        eligibility: config.eligibility,
        warnings,
      };
    } finally {
      restoreTraps();
      encoder?.close();
      spriteCompositor.dispose();
      engine.dispose();
    }
  };
})();
