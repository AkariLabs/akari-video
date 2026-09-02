var AkariEditKernel = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/webview-kernel.ts
  var webview_kernel_exports = {};
  __export(webview_kernel_exports, {
    DEFAULT_DUCK_ATTACK_SEC: () => DEFAULT_DUCK_ATTACK_SEC,
    DEFAULT_DUCK_DB: () => DEFAULT_DUCK_DB,
    DEFAULT_DUCK_KEYS: () => DEFAULT_DUCK_KEYS,
    DEFAULT_DUCK_RELEASE_SEC: () => DEFAULT_DUCK_RELEASE_SEC,
    STATIC_DUCK_GAIN_DB: () => STATIC_DUCK_GAIN_DB,
    TRANSITION_BY_ID: () => TRANSITION_BY_ID,
    TRANSITION_CATEGORIES: () => TRANSITION_CATEGORIES,
    TRANSITION_TYPE_IDS: () => TRANSITION_TYPE_IDS,
    TRANSITION_VOCABULARY: () => TRANSITION_VOCABULARY,
    buildTimelineMap: () => buildTimelineMap,
    buildWebAudioSchedule: () => buildWebAudioSchedule,
    captionAnchorPositionVars: () => captionAnchorPositionVars,
    captionWindowSeconds: () => captionWindowSeconds,
    composeEnvelopesDb: () => composeEnvelopesDb,
    computeDuckEnvelope: () => computeDuckEnvelope,
    computeDuckIntervals: () => computeDuckIntervals,
    computeTransitionVisual: () => computeTransitionVisual,
    easingProgress: () => easingProgress,
    envelopeToGainEvents: () => envelopeToGainEvents,
    evaluateEnvelopeDb: () => evaluateEnvelopeDb,
    findActiveCaption: () => findActiveCaption,
    findActiveResolvedCaption: () => findActiveResolvedCaption,
    isTransitionType: () => isTransitionType,
    isWithinDuckInterval: () => isWithinDuckInterval,
    outputToSource: () => outputToSource,
    projectSpeechDeclarations: () => projectSpeechDeclarations,
    projectSpeechKeyIntervals: () => projectSpeechKeyIntervals,
    sampleEnvelopeLinear: () => sampleEnvelopeLinear,
    transitionProgressAt: () => transitionProgressAt
  });

  // src/transition-vocabulary.ts
  var TRANSITION_VOCABULARY = [
    { id: "dissolve", xfadeName: "dissolve", labelJa: "\u30C7\u30A3\u30BE\u30EB\u30D6", category: "\u30D5\u30A7\u30FC\u30C9", previewKind: "dissolve", glyph: "D" },
    { id: "fade", xfadeName: "fade", labelJa: "\u30AF\u30ED\u30B9\u30D5\u30A7\u30FC\u30C9", category: "\u30D5\u30A7\u30FC\u30C9", previewKind: "fade", glyph: "F" },
    { id: "fade-black", xfadeName: "fadeblack", labelJa: "\u9ED2\u30D5\u30A7\u30FC\u30C9", category: "\u30D5\u30A7\u30FC\u30C9", previewKind: "fade-black", glyph: "B" },
    { id: "fade-white", xfadeName: "fadewhite", labelJa: "\u767D\u30D5\u30A7\u30FC\u30C9", category: "\u30D5\u30A7\u30FC\u30C9", previewKind: "fade-white", glyph: "W" },
    { id: "fade-grays", xfadeName: "fadegrays", labelJa: "\u30E2\u30CE\u30AF\u30ED\u30D5\u30A7\u30FC\u30C9", category: "\u30D5\u30A7\u30FC\u30C9", previewKind: "fade-grays", glyph: "G" },
    { id: "wipe-left", xfadeName: "wipeleft", labelJa: "\u30EF\u30A4\u30D7\uFF08\u5DE6\u3078\uFF09", category: "\u30EF\u30A4\u30D7", previewKind: "wipe-left", glyph: "\u2190" },
    { id: "wipe-right", xfadeName: "wiperight", labelJa: "\u30EF\u30A4\u30D7\uFF08\u53F3\u3078\uFF09", category: "\u30EF\u30A4\u30D7", previewKind: "wipe-right", glyph: "\u2192" },
    { id: "wipe-up", xfadeName: "wipeup", labelJa: "\u30EF\u30A4\u30D7\uFF08\u4E0A\u3078\uFF09", category: "\u30EF\u30A4\u30D7", previewKind: "wipe-up", glyph: "\u2191" },
    { id: "wipe-down", xfadeName: "wipedown", labelJa: "\u30EF\u30A4\u30D7\uFF08\u4E0B\u3078\uFF09", category: "\u30EF\u30A4\u30D7", previewKind: "wipe-down", glyph: "\u2193" },
    { id: "radial", xfadeName: "radial", labelJa: "\u6642\u8A08\u30EF\u30A4\u30D7", category: "\u30EF\u30A4\u30D7", previewKind: "radial", glyph: "\u25F7" },
    { id: "slide-left", xfadeName: "slideleft", labelJa: "\u30B9\u30E9\u30A4\u30C9\uFF08\u5DE6\u3078\uFF09", category: "\u30B9\u30E9\u30A4\u30C9", previewKind: "slide-left", glyph: "\u2190" },
    { id: "slide-right", xfadeName: "slideright", labelJa: "\u30B9\u30E9\u30A4\u30C9\uFF08\u53F3\u3078\uFF09", category: "\u30B9\u30E9\u30A4\u30C9", previewKind: "slide-right", glyph: "\u2192" },
    { id: "slide-up", xfadeName: "slideup", labelJa: "\u30B9\u30E9\u30A4\u30C9\uFF08\u4E0A\u3078\uFF09", category: "\u30B9\u30E9\u30A4\u30C9", previewKind: "slide-up", glyph: "\u2191" },
    { id: "slide-down", xfadeName: "slidedown", labelJa: "\u30B9\u30E9\u30A4\u30C9\uFF08\u4E0B\u3078\uFF09", category: "\u30B9\u30E9\u30A4\u30C9", previewKind: "slide-down", glyph: "\u2193" },
    { id: "cover-left", xfadeName: "coverleft", labelJa: "\u30AB\u30D0\u30FC\uFF08\u5DE6\u3078\uFF09", category: "\u30AB\u30D0\u30FC", previewKind: "cover-left", glyph: "\u2190" },
    { id: "cover-right", xfadeName: "coverright", labelJa: "\u30AB\u30D0\u30FC\uFF08\u53F3\u3078\uFF09", category: "\u30AB\u30D0\u30FC", previewKind: "cover-right", glyph: "\u2192" },
    { id: "cover-up", xfadeName: "coverup", labelJa: "\u30AB\u30D0\u30FC\uFF08\u4E0A\u3078\uFF09", category: "\u30AB\u30D0\u30FC", previewKind: "cover-up", glyph: "\u2191" },
    { id: "cover-down", xfadeName: "coverdown", labelJa: "\u30AB\u30D0\u30FC\uFF08\u4E0B\u3078\uFF09", category: "\u30AB\u30D0\u30FC", previewKind: "cover-down", glyph: "\u2193" },
    { id: "reveal-left", xfadeName: "revealleft", labelJa: "\u30EA\u30D3\u30FC\u30EB\uFF08\u5DE6\u3078\uFF09", category: "\u30EA\u30D3\u30FC\u30EB", previewKind: "reveal-left", glyph: "\u2190" },
    { id: "reveal-right", xfadeName: "revealright", labelJa: "\u30EA\u30D3\u30FC\u30EB\uFF08\u53F3\u3078\uFF09", category: "\u30EA\u30D3\u30FC\u30EB", previewKind: "reveal-right", glyph: "\u2192" },
    { id: "reveal-down", xfadeName: "revealdown", labelJa: "\u4E0A\u304B\u3089\u30EA\u30D3\u30FC\u30EB", category: "\u30EA\u30D3\u30FC\u30EB", previewKind: "reveal-down", glyph: "\u2193" },
    { id: "reveal-up", xfadeName: "revealup", labelJa: "\u4E0B\u304B\u3089\u30EA\u30D3\u30FC\u30EB", category: "\u30EA\u30D3\u30FC\u30EB", previewKind: "reveal-up", glyph: "\u2191" },
    { id: "circle-open", xfadeName: "circleopen", labelJa: "\u30B5\u30FC\u30AF\u30EB\uFF08\u958B\u304F\uFF09", category: "\u5F62\u72B6", previewKind: "circle-open", glyph: "\u25CB" },
    { id: "circle-close", xfadeName: "circleclose", labelJa: "\u30B5\u30FC\u30AF\u30EB\uFF08\u9589\u3058\u308B\uFF09", category: "\u5F62\u72B6", previewKind: "circle-close", glyph: "\u25CF" },
    { id: "zoom-in", xfadeName: "zoomin", labelJa: "\u30BA\u30FC\u30E0\u30A4\u30F3", category: "\u5909\u5F62", previewKind: "zoom-in", glyph: "\uFF0B" },
    { id: "squeeze-h", xfadeName: "squeezeh", labelJa: "\u30B9\u30AF\u30A4\u30FC\u30BA\uFF08\u7E26\u3064\u3076\u3057\uFF09", category: "\u5909\u5F62", previewKind: "squeeze-h", glyph: "\u2195" },
    { id: "squeeze-v", xfadeName: "squeezev", labelJa: "\u30B9\u30AF\u30A4\u30FC\u30BA\uFF08\u6A2A\u3064\u3076\u3057\uFF09", category: "\u5909\u5F62", previewKind: "squeeze-v", glyph: "\u2194" },
    { id: "blur", xfadeName: "hblur", labelJa: "\u30D6\u30E9\u30FC", category: "\u8CEA\u611F", previewKind: "blur", glyph: "B" },
    { id: "pixelize", xfadeName: "pixelize", labelJa: "\u30D4\u30AF\u30BB\u30EC\u30FC\u30C8", category: "\u8CEA\u611F", previewKind: "pixelize", glyph: "P" }
  ];
  var TRANSITION_TYPE_IDS = TRANSITION_VOCABULARY.map((entry) => entry.id);
  var TRANSITION_CATEGORIES = [...new Set(TRANSITION_VOCABULARY.map((entry) => entry.category))];
  var TRANSITION_BY_ID = Object.fromEntries(TRANSITION_VOCABULARY.map((entry) => [entry.id, entry]));
  function isTransitionType(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(TRANSITION_BY_ID, value);
  }

  // src/edit-store.ts
  function computeCutTrackSegments(cuts) {
    const cursorByTrack = /* @__PURE__ */ new Map();
    const previousIndexByTrack = /* @__PURE__ */ new Map();
    const segments = [];
    cuts.forEach((cut, index) => {
      const track = typeof cut.track === "number" && Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
      const speed = typeof cut.speed === "number" && cut.speed > 0 ? cut.speed : 1;
      const duration = Math.max(0, cut.out - cut.in) / speed;
      const cursor = cursorByTrack.get(track) ?? 0;
      const hasExplicitAt = typeof cut.at === "number" && Number.isFinite(cut.at) && cut.at >= 0;
      const previousIndex = previousIndexByTrack.get(track);
      const transitionOverlap = !hasExplicitAt && previousIndex !== void 0 ? cuts[previousIndex].transitionOut?.duration ?? 0 : 0;
      const at = hasExplicitAt ? cut.at : cursor - transitionOverlap;
      const end = at + duration;
      cursorByTrack.set(track, end);
      previousIndexByTrack.set(track, index);
      segments.push({ index, track, at, duration, end });
    });
    return segments;
  }

  // src/cut-adjacency.ts
  var DEFAULT_CUT_ADJACENCY_FPS = 30;
  function effectiveCutFps(fps) {
    return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_CUT_ADJACENCY_FPS;
  }
  function cutOverlapFrames(earlier, later, fps = DEFAULT_CUT_ADJACENCY_FPS) {
    const resolvedFps = effectiveCutFps(fps);
    return Math.round(earlier.tlEnd * resolvedFps) - Math.round(later.tlStart * resolvedFps);
  }
  var nonNegativeRoom = (value) => value === Number.POSITIVE_INFINITY ? value : Number.isFinite(value) && value > 0 ? value : 0;
  function planTransitionHandleWindow(input) {
    const declaredSeconds = Number.isFinite(input.declaredSeconds) && input.declaredSeconds > 0 ? input.declaredSeconds : 0;
    const effectiveSeconds = Math.max(0, Math.min(
      declaredSeconds,
      2 * nonNegativeRoom(input.outgoingTailRoomSeconds),
      2 * nonNegativeRoom(input.incomingHeadRoomSeconds),
      2 * nonNegativeRoom(input.outgoingDurationSeconds),
      2 * nonNegativeRoom(input.incomingDurationSeconds)
    ));
    return {
      effectiveSeconds,
      halfSeconds: effectiveSeconds / 2,
      outcome: effectiveSeconds <= 0 ? "none" : effectiveSeconds < declaredSeconds ? "clamped" : "full"
    };
  }

  // src/timeline-map.ts
  function projectSpeechKeyIntervals(cuts, transcript, options = {}) {
    const normalizedCuts = cuts.map((cut) => ({
      ...cut,
      transitionOut: cut.transitionOut ?? cut.transition_out
    }));
    const hasExplicitSources = normalizedCuts.some((cut) => typeof cut.src === "string" && cut.src.length > 0);
    if (hasExplicitSources && !options.sourceId) return { intervals: [], droppedShortIntervals: 0 };
    const map = buildTimelineMap(normalizedCuts, { fps: options.fps });
    const projected = [];
    for (const segment of map.segments) {
      if (segment.kind !== "src" || typeof segment.in !== "number" || typeof segment.out !== "number") continue;
      if (hasExplicitSources && segment.src !== options.sourceId) continue;
      const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1;
      for (const entry of transcript) {
        if (!entry || !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start) continue;
        const sourceStart = Math.max(segment.in, entry.start);
        const sourceEnd = Math.min(segment.out, entry.end);
        if (!(sourceEnd > sourceStart)) continue;
        projected.push({
          startSec: segment.outStart + (sourceStart - segment.in) / speed,
          endSec: segment.outStart + (sourceEnd - segment.in) / speed
        });
      }
    }
    projected.sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
    const merged = [];
    for (const interval of projected) {
      const last = merged[merged.length - 1];
      if (last && interval.startSec - last.endSec < 0.35) last.endSec = Math.max(last.endSec, interval.endSec);
      else merged.push({ ...interval });
    }
    const intervals = merged.filter((interval) => interval.endSec - interval.startSec >= 0.15);
    return { intervals, droppedShortIntervals: merged.length - intervals.length };
  }
  function transitionProgressAt(window, outputT) {
    if (!(window.duration > 0)) return 0;
    return Math.max(0, Math.min(1, (outputT - window.start) / window.duration));
  }
  function buildTimelineMap(cuts, options) {
    const usable = [];
    cuts.forEach((cut, index) => {
      if (typeof cut?.in === "number" && Number.isFinite(cut.in) && typeof cut?.out === "number" && Number.isFinite(cut.out) && cut.in < cut.out) {
        usable.push({ cut, index });
      }
    });
    const usableCuts = usable.map((entry) => entry.cut);
    const trackSegments = computeCutTrackSegments(usableCuts);
    const trackZ = options?.trackZ ?? ((track) => -track);
    const resolved = trackSegments.map((segment) => ({
      start: segment.at,
      end: segment.end,
      baseStart: segment.at,
      baseEnd: segment.end,
      track: segment.track,
      cut: usableCuts[segment.index],
      cutIndex: usable[segment.index].index
    }));
    const fps = options?.fps ?? DEFAULT_CUT_ADJACENCY_FPS;
    for (let outgoingIndex = 0; outgoingIndex < resolved.length; outgoingIndex++) {
      const outgoing = resolved[outgoingIndex];
      const transition = outgoing.cut.transitionOut;
      if (!transition || !(typeof transition.duration === "number" && Number.isFinite(transition.duration) && transition.duration > 0)) continue;
      const incoming = resolved.slice(outgoingIndex + 1).find((candidate) => candidate.track === outgoing.track);
      if (!incoming || cutOverlapFrames(
        { tlEnd: outgoing.end },
        { tlStart: incoming.start },
        fps
      ) !== 0) continue;
      const outgoingRoom = options?.handleRoom?.(outgoing.cutIndex);
      const incomingRoom = options?.handleRoom?.(incoming.cutIndex);
      const incomingSpeed = typeof incoming.cut.speed === "number" && incoming.cut.speed > 0 ? incoming.cut.speed : 1;
      const plan = planTransitionHandleWindow({
        declaredSeconds: transition.duration,
        outgoingTailRoomSeconds: outgoingRoom?.tailSeconds ?? Number.POSITIVE_INFINITY,
        incomingHeadRoomSeconds: incomingRoom?.headSeconds ?? incoming.cut.in / incomingSpeed,
        outgoingDurationSeconds: outgoing.baseEnd - outgoing.baseStart,
        incomingDurationSeconds: incoming.baseEnd - incoming.baseStart
      });
      if (plan.effectiveSeconds <= 0) continue;
      const cutPoint = outgoing.end;
      outgoing.end = cutPoint + plan.halfSeconds;
      outgoing.cut = {
        ...outgoing.cut,
        transitionOut: { ...transition, duration: plan.effectiveSeconds }
      };
      incoming.start = cutPoint - plan.halfSeconds;
      incoming.cut = {
        ...incoming.cut,
        in: Math.max(0, incoming.cut.in - plan.halfSeconds * incomingSpeed)
      };
    }
    const segmentSlice = (entry, start, end, transitionOut = null) => {
      const cut = entry.cut;
      const speed = typeof cut.speed === "number" && cut.speed > 0 ? cut.speed : 1;
      return {
        kind: "src",
        outStart: start,
        outEnd: end,
        cutIndex: entry.cutIndex,
        ...cut.src !== void 0 ? { src: cut.src } : {},
        in: cut.in + (start - entry.start) * speed,
        out: cut.in + (end - entry.start) * speed,
        speed,
        track: entry.track,
        transitionOut
      };
    };
    const transitionWindows = [];
    for (let outgoingIndex = 0; outgoingIndex < resolved.length; outgoingIndex++) {
      const outgoing = resolved[outgoingIndex];
      const transition = outgoing.cut.transitionOut;
      if (!transition || !(typeof transition.duration === "number" && Number.isFinite(transition.duration) && transition.duration > 0)) continue;
      const incoming = resolved.slice(outgoingIndex + 1).find((candidate) => candidate.track === outgoing.track);
      if (!incoming) continue;
      const start = incoming.start;
      const actualOverlap = outgoing.end - start;
      if (!(actualOverlap > 1e-6) || actualOverlap - transition.duration > 1e-6) continue;
      const end = Math.min(outgoing.end, incoming.end, start + transition.duration);
      if (!(end - start > 1e-6)) continue;
      transitionWindows.push({
        start,
        end,
        duration: end - start,
        type: transition.type,
        outgoing: segmentSlice(outgoing, start, end, transition),
        incoming: segmentSlice(incoming, start, end)
      });
    }
    const outputDuration = resolved.reduce((max, segment) => Math.max(max, segment.end), 0);
    const boundarySet = /* @__PURE__ */ new Set([0, outputDuration]);
    for (const segment of resolved) {
      boundarySet.add(segment.start);
      boundarySet.add(segment.end);
    }
    const boundaries = [...boundarySet].sort((left, right) => left - right);
    const runs = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (end - start <= 1e-6) {
        continue;
      }
      const midpoint = (start + end) / 2;
      let winner = null;
      for (const segment of resolved) {
        if (segment.start <= midpoint && segment.end > midpoint && (!winner || trackZ(segment.track) > trackZ(winner.track))) {
          winner = segment;
        }
      }
      const last = runs[runs.length - 1];
      const sameWinner = last && (last.winner === null && winner === null || last.winner !== null && winner !== null && last.winner.cutIndex === winner.cutIndex);
      if (sameWinner && Math.abs(last.end - start) <= 1e-6) {
        last.end = end;
      } else {
        runs.push({ start, end, winner });
      }
    }
    const segments = runs.map((run) => {
      if (!run.winner) {
        return { kind: "gap", outStart: run.start, outEnd: run.end, cutIndex: null };
      }
      return segmentSlice(
        run.winner,
        run.start,
        run.end,
        run.winner.cut.transitionOut ?? null
      );
    });
    const transitionPlates = transitionWindows.flatMap(
      (window) => window.type === "fade-black" || window.type === "fade-white" ? [{
        start: window.start,
        end: window.end,
        mid: (window.start + window.end) / 2,
        color: window.type === "fade-white" ? "#fff" : "#000",
        type: window.type
      }] : []
    );
    return {
      segments,
      totalDuration: outputDuration,
      transitionPlates,
      transitionWindows,
      usesGapsOrTracks: true
    };
  }
  function outputToSource(segments, outputT) {
    if (segments.length === 0) {
      return { segment: null, sourceT: null };
    }
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (outputT <= segment.outEnd || index === segments.length - 1) {
        if (segment.kind !== "src") {
          return { segment, sourceT: null };
        }
        const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1;
        const clamped = Math.max(segment.outStart, Math.min(outputT, segment.outEnd));
        return { segment, sourceT: (segment.in ?? 0) + (clamped - segment.outStart) * speed };
      }
    }
    return { segment: null, sourceT: null };
  }

  // src/caption-window.ts
  function captionWindowSeconds(caption) {
    const start = typeof caption.start === "number" && Number.isFinite(caption.start) ? caption.start : 0;
    const duration = typeof caption.duration === "number" && Number.isFinite(caption.duration) ? caption.duration : 0;
    const end = typeof caption.end === "number" && Number.isFinite(caption.end) ? caption.end : start + duration;
    return { start, end };
  }
  function findActiveCaption(captions, sourceSeconds) {
    return captions.find((caption) => {
      const window = captionWindowSeconds(caption);
      return window.start <= sourceSeconds && sourceSeconds < window.end;
    });
  }

  // src/transition-visual.ts
  function computeTransitionVisual(previewKind, rawProgress, fallbackName = "") {
    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    const progress = clamp01(Number.isFinite(rawProgress) ? rawProgress : 0);
    const mid = 1 - Math.abs(2 * progress - 1);
    const percent = (value) => `${value * 100}%`;
    const translateX = (value) => `translateX(${percent(value)})`;
    const translateY = (value) => `translateY(${percent(value)})`;
    const base = {
      progress,
      engine: "none",
      blurStdDeviationRatio: 0,
      pixelBlockRatio: 0,
      dissolveVisibleRatio: 0,
      outgoingOpacity: 1,
      incomingOpacity: 1,
      incomingClipPath: "none",
      outgoingTransform: "",
      incomingTransform: "",
      outgoingMask: "none",
      incomingMask: "none",
      outgoingFilter: "none",
      incomingFilter: "none",
      plateOpacity: 0,
      plateColor: "transparent",
      zSwap: false,
      fallbackLabel: ""
    };
    const cross = () => ({
      ...base,
      outgoingOpacity: 1 - progress,
      incomingOpacity: progress
    });
    if (previewKind === "blur") {
      return { ...cross(), engine: "directional-blur", blurStdDeviationRatio: mid * 0.075 };
    }
    if (previewKind === "pixelize") {
      return { ...cross(), engine: "pixelize", pixelBlockRatio: mid / 22 };
    }
    if (previewKind === "dissolve") {
      return { ...base, engine: "noise-dissolve", dissolveVisibleRatio: progress };
    }
    if (previewKind === "fade") return cross();
    if (previewKind === "fade-black" || previewKind === "fade-white") {
      return {
        ...cross(),
        plateOpacity: clamp01(Math.min(progress / 0.18, (1 - progress) / 0.7)),
        plateColor: previewKind === "fade-white" ? "#fff" : "#000"
      };
    }
    if (previewKind === "fade-grays") {
      const filter = `grayscale(${mid})`;
      return { ...cross(), outgoingFilter: filter, incomingFilter: filter };
    }
    const hidden = 1 - progress;
    if (previewKind === "wipe-left") return { ...base, incomingClipPath: `inset(0 0 0 ${percent(hidden)})` };
    if (previewKind === "wipe-right") return { ...base, incomingClipPath: `inset(0 ${percent(hidden)} 0 0)` };
    if (previewKind === "wipe-up") return { ...base, incomingClipPath: `inset(${percent(hidden)} 0 0 0)` };
    if (previewKind === "wipe-down") return { ...base, incomingClipPath: `inset(0 0 ${percent(hidden)} 0)` };
    if (previewKind === "slide-left") {
      return { ...base, outgoingTransform: translateX(-progress), incomingTransform: translateX(hidden) };
    }
    if (previewKind === "slide-right") {
      return { ...base, outgoingTransform: translateX(progress), incomingTransform: translateX(-hidden) };
    }
    if (previewKind === "slide-up") {
      return { ...base, outgoingTransform: translateY(-progress), incomingTransform: translateY(hidden) };
    }
    if (previewKind === "slide-down") {
      return { ...base, outgoingTransform: translateY(progress), incomingTransform: translateY(-hidden) };
    }
    if (previewKind === "cover-left") return { ...base, incomingTransform: translateX(hidden) };
    if (previewKind === "cover-right") return { ...base, incomingTransform: translateX(-hidden) };
    if (previewKind === "cover-up") return { ...base, incomingTransform: translateY(hidden) };
    if (previewKind === "cover-down") return { ...base, incomingTransform: translateY(-hidden) };
    if (previewKind === "reveal-left") {
      return { ...base, outgoingTransform: translateX(-progress), zSwap: true };
    }
    if (previewKind === "reveal-right") {
      return { ...base, outgoingTransform: translateX(progress), zSwap: true };
    }
    if (previewKind === "reveal-up") {
      return { ...base, outgoingTransform: translateY(-progress), zSwap: true };
    }
    if (previewKind === "reveal-down") {
      return { ...base, outgoingTransform: translateY(progress), zSwap: true };
    }
    if (previewKind === "circle-open") {
      const c = progress * 170 - 35;
      return {
        ...base,
        incomingMask: `radial-gradient(circle farthest-corner, #000 ${c - 35}%, transparent ${c + 35}%)`
      };
    }
    if (previewKind === "circle-close") {
      const c = (1 - progress) * 170 - 35;
      return {
        ...base,
        outgoingMask: `radial-gradient(circle farthest-corner, #000 ${c - 35}%, transparent ${c + 35}%)`,
        zSwap: true
      };
    }
    if (previewKind === "radial") {
      const c = progress * 424 - 32;
      return {
        ...base,
        incomingMask: `conic-gradient(from 0deg, #000 ${c - 16}deg, transparent ${c + 16}deg)`
      };
    }
    if (previewKind === "zoom-in") {
      return {
        ...base,
        outgoingOpacity: progress < 0.6 ? 1 : 1 - (progress - 0.6) / 0.4,
        outgoingTransform: `scale(${1 + 1.5 * progress})`,
        outgoingFilter: `blur(${6 * progress}px)`,
        zSwap: true
      };
    }
    if (previewKind === "squeeze-h") {
      return { ...base, outgoingTransform: `scaleY(${1 - progress})`, zSwap: true };
    }
    if (previewKind === "squeeze-v") {
      return { ...base, outgoingTransform: `scaleX(${1 - progress})`, zSwap: true };
    }
    return {
      ...cross(),
      fallbackLabel: `${fallbackName || previewKind} \u2014 \u30D7\u30EC\u30D3\u30E5\u30FC\u8FD1\u4F3C\u306A\u3057`
    };
  }

  // src/envelope.ts
  var DEFAULT_DUCK_DB = -12;
  var DEFAULT_DUCK_ATTACK_SEC = 0.3;
  var DEFAULT_DUCK_RELEASE_SEC = 0.8;
  var DEFAULT_DUCK_KEYS = ["narration", "speech"];
  var SAMPLE_STEP_SEC = 0.02;
  var MIN_LINEAR_GAIN = 1e-4;
  var CUBIC_BEZIER_PATTERN = /^cubic-bezier\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*\)$/iu;
  function easingProgress(easing, progress) {
    const value = clamp(progress);
    switch (easing ?? "linear") {
      case "hold":
        return 0;
      case "ease-in-out":
      case "in-out-cubic":
        return value < 0.5 ? 4 * value * value * value : 1 - (-2 * value + 2) ** 3 / 2;
      case "in-quad":
        return value * value;
      case "out-quad":
        return 1 - (1 - value) ** 2;
      case "in-out-quad":
        return value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
      case "in-cubic":
        return value ** 3;
      case "out-cubic":
        return 1 - (1 - value) ** 3;
      case "in-quart":
        return value ** 4;
      case "out-quart":
        return 1 - (1 - value) ** 4;
      case "in-out-quart":
        return value < 0.5 ? 8 * value ** 4 : 1 - (-2 * value + 2) ** 4 / 2;
      case "in-expo":
        return value === 0 ? 0 : 2 ** (10 * value - 10);
      case "out-expo":
        return value === 1 ? 1 : 1 - 2 ** (-10 * value);
      case "in-out-expo":
        if (value === 0 || value === 1) return value;
        return value < 0.5 ? 2 ** (20 * value - 10) / 2 : (2 - 2 ** (-20 * value + 10)) / 2;
      case "in-back": {
        const c1 = 1.70158;
        return (c1 + 1) * value ** 3 - c1 * value ** 2;
      }
      case "out-back": {
        const c1 = 1.70158;
        return 1 + (c1 + 1) * (value - 1) ** 3 + c1 * (value - 1) ** 2;
      }
      case "in-out-back": {
        const c2 = 1.70158 * 1.525;
        return value < 0.5 ? (2 * value) ** 2 * ((c2 + 1) * 2 * value - c2) / 2 : ((2 * value - 2) ** 2 * ((c2 + 1) * (value * 2 - 2) + c2) + 2) / 2;
      }
      case "out-bounce": {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (value < 1 / d1) return n1 * value * value;
        if (value < 2 / d1) {
          const shifted2 = value - 1.5 / d1;
          return n1 * shifted2 * shifted2 + 0.75;
        }
        if (value < 2.5 / d1) {
          const shifted2 = value - 2.25 / d1;
          return n1 * shifted2 * shifted2 + 0.9375;
        }
        const shifted = value - 2.625 / d1;
        return n1 * shifted * shifted + 0.984375;
      }
      case "out-elastic":
        if (value === 0 || value === 1) return value;
        return 2 ** (-10 * value) * Math.sin((value * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
      case "linear":
        return value;
      default: {
        const match = typeof easing === "string" ? easing.match(CUBIC_BEZIER_PATTERN) : null;
        if (!match) return value;
        return cubicBezierAt(value, ...match.slice(1).map(Number));
      }
    }
  }
  function evaluateEnvelopeDb(points, t) {
    const usable = normalizedPoints(points);
    if (usable.length === 0) return 0;
    if (t <= usable[0].t) return usable[0].gainDb;
    const last = usable[usable.length - 1];
    if (t >= last.t) return last.gainDb;
    for (let index = 1; index < usable.length; index += 1) {
      const end = usable[index];
      if (t >= end.t) continue;
      const start = usable[index - 1];
      const span = end.t - start.t;
      if (!(span > 0)) return end.gainDb;
      const coefficient = easingProgress(end.easing, (t - start.t) / span);
      return start.gainDb + (end.gainDb - start.gainDb) * coefficient;
    }
    return last.gainDb;
  }
  function composeEnvelopesDb(a, b) {
    const left = normalizedPoints(a);
    const right = normalizedPoints(b);
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    const boundaries = [...new Set([...left, ...right].map((point) => point.t))].sort((x, y) => x - y);
    const times = new Set(boundaries);
    for (let index = 1; index < boundaries.length; index += 1) {
      const start = boundaries[index - 1];
      const end = boundaries[index];
      if (!isNonLinearAt(left, (start + end) / 2) && !isNonLinearAt(right, (start + end) / 2)) continue;
      for (let at = start + SAMPLE_STEP_SEC; at < end - 1e-9; at += SAMPLE_STEP_SEC) {
        times.add(Number(at.toFixed(9)));
      }
    }
    return [...times].sort((x, y) => x - y).map((t) => ({
      t,
      gainDb: evaluateEnvelopeDb(left, t) + evaluateEnvelopeDb(right, t)
    }));
  }
  function envelopeToGainEvents(points) {
    const usable = normalizedPoints(points);
    if (usable.length === 0) return [];
    const events = [{
      offsetSec: usable[0].t,
      value: dbToLinear(usable[0].gainDb),
      method: "set"
    }];
    for (let index = 1; index < usable.length; index += 1) {
      const start = usable[index - 1];
      const end = usable[index];
      const easing = end.easing ?? "linear";
      if (easing === "hold") {
        events.push({ offsetSec: end.t, value: dbToLinear(end.gainDb), method: "set" });
        continue;
      }
      if (easing === "linear") {
        events.push({ offsetSec: end.t, value: dbToLinear(end.gainDb), method: "exponential" });
        continue;
      }
      for (let at = start.t + SAMPLE_STEP_SEC; at < end.t - 1e-9; at += SAMPLE_STEP_SEC) {
        events.push({
          offsetSec: Number(at.toFixed(9)),
          value: dbToLinear(evaluateEnvelopeDb(usable, at)),
          method: "exponential"
        });
      }
      events.push({ offsetSec: end.t, value: dbToLinear(end.gainDb), method: "exponential" });
    }
    return events;
  }
  function sampleEnvelopeLinear(points, options) {
    const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0 ? options.sampleRate : 48e3;
    const durationSec = Number.isFinite(options.durationSec) && options.durationSec > 0 ? options.durationSec : 0;
    const samples = new Float32Array(Math.ceil(sampleRate * durationSec));
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = dbToLinear(evaluateEnvelopeDb(points, index / sampleRate));
    }
    return samples;
  }
  function computeDuckEnvelope(intervals, options) {
    const duckDb = finiteInRange(options.duckDb, -40, 0, DEFAULT_DUCK_DB);
    const attackSec = finiteInRange(options.attackSec, 0, 2, DEFAULT_DUCK_ATTACK_SEC);
    const releaseSec = finiteInRange(options.releaseSec, 0, 5, DEFAULT_DUCK_RELEASE_SEC);
    const clipStartSec = Number.isFinite(options.clipStartSec) ? Math.max(0, options.clipStartSec) : 0;
    const clipDurationSec = Number.isFinite(options.clipDurationSec) ? Math.max(0, options.clipDurationSec) : 0;
    if (!(clipDurationSec > 0)) return [];
    const merged = mergeIntervals(intervals, attackSec + releaseSec);
    if (merged.length === 0) return [];
    const absolute = [];
    for (const interval of merged) {
      const rampStart = Math.max(0, interval.startSec - attackSec);
      if (rampStart < interval.startSec) absolute.push({ t: rampStart, gainDb: 0 });
      absolute.push({ t: interval.startSec, gainDb: duckDb, easing: rampStart < interval.startSec ? "linear" : "hold" });
      if (releaseSec > 0) {
        absolute.push({ t: interval.endSec, gainDb: duckDb, easing: "hold" });
        absolute.push({ t: interval.endSec + releaseSec, gainDb: 0, easing: "linear" });
      } else {
        absolute.push({ t: interval.endSec, gainDb: 0, easing: "hold" });
      }
    }
    const normalized = normalizedPoints(absolute);
    const clipEndSec = clipStartSec + clipDurationSec;
    const active = merged.some((interval) => interval.startSec < clipEndSec + releaseSec && interval.endSec > Math.max(0, clipStartSec - attackSec));
    if (!active) return [];
    const clippedTimes = [
      clipStartSec,
      ...normalized.filter((point) => point.t > clipStartSec && point.t < clipEndSec).map((point) => point.t),
      clipEndSec
    ];
    return [...new Set(clippedTimes)].sort((a, b) => a - b).map((t) => ({
      t: t - clipStartSec,
      gainDb: evaluateEnvelopeDb(normalized, t),
      ...easingAtExactPoint(normalized, t)
    }));
  }
  function normalizedPoints(points) {
    const sorted = points.filter((point) => point && Number.isFinite(point.t) && point.t >= 0 && Number.isFinite(point.gainDb)).map((point) => ({ ...point })).sort((a, b) => a.t - b.t);
    const result = [];
    for (const point of sorted) {
      if (result.length > 0 && Math.abs(result[result.length - 1].t - point.t) <= 1e-9) result[result.length - 1] = point;
      else result.push(point);
    }
    return result;
  }
  function isNonLinearAt(points, t) {
    for (let index = 1; index < points.length; index += 1) {
      if (t < points[index].t) {
        const easing = points[index].easing ?? "linear";
        return easing !== "linear" && easing !== "hold";
      }
    }
    return false;
  }
  function mergeIntervals(intervals, maximumGapSec) {
    const sorted = intervals.filter((interval) => interval && Number.isFinite(interval.startSec) && Number.isFinite(interval.endSec) && interval.startSec >= 0 && interval.endSec > interval.startSec).map((interval) => ({ ...interval })).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    const merged = [];
    for (const interval of sorted) {
      const last = merged[merged.length - 1];
      if (last && interval.startSec - last.endSec < maximumGapSec) last.endSec = Math.max(last.endSec, interval.endSec);
      else if (last && interval.startSec <= last.endSec) last.endSec = Math.max(last.endSec, interval.endSec);
      else merged.push(interval);
    }
    return merged;
  }
  function easingAtExactPoint(points, t) {
    const point = points.find((candidate) => Math.abs(candidate.t - t) <= 1e-9);
    return point?.easing ? { easing: point.easing } : {};
  }
  function dbToLinear(db) {
    return Math.max(MIN_LINEAR_GAIN, 10 ** (db / 20));
  }
  function finiteInRange(value, minimum, maximum, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
  }
  function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
  }
  function cubicCoordinateAt(parameter, first, second) {
    const inverse = 1 - parameter;
    return 3 * inverse * inverse * parameter * first + 3 * inverse * parameter * parameter * second + parameter * parameter * parameter;
  }
  function cubicBezierAt(progress, x1, y1, x2, y2) {
    if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return progress;
    if (x1 === y1 && x2 === y2) return progress;
    let lower = 0;
    let upper = 1;
    for (let index = 0; index < 32; index += 1) {
      const parameter = (lower + upper) / 2;
      if (cubicCoordinateAt(parameter, x1, x2) < progress) lower = parameter;
      else upper = parameter;
    }
    return cubicCoordinateAt((lower + upper) / 2, y1, y2);
  }

  // src/ducking.ts
  var STATIC_DUCK_GAIN_DB = DEFAULT_DUCK_DB;
  function computeDuckIntervals(sources) {
    return sources.filter(
      (s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.durationSec) && s.durationSec > 0
    ).map((s) => ({ startSec: s.t, endSec: s.t + s.durationSec }));
  }
  function isWithinDuckInterval(intervals, atSec) {
    return intervals.some((iv) => atSec >= iv.startSec && atSec < iv.endSec);
  }

  // src/audio-schedule.ts
  function buildWebAudioSchedule(input) {
    const warnings = [];
    const timelineDurationSec = finitePositive(input.timelineDurationSec) ? input.timelineDurationSec : 0;
    const startAtSec = Math.max(0, Math.min(
      timelineDurationSec,
      Number.isFinite(input.startAtSec) ? input.startAtSec : 0
    ));
    const audio = input.audio;
    if (!audio || timelineDurationSec <= 0 || startAtSec >= timelineDurationSec) {
      return { timelineDurationSec, startAtSec, items: [], duckIntervals: [], warnings };
    }
    const narration = resolveTimedItems("narration", audio.narration, timelineDurationSec, warnings);
    const sfx = resolveTimedItems("sfx", audio.sfx, timelineDurationSec, warnings);
    const narrationIntervals = computeDuckIntervals(narration.map((item) => ({
      t: item.t,
      durationSec: item.itemDurationSec
    })));
    const duckKeys = normalizedDuckKeys(audio.duck_keys);
    const speechIntervals = input.duckKeyIntervals ?? input.speechKeyIntervals ?? [];
    const duckIntervals = mergeDuckIntervals([
      ...duckKeys.includes("narration") ? narrationIntervals : [],
      ...duckKeys.includes("speech") ? speechIntervals : []
    ]);
    const items = [];
    const bgm = audio.bgm;
    if (bgm) {
      const scheduled = scheduleBgm(bgm, timelineDurationSec, startAtSec, duckIntervals, warnings);
      if (scheduled) items.push(scheduled);
    }
    for (const item of sfx) {
      const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
      if (scheduled) items.push(scheduled);
    }
    for (const item of narration) {
      const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
      if (scheduled) items.push(scheduled);
    }
    for (const speech of audio.speech ?? []) {
      const scheduled = scheduleSpeech(speech, timelineDurationSec, startAtSec, warnings);
      if (scheduled) items.push(scheduled);
    }
    return { timelineDurationSec, startAtSec, items, duckIntervals, warnings };
  }
  function resolveTimedItems(kind, specs, timelineDurationSec, warnings) {
    if (!Array.isArray(specs)) return [];
    const resolved = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const id = typeof spec?.id === "string" && spec.id ? spec.id : `${kind}-${index + 1}`;
      const label = `${kind} ${id}`;
      if (!spec || !finitePositive(spec.durationSec)) {
        warnings.push(`${label}: decoded duration is invalid; skipped`);
        continue;
      }
      if (typeof spec.t !== "number" || !Number.isFinite(spec.t) || spec.t < 0 || spec.t >= timelineDurationSec) {
        warnings.push(`${label}: t is outside timeline duration; skipped`);
        continue;
      }
      const gainDb = normalizedGainDb(spec, label, warnings);
      if (gainDb === null) continue;
      const sidecar = validSidecar(spec.sidecar);
      if (spec.sidecar && !sidecar) warnings.push(`${label}: sidecar declaration is invalid; using source`);
      const playbackRate = kind === "sfx" && !sidecar && finiteClipSpeed(spec.speed) ? spec.speed : 1;
      const trim = sidecar ? { sourceOffsetSec: 0, durationSec: sidecar.durationSec } : resolveTrim(kind, spec, label, warnings);
      if (!trim) continue;
      resolved.push({
        spec,
        id,
        kind,
        t: spec.t,
        track: normalizedTrack(spec.track),
        materialDurationSec: spec.durationSec,
        sourceOffsetSec: trim.sourceOffsetSec,
        itemDurationSec: sidecar ? trim.durationSec : trim.durationSec / playbackRate,
        playbackRate,
        gainDb
      });
    }
    return resolved;
  }
  function resolveTrim(kind, spec, label, warnings) {
    const materialDurationSec = spec.durationSec;
    let sourceOffsetSec = finiteNonNegative(spec.in) ? spec.in : 0;
    if (sourceOffsetSec >= materialDurationSec) {
      if (kind === "sfx") {
        warnings.push(`${label}: in is at or beyond decoded duration; skipped`);
        return null;
      }
      warnings.push(`${label}: in is at or beyond decoded duration; clamped to 0s`);
      sourceOffsetSec = 0;
    }
    let outSec = finitePositive(spec.out) ? spec.out : materialDurationSec;
    if (outSec > materialDurationSec) {
      warnings.push(`${label}: out exceeds decoded duration; clamped to material end`);
      outSec = materialDurationSec;
    }
    if (outSec <= sourceOffsetSec) {
      warnings.push(`${label}: out <= in after clamping; skipped`);
      return null;
    }
    return { sourceOffsetSec, durationSec: outSec - sourceOffsetSec };
  }
  function scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals) {
    const itemEndSec = item.t + item.itemDurationSec;
    if (itemEndSec <= startAtSec) return null;
    const delaySec = Math.max(0, item.t - startAtSec);
    const elapsedIntoItemSec = Math.max(0, startAtSec - item.t);
    const durationSec = Math.min(
      item.itemDurationSec - elapsedIntoItemSec,
      timelineDurationSec - startAtSec - delaySec
    );
    if (!(durationSec > 0)) return null;
    const timelineStartSec = startAtSec + delaySec;
    const baseGain = dbToLinear2(item.gainDb);
    const gainEvents = item.kind === "sfx" ? fadeGainEvents(
      item.spec.fade_in ?? item.spec.fadeIn,
      item.spec.fade_out ?? item.spec.fadeOut,
      item.itemDurationSec,
      elapsedIntoItemSec,
      durationSec,
      baseGain
    ) : [{ offsetSec: 0, value: baseGain, method: "set" }];
    return {
      kind: item.kind,
      id: item.id,
      track: item.track,
      timelineStartSec,
      timelineEndSec: timelineStartSec + durationSec,
      delaySec,
      sourceOffsetSec: item.sourceOffsetSec + elapsedIntoItemSec * item.playbackRate,
      durationSec,
      playbackRate: item.playbackRate,
      sourceDurationSec: durationSec * item.playbackRate,
      loop: false,
      gainDb: item.gainDb,
      gainEvents,
      envelopeEvents: scheduledEnvelopeEvents(
        item.spec,
        item.t,
        item.itemDurationSec,
        elapsedIntoItemSec,
        durationSec,
        item.kind === "sfx" ? duckIntervals : []
      )
    };
  }
  function scheduleBgm(spec, timelineDurationSec, startAtSec, duckIntervals, warnings) {
    const label = "bgm";
    if (!finitePositive(spec.durationSec)) {
      warnings.push(`${label}: decoded duration is invalid; skipped`);
      return null;
    }
    const gainDb = normalizedGainDb(spec, label, warnings);
    if (gainDb === null) return null;
    const timelineT = typeof spec.t === "number" && Number.isFinite(spec.t) && spec.t > 0 ? spec.t : 0;
    if (timelineT >= timelineDurationSec) return null;
    const sidecar = validSidecar(spec.sidecar);
    if (spec.sidecar && !sidecar) warnings.push(`${label}: sidecar declaration is invalid; using source`);
    const materialDurationSec = sidecar ? sidecar.durationSec : spec.durationSec;
    const playbackRate = sidecar ? 1 : finiteClipSpeed(spec.speed) ? spec.speed : 1;
    let materialInSec = sidecar ? 0 : finiteNonNegative(spec.in) ? spec.in : 0;
    if (materialInSec >= materialDurationSec) {
      warnings.push(`${label}: in is at or beyond decoded duration; clamped to 0s`);
      materialInSec = 0;
    }
    const loop = spec.loop !== false;
    const delaySec = Math.max(0, timelineT - startAtSec);
    const elapsedSec = Math.max(0, startAtSec - timelineT);
    let sourceOffsetSec = materialInSec + elapsedSec * playbackRate;
    if (loop) {
      sourceOffsetSec = positiveModulo(sourceOffsetSec, materialDurationSec);
    } else if (sourceOffsetSec >= materialDurationSec) {
      return null;
    }
    const timelineStartSec = startAtSec + delaySec;
    const timelineAvailableSec = timelineDurationSec - timelineStartSec;
    const durationSec = Math.min(
      timelineAvailableSec,
      loop ? timelineAvailableSec : (materialDurationSec - sourceOffsetSec) / playbackRate
    );
    if (!(durationSec > 0)) return null;
    const baseGain = dbToLinear2(gainDb);
    return {
      kind: "bgm",
      id: typeof spec.id === "string" && spec.id ? spec.id : "bgm",
      track: normalizedTrack(spec.track),
      timelineStartSec,
      timelineEndSec: timelineStartSec + durationSec,
      delaySec,
      sourceOffsetSec,
      durationSec,
      playbackRate,
      sourceDurationSec: durationSec * playbackRate,
      loop,
      gainDb,
      gainEvents: bgmFadeGainEvents(
        spec.fadeIn,
        spec.fadeOut,
        timelineDurationSec,
        timelineStartSec,
        durationSec,
        baseGain
      ),
      envelopeEvents: scheduledEnvelopeEvents(
        spec,
        timelineT,
        timelineDurationSec - timelineT,
        elapsedSec,
        durationSec,
        duckIntervals
      )
    };
  }
  function scheduleSpeech(spec, timelineDurationSec, startAtSec, warnings) {
    const id = typeof spec?.id === "string" && spec.id ? spec.id : "speech";
    const label = `speech ${id}`;
    if (!spec || typeof spec.src !== "string" || !spec.src || !finiteNonNegative(spec.atSec) || !finitePositive(spec.durationSec) || !finiteNonNegative(spec.inSec) || !finitePositive(spec.outSec) || spec.outSec <= spec.inSec || !finitePositive(spec.speed) || !finitePositive(spec.materialDurationSec)) {
      warnings.push(`${label}: declaration is invalid; skipped`);
      return null;
    }
    if (spec.atSec >= timelineDurationSec) return null;
    const gainDb = normalizedGainDb(spec, label, warnings);
    if (gainDb === null) return null;
    const sidecar = validSidecar(spec.sidecar);
    if (spec.sidecar && !sidecar) warnings.push(`${label}: sidecar declaration is invalid; using source`);
    const atempo = spec.atempo && typeof spec.atempo.path === "string" && spec.atempo.path && finitePositive(spec.atempo.durationSec) ? spec.atempo : void 0;
    if (spec.atempo && !atempo) warnings.push(`${label}: atempo declaration is invalid; using source playbackRate`);
    const baked = sidecar ?? atempo;
    const crossfadeInSec = finitePositive(spec.crossfadeInSec) ? spec.crossfadeInSec : 0;
    const crossfadeOutSec = finitePositive(spec.crossfadeOutSec) ? spec.crossfadeOutSec : 0;
    const effectiveAtSec = spec.atSec - crossfadeInSec;
    const effectiveDurationSec = spec.durationSec + crossfadeInSec;
    const elapsedIntoItemSec = Math.max(0, startAtSec - effectiveAtSec);
    if (elapsedIntoItemSec >= effectiveDurationSec) return null;
    const delaySec = Math.max(0, effectiveAtSec - startAtSec);
    const timelineStartSec = startAtSec + delaySec;
    const playbackRate = baked ? 1 : spec.speed;
    const padBeforeSec = sidecar && finiteNonNegative(sidecar.padBeforeSec) ? sidecar.padBeforeSec : finiteNonNegative(spec.padBeforeSec) ? spec.padBeforeSec : 0;
    const bakedContentOffsetSec = sidecar ? padBeforeSec / spec.speed : 0;
    const sourceOffsetSec = baked ? Math.max(0, bakedContentOffsetSec - crossfadeInSec + elapsedIntoItemSec) : Math.max(0, spec.inSec - crossfadeInSec * spec.speed + elapsedIntoItemSec * spec.speed);
    const sourceEndSec = baked ? Math.min(baked.durationSec, spec.materialDurationSec) : Math.min(spec.outSec, spec.materialDurationSec);
    const sourceAvailableSec = sourceEndSec - sourceOffsetSec;
    if (!(sourceAvailableSec > 0)) return null;
    const durationSec = Math.min(
      effectiveDurationSec - elapsedIntoItemSec,
      timelineDurationSec - timelineStartSec,
      sourceAvailableSec / playbackRate
    );
    if (!(durationSec > 0)) return null;
    const baseGain = dbToLinear2(gainDb);
    const gainEvents = speechCrossfadeGainEvents(
      effectiveDurationSec,
      elapsedIntoItemSec,
      durationSec,
      crossfadeInSec,
      crossfadeOutSec,
      baseGain
    );
    return {
      kind: "speech",
      id,
      track: normalizedTrack(spec.track),
      timelineStartSec,
      timelineEndSec: timelineStartSec + durationSec,
      delaySec,
      sourceOffsetSec,
      durationSec,
      playbackRate,
      sourceDurationSec: durationSec * playbackRate,
      loop: false,
      gainDb,
      gainEvents,
      envelopeEvents: []
    };
  }
  function projectSpeechDeclarations(cuts, options) {
    const fps = finitePositive(options?.fps) ? options.fps : 30;
    const normalizedCuts = cuts.map((cut) => ({
      ...cut,
      transitionOut: cut.transitionOut ?? cut.transition_out ?? void 0
    }));
    const virtualCuts = normalizedCuts.map((cut) => {
      const speed = finitePositive(cut?.speed) ? cut.speed : 1;
      const holdSec = freezeDuration(cut?.freeze);
      return { ...cut, out: cut.out + holdSec * speed };
    });
    const map = buildTimelineMap(virtualCuts, { fps });
    const declarations = [];
    for (const segment of map.segments) {
      if (segment.kind !== "src" || segment.cutIndex === null) continue;
      const cut = normalizedCuts[segment.cutIndex];
      if (!cut || typeof cut.src !== "string" || !cut.src) continue;
      const speed = finitePositive(cut.speed) ? cut.speed : 1;
      const segmentIn = typeof segment.in === "number" ? segment.in : cut.in;
      const cutTimelineStart = segment.outStart - (segmentIn - cut.in) / speed;
      const baseDurationSec = Math.max(0, cut.out - cut.in) / speed;
      const gainDb = speechGainDb(cut);
      const baseId = typeof cut.id === "string" && cut.id ? cut.id : `cut-${segment.cutIndex}`;
      const holdSec = freezeDuration(cut.freeze);
      if (!(holdSec > 0)) {
        appendSpeechIntersection(declarations, {
          id: `${baseId}-speech`,
          src: cut.src,
          gainDb,
          speed,
          sourceIn: cut.in,
          outputStart: cutTimelineStart,
          outputEnd: cutTimelineStart + baseDurationSec,
          segmentStart: segment.outStart,
          segmentEnd: segment.outEnd,
          track: cut.track
        });
        continue;
      }
      const freezeAtSec = Math.max(0, Math.min(freezeAt(cut.freeze), baseDurationSec));
      const freezeSourceIn = cut.in + freezeAtSec * speed;
      appendSpeechIntersection(declarations, {
        id: `${baseId}-speech-pre`,
        src: cut.src,
        gainDb,
        speed,
        sourceIn: cut.in,
        outputStart: cutTimelineStart,
        outputEnd: cutTimelineStart + freezeAtSec,
        segmentStart: segment.outStart,
        segmentEnd: segment.outEnd,
        track: cut.track
      });
      appendSpeechIntersection(declarations, {
        id: `${baseId}-speech-post`,
        src: cut.src,
        gainDb,
        speed,
        sourceIn: freezeSourceIn,
        outputStart: cutTimelineStart + freezeAtSec + holdSec,
        outputEnd: cutTimelineStart + baseDurationSec + holdSec,
        segmentStart: segment.outStart,
        segmentEnd: segment.outEnd,
        track: cut.track
      });
    }
    for (const window of map.transitionWindows) {
      if (window.outgoing.cutIndex === null || window.incoming.cutIndex === null) continue;
      const outgoingCut = normalizedCuts[window.outgoing.cutIndex];
      const incomingCut = normalizedCuts[window.incoming.cutIndex];
      const outgoingBase = speechBaseId(outgoingCut, window.outgoing.cutIndex);
      const incomingBase = speechBaseId(incomingCut, window.incoming.cutIndex);
      const outgoing = [...declarations].reverse().find((item) => item.id.startsWith(`${outgoingBase}-speech`) && item.atSec <= window.start + 1e-9 && item.atSec + item.durationSec >= window.end - 1e-9);
      const incoming = declarations.find((item) => item.id.startsWith(`${incomingBase}-speech`) && item.atSec >= window.end - 1e-9);
      if (outgoing) {
        outgoing.padAfterSec = Math.max(outgoing.padAfterSec ?? 0, window.duration);
        outgoing.crossfadeOutSec = Math.max(outgoing.crossfadeOutSec ?? 0, window.duration);
      }
      if (incoming) {
        incoming.padBeforeSec = Math.max(incoming.padBeforeSec ?? 0, window.duration);
        incoming.crossfadeInSec = Math.max(incoming.crossfadeInSec ?? 0, window.duration);
      }
    }
    return declarations;
  }
  function speechBaseId(cut, index) {
    return cut && typeof cut.id === "string" && cut.id ? cut.id : `cut-${index}`;
  }
  function appendSpeechIntersection(declarations, input) {
    const atSec = Math.max(input.outputStart, input.segmentStart);
    const endSec = Math.min(input.outputEnd, input.segmentEnd);
    if (!(endSec > atSec)) return;
    const inSec = input.sourceIn + (atSec - input.outputStart) * input.speed;
    const outSec = inSec + (endSec - atSec) * input.speed;
    declarations.push({
      id: input.id,
      src: input.src,
      atSec,
      durationSec: endSec - atSec,
      inSec,
      outSec,
      speed: input.speed,
      gainDb: input.gainDb,
      track: normalizedTrack(input.track),
      materialDurationSec: outSec
    });
  }
  function freezeDuration(freeze) {
    return freeze && finitePositive(freeze.duration_sec) ? freeze.duration_sec : 0;
  }
  function freezeAt(freeze) {
    return freeze && finiteNonNegative(freeze.at_sec) ? freeze.at_sec : 0;
  }
  function speechGainDb(cut) {
    const raw = cut.gain_db ?? cut.gainDb ?? cut.volume_db;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  }
  function validSidecar(value) {
    return value && typeof value.path === "string" && value.path && finitePositive(value.durationSec) && finiteNonNegative(value.padBeforeSec) && finiteNonNegative(value.padAfterSec) ? value : void 0;
  }
  function speechCrossfadeGainEvents(itemDurationSec, elapsedIntoItemSec, availableSec, fadeInSec, fadeOutSec, baseGain) {
    if (!(fadeInSec > 0) && !(fadeOutSec > 0)) {
      return [{ offsetSec: 0, value: baseGain, method: "set" }];
    }
    const multiplierAt = (localSec) => {
      let value = 1;
      if (fadeInSec > 0 && localSec < fadeInSec) value = Math.min(value, localSec / fadeInSec);
      if (fadeOutSec > 0 && localSec > itemDurationSec - fadeOutSec) {
        value = Math.min(value, (itemDurationSec - localSec) / fadeOutSec);
      }
      return Math.max(0, Math.min(1, value));
    };
    const windowEnd = elapsedIntoItemSec + availableSec;
    return uniqueSorted([
      elapsedIntoItemSec,
      fadeInSec,
      itemDurationSec - fadeOutSec,
      windowEnd
    ].filter((point) => point >= elapsedIntoItemSec && point <= windowEnd)).map((point, index) => ({
      offsetSec: point - elapsedIntoItemSec,
      value: baseGain * multiplierAt(point),
      method: index === 0 ? "set" : "linear"
    }));
  }
  function normalizedGainDb(spec, label, warnings) {
    const raw = spec.gainDb !== void 0 ? spec.gainDb : spec.gain_db;
    if (raw === void 0) return 0;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      warnings.push(`${label}: gain_db is not finite; skipped`);
      return null;
    }
    const clamped = Math.max(-60, Math.min(12, raw));
    if (clamped !== raw) warnings.push(`${label}: gain_db clamped to [-60, 12]`);
    return clamped;
  }
  function fadeGainEvents(rawFadeIn, rawFadeOut, itemDurationSec, elapsedIntoItemSec, availableSec, baseGain) {
    const ceiling = itemDurationSec / 2;
    const fadeIn = finitePositive(rawFadeIn) ? Math.min(rawFadeIn, ceiling) : 0;
    const fadeOut = finitePositive(rawFadeOut) ? Math.min(rawFadeOut, ceiling) : 0;
    const multiplierAt = (localSec) => {
      let multiplier = 1;
      if (fadeIn > 0 && localSec < fadeIn) multiplier = Math.min(multiplier, localSec / fadeIn);
      if (fadeOut > 0 && localSec > itemDurationSec - fadeOut) {
        multiplier = Math.min(multiplier, (itemDurationSec - localSec) / fadeOut);
      }
      return Math.max(0, Math.min(1, multiplier));
    };
    if (fadeIn <= 0 && fadeOut <= 0) {
      return [{ offsetSec: 0, value: baseGain, method: "set" }];
    }
    const windowEnd = elapsedIntoItemSec + availableSec;
    const points = uniqueSorted([
      elapsedIntoItemSec,
      fadeIn,
      itemDurationSec - fadeOut,
      windowEnd
    ].filter((point) => point >= elapsedIntoItemSec && point <= windowEnd));
    return points.map((point, index) => ({
      offsetSec: point - elapsedIntoItemSec,
      value: baseGain * multiplierAt(point),
      method: index === 0 ? "set" : "linear"
    }));
  }
  function bgmFadeGainEvents(rawFadeIn, rawFadeOut, timelineDurationSec, timelineStartSec, availableSec, baseGain) {
    const ceiling = timelineDurationSec / 2;
    const fadeIn = finitePositive(rawFadeIn) ? Math.min(rawFadeIn, ceiling) : 0;
    const fadeOut = finitePositive(rawFadeOut) ? Math.min(rawFadeOut, ceiling) : 0;
    if (fadeIn <= 0 && fadeOut <= 0) {
      return [{ offsetSec: 0, value: baseGain, method: "set" }];
    }
    const timelineEndSec = timelineStartSec + availableSec;
    const multiplierAt = (timelineSec) => {
      let multiplier = 1;
      if (fadeIn > 0 && timelineSec < fadeIn) multiplier = Math.min(multiplier, timelineSec / fadeIn);
      if (fadeOut > 0 && timelineSec > timelineDurationSec - fadeOut) {
        multiplier = Math.min(multiplier, (timelineDurationSec - timelineSec) / fadeOut);
      }
      return Math.max(0, Math.min(1, multiplier));
    };
    const points = uniqueSorted([
      timelineStartSec,
      fadeIn,
      timelineDurationSec - fadeOut,
      timelineEndSec
    ].filter((point) => point >= timelineStartSec && point <= timelineEndSec));
    return points.map((point, index) => ({
      offsetSec: point - timelineStartSec,
      value: baseGain * multiplierAt(point),
      method: index === 0 ? "set" : "linear"
    }));
  }
  function scheduledEnvelopeEvents(spec, clipStartSec, clipDurationSec, elapsedIntoClipSec, availableSec, intervals) {
    const keyframes = audioKeyframeEnvelope(spec.keyframes);
    const duck = spec.ducking === true ? computeDuckEnvelope(intervals, {
      duckDb: finiteRange(spec.duck_db, -40, 0),
      attackSec: finiteRange(spec.duck_attack, 0, 2),
      releaseSec: finiteRange(spec.duck_release, 0, 5),
      clipStartSec,
      clipDurationSec
    }) : [];
    const composed = composeEnvelopesDb(keyframes, duck);
    if (composed.length === 0 || composed.every((point) => Math.abs(point.gainDb) <= 1e-12)) return [];
    return envelopeToGainEvents(sliceEnvelope(composed, elapsedIntoClipSec, availableSec));
  }
  function audioKeyframeEnvelope(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const point = entry;
      if (!finiteNonNegative(point.t) || typeof point.gain_db !== "number" || !Number.isFinite(point.gain_db)) return [];
      return [{
        t: point.t,
        gainDb: point.gain_db,
        ...typeof point.easing === "string" ? { easing: point.easing } : {}
      }];
    }).sort((left, right) => left.t - right.t);
  }
  function sliceEnvelope(points, startSec, durationSec) {
    if (points.length === 0 || !(durationSec > 0)) return [];
    const endSec = startSec + durationSec;
    return [
      { t: 0, gainDb: evaluateEnvelopeDb(points, startSec) },
      ...points.filter((point) => point.t > startSec && point.t < endSec).map((point) => ({
        ...point,
        t: point.t - startSec
      })),
      { t: durationSec, gainDb: evaluateEnvelopeDb(points, endSec) }
    ];
  }
  function normalizedDuckKeys(value) {
    if (!Array.isArray(value)) return [...DEFAULT_DUCK_KEYS];
    return [...new Set(value.filter((entry) => entry === "narration" || entry === "speech"))];
  }
  function mergeDuckIntervals(intervals) {
    const sorted = intervals.filter((interval) => interval && finiteNonNegative(interval.startSec) && finitePositive(interval.endSec) && interval.endSec > interval.startSec).map((interval) => ({ ...interval })).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    const result = [];
    for (const interval of sorted) {
      const last = result[result.length - 1];
      if (last && interval.startSec <= last.endSec) last.endSec = Math.max(last.endSec, interval.endSec);
      else result.push(interval);
    }
    return result;
  }
  function finiteRange(value, minimum, maximum) {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : void 0;
  }
  function normalizedTrack(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  }
  function finitePositive(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
  function finiteClipSpeed(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0.25 && value <= 4;
  }
  function finiteNonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }
  function positiveModulo(value, modulus) {
    return (value % modulus + modulus) % modulus;
  }
  function dbToLinear2(value) {
    return Math.pow(10, value / 20);
  }
  function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left - right);
  }

  // src/caption-display.ts
  var CAPTION_VERTICAL_ALIGN_VALUES = /* @__PURE__ */ new Set(["top", "middle", "bottom"]);
  var CAPTION_TEXT_ANCHOR_VALUES = /* @__PURE__ */ new Set(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]);
  var CAPTION_LAYOUT_KEYS = /* @__PURE__ */ new Set([
    "mode",
    "reference_width_px",
    "reference_height_px",
    "left_px",
    "width_px",
    "bottom_px",
    "text_align",
    "max_lines"
  ]);
  var CAPTION_LAYOUT_REQUIRED_KEYS = [...CAPTION_LAYOUT_KEYS];
  function captionAnchorPositionVars(anchorValue, positionValue, verticalAlignValue) {
    const anchor = typeof anchorValue === "string" && CAPTION_TEXT_ANCHOR_VALUES.has(anchorValue) ? anchorValue : void 0;
    const position = isRecord(positionValue) ? positionValue : void 0;
    const verticalAlign = typeof verticalAlignValue === "string" && CAPTION_VERTICAL_ALIGN_VALUES.has(verticalAlignValue) ? verticalAlignValue : void 0;
    if (!anchor && !position && !verticalAlign) return {};
    const vars = {};
    const vertical = anchor ? anchor[0] : verticalAlign === "top" ? "t" : verticalAlign === "middle" ? "m" : "b";
    const horizontal = anchor ? anchor[1] : "c";
    if (typeof position?.y === "number" && Number.isFinite(position.y)) {
      const clamped = Math.min(1, Math.max(0, position.y));
      if ((anchor || verticalAlign) && vertical === "b") {
        vars["--caption-top"] = "auto";
        vars["--caption-bottom"] = `${Math.round((1 - clamped) * 1e4) / 100}%`;
      } else {
        vars["--caption-top"] = `${Math.round(clamped * 1e4) / 100}%`;
        vars["--caption-bottom"] = "auto";
        if ((anchor || verticalAlign) && vertical === "m") {
          vars["--caption-translate"] = "0 -50%";
        }
      }
    } else if (anchor || verticalAlign) {
      vars["--caption-top"] = vertical === "t" ? "7%" : vertical === "m" ? "0" : "auto";
      vars["--caption-bottom"] = vertical === "b" ? "7%" : vertical === "m" ? "0" : "auto";
      if (vertical === "m") vars["--caption-justify-content"] = "center";
    }
    if (typeof position?.x === "number" && Number.isFinite(position.x)) {
      const clamped = Math.min(1, Math.max(0, position.x));
      vars["--caption-left"] = `${Math.round(clamped * 1e4) / 100}%`;
      vars["--caption-right"] = "4%";
      vars["--caption-align-items"] = "flex-start";
      vars["--caption-line-margin"] = "0";
    } else if (anchor) {
      vars["--caption-left"] = "4%";
      vars["--caption-right"] = "4%";
      vars["--caption-align-items"] = horizontal === "l" ? "flex-start" : horizontal === "r" ? "flex-end" : "center";
      vars["--caption-text-align"] = horizontal === "l" ? "left" : horizontal === "r" ? "right" : "center";
      vars["--caption-line-margin"] = "0";
      vars["--caption-line-max-width"] = "100%";
    }
    return vars;
  }
  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // src/webview-kernel.ts
  function findActiveResolvedCaption(cues, outputTime) {
    return cues.find((cue) => cue.start <= outputTime && outputTime < cue.end);
  }
  return __toCommonJS(webview_kernel_exports);
})();
