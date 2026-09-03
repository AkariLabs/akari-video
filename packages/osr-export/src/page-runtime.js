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

  // 出口の素材選択は frame-engine の chooseSource / needsCodecProbe 一本に通す（プレビューと同一実装。
  // 契約 tasks/2026-09-03-export-original-source）。既定 mode は 'original': 'auto' は宣言 proxy を
  // 無条件で選ぶので出口では使わない（source-selection.ts の chooseSource 参照）。
  function exportSourceMode(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized === "proxy" || normalized === "auto" ? normalized : "original";
  }

  // v0 の単一 source も v1 の sources[] と同じ 1 本の判定へ流す。
  function declaredSources(edit) {
    if (Array.isArray(edit.sources)) return edit.sources;
    return edit.source && edit.source.path
      ? [{ id: "default", path: edit.source.path, proxy: edit.source.proxy }]
      : [];
  }

  // 素材ごとに { url, record } を決める。mode 'original' でも needsCodecProbe は true なので原本の
  // codec を probe し、support.any === false かつ proxy が実在するときだけ proxy へ退避する
  // （reason 'codec-unsupported' + warning 1 件）。probe 不能（support == null）は原本のまま進む。
  async function resolveSourceSelections(sources, options) {
    const engine = options.engine;
    const toUrl = options.toUrl;
    const looksLikeImage = options.looksLikeImage;
    const onWarning = options.onWarning;
    const mode = exportSourceMode(options.mode);
    const declared = [];
    for (const source of Array.isArray(sources) ? sources : []) {
      if (!source || !source.id) continue;
      const original = typeof source.path === "string" && source.path !== "" ? source.path : null;
      const proxy = typeof source.proxy === "string" && source.proxy !== "" ? source.proxy : null;
      const path = original === null ? proxy : original;
      if (path === null) continue;
      declared.push({
        id: String(source.id),
        path,
        proxy: original !== null && proxy !== null && proxy !== original ? proxy : null,
      });
    }
    const resolved = await Promise.all(declared.map(async (entry) => {
      const hasProxy = entry.proxy !== null;
      const originalUrl = toUrl(entry.path);
      const probe = !looksLikeImage(entry.path) && engine.needsCodecProbe(mode, hasProxy)
        ? await engine.probeSourceCodec(originalUrl)
        : null;
      const decision = engine.chooseSource({ mode, hasProxy, support: probe ? probe.support : null });
      const useProxy = decision.chosen === "proxy" && hasProxy;
      const path = useProxy ? entry.proxy : entry.path;
      const url = useProxy ? toUrl(entry.proxy) : originalUrl;
      // レシートの width / height は「実際に読んだ側」の実測値にする（後から出口の入力を検算できる）。
      let info = useProxy || probe === null ? null : probe.info;
      if (info === null && !looksLikeImage(path)) {
        const chosenProbe = await engine.probeSourceCodec(url);
        info = chosenProbe ? chosenProbe.info : null;
      }
      if (useProxy && decision.reason === "codec-unsupported") {
        onWarning("原本を再生できないためプロキシで書き出しました: " + entry.id);
      }
      return {
        id: entry.id,
        url,
        record: {
          id: entry.id,
          chosen: useProxy ? "proxy" : decision.chosen,
          reason: decision.reason,
          path,
          width: info && Number.isInteger(info.codedWidth) ? info.codedWidth : null,
          height: info && Number.isInteger(info.codedHeight) ? info.codedHeight : null,
          ...(info && typeof info.codec === "string" ? { codec: info.codec } : {}),
        },
      };
    }));
    return {
      urls: new Map(resolved.map((entry) => [entry.id, entry.url])),
      records: resolved.map((entry) => entry.record),
    };
  }

  class OsrFrameEngineRuntime {
    // sourceUrls は resolveSourceSelections が決めた id -> URL（既定は原本）。
    constructor(sourceUrls) {
      this.canvas = document.getElementById("akari-engine");
      this.compositor = new FE.WebGL2Compositor(this.canvas, { synchronization: "flush", uploadPath: "direct" });
      this.metrics = new FE.FrameMetrics();
      const cuts = normalizedCuts(config.edit);
      const urls = new Map(sourceUrls instanceof Map ? sourceUrls : []);
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
    const sourceSelection = await resolveSourceSelections(declaredSources(config.edit), {
      engine: FE,
      toUrl: mediaUrl,
      looksLikeImage: isImage,
      onWarning: warn,
      mode: config.sourceMode,
    });
    // electron-main が run.json / レシートへ写す（どちらを読んだかの実測記録）。
    window.__akariSourceSelections = sourceSelection.records;
    engineRuntime = new OsrFrameEngineRuntime(sourceSelection.urls);
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
