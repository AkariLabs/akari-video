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
    buildTimelineMap: () => buildTimelineMap,
    captionWindowSeconds: () => captionWindowSeconds,
    findActiveCaption: () => findActiveCaption,
    findActiveResolvedCaption: () => findActiveResolvedCaption,
    outputToSource: () => outputToSource,
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

  // src/timeline-map.ts
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
      track: segment.track,
      cut: usableCuts[segment.index],
      cutIndex: usable[segment.index].index
    }));
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

  // src/webview-kernel.ts
  function findActiveResolvedCaption(cues, outputTime) {
    return cues.find((cue) => cue.start <= outputTime && outputTime < cue.end);
  }
  return __toCommonJS(webview_kernel_exports);
})();
