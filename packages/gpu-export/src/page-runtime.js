(function () {
  "use strict";

  const pageConfig = window.__AKARI_GPU_CONFIG__;
  const FE = window.AkariFrameEngine;
  const bridge = window.akariGpu;
  const warnings = [];
  const pools = new Map();
  const lookahead = new Map();
  const images = new Map();
  const captionFontCheckCache = new Map();
  let captionEncodedFontPromise = null;

  const CAPTION_MEASURE_MAX_ATTEMPTS = 32;
  const CAPTION_MEASURE_UNSTABLE_REASON = "caption-measure-unstable";
  const HEVC_UNSUPPORTED_REASON = "hevc-unsupported";
  const CAPTION_MEASURE_DIFF_LIMIT = 20;
  const CAPTION_MEASURE_DIFF_MARKER = "AKARI_CAPTION_MEASURE_DIFFS:";
  const GPU_DIAGNOSTICS_MARKER = "AKARI_GPU_DIAGNOSTICS:";
  const CAPTION_RECT_KEYS = ["x", "y", "width", "height", "right", "bottom"];
  const CAPTION_BATCH_MAX_UNITS = 8;
  const CAPTION_BATCH_MAX_HEIGHT_PX = 4096;
  const CAPTION_PREFETCH_MAX_BYTES = 256 * 1024 * 1024;
  const CAPTION_FONT_PLACEHOLDER = "/caption-font.ttf";
  const CAPTION_MEASURE_ROOT_CLASS = "akari-measure-root";

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

  function collectRendererInfo(canvas) {
    const gl = canvas.getContext("webgl2");
    if (!gl) return null;
    try {
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      if (!extension) return null;
      const vendor = gl.getParameter(extension.UNMASKED_VENDOR_WEBGL);
      const renderer = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
      return typeof vendor === "string" && typeof renderer === "string" ? { vendor, renderer } : null;
    } catch {
      return null;
    }
  }

  // unsupported の診断用: 実際に probe した codec 文字列（level 導出後）と解像度・fps・ビットレートを添える。
  // level 導出が throw する寸法（Level 6.2 超）でもここは診断文なので落とさない。
  function describeEncoderTarget(config) {
    const width = config.outputWidth ?? config.width;
    const height = config.outputHeight ?? config.height;
    let codec = config.codec === "hevc" ? "hvc1.?" : "avc1.?";
    try {
      if (config.codec === "hevc" && typeof FE.hevcEncoderCodecString === "function") {
        codec = FE.hevcEncoderCodecString({ width, height, fps: config.fps });
      } else if (typeof FE.h264CodecString === "function") {
        codec = FE.h264CodecString({ width, height, fps: config.fps, bitrate: config.bitrate });
      }
    } catch (error) {
      codec = `no-level: ${error?.message ?? error}`;
    }
    return `${codec} ${width}x${height}@${config.fps}fps ${config.bitrate}bps`;
  }

  async function collectEncoderSupport(config) {
    const base = {
      width: config.outputWidth ?? config.width,
      height: config.outputHeight ?? config.height,
      fps: config.fps,
      bitrate: config.bitrate,
      codec: config.codec ?? "h264",
    };
    const probe = async (hardwareAcceleration) => {
      try {
        return await FE.WebCodecsH264Encoder.isSupported({ ...base, hardwareAcceleration });
      } catch {
        return false;
      }
    };
    const [hardware, software] = await Promise.all([
      probe("prefer-hardware"),
      probe("prefer-software"),
    ]);
    return { "prefer-hardware": hardware, "prefer-software": software };
  }

  function scaleSurfaceForEncode(finalCanvas, config, reusableCanvas = null) {
    const width = config.outputWidth ?? config.width;
    const height = config.outputHeight ?? config.height;
    if (width === config.width && height === config.height) return finalCanvas;
    const scaled = reusableCanvas ?? new OffscreenCanvas(width, height);
    if (scaled.width !== width) scaled.width = width;
    if (scaled.height !== height) scaled.height = height;
    const context = scaled.getContext("2d");
    if (!context) throw new Error("GPU output scale requires an OffscreenCanvas 2D context");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, width, height);
    context.drawImage(finalCanvas, 0, 0, width, height);
    return scaled;
  }

  function mediaUrl(value) {
    return "/media/" + String(value).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  }

  function normalizedCuts(edit) {
    return (Array.isArray(edit.cuts) ? edit.cuts : []).map((cut, index) => {
      const copy = Object.assign({}, cut);
      // track 0（本編の連結チェーン）は投影が導出した at を外して連続配置に任せる: freeze で
      // 時間軸を伸ばし、トランジションの重なりは宣言から再計算する（preview-server と同じ）。
      // 2 本目以降の visual トラック（track >= 1）は at / track を保持して絶対配置する。外すと
      // 直列に連結されて出力尺の外へ押し出され、無言で消える（issue #31）。前後関係は
      // frame-engine の既定 trackZ（番号が大きいトラックが前面）。
      const track = Number.isInteger(cut.track) && cut.track > 0 ? cut.track : 0;
      delete copy.at;
      delete copy.track;
      if (track > 0) {
        copy.track = track;
        if (Number.isFinite(cut.at) && cut.at >= 0) copy.at = Number(cut.at);
      }
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
      const engineLayers = (Array.isArray(config.edit.layers) ? config.edit.layers : []).map((layer) => {
        if (layer?.kind !== "filter" || layer?.filter?.type !== "lut") return layer;
        if (typeof layer.filter.cubeText !== "string") return layer;
        return {
          ...layer,
          filter: {
            type: "lut",
            lut: FE.parseCube(layer.filter.cubeText),
            intensity: Math.max(0, Math.min(1, Number(layer.filter.intensity ?? 1))),
          },
        };
      });
      for (const layer of engineLayers) {
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
          // capacity 1: sequential export never re-reads past frames, and every cached frame is a
          // decoder-backed clone that pins a decoder output surface; holding 12 starved the decoder
          // (10 s watchdog -> decoder recreate, 0.73 fps; issue #28). 1 keeps an LRU hit for freezes.
          const source = new FE.LookaheadFrameSource(pool, { fps: config.fps, capacity: 1 });
          pools.set(id, pool);
          lookahead.set(id, source);
          videoSources.set(id, source);
        }
      }
      this.sources = new Map([...videoSources, ...images]);
      this.timeline = FE.buildResolvedTimelinePlan(normalizedCuts(config.edit), {
        fps: config.fps,
        layers: engineLayers,
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

  // CSS 変数は SVG foreignObject の style="..." 属性へ文字列連結で埋まるので、XML 属性を壊す
  // 4 文字（& " < >）を実体参照にする。legacy の rasterize.mjs escapeAttribute と同じ規律。
  // 例: font_family の "Noto Sans JP" の二重引用符は、素通しすると属性を閉じて SVG 全体が
  // parsererror になり、解像度に関係なく書き出しが失敗する。
  function escapeAttributeValue(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function varsCss(vars) {
    return Object.entries(vars || {})
      .filter(([name]) => /^--[a-z0-9_-]+$/i.test(name))
      .map(([name, value]) => `${name}:${escapeAttributeValue(String(value).replace(/[;{}]/g, ""))}`)
      .join(";");
  }

  function dedupeFontSample(text) {
    const sample = [...new Set(Array.from(text || ""))].join("");
    return sample || "字幕";
  }

  // source.params を data-akari-slot へ注入する（issue #32）。legacy の rasterize.mjs と同じ
  // window.akari.slotParams.renderTextSlots を通し、params の無い断片は文字列をそのまま返す
  // （params 無しの経路のバイト同一性を保つ）。runtime が無いのに params があるのは page-builder の
  // 取りこぼしなので、黙って既定文言を焼かず fail-closed にする。
  function applyTextSlotParams(html, params) {
    if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length === 0) return html;
    const slotParams = window.akari && window.akari.slotParams;
    if (!slotParams || typeof slotParams.renderTextSlots !== "function") {
      throw new Error("text slot params were declared but the slot-params runtime is not loaded");
    }
    const documentValue = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    return slotParams.renderTextSlots(documentValue.body, params).innerHTML;
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
    const svg = foreignObjectSvg(applyTextSlotParams(value.html, value.params), config.width, config.height, css, value.vars);
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
    root.className = CAPTION_MEASURE_ROOT_CLASS;
    root.style.cssText = `position:fixed;left:0;top:0;width:${config.width}px;height:${config.height}px;overflow:hidden;`
      + `background:transparent;container-type:size;visibility:hidden;pointer-events:none;${varsCss(value.vars)}`;
    root.innerHTML = `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}${extraCss}</style>${html}`;
    document.body.appendChild(root);
    return root;
  }

  function captionMeasurementKey(value, config, html, cssVariants, unitIndex) {
    return JSON.stringify([
      config.width,
      config.height,
      varsCss(value.vars),
      html,
      unitIndex,
      cssVariants,
    ]);
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

  async function measureCaptionVariants(value, config, html, cssVariants, unitIndex, startupMetrics) {
    const contentKey = captionMeasurementKey(value, config, html, cssVariants, unitIndex);
    if (startupMetrics.measure.distinctKeys.has(contentKey)) startupMetrics.measure.duplicatePasses += 1;
    else startupMetrics.measure.distinctKeys.add(contentKey);
    const passStarted = performance.now();
    const rootStarted = performance.now();
    const root = captionRoot(value, config, html, cssVariants[0]);
    startupMetrics.measure.rootMs += performance.now() - rootStarted;
    try {
      const styleElement = root.querySelector("style");
      if (!styleElement) throw new Error(`caption ${value.id} measurement style is missing`);
      const typography = root.querySelector(".akari-caption");
      let fontDeclaration = null;
      let fontSample = "字幕";
      if (typography && typeof document.fonts.load === "function") {
        const computed = getComputedStyle(typography);
        fontDeclaration = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        fontSample = dedupeFontSample(typography.textContent);
        const fontLoadStarted = performance.now();
        await document.fonts.load(fontDeclaration, fontSample);
        startupMetrics.measure.fontWaitMs += performance.now() - fontLoadStarted;
      }
      const fontReadyStarted = performance.now();
      await document.fonts.ready;
      startupMetrics.measure.fontWaitMs += performance.now() - fontReadyStarted;
      if (fontDeclaration !== null) {
        const fontCheckKey = `${fontDeclaration}\0${fontSample}`;
        if (!captionFontCheckCache.has(fontCheckKey)) {
          if (!document.fonts.check(fontDeclaration, fontSample)) {
            throw new Error(`caption ${value.id} font is not ready for measurement`);
          }
          captionFontCheckCache.set(fontCheckKey, true);
        }
      }
      const measurements = [];
      for (const css of cssVariants) {
        const layoutStarted = performance.now();
        styleElement.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden}${css}`;
        void root.getBoundingClientRect();
        startupMetrics.measure.variantMeasurements += 1;
        measurements.push(measureCaptionUnit(root, unitIndex));
        startupMetrics.measure.layoutMs += performance.now() - layoutStarted;
      }
      return measurements;
    } finally {
      const rootRemoveStarted = performance.now();
      root.remove();
      startupMetrics.measure.rootMs += performance.now() - rootRemoveStarted;
      startupMetrics.measure.passMs.push(performance.now() - passStarted);
    }
  }

  function captionMeasurementVariantsEqual(left, right) {
    return left.length === right.length
      && left.every((measurement, index) => FE.captionMeasurementsEqual(measurement, right[index]));
  }

  function captionMeasureFaultMatches(fault, id) {
    return fault === "all" || id.startsWith(fault);
  }

  function captionMeasurementVariantsDiff(left, right, context = {}) {
    const differences = [];
    const add = (location, field, previous, current) => {
      if (previous === current) return;
      differences.push({
        cueId: context.cueId ?? null,
        unitIndex: context.unitIndex ?? null,
        variantIndex: location.variantIndex ?? null,
        tokenIndex: location.tokenIndex ?? null,
        rectIndex: location.rectIndex ?? null,
        role: location.role ?? "measurement",
        field,
        previous: serializableMeasurementValue(previous),
        current: serializableMeasurementValue(current),
        delta: typeof previous === "number" && typeof current === "number" ? current - previous : null,
      });
    };
    const diffRect = (previous, current, location) => {
      for (const key of CAPTION_RECT_KEYS) add(location, key, previous[key], current[key]);
    };
    const diffMeasurement = (previous, current, variantIndex) => {
      const measurement = { variantIndex, role: "measurement" };
      add(measurement, "tokens.length", previous.tokens.length, current.tokens.length);
      add(measurement, "lines.length", previous.lines.length, current.lines.length);
      for (const field of ["emPx", "wordCount", "reveal", "revealDelay", "revealDuration"]) {
        add(measurement, field, previous[field], current[field]);
      }
      if (previous.plate === null || previous.plate === undefined
          || current.plate === null || current.plate === undefined) {
        add({ variantIndex, role: "plate" }, "plate", previous.plate, current.plate);
      } else {
        diffRect(previous.plate, current.plate, { variantIndex, role: "plate" });
      }
      const lineCount = Math.min(previous.lines.length, current.lines.length);
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        diffRect(previous.lines[lineIndex], current.lines[lineIndex], {
          variantIndex, role: "line", rectIndex: lineIndex,
        });
      }
      const tokenCount = Math.min(previous.tokens.length, current.tokens.length);
      for (let index = 0; index < tokenCount; index += 1) {
        const before = previous.tokens[index];
        const after = current.tokens[index];
        const location = {
          variantIndex,
          tokenIndex: after.tokenIndex ?? before.tokenIndex ?? index,
          rectIndex: after.rectIndex ?? before.rectIndex ?? null,
          role: after.role ?? before.role ?? "token",
        };
        for (const field of ["tokenIndex", "rectIndex", "role", "style", "lineIndex"]) {
          add(location, field, before[field], after[field]);
        }
        diffRect(before.rect, after.rect, location);
        if (before.timing === null || after.timing === null) {
          add(location, "timing", before.timing, after.timing);
        } else {
          for (const field of ["role", "delaySec", "durationSec", "emPx"]) {
            add(location, `timing.${field}`, before.timing[field], after.timing[field]);
          }
        }
      }
    };
    add({ role: "variants" }, "variants.length", left.length, right.length);
    const variantCount = Math.min(left.length, right.length);
    for (let variantIndex = 0; variantIndex < variantCount; variantIndex += 1) {
      diffMeasurement(left[variantIndex], right[variantIndex], variantIndex);
    }
    return differences;
  }

  function serializableMeasurementValue(value) {
    if (value === undefined) return "__undefined__";
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }

  function summarizeCaptionMeasurementDiffs(differences, limit = CAPTION_MEASURE_DIFF_LIMIT) {
    const sorted = [...differences].sort((left, right) => {
      const leftMagnitude = typeof left.delta === "number" && Number.isFinite(left.delta)
        ? Math.abs(left.delta) : Number.NEGATIVE_INFINITY;
      const rightMagnitude = typeof right.delta === "number" && Number.isFinite(right.delta)
        ? Math.abs(right.delta) : Number.NEGATIVE_INFINITY;
      if (leftMagnitude !== rightMagnitude) return rightMagnitude - leftMagnitude;
      return measurementDiffSortKey(left).localeCompare(measurementDiffSortKey(right));
    });
    const entries = sorted.slice(0, limit);
    return {
      totalCount: differences.length,
      shownCount: entries.length,
      truncated: differences.length > entries.length,
      entries,
    };
  }

  function measurementDiffSortKey(value) {
    return [
      value.cueId ?? "", value.unitIndex ?? -1, value.variantIndex ?? -1,
      value.tokenIndex ?? -1, value.rectIndex ?? -1, value.role ?? "", value.field ?? "",
      JSON.stringify(value.previous), JSON.stringify(value.current),
    ].join("\u0000");
  }

  function resolveStableMeasurement(sequence, maxAttempts, diff) {
    const limit = Math.min(sequence.length, maxAttempts);
    const differences = [];
    for (let index = 1; index < limit; index += 1) {
      const attemptDifferences = diff(sequence[index - 1], sequence[index]);
      if (attemptDifferences.length === 0) {
        return { measurement: sequence[index], attempts: index + 1, differences };
      }
      differences.push(...attemptDifferences.map((entry) => ({
        ...entry,
        previousAttempt: index,
        currentAttempt: index + 1,
      })));
    }
    if (sequence.length >= maxAttempts) {
      const error = new Error(`caption word measurement is unstable after ${maxAttempts} attempts: ${CAPTION_MEASURE_UNSTABLE_REASON}`);
      error.code = CAPTION_MEASURE_UNSTABLE_REASON;
      error.differences = differences;
      throw error;
    }
    return null;
  }

  async function measureCaptionVariantsStable(value, config, html, cssVariants, unitIndex, attemptsLog, differencesLog, startupMetrics) {
    startupMetrics.measure.stableCalls += 1;
    const contentKey = captionMeasurementKey(value, config, html, cssVariants, unitIndex);
    const faultInjected = config.captionMeasureFault
      ? captionMeasureFaultMatches(config.captionMeasureFault, value.id)
      : false;
    // cssVariants は contentKey に入るので、再利用される安定結果は必ず settled 状態
    // （measureSettleCss 付き）で測ったものになる。再利用が採寸の決定論化をすり抜けない。
    if (!faultInjected && startupMetrics.measure.stableResults.has(contentKey)) {
      startupMetrics.measure.reusedStableCalls += 1;
      return startupMetrics.measure.stableResults.get(contentKey);
    }
    const equal = config.captionMeasureFault
      ? (faultInjected ? () => false : captionMeasurementVariantsEqual)
      : captionMeasurementVariantsEqual;
    const sequence = [];
    for (let attempt = 1; attempt <= CAPTION_MEASURE_MAX_ATTEMPTS; attempt += 1) {
      sequence.push(await measureCaptionVariants(value, config, html, cssVariants, unitIndex, startupMetrics));
      try {
        const stable = resolveStableMeasurement(
          sequence,
          CAPTION_MEASURE_MAX_ATTEMPTS,
          (previous, current) => {
            const differences = captionMeasurementVariantsDiff(previous, current, {
              cueId: value.id,
              unitIndex,
            });
            if ((differences.length === 0) !== captionMeasurementVariantsEqual(previous, current)) {
              throw new Error("caption measurement diff drifted from frame-engine strict equality");
            }
            if (differences.length === 0 && !equal(previous, current)) {
              // 故障注入（#120h）は収束を強制的に潰す。差分ログには「注入で潰した」と残し、
              // 空の差分で 32 回黙って回るのを避ける。
              return [{
                cueId: value.id,
                unitIndex,
                variantIndex: null,
                tokenIndex: null,
                rectIndex: null,
                role: "fault",
                field: "captionMeasureFault",
                previous: null,
                current: config.captionMeasureFault,
                delta: null,
              }];
            }
            return differences;
          },
        );
        if (stable) {
          attemptsLog.push(stable.attempts);
          differencesLog.push(...stable.differences);
          startupMetrics.measure.stableResults.set(contentKey, stable.measurement);
          return stable.measurement;
        }
      } catch (error) {
        if (error?.code !== CAPTION_MEASURE_UNSTABLE_REASON) throw error;
        differencesLog.push(...(error.differences ?? []));
        const summary = summarizeCaptionMeasurementDiffs(error.differences ?? []);
        const message = `caption ${value.id} word measurement is unstable after ${CAPTION_MEASURE_MAX_ATTEMPTS} attempts: ${CAPTION_MEASURE_UNSTABLE_REASON}`;
        warn(message);
        error.message = `${message} ${CAPTION_MEASURE_DIFF_MARKER}${encodeURIComponent(JSON.stringify(summary))}`;
        error.code = CAPTION_MEASURE_UNSTABLE_REASON;
        error.captionMeasureDiffs = summary;
        // 実測由来の不安定は最後の採寸値を渡し、#120h の sprite 降格で書き出しを完走させる。
        // 故障注入は「採寸が一切信用できない」不良の代役なので採寸値を渡さない
        // = 降格せず caption-measure-unstable が伝播し、--engine auto の osr フォールバック /
        // 明示 --engine gpu の fail-closed（契約 §12.3）が実物の経路で走る。
        if (!faultInjected) error.lastMeasurement = sequence.at(-1);
        throw error;
      }
    }
    throw new Error(`caption ${value.id} measurement loop terminated unexpectedly`);
  }

  function scopeCaptionCss(css, prefix) {
    if (css.includes("@")) throw new Error("caption variant CSS cannot contain at-rules");
    let out = "";
    let index = 0;
    for (;;) {
      const open = css.indexOf("{", index);
      if (open < 0) {
        out += css.slice(index);
        break;
      }
      const close = css.indexOf("}", open);
      const selectors = css.slice(index, open);
      const body = css.slice(open, close < 0 ? css.length : close + 1);
      out += selectors.split(",").map((one) => one.trim()).filter(Boolean)
        .map((one) => `${prefix} ${one}`).join(",") + body;
      if (close < 0) break;
      index = close + 1;
    }
    return out;
  }

  function matchingBrace(value, open) {
    let depth = 0;
    for (let index = open; index < value.length; index += 1) {
      if (value[index] === "{") depth += 1;
      else if (value[index] === "}" && --depth === 0) return index;
    }
    return -1;
  }

  function removeDuplicateCaptionFontFaces(svg, placeholder = CAPTION_FONT_PLACEHOLDER) {
    let out = "";
    let cursor = 0;
    let keptPlaceholderFace = false;
    for (;;) {
      const start = svg.indexOf("@font-face", cursor);
      if (start < 0) {
        out += svg.slice(cursor);
        break;
      }
      const open = svg.indexOf("{", start);
      if (open < 0) {
        out += svg.slice(cursor);
        break;
      }
      const close = matchingBrace(svg, open);
      if (close < 0) throw new Error("caption @font-face block is unterminated");
      const block = svg.slice(start, close + 1);
      out += svg.slice(cursor, start);
      if (!block.includes(placeholder) || !keptPlaceholderFace) out += block;
      if (block.includes(placeholder)) keptPlaceholderFace = true;
      cursor = close + 1;
    }
    return out;
  }

  function captionRasterBand(value, config, html, sharedCss, bandCss, textureRect, bandIndex, offsetY) {
    const xhtml = serializeHtmlToXhtml(html);
    const prefix = `[data-akari-band="${bandIndex}"]`;
    const scopedBandCss = scopeCaptionCss(bandCss, prefix);
    return `<foreignObject x="0" y="${offsetY}" width="${config.width}" height="${textureRect.height}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${config.width}px;height:${textureRect.height}px;overflow:hidden">
        <div class="akari-sprite-root" data-akari-band="${bandIndex}" style="position:absolute;left:0;top:${-textureRect.y}px;width:${config.width}px;height:${config.height}px;overflow:hidden;background:transparent;container-type:size;${varsCss(value.vars)}">
          <style>html,body{margin:0;width:${config.width}px;height:${config.height}px;overflow:hidden}${sharedCss}${scopedBandCss}</style>${xhtml}
        </div>
      </div>
    </foreignObject>`;
  }

  function captionRasterSvg(value, config, html, sharedCss, bandCss, textureRect) {
    const xhtml = serializeHtmlToXhtml(html);
    const scopedBandCss = scopeCaptionCss(bandCss, `[data-akari-band="0"]`);
    return removeDuplicateCaptionFontFaces(`<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${textureRect.height}" viewBox="0 ${textureRect.y} ${config.width} ${textureRect.height}">
      <foreignObject x="0" y="0" width="${config.width}" height="${config.height}">
        <div xmlns="http://www.w3.org/1999/xhtml" class="akari-sprite-root" data-akari-band="0" style="position:relative;width:${config.width}px;height:${config.height}px;overflow:hidden;background:transparent;container-type:size;${varsCss(value.vars)}">
          <style>html,body{margin:0;width:${config.width}px;height:${config.height}px;overflow:hidden}${sharedCss}${scopedBandCss}</style>${xhtml}
        </div>
      </foreignObject>
    </svg>`);
  }

  function captionBatchRasterSvg(batch, config) {
    let offsetY = 0;
    let bandIndex = 0;
    const bands = [];
    for (const unit of batch.units.filter((entry) => !entry.released)) {
      for (const [stateIndex, bandCss] of unit.bandCss.entries()) {
        bands.push({ unit, stateIndex, bandCss, bandIndex, offsetY, height: unit.textureRect.height });
        offsetY += unit.textureRect.height;
        bandIndex += 1;
      }
    }
    const body = bands.map(({ unit, bandCss, bandIndex: index, offsetY: y }) => captionRasterBand(
      unit.value,
      config,
      unit.html,
      unit.sharedCss,
      bandCss,
      unit.textureRect,
      index,
      y,
    )).join("");
    return {
      svg: removeDuplicateCaptionFontFaces(`<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${offsetY}" viewBox="0 0 ${config.width} ${offsetY}">${body}</svg>`),
      bands,
      height: offsetY,
    };
  }

  function assertCaptionSvg(svg, id) {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const parserError = parsed.querySelector("parsererror");
    if (parserError) throw new Error(`caption ${id} SVG parsererror: ${parserError.textContent}`);
  }

  function assignCaptionImageSource(image, svg, encodedFont) {
    const parts = svg.split(CAPTION_FONT_PLACEHOLDER);
    if (parts.length > 2) throw new Error("caption SVG contains duplicate embedded font placeholders");
    image.src = "data:image/svg+xml;charset=utf-8," + parts.map(encodeURIComponent).join(encodedFont);
  }

  async function decodeCaptionSvg(svg, id, startupMetrics) {
    const image = new Image();
    image.decoding = "sync";
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`caption ${id} image load failed`));
    });
    const encodedFont = await embeddedCaptionFont(startupMetrics);
    const srcAssignStarted = performance.now();
    assignCaptionImageSource(image, svg, encodedFont);
    startupMetrics.raster.srcAssignMs += performance.now() - srcAssignStarted;
    const decodeStarted = performance.now();
    await loaded;
    startupMetrics.raster.decodeMs += performance.now() - decodeStarted;
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error(`caption ${id} decoded empty`);
    }
    return image;
  }

  async function rasterizeCaptionBatch(batch, config, spriteCompositor, startupMetrics) {
    if (batch.registered) throw new Error(`caption batch cannot be registered twice: ${batch.index}`);
    const svgBuildStarted = performance.now();
    const raster = captionBatchRasterSvg(batch, config);
    startupMetrics.raster.svgBuildMs += performance.now() - svgBuildStarted;
    startupMetrics.raster.svgChars += raster.svg.length;
    const assertStarted = performance.now();
    assertCaptionSvg(raster.svg, `batch-${batch.index}`);
    startupMetrics.raster.assertMs += performance.now() - assertStarted;
    const image = await decodeCaptionSvg(raster.svg, `batch-${batch.index}`, startupMetrics);
    const sheetDrawStarted = performance.now();
    const sheet = document.createElement("canvas");
    sheet.width = config.width;
    sheet.height = raster.height;
    const sheetContext = sheet.getContext("2d", { alpha: true });
    if (!sheetContext) throw new Error("caption sheet 2D canvas is unavailable");
    sheetContext.clearRect(0, 0, sheet.width, sheet.height);
    sheetContext.drawImage(image, 0, 0);
    startupMetrics.raster.sheetDrawMs += performance.now() - sheetDrawStarted;
    const registeredUnits = new Set();
    for (const band of raster.bands) {
      const unit = band.unit;
      if (unit.released) continue;
      const id = band.stateIndex === 0 ? unit.id : unit.secondaryId;
      if (!id) throw new Error(`caption unit secondary id is missing: ${unit.id}`);
      const drawImageStarted = performance.now();
      const canvas = document.createElement("canvas");
      canvas.width = config.width;
      canvas.height = band.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("caption 2D canvas is unavailable");
      context.clearRect(0, 0, config.width, band.height);
      context.drawImage(sheet, 0, band.offsetY, config.width, band.height, 0, 0, config.width, band.height);
      startupMetrics.raster.drawImageMs += performance.now() - drawImageStarted;
      const registerStarted = performance.now();
      spriteCompositor.registerSprite(id, canvas);
      startupMetrics.raster.registerMs += performance.now() - registerStarted;
      canvas.width = 0;
      canvas.height = 0;
      registeredUnits.add(unit);
    }
    sheet.width = 0;
    sheet.height = 0;
    image.src = "";
    for (const unit of batch.units) {
      if (registeredUnits.has(unit)) unit.registered = true;
      unit.html = "";
      unit.sharedCss = "";
      unit.bandCss = [];
      unit.value = null;
    }
    batch.registered = true;
    return { units: registeredUnits.size, bands: raster.bands.length };
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
    unit.sharedCss = "";
    unit.bandCss = [];
    unit.value = null;
  }

  async function buildCaptionUnits(value, config, attemptsLog, differencesLog, startupMetrics) {
    const html = captionHtmlWithUnitMarkers(value.html);
    const settled = value.motion?.in?.duration_sec ?? value.motion?.in?.durationSec ?? 0.18;
    const settleCss = `*{animation-play-state:paused!important;animation-delay:-${Math.max(0, Number(settled) || 0)}s!important}`;
    // 採寸はラスタと同じ settled 状態で行う。settle していないと plate の入場アニメ
    // （akari-caption-fade が 0.18em 縦に動かす）が生きたまま採寸され、毎回別の時点を
    // サンプルするので厳密一致が 32 回でも収束しない。許容差を広げるのではなく
    // 揺らぎの発生源を止める。
    const measureSettleCss = `.${CAPTION_MEASURE_ROOT_CLASS} *{animation-play-state:paused!important;animation-delay:-${Math.max(0, Number(settled) || 0)}s!important}`;
    const probe = captionRoot(value, config, html, `${CAPTION_WORD_FREEZE_CSS}${measureSettleCss}`);
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
      const unitCss = `${CAPTION_WORD_FREEZE_CSS}${measureSettleCss}${captionUnitCss(revealIndex)}`;
      const id = `${value.id}::unit-${unitIndex}`;
      let secondaryId = null;
      let bandCss;
      let tiles = null;
      let unitMeasurement = null;
      let mode = "sprite";
      let degraded = false;
      try {
        const [probeMeasurement] = await measureCaptionVariantsStable(
          value, config, html, [unitCss], unitIndex, attemptsLog, differencesLog, startupMetrics,
        );
        unitMeasurement = probeMeasurement;
        const roles = new Set(probeMeasurement.tokens.map((token) => token.role));
        const hasColor = roles.has("karaoke");
        const hasGeometry = ["pop", "reveal-word", "emphasis-bang", "emphasis-pulse"].some((role) => roles.has(role));
        if (hasColor && hasGeometry) throw new Error(`caption ${value.id} contains mixed color and geometry word roles`);
        mode = hasColor ? "color" : hasGeometry ? "geometry" : "sprite";
        if (mode === "color") {
          const baseCss = `${captionUnitCss(revealIndex)}.akari-caption__tok--karaoke{color:var(--caption-color,#fff)!important}`;
          const highlightCss = `${captionUnitCss(revealIndex)}.akari-caption__tok--karaoke{color:var(--caption-highlight-color,#ffd94a)!important}`;
          const [baseMeasurement, highlightMeasurement] = await measureCaptionVariantsStable(
            value,
            config,
            html,
            [`${CAPTION_WORD_FREEZE_CSS}${measureSettleCss}${baseCss}`, `${CAPTION_WORD_FREEZE_CSS}${measureSettleCss}${highlightCss}`],
            unitIndex,
            attemptsLog,
            differencesLog,
            startupMetrics,
          );
          // Keep the strict threshold: measuring variants in one root removes insertion jitter
          // instead of hiding a real layout mismatch by widening the tolerance.
          layoutMaxDeltaPx = Math.max(layoutMaxDeltaPx, compareCaptionLayouts(baseMeasurement, highlightMeasurement, id));
          unitMeasurement = baseMeasurement;
          bandCss = [`${settleCss}${baseCss}`, `${settleCss}${highlightCss}`];
          secondaryId = `${id}::b`;
        } else if (mode === "geometry") {
          const plateCss = `${captionUnitCss(revealIndex)}.akari-caption__tok,.akari-caption__emphasis-char{visibility:hidden!important}`;
          const textCss = `${captionUnitCss(revealIndex)}.akari-caption__line,.akari-caption__block{background:transparent!important}`
            + `.akari-caption__line::before{background:transparent!important}`;
          const [plateMeasurement, textMeasurement] = await measureCaptionVariantsStable(
            value,
            config,
            html,
            [`${CAPTION_WORD_FREEZE_CSS}${measureSettleCss}${plateCss}`, `${CAPTION_WORD_FREEZE_CSS}${measureSettleCss}${textCss}`],
            unitIndex,
            attemptsLog,
            differencesLog,
            startupMetrics,
          );
          layoutMaxDeltaPx = Math.max(layoutMaxDeltaPx, compareCaptionLayouts(plateMeasurement, textMeasurement, id));
          unitMeasurement = plateMeasurement;
          bandCss = [`${settleCss}${plateCss}`, `${settleCss}${textCss}`];
          secondaryId = `${id}::b`;
        } else {
          bandCss = [`${settleCss}${captionUnitCss(revealIndex)}`];
        }
      } catch (error) {
        if (error?.code !== CAPTION_MEASURE_UNSTABLE_REASON) throw error;
        unitMeasurement = error.lastMeasurement?.[0] ?? unitMeasurement;
        if (!unitMeasurement) throw error;
        mode = "sprite";
        secondaryId = null;
        bandCss = [`${settleCss}${captionUnitCss(revealIndex)}`];
        degraded = true;
        startupMetrics.measure.degradedUnits += 1;
        warn(`caption ${value.id} unit ${unitIndex} degraded to sprite: ${CAPTION_MEASURE_UNSTABLE_REASON}`);
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
        sharedCss: CAPTION_WORD_FREEZE_CSS,
        bandCss,
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
        degraded,
        registered: false,
        released: false,
      });
    }
    return { units, layoutMaxDeltaPx };
  }

  function buildCaptionBatches(units, maxUnits = CAPTION_BATCH_MAX_UNITS, maxHeight = CAPTION_BATCH_MAX_HEIGHT_PX) {
    const batches = [];
    let current = null;
    for (const unit of units) {
      const height = unit.textureRect.height * unit.bandCss.length;
      if (height > maxHeight) throw new Error(`caption unit ${unit.id} exceeds batch height ${maxHeight}`);
      if (current === null || current.units.length >= maxUnits || current.height + height > maxHeight) {
        current = { index: batches.length, units: [], height: 0, registered: false };
        batches.push(current);
      }
      unit.batchIndex = current.index;
      current.units.push(unit);
      current.height += height;
    }
    return batches;
  }

  function embeddedCaptionFont(startupMetrics) {
    const encodeStarted = captionEncodedFontPromise === null ? performance.now() : null;
    captionEncodedFontPromise ??= (async () => {
      const response = await fetch("/caption-font.ttf");
      if (!response.ok) throw new Error(`caption font fetch failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      const encoded = encodeURIComponent(`data:font/ttf;base64,${btoa(binary)}`);
      startupMetrics.fontEncodeMs = performance.now() - encodeStarted;
      startupMetrics.fontBase64Bytes = encoded.length;
      return encoded;
    })();
    return captionEncodedFontPromise;
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

  function summarizeAttempts(values) {
    if (values.length === 0) return { count: 0, p50: null, max: null };
    const sorted = [...values].sort((left, right) => left - right);
    return { count: values.length, p50: sorted[Math.floor((sorted.length - 1) * 0.5)], max: sorted.at(-1) };
  }

  function createCaptionStartupMetrics(faultInjected) {
    return {
      totalMs: 0,
      fontEncodeMs: 0,
      fontBase64Bytes: 0,
      measure: {
        stableCalls: 0,
        reusedStableCalls: 0,
        passMs: [],
        variantMeasurements: 0,
        fontWaitMs: 0,
        layoutMs: 0,
        rootMs: 0,
        distinctKeys: new Set(),
        duplicatePasses: 0,
        degradedUnits: 0,
        faultInjected,
        stableResults: new Map(),
      },
      raster: {
        batches: 0,
        bands: 0,
        units: 0,
        svgBuildMs: 0,
        svgChars: 0,
        assertMs: 0,
        srcAssignMs: 0,
        decodeMs: 0,
        sheetDrawMs: 0,
        drawImageMs: 0,
        registerMs: 0,
        totalMs: 0,
        prefetchedBatches: 0,
        prefetchMs: 0,
      },
    };
  }

  function summarizeCaptionStartup(metrics) {
    const passes = summarize(metrics.measure.passMs);
    return {
      totalMs: metrics.totalMs,
      fontEncodeMs: metrics.fontEncodeMs,
      fontBase64Bytes: metrics.fontBase64Bytes,
      measure: {
        stableCalls: metrics.measure.stableCalls,
        reusedStableCalls: metrics.measure.reusedStableCalls,
        passes: passes.count,
        variantMeasurements: metrics.measure.variantMeasurements,
        totalMs: metrics.measure.passMs.reduce((total, value) => total + value, 0),
        p50: passes.p50,
        p95: passes.p95,
        max: metrics.measure.passMs.length > 0 ? Math.max(...metrics.measure.passMs) : null,
        fontWaitMs: metrics.measure.fontWaitMs,
        layoutMs: metrics.measure.layoutMs,
        rootMs: metrics.measure.rootMs,
        distinctKeys: metrics.measure.distinctKeys.size,
        duplicatePasses: metrics.measure.duplicatePasses,
        degradedUnits: metrics.measure.degradedUnits,
        faultInjected: metrics.measure.faultInjected,
      },
      raster: { ...metrics.raster },
    };
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

  function threeEntranceStateAt(entrance, localSeconds) {
    const duration = Number(entrance.durationSec);
    const delay = Number(entrance.delaySec);
    const progress = Math.max(0, Math.min(1, (localSeconds - delay) / duration));
    const eased = entrance.timing === "linear"
      ? progress
      : FE.cubicBezierAt(
        progress,
        entrance.timing.x1,
        entrance.timing.y1,
        entrance.timing.x2,
        entrance.timing.y2,
      );
    const interpolate = (key) => entrance.from[key] + (entrance.to[key] - entrance.from[key]) * eased;
    return {
      opacity: interpolate("opacity"),
      translateX: interpolate("tx"),
      translateY: interpolate("ty"),
      scaleX: interpolate("sx"),
      scaleY: interpolate("sy"),
    };
  }

  function orderedSpriteDraws(manifest, seconds, domRuntime) {
    const values = [];
    for (const value of manifest.statics) {
      const z = Number.isInteger(value.z) && value.z >= 0 ? value.z : 0;
      if (activeAt(value, seconds)) values.push({ z, index: value.index, id: value.id, opacity: 1 });
    }
    for (const value of manifest.three) {
      if (!activeAt(value, seconds)) continue;
      const state = value.entrance
        ? threeEntranceStateAt(value.entrance, seconds - value.start)
        : { opacity: 1 };
      const z = Number.isInteger(value.z) && value.z >= 0 ? value.z : 0;
      values.push({ z, index: value.index, id: value.id, ...state });
    }
    for (const run of manifest.dom ?? []) {
      const z = Number.isInteger(run.z) && run.z >= 0 ? run.z : 0;
      if (domRuntime.activeAt(run, seconds)) values.push({ z, index: run.index, id: run.runId, opacity: 1 });
    }
    return values.sort((left, right) => (left.z - right.z) || (left.index - right.index));
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
          const declaration = (this.config.edit?.overlays ?? [])
            .find((overlay) => String(overlay?.id) === String(entry.id));
          const container = document.createElement("div");
          container.className = "akari-dom-container scene clip";
          container.dataset.overlayId = entry.id;
          container.dataset.start = String(entry.start);
          container.dataset.duration = String(entry.duration);
          if (entry.params && typeof entry.params === "object") container.dataset.akariParams = JSON.stringify(entry.params);
          styleVariables(container, entry.vars);
          const content = document.createElement("div");
          content.className = "scene-content";
          content.insertAdjacentHTML("beforeend", applyTextSlotParams(entry.html, entry.params));
          container.appendChild(content);
          root.appendChild(container);
          containers.push({
            entry,
            container,
            ...(Array.isArray(declaration?.keyframes) ? {
              itemKeyframes: {
                points: declaration.keyframes,
                statics: {
                  x: Number(declaration.transform?.x ?? 0),
                  y: Number(declaration.transform?.y ?? 0),
                  scale: Number(declaration.transform?.scale ?? 1),
                  rotate: Number(declaration.transform?.rotate ?? 0),
                  opacity: Number(declaration.opacity ?? 1),
                },
                isBackground: declaration.role === "background",
              },
            } : {}),
          });
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
      for (const { entry, container, itemKeyframes } of record.containers) {
        const active = activeAt(entry, seconds);
        container.style.visibility = active ? "visible" : "hidden";
        container.toggleAttribute("data-akari-active", active);
        if (!active) continue;
        if (itemKeyframes) {
          const state = window.akari.keyframes.interpolateKeyframes(
            itemKeyframes.points,
            Math.max(0, seconds - entry.start) * Number(this.config.fps),
            { statics: itemKeyframes.statics },
          );
          const background = itemKeyframes.isBackground;
          container.style.setProperty("--x", background ? "0px" : `${state.x}px`);
          container.style.setProperty("--y", background ? "0px" : `${state.y}px`);
          container.style.setProperty("--scale", background ? "1" : String(state.scale));
          container.style.setProperty("--rotate", background ? "0deg" : `${state.rotate}deg`);
          container.style.setProperty("opacity", String(state.opacity));
        }
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

  window.__akariGpuDomInternals = {
    sentinelColor, chooseSettlePolicy, runActiveAt, threeEntranceStateAt, orderedSpriteDraws,
  };

  window.__akariGpuRun = async function () {
    if (!FE || !bridge) throw new Error("GPU page dependencies are unavailable");
    const runtimeConfig = await bridge.config();
    const config = { ...pageConfig, ...runtimeConfig };
    const captureMode = Array.isArray(config.captureFrames);
    const dumpFrameNumbers = new Set(config.dumpFrames ?? []);
    const frameSequence = captureMode ? [...config.captureFrames] : null;
    const sequenceLength = captureMode ? frameSequence.length : config.frames;
    if (config.trapReadback && (config.verifyFrames || dumpFrameNumbers.size > 0)) {
      throw new Error("trapReadback and verification readback are mutually exclusive");
    }
    if (captureMode && config.trapReadback) throw new Error("GPU capture cannot trap its required readback");
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
    const stages = { evaluate: [], three: [], dom: [], captionRaster: [], captionRasterBatch: [], captions: [], composite: [], encode: [], backpressure: [] };
    const frameHashes = [];
    const threeRecords = new Map();
    const captionUnits = [];
    const captionRecords = [];
    const captionMeasureAttemptValues = [];
    const captionMeasurementDifferences = [];
    const captionStartupMetrics = createCaptionStartupMetrics(Boolean(config.captionMeasureFault));
    let captionBatches = [];
    let captionRasterTotalMs = 0;
    const captionRasterBatchMetrics = { batches: 0, unitsPerBatchMax: 0, bandsMax: 0 };
    const captureOutputs = [];
    let captionLayoutMaxDeltaPx = 0;
    let threeRuntime = null;
    let queueWaits = 0;
    let encoder = null;
    let encodeCanvas = null;
    let supported = false;
    let hashFrame = null;
    let captureFrame = null;
    let drawTimingProbe = null;
    let domRuntime = null;
    const renderer = collectRendererInfo(engine.canvas);
    let encoderSupport = null;
    const started = performance.now();
    try {
      for (const value of config.spriteManifest.statics) {
        spriteCompositor.registerSprite(value.id, await rasterizeSprite(value, config));
      }
      for (const value of config.spriteManifest.captions) {
        const captionBuildStarted = performance.now();
        const built = await buildCaptionUnits(
          value,
          config,
          captionMeasureAttemptValues,
          captionMeasurementDifferences,
          captionStartupMetrics,
        );
        captionStartupMetrics.totalMs += performance.now() - captionBuildStarted;
        captionLayoutMaxDeltaPx = Math.max(captionLayoutMaxDeltaPx, built.layoutMaxDeltaPx);
        let rasters = 0;
        let tiles = 0;
        let words = 0;
        let degradedUnits = 0;
        for (const unit of built.units) {
          unit.z = Number.isInteger(value.z) && value.z >= 0 ? value.z : 0;
          unit.index = Number.isInteger(value.index) && value.index >= 0 ? value.index : 0;
          rasters += unit.bandCss.length;
          tiles += unit.tiles?.length ?? 0;
          words += unit.wordCount;
          if (unit.degraded) degradedUnits += 1;
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
          bands: rasters,
          tiles,
          degradedUnits,
        });
        value.html = "";
      }
      captionUnits.sort((left, right) => left.cueStart - right.cueStart);
      const captionBatchBuildStarted = performance.now();
      captionBatches = buildCaptionBatches(captionUnits);
      captionStartupMetrics.totalMs += performance.now() - captionBatchBuildStarted;
      let captionPrefetchBytes = 0;
      for (const batch of captionBatches) {
        const estimatedBytes = batch.units.reduce(
          (total, unit) => total + config.width * unit.textureRect.height * unit.bandCss.length * 4,
          0,
        );
        if (captionPrefetchBytes + estimatedBytes > CAPTION_PREFETCH_MAX_BYTES) continue;
        captionPrefetchBytes += estimatedBytes;
        const prefetchStarted = performance.now();
        const registered = await rasterizeCaptionBatch(batch, config, spriteCompositor, captionStartupMetrics);
        const elapsed = performance.now() - prefetchStarted;
        captionRasterTotalMs += elapsed;
        captionRasterBatchMetrics.batches += 1;
        captionRasterBatchMetrics.unitsPerBatchMax = Math.max(
          captionRasterBatchMetrics.unitsPerBatchMax,
          registered.units,
        );
        captionRasterBatchMetrics.bandsMax = Math.max(captionRasterBatchMetrics.bandsMax, registered.bands);
        captionStartupMetrics.raster.batches += 1;
        captionStartupMetrics.raster.bands += registered.bands;
        captionStartupMetrics.raster.units += registered.units;
        captionStartupMetrics.raster.totalMs += elapsed;
        captionStartupMetrics.raster.prefetchedBatches += 1;
        captionStartupMetrics.raster.prefetchMs += elapsed;
        if (registered.units <= 0) throw new Error(`caption batch registered no units: ${batch.index}`);
        await yieldMacrotask();
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
      if (config.verifyFrames || captureMode || dumpFrameNumbers.size > 0) {
        const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(config.verifyReadbackModule)}`;
        verifyModule = await import(moduleUrl);
        captureFrame = verifyModule.readbackCanvasFrame;
        if (config.verifyFrames) hashFrame = verifyModule.hashCanvasFrame;
        if (config.verifyFrames && typeof verifyModule.createSpriteDrawTimingProbe === "function") {
          const timingGl = finalCanvas.getContext("webgl2");
          if (!timingGl) throw new Error("sprite draw timing WebGL2 context is unavailable");
          drawTimingProbe = verifyModule.createSpriteDrawTimingProbe(timingGl);
          spriteCompositor.setDrawProbe(drawTimingProbe);
        }
      }
      const sentinelVerifier = config.verifyFrames && config.spriteManifest.dom?.length > 0
        ? verifyModule.createDomLayerSentinelVerifier(config.width, config.height)
        : null;
      domRuntime = new DomLayerRuntime(config, config.spriteManifest.dom, spriteCompositor, sentinelVerifier);
      await domRuntime.mount();
      const hardwareAcceleration = config.soft ? "prefer-software" : "prefer-hardware";
      encoderSupport = captureMode ? null : await collectEncoderSupport(config);
      supported = captureMode || encoderSupport[hardwareAcceleration];
      if (!captureMode && supported) {
        const encodeWidth = config.outputWidth ?? config.width;
        const encodeHeight = config.outputHeight ?? config.height;
        await bridge.startChunks({ width: encodeWidth, height: encodeHeight, fps: config.fps, frames: config.frames, codec: config.codec ?? "h264" });
        encoder = new FE.WebCodecsH264Encoder({
          write: (bytes, chunk) => bridge.writeChunk({ bytes, ...chunk }),
        }, {
          width: encodeWidth,
          height: encodeHeight,
          fps: config.fps,
          bitrate: config.bitrate,
          keyframeIntervalFrames: config.fps * 2,
          hardwareAcceleration,
          codec: config.codec ?? "h264",
        });
      } else if (!captureMode && !config.verifyFrames) {
        // 失敗時の run.json が renderer を捨てないよう、診断（renderer / encoder_support）を error に添える。
        // executeJavaScript の reject で main へ渡るとき Error の付随プロパティは落ちるため、captionMeasureDiffs と同じく
        // メッセージ末尾に marker + encodeURIComponent(JSON) も付ける（main 側 extractGpuDiagnostics が両方を見る）。
        const gpuDiagnostics = { renderer, encoder_support: encoderSupport };
        const codecLabel = config.codec === "hevc" ? "HEVC" : "H.264";
        const reason = config.codec === "hevc" ? `${HEVC_UNSUPPORTED_REASON}: ` : "";
        const unsupported = new Error(
          `${reason}WebCodecs ${codecLabel} config is unsupported: ${hardwareAcceleration} (${describeEncoderTarget(config)})`
          + ` renderer=${renderer?.renderer ?? "unknown"}`
          + ` ${GPU_DIAGNOSTICS_MARKER}${encodeURIComponent(JSON.stringify(gpuDiagnostics))}`,
        );
        unsupported.gpuDiagnostics = gpuDiagnostics;
        throw unsupported;
      }
      for (let sequenceIndex = 0; sequenceIndex < sequenceLength; sequenceIndex += 1) {
        const frameNumber = captureMode ? frameSequence[sequenceIndex] : sequenceIndex;
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
          for (const unit of captionUnits) {
            if (seconds >= unit.cueStart + unit.cueDuration) {
              releaseCaptionUnit(unit, spriteCompositor);
            }
            if (seconds < unit.cueStart || seconds >= unit.cueStart + unit.cueDuration) continue;
            if (!unit.registered) {
              const batch = captionBatches[unit.batchIndex];
              if (!batch) throw new Error(`caption batch is missing: ${unit.batchIndex}`);
              if (!batch.registered) {
                const rasterStarted = performance.now();
                const registered = await rasterizeCaptionBatch(batch, config, spriteCompositor, captionStartupMetrics);
                const elapsed = performance.now() - rasterStarted;
                stages.captionRasterBatch.push(elapsed);
                captionRasterTotalMs += elapsed;
                captionRasterBatchMetrics.batches += 1;
                captionRasterBatchMetrics.unitsPerBatchMax = Math.max(
                  captionRasterBatchMetrics.unitsPerBatchMax,
                  registered.units,
                );
                captionRasterBatchMetrics.bandsMax = Math.max(captionRasterBatchMetrics.bandsMax, registered.bands);
                captionStartupMetrics.raster.batches += 1;
                captionStartupMetrics.raster.bands += registered.bands;
                captionStartupMetrics.raster.units += registered.units;
                captionStartupMetrics.raster.totalMs += elapsed;
                if (registered.units <= 0) throw new Error(`caption batch registered no units: ${batch.index}`);
                for (let index = 0; index < registered.units; index += 1) {
                  stages.captionRaster.push(elapsed / registered.units);
                }
                await yieldMacrotask();
              }
              if (!unit.registered) throw new Error(`caption batch did not register active unit: ${unit.id}`);
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
              draws.push({ z: unit.z, index: unit.index, id: unit.id, textureRect: unit.textureRect, ...state });
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
              draws.push({ z: unit.z, index: unit.index, id: unit.id, textureRect: unit.textureRect, ...state });
              draws.push({ z: unit.z, index: unit.index, id: unit.secondaryId, textureRect: unit.textureRect, tiles, ...state });
            } else {
              draws.push({
                z: unit.z,
                index: unit.index,
                id: unit.id,
                secondaryId: unit.secondaryId,
                textureRect: unit.textureRect,
                tiles,
                ...state,
              });
            }
          }
          const compositeStarted = performance.now();
          const orderedDraws = draws
            .sort((left, right) => (left.z - right.z) || (left.index - right.index))
            .map(({ z, index, ...draw }) => draw);
          spriteCompositor.compose(frame.surface.canvas, orderedDraws);
          stages.composite.push(performance.now() - compositeStarted);
          if (captionUnits.length > 0) stages.captions.push(compositeStarted - captionStarted);
          if (hashFrame) frameHashes.push(await hashFrame(finalCanvas));
          if (captureMode) {
            if (typeof captureFrame !== "function") throw new Error("GPU capture readback module is unavailable");
            const rgba = await captureFrame(FE, frame, finalCanvas);
            captureOutputs.push(await bridge.writeCaptureFrame({ frameNumber, rgba }));
          }
          if (encoder) {
            if (dumpFrameNumbers.has(frameNumber)) {
              if (typeof captureFrame !== "function") throw new Error("GPU dump readback module is unavailable");
              // readbackCanvasFrame converts WebGL's bottom-up rows to top-to-bottom RGBA8.
              const rgba = await captureFrame(FE, frame, finalCanvas);
              await bridge.writeDumpFrame({ frameNumber, rgba });
            }
            const encodeStarted = performance.now();
            encodeCanvas = scaleSurfaceForEncode(finalCanvas, config, encodeCanvas);
            encoder.encode({ ...frame, surface: { ...frame.surface, canvas: encodeCanvas } });
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
        if ((sequenceIndex + 1) % 30 === 0 || sequenceIndex + 1 === sequenceLength) {
          await bridge.checkpoint({
            status: "running",
            framesCompleted: sequenceIndex + 1,
            framesRequested: captureMode ? frameSequence : config.frames,
            stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, summarize(values)])),
            gpu: {
              renderer,
              encoder_support: encoderSupport,
              uploadPath: spriteCompositor.uploadPath,
              quality: config.quality,
              bitrate: config.bitrate,
              codec: config.codec ?? "h264",
              queueDepth: config.queueDepth,
              queueWaits,
              glTiming: drawTimingProbe ? drawTimingProbe.summary() : null,
              readbackCounters: counters,
              captions: captionRecords,
              captionLayoutMaxDeltaPx,
              captionMeasureAttempts: summarizeAttempts(captionMeasureAttemptValues),
              captionMeasureDiffs: summarizeCaptionMeasurementDiffs(captionMeasurementDifferences),
              captionRasterTotalMs,
              captionRasterBatches: captionRasterBatchMetrics,
              captionStartup: summarizeCaptionStartup(captionStartupMetrics),
            },
            domLayer: domRuntime.summary(),
          });
        }
      }
      const encoderFinish = encoder ? await encoder.finish() : null;
      const mux = encoder ? await bridge.finishChunks({ encoderFinish }) : null;
      return {
        status: supported ? "completed" : "unsupported",
        ...(captureMode ? { operation: "capture" } : {}),
        framesRequested: captureMode ? frameSequence : config.frames,
        framesCompleted: sequenceLength,
        ...(captureMode ? {
          outputs: captureOutputs,
          verify: {
            mode: "frame-engine-readback",
            matched: captureOutputs.length === frameSequence.length,
            frameNumbers: frameSequence,
          },
        } : {}),
        frameHashes,
        elapsedMs: performance.now() - started,
        stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => [name, summarize(values)])),
        frameEngineMetrics: engine.metrics.toJSON(),
        gpu: {
          encoder: supported ? "WebCodecsH264Encoder" : "unsupported",
          hardware: hardwareAcceleration,
          renderer,
          encoder_support: encoderSupport,
          uploadPath: spriteCompositor.uploadPath,
          quality: config.quality,
          bitrate: config.bitrate,
          codec: config.codec ?? "h264",
          queueDepth: config.queueDepth,
          queueWaits,
          glTiming: drawTimingProbe ? drawTimingProbe.summary() : null,
          trapReadback: Boolean(config.trapReadback),
          readbackCounters: counters,
          captions: captionRecords,
          captionLayoutMaxDeltaPx,
          captionMeasureAttempts: summarizeAttempts(captionMeasureAttemptValues),
          captionMeasureDiffs: summarizeCaptionMeasurementDiffs(captionMeasurementDifferences),
          captionRasterTotalMs,
          captionRasterBatches: captionRasterBatchMetrics,
          captionStartup: summarizeCaptionStartup(captionStartupMetrics),
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
