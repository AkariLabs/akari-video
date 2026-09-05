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

  function resolvedItemAdjust(item, adjustLutCubeTexts) {
    const adjust = item?.adjust;
    if (!adjust || typeof adjust !== "object" || adjust.lut == null || adjust.sections?.lut === false) return item;
    const ref = adjust.lut?.lut;
    if (typeof ref !== "string") return item;
    const cubeText = adjustLutCubeTexts?.[String(item.id)];
    return {
      ...item,
      adjust: {
        ...adjust,
        lut: typeof cubeText === "string"
          ? { ...adjust.lut, lut: FE.parseCube(cubeText) }
          : null,
      },
    };
  }

  function normalizedCuts(edit, adjustLutCubeTexts = {}) {
    const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];
    return cuts.map((cut, index) => {
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
      return resolvedItemAdjust(copy, adjustLutCubeTexts);
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
      const cuts = normalizedCuts(config.edit, config.adjustLutCubeTexts);
      const urls = new Map();
      if (Array.isArray(config.edit.sources)) {
        for (const source of config.edit.sources) {
          if (source && source.id && (source.proxy || source.path)) urls.set(String(source.id), mediaUrl(source.proxy || source.path));
        }
      } else if (config.edit.source && config.edit.source.path) {
        urls.set("default", mediaUrl(config.edit.source.path));
      }
      const engineLayers = (Array.isArray(config.edit.layers) ? config.edit.layers : [])
        .map((layer) => resolvedItemAdjust(layer, config.adjustLutCubeTexts))
        .map((layer) => {
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
        // capacity 1: sequential export never re-reads past frames, and every cached frame is a
        // decoder-backed clone that pins a decoder output surface; holding 12 starved the decoder
        // (10 s watchdog -> decoder recreate, 0.73 fps; issue #28). 1 keeps an LRU hit for freezes.
        const source = new FE.LookaheadFrameSource(pool, { fps: config.fps, capacity: 1 });
        pools.set(id, pool);
        lookahead.set(id, source);
        videoSources.set(id, source);
      }
      this.sources = new Map([...videoSources, ...images]);
      // GPU 経路と同じ規律: 書き出しは厳密に前方順なので、plan から外れたカットのデコーダ
      // セッションは捨てる。カット本数ぶん積み上げると長尺で RSS が hard stop に当たる
      // （issue #52。#28 の再発予防でもある）
      this.fps = Number(config.fps) > 0 ? Number(config.fps) : 30;
      this.reaper = new FE.StreamReaper(lookahead.values(), { graceFrames: Math.max(1, Math.round(this.fps)) });
      this.decoderSessions = { live: 0, released: 0 };
      this.timeline = FE.buildResolvedTimelinePlan(cuts, {
        fps: config.fps,
        layers: engineLayers,
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
      const reaped = this.reaper.reap(plan, Math.round(clamped * this.fps));
      this.decoderSessions = { live: reaped.liveStreams, released: this.reaper.released() };
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
    return {
      warnings: warnings.concat(result && Array.isArray(result.warnings) ? result.warnings : []),
      // RSS はデコーダセッション数に比例して伸びる（issue #28 / #52）。run.json の memory へ運ぶ
      decoderSessions: engineRuntime.decoderSessions,
    };
  };

  window.__akariSettle = async function () {
    await animationFrames(2);
  };

  window.addEventListener("beforeunload", () => engineRuntime && engineRuntime.dispose(), { once: true });
})();
