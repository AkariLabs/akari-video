(function () {
  "use strict";

  const pageConfig = window.__AKARI_GPU_CONFIG__;
  const FE = window.AkariFrameEngine;
  const bridge = window.akariGpu;
  const warnings = [];
  const pools = new Map();
  const lookahead = new Map();
  const images = new Map();
  let captionEncodedFontPromise = null;

  const CAPTION_MEASURE_MAX_ATTEMPTS = 32;
  const CAPTION_MEASURE_UNSTABLE_REASON = "caption-measure-unstable";
  const CAPTION_BATCH_MAX_UNITS = 8;
  const CAPTION_BATCH_MAX_HEIGHT_PX = 4096;
  const CAPTION_FONT_PLACEHOLDER = "/caption-font.ttf";

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

  function captionMeasurementVariantsEqual(left, right) {
    return left.length === right.length
      && left.every((measurement, index) => FE.captionMeasurementsEqual(measurement, right[index]));
  }

  function resolveStableMeasurement(sequence, maxAttempts, equal) {
    const limit = Math.min(sequence.length, maxAttempts);
    for (let index = 1; index < limit; index += 1) {
      if (equal(sequence[index - 1], sequence[index])) {
        return { measurement: sequence[index], attempts: index + 1 };
      }
    }
    if (sequence.length >= maxAttempts) {
      const error = new Error(`caption word measurement is unstable after ${maxAttempts} attempts: ${CAPTION_MEASURE_UNSTABLE_REASON}`);
      error.code = CAPTION_MEASURE_UNSTABLE_REASON;
      throw error;
    }
    return null;
  }

  async function measureCaptionVariantsStable(value, config, html, cssVariants, unitIndex, attemptsLog) {
    const sequence = [];
    for (let attempt = 1; attempt <= CAPTION_MEASURE_MAX_ATTEMPTS; attempt += 1) {
      sequence.push(await measureCaptionVariants(value, config, html, cssVariants, unitIndex));
      try {
        const stable = resolveStableMeasurement(
          sequence,
          CAPTION_MEASURE_MAX_ATTEMPTS,
          captionMeasurementVariantsEqual,
        );
        if (stable) {
          attemptsLog.push(stable.attempts);
          return stable.measurement;
        }
      } catch (error) {
        const message = `caption ${value.id} word measurement is unstable after ${CAPTION_MEASURE_MAX_ATTEMPTS} attempts: ${CAPTION_MEASURE_UNSTABLE_REASON}`;
        warn(message);
        error.message = message;
        error.code = CAPTION_MEASURE_UNSTABLE_REASON;
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

  async function rasterizeCaptionBatch(batch, config, spriteCompositor) {
    if (batch.registered) throw new Error(`caption batch cannot be registered twice: ${batch.index}`);
    const raster = captionBatchRasterSvg(batch, config);
    assertCaptionSvg(raster.svg, `batch-${batch.index}`);
    const image = await decodeCaptionSvg(raster.svg, `batch-${batch.index}`);
    const registeredUnits = new Set();
    for (const band of raster.bands) {
      const unit = band.unit;
      if (unit.released) continue;
      const id = band.stateIndex === 0 ? unit.id : unit.secondaryId;
      if (!id) throw new Error(`caption unit secondary id is missing: ${unit.id}`);
      const canvas = document.createElement("canvas");
      canvas.width = config.width;
      canvas.height = band.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("caption 2D canvas is unavailable");
      context.clearRect(0, 0, config.width, band.height);
      context.drawImage(image, 0, band.offsetY, config.width, band.height, 0, 0, config.width, band.height);
      spriteCompositor.registerSprite(id, canvas);
      canvas.width = 0;
      canvas.height = 0;
      registeredUnits.add(unit);
    }
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

  async function buildCaptionUnits(value, config, attemptsLog) {
    const html = captionHtmlWithUnitMarkers(value.html);
    const settled = value.motion?.in?.duration_sec ?? value.motion?.in?.durationSec ?? 0.18;
    const settleCss = `*{animation-play-state:paused!important;animation-delay:-${Math.max(0, Number(settled) || 0)}s!important}`;
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
      const [probeMeasurement] = await measureCaptionVariantsStable(value, config, html, [unitCss], unitIndex, attemptsLog);
      const roles = new Set(probeMeasurement.tokens.map((token) => token.role));
      const hasColor = roles.has("karaoke");
      const hasGeometry = ["pop", "reveal-word", "emphasis-bang", "emphasis-pulse"].some((role) => roles.has(role));
      if (hasColor && hasGeometry) throw new Error(`caption ${value.id} contains mixed color and geometry word roles`);
      const mode = hasColor ? "color" : hasGeometry ? "geometry" : "sprite";
      const id = `${value.id}::unit-${unitIndex}`;
      let secondaryId = null;
      let bandCss;
      let tiles = null;
      let unitMeasurement = probeMeasurement;
      if (mode === "color") {
        const baseCss = `${captionUnitCss(revealIndex)}.akari-caption__tok--karaoke{color:var(--caption-color,#fff)!important}`;
        const highlightCss = `${captionUnitCss(revealIndex)}.akari-caption__tok--karaoke{color:var(--caption-highlight-color,#ffd94a)!important}`;
        const [baseMeasurement, highlightMeasurement] = await measureCaptionVariantsStable(
          value,
          config,
          html,
          [`${CAPTION_WORD_FREEZE_CSS}${baseCss}`, `${CAPTION_WORD_FREEZE_CSS}${highlightCss}`],
          unitIndex,
          attemptsLog,
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
          [`${CAPTION_WORD_FREEZE_CSS}${plateCss}`, `${CAPTION_WORD_FREEZE_CSS}${textCss}`],
          unitIndex,
          attemptsLog,
        );
        layoutMaxDeltaPx = Math.max(layoutMaxDeltaPx, compareCaptionLayouts(plateMeasurement, textMeasurement, id));
        unitMeasurement = plateMeasurement;
        bandCss = [`${settleCss}${plateCss}`, `${settleCss}${textCss}`];
        secondaryId = `${id}::b`;
      } else {
        bandCss = [`${settleCss}${captionUnitCss(revealIndex)}`];
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

  function embeddedCaptionFont() {
    captionEncodedFontPromise ??= (async () => {
      const response = await fetch("/caption-font.ttf");
      if (!response.ok) throw new Error(`caption font fetch failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      return encodeURIComponent(`data:font/ttf;base64,${btoa(binary)}`);
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
      if (activeAt(value, seconds)) values.push({ index: value.index, id: value.id, opacity: 1 });
    }
    for (const value of manifest.three) {
      if (!activeAt(value, seconds)) continue;
      const state = value.entrance
        ? threeEntranceStateAt(value.entrance, seconds - value.start)
        : { opacity: 1 };
      values.push({ index: value.index, id: value.id, ...state });
    }
    for (const run of manifest.dom ?? []) {
      if (domRuntime.activeAt(run, seconds)) values.push({ index: run.index, id: run.runId, opacity: 1 });
    }
    return values.sort((left, right) => left.index - right.index)
      .map(({ index, ...draw }) => draw);
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

  window.__akariGpuDomInternals = {
    sentinelColor, chooseSettlePolicy, runActiveAt, threeEntranceStateAt, orderedSpriteDraws,
  };

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
    const stages = { evaluate: [], three: [], dom: [], captionRaster: [], captionRasterBatch: [], captions: [], composite: [], encode: [], backpressure: [] };
    const frameHashes = [];
    const threeRecords = new Map();
    const captionUnits = [];
    const captionRecords = [];
    const captionMeasureAttemptValues = [];
    let captionBatches = [];
    let captionRasterTotalMs = 0;
    const captionRasterBatchMetrics = { batches: 0, unitsPerBatchMax: 0, bandsMax: 0 };
    let captionLayoutMaxDeltaPx = 0;
    let threeRuntime = null;
    let queueWaits = 0;
    let encoder = null;
    let supported = false;
    let hashFrame = null;
    let drawTimingProbe = null;
    let domRuntime = null;
    const started = performance.now();
    try {
      for (const value of config.spriteManifest.statics) {
        spriteCompositor.registerSprite(value.id, await rasterizeSprite(value, config));
      }
      for (const value of config.spriteManifest.captions) {
        const built = await buildCaptionUnits(value, config, captionMeasureAttemptValues);
        captionLayoutMaxDeltaPx = Math.max(captionLayoutMaxDeltaPx, built.layoutMaxDeltaPx);
        let rasters = 0;
        let tiles = 0;
        let words = 0;
        for (const unit of built.units) {
          rasters += unit.bandCss.length;
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
          bands: rasters,
          tiles,
        });
        value.html = "";
      }
      captionUnits.sort((left, right) => left.cueStart - right.cueStart);
      captionBatches = buildCaptionBatches(captionUnits);
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
        if (typeof verifyModule.createSpriteDrawTimingProbe === "function") {
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
                const registered = await rasterizeCaptionBatch(batch, config, spriteCompositor);
                const elapsed = performance.now() - rasterStarted;
                stages.captionRasterBatch.push(elapsed);
                captionRasterTotalMs += elapsed;
                captionRasterBatchMetrics.batches += 1;
                captionRasterBatchMetrics.unitsPerBatchMax = Math.max(
                  captionRasterBatchMetrics.unitsPerBatchMax,
                  registered.units,
                );
                captionRasterBatchMetrics.bandsMax = Math.max(captionRasterBatchMetrics.bandsMax, registered.bands);
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
              glTiming: drawTimingProbe ? drawTimingProbe.summary() : null,
              readbackCounters: counters,
              captions: captionRecords,
              captionLayoutMaxDeltaPx,
              captionMeasureAttempts: summarizeAttempts(captionMeasureAttemptValues),
              captionRasterTotalMs,
              captionRasterBatches: captionRasterBatchMetrics,
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
          glTiming: drawTimingProbe ? drawTimingProbe.summary() : null,
          trapReadback: Boolean(config.trapReadback),
          readbackCounters: counters,
          captions: captionRecords,
          captionLayoutMaxDeltaPx,
          captionMeasureAttempts: summarizeAttempts(captionMeasureAttemptValues),
          captionRasterTotalMs,
          captionRasterBatches: captionRasterBatchMetrics,
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
