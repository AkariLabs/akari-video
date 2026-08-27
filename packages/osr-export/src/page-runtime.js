(function () {
  "use strict";

  const config = window.__AKARI_OSR_CONFIG__;
  const FE = window.AkariFrameEngine;
  const warnings = [];
  const pools = new Map();
  const lookahead = new Map();
  const images = new Map();

  function warn(message) {
    warnings.push(String(message));
    console.warn("[akari-osr]", message);
  }

  function mediaUrl(value) {
    return "/media/" + String(value).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  }

  function normalizedCuts(edit) {
    const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];
    return cuts.map((cut, index) => {
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

  class OsrFrameEngineRuntime {
    constructor() {
      this.canvas = document.getElementById("akari-engine");
      this.compositor = new FE.WebGL2Compositor(this.canvas, { synchronization: "flush", uploadPath: "direct" });
      this.metrics = new FE.FrameMetrics();
      const cuts = normalizedCuts(config.edit);
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
        urls.set(String(layer.src), mediaUrl(layer.src));
        if (layer.mask) urls.set(String(layer.mask), mediaUrl(layer.mask));
      }
      const videoSources = new Map();
      for (const [id, url] of urls) {
        if (isImage(url)) {
          const image = new FE.CachedStillImageSource(url);
          images.set(id, image);
          continue;
        }
        const pool = new FE.ClipSessionPool(id, url, { onWarning: warn });
        const source = new FE.LookaheadFrameSource(pool, { fps: config.fps, capacity: 12 });
        pools.set(id, pool);
        lookahead.set(id, source);
        videoSources.set(id, source);
      }
      this.sources = new Map([...videoSources, ...images]);
      this.timeline = FE.buildResolvedTimelinePlan(cuts, {
        fps: config.fps,
        layers: Array.isArray(config.edit.layers) ? config.edit.layers : [],
        onWarning: warn,
      });
      const look = config.look && typeof config.look.cubeText === "string"
        ? { lut: FE.parseCube(config.look.cubeText), intensity: Math.max(0, Math.min(1, Number(config.look.intensity ?? 1))) }
        : null;
      this.output = { width: config.width, height: config.height, colorSpace: "bt709-limited", look };
    }

    async renderAt(seconds) {
      const clamped = Math.max(0, Math.min(Number(seconds) || 0, this.timeline.totalDuration));
      const plan = FE.evaluationPlanFromResolvedTimeline(this.timeline, Math.round(clamped * 1e6), this.sources, this.output);
      if (plan.base.length === 0 && plan.layers.length === 0) {
        const context = this.canvas.getContext("webgl2");
        if (context) {
          context.clearColor(0, 0, 0, 1);
          context.clear(context.COLOR_BUFFER_BIT);
        }
        return;
      }
      let frame;
      try {
        frame = await FE.evaluateFrame(plan, { compositor: this.compositor, metrics: this.metrics });
      } finally {
        frame && frame.close();
      }
    }

    dispose() {
      for (const source of lookahead.values()) source.clear();
      for (const source of images.values()) source.destroy();
      for (const pool of pools.values()) pool.destroy();
      this.compositor.dispose();
    }
  }

  function animationFrames(count) {
    return new Promise((resolve) => {
      const next = (remaining) => remaining <= 0 ? resolve() : requestAnimationFrame(() => next(remaining - 1));
      next(count);
    });
  }

  const overlayFrame = document.getElementById("akari-overlays");
  const stampRow = document.getElementById("akari-stamp");
  let engineRuntime;

  window.__akariReady = (async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      if (overlayFrame.contentDocument && overlayFrame.contentDocument.readyState === "complete") resolve();
      else overlayFrame.addEventListener("load", resolve, { once: true });
    });
    await overlayFrame.contentWindow.__akariReady;
    engineRuntime = new OsrFrameEngineRuntime();
    await engineRuntime.renderAt(0);
    await engineRuntime.renderAt(0);
    await animationFrames(2);
    return true;
  })();

  window.__akariSeek = async function (seconds, frameNumber) {
    await window.__akariReady;
    await engineRuntime.renderAt(seconds);
    const result = await overlayFrame.contentWindow.__akariSeek(seconds);
    stampRow.style.backgroundColor = window.__akariEncodeStamp(frameNumber).css;
    await animationFrames(2);
    return { warnings: warnings.concat(result && Array.isArray(result.warnings) ? result.warnings : []) };
  };

  window.__akariSettle = async function () {
    await animationFrames(2);
  };

  window.addEventListener("beforeunload", () => engineRuntime && engineRuntime.dispose(), { once: true });
})();
