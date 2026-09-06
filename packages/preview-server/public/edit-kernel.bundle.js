// ../edit-store/src/transition-vocabulary.ts
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

// ../edit-store/src/edit-store.ts
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

// ../edit-store/src/cut-adjacency.ts
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
var STILL_IMAGE_SOURCE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/iu;
function isStillImageSourcePath(path) {
  return typeof path === "string" && STILL_IMAGE_SOURCE_PATTERN.test(path);
}

// ../edit-store/src/timeline-map.ts
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
function sourceToOutput(segments, sourceT) {
  const sources = segments.filter((segment) => segment.kind === "src" && typeof segment.in === "number" && typeof segment.out === "number");
  if (sources.length === 0 || !Number.isFinite(sourceT)) {
    return null;
  }
  for (const segment of sources) {
    const start = segment.in;
    const end = segment.out;
    if (start <= sourceT && sourceT < end) {
      const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1;
      return segment.outStart + (sourceT - start) / speed;
    }
  }
  const next = sources.find((segment) => segment.in > sourceT);
  return next?.outStart ?? sources[sources.length - 1].outEnd;
}

// ../edit-store/src/caption-window.ts
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

// ../edit-store/src/caption-clock.ts
var EPSILON = 1e-6;
function normalizeCaptionClock(captions, segments) {
  const output = [];
  for (const caption of captions) {
    const legacyOutputCue = caption.clockDomain === "legacy" && segments.some(
      (segment) => segment.kind === "gap" && caption.start >= segment.outStart - EPSILON && caption.end <= segment.outEnd + EPSILON
    );
    const domain = caption.clockDomain === "legacy" ? legacyOutputCue ? "output" : "source" : caption.clockDomain;
    if (domain === "output" || segments.length === 0) {
      output.push({ ...caption, clockDomain: "output" });
      continue;
    }
    let occurrence = 0;
    for (const segment of segments) {
      if (segment.kind !== "src" || segment.in === void 0 || segment.out === void 0) continue;
      if (caption.clockSourceId !== void 0 && segment.src !== caption.clockSourceId) continue;
      const sourceStart = Math.max(caption.start, segment.in);
      const sourceEnd = Math.min(caption.end, segment.out);
      if (!(sourceEnd - sourceStart > EPSILON)) continue;
      const speed = typeof segment.speed === "number" && segment.speed > 0 ? segment.speed : 1;
      const projectTime = (sourceTime) => segment.outStart + (sourceTime - (segment.in ?? 0)) / speed;
      occurrence += 1;
      const sourceCueId = caption.sourceCueId ?? caption.id;
      const words = caption.words?.flatMap((word) => {
        const wordStart = Math.max(word.start, sourceStart);
        const wordEnd = Math.min(word.end, sourceEnd);
        return wordEnd - wordStart > EPSILON ? [{ ...word, start: projectTime(wordStart), end: projectTime(wordEnd) }] : [];
      });
      output.push({
        ...caption,
        ...caption.id ? { id: `${caption.id}-output-${occurrence}` } : {},
        ...sourceCueId ? { sourceCueId } : {},
        start: projectTime(sourceStart),
        end: projectTime(sourceEnd),
        ...words && words.length > 0 ? { words } : { words: void 0 },
        clockDomain: "output"
      });
    }
  }
  return output.sort((left, right) => left.start - right.start || left.end - right.end);
}
function captionClockDomainOf(raw) {
  const clockDomain = raw?.time_domain === "source" || raw?.time_domain === "output" ? raw.time_domain : "legacy";
  return {
    clockDomain,
    ...typeof raw?.src === "string" && raw.src ? { clockSourceId: raw.src } : {}
  };
}

// ../edit-store/src/caption-style-preset.ts
var NESTED_STYLE_FIELDS = [
  "stroke",
  "background",
  "shadow",
  "glow",
  "position",
  "animation"
];
function mergePresetTextStyle(presetStyle, recordStyle) {
  const override = isRecord(recordStyle) ? recordStyle : {};
  const merged = {
    ...presetStyle,
    ...override
  };
  for (const field of NESTED_STYLE_FIELDS) {
    const base = isRecord(presetStyle[field]) ? presetStyle[field] : void 0;
    const nestedOverride = isRecord(override[field]) ? override[field] : void 0;
    if (base || nestedOverride) {
      const nested = { ...base, ...nestedOverride };
      if (Object.keys(nested).length > 0) merged[field] = nested;
      else delete merged[field];
    }
  }
  return merged;
}
function resolveCaptionStylePreset(record, catalog) {
  const presetId = record.style_preset;
  if (typeof presetId !== "string") return { record, resolved: false };
  const preset = catalog instanceof Map ? catalog.get(presetId) : Object.prototype.hasOwnProperty.call(catalog, presetId) ? catalog[presetId] : void 0;
  if (!preset) return { record, resolved: false };
  return {
    record: {
      ...record,
      text_style: mergePresetTextStyle(preset.style, record.text_style)
    },
    resolved: true
  };
}
function applyCaptionStylePresets(root, catalog) {
  const values = Array.isArray(root) ? root : isRecord(root) && Array.isArray(root.captions) ? root.captions : null;
  if (!values) return { root, unresolved: [] };
  let sawPreset = false;
  let changed = false;
  const unresolved = /* @__PURE__ */ new Set();
  const captions = values.map((value) => {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "style_preset")) {
      return value;
    }
    sawPreset = true;
    const result = resolveCaptionStylePreset(value, catalog);
    if (result.resolved) changed = true;
    else if (typeof value.style_preset === "string") unresolved.add(value.style_preset);
    return result.record;
  });
  if (!sawPreset || !changed) {
    return { root, unresolved: [...unresolved] };
  }
  return {
    root: Array.isArray(root) ? captions : { ...root, captions },
    unresolved: [...unresolved]
  };
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ../edit-store/src/generated/textstyle-catalog.ts
var TEXTSTYLE_CATALOG = {
  "discount-text": {
    "id": "discount-text",
    "name": "\u5272\u5F15\u30D0\u30C3\u30B8\u30C6\u30AD\u30B9\u30C8",
    "category": "price",
    "style": {
      "size_px": 72,
      "weight": 400,
      "color": "#FF2D55",
      "letter_spacing_em": 0.04,
      "stroke": {
        "color": "#ffffff",
        "width_px": 3
      }
    }
  },
  "emphasis-red": {
    "id": "emphasis-red",
    "name": "\u5F37\u8ABF",
    "category": "emphasis",
    "style": {
      "size_px": 92,
      "weight": 700,
      "color": "#ff1744",
      "stroke": {
        "color": "#ffffff",
        "width_px": 6
      },
      "animation": {
        "in": {
          "id": "pop"
        }
      }
    }
  },
  "glitch": {
    "id": "glitch",
    "name": "\u30B0\u30EA\u30C3\u30C1\u98A8",
    "category": "decorative",
    "style": {
      "size_px": 116,
      "weight": 700,
      "color": "#f5f5f5",
      "letter_spacing_em": 0.06,
      "text_transform": "uppercase",
      "shadow": {
        "color": "#ff0066",
        "opacity": 0.9,
        "blur_px": 0,
        "distance_px": 8,
        "angle_deg": 0
      },
      "animation": {
        "in": {
          "id": "glitch"
        }
      }
    }
  },
  "narration-caption": {
    "id": "narration-caption",
    "name": "\u30CA\u30EC\u30FC\u30B7\u30E7\u30F3\u5B57\u5E55",
    "category": "subtitle",
    "style": {
      "font_family": "'Noto Serif JP', serif",
      "size_px": 28,
      "weight": 400,
      "letter_spacing_em": 0.06,
      "shadow": {
        "color": "#000000",
        "opacity": 0.55,
        "blur_px": 6,
        "distance_px": 1,
        "angle_deg": 90
      }
    }
  },
  "neon": {
    "id": "neon",
    "name": "\u30CD\u30AA\u30F3",
    "category": "decorative",
    "style": {
      "size_px": 120,
      "weight": 700,
      "color": "#aefcff",
      "letter_spacing_em": 0.12,
      "text_transform": "uppercase",
      "shadow": {
        "color": "#00e5ff",
        "opacity": 0.9,
        "blur_px": 24,
        "distance_px": 0,
        "angle_deg": 90
      },
      "glow": {
        "color": "#00e5ff",
        "density": 80,
        "spread": 60
      },
      "animation": {
        "in": {
          "id": "soft-fade"
        },
        "loop": {
          "id": "neon-flicker"
        },
        "out": {
          "id": "soft-fade"
        }
      }
    }
  },
  "subtitle-commentary": {
    "id": "subtitle-commentary",
    "name": "\u5B9F\u6CC1\u30C6\u30ED\u30C3\u30D7",
    "category": "subtitle",
    "style": {
      "size_px": 60,
      "weight": 700,
      "color": "#00e676",
      "stroke": {
        "color": "#000000",
        "width_px": 7
      },
      "animation": {
        "in": {
          "id": "caption-rise"
        }
      }
    }
  },
  "subtitle-interview": {
    "id": "subtitle-interview",
    "name": "\u30A4\u30F3\u30BF\u30D3\u30E5\u30FC\u5B57\u5E55",
    "category": "subtitle",
    "style": {
      "size_px": 56,
      "weight": 700,
      "color": "#fffde7",
      "stroke": {
        "color": "#33691e",
        "width_px": 6
      },
      "shadow": {
        "color": "#000000",
        "opacity": 0.5,
        "blur_px": 6,
        "distance_px": 4,
        "angle_deg": 90
      }
    }
  },
  "subtitle-news": {
    "id": "subtitle-news",
    "name": "\u30CB\u30E5\u30FC\u30B9\u98A8",
    "category": "subtitle",
    "style": {
      "size_px": 56,
      "weight": 700,
      "color": "#ffffff",
      "background": {
        "color": "#c62828",
        "opacity": 1,
        "padding_px": 16,
        "radius_px": 0
      }
    }
  },
  "subtitle-standard": {
    "id": "subtitle-standard",
    "name": "\u6A19\u6E96\u5B57\u5E55",
    "category": "subtitle",
    "style": {
      "size_px": 56,
      "weight": 700,
      "color": "#ffffff",
      "stroke": {
        "color": "#000000",
        "width_px": 4
      }
    }
  },
  "subtitle-variety": {
    "id": "subtitle-variety",
    "name": "\u30D0\u30E9\u30A8\u30C6\u30A3",
    "category": "subtitle",
    "style": {
      "size_px": 80,
      "weight": 700,
      "color": "#fff200",
      "stroke": {
        "color": "#1a1a1a",
        "width_px": 9
      },
      "shadow": {
        "color": "#000000",
        "opacity": 0.6,
        "blur_px": 6,
        "distance_px": 6,
        "angle_deg": 90
      }
    }
  },
  "title-impact": {
    "id": "title-impact",
    "name": "\u30A4\u30F3\u30D1\u30AF\u30C8",
    "category": "title",
    "style": {
      "size_px": 168,
      "weight": 700,
      "color": "#ffeb3b",
      "stroke": {
        "color": "#000000",
        "width_px": 10
      },
      "shadow": {
        "color": "#000000",
        "opacity": 0.7,
        "blur_px": 14,
        "distance_px": 8,
        "angle_deg": 90
      }
    }
  },
  "verdict-badge": {
    "id": "verdict-badge",
    "name": "\u5224\u5B9A\u30D0\u30C3\u30B8",
    "category": "emphasis",
    "style": {
      "size_px": 80,
      "weight": 400,
      "letter_spacing_em": -0.02,
      "stroke": {
        "color": "#E53935",
        "width_px": 4
      },
      "shadow": {
        "color": "rgba(229,57,53,0.6)",
        "opacity": 0.6,
        "blur_px": 16,
        "distance_px": 0,
        "angle_deg": 90
      }
    }
  }
};

// ../edit-store/src/transition-visual.ts
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

// ../edit-store/src/envelope.ts
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

// ../edit-store/src/ducking.ts
var STATIC_DUCK_GAIN_DB = DEFAULT_DUCK_DB;
function computeDuckIntervals(sources) {
  return sources.filter(
    (s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.durationSec) && s.durationSec > 0
  ).map((s) => ({ startSec: s.t, endSec: s.t + s.durationSec }));
}
function isWithinDuckInterval(intervals, atSec) {
  return intervals.some((iv) => atSec >= iv.startSec && atSec < iv.endSec);
}

// ../edit-store/src/audio-schedule.ts
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
    if (cut.mute === true) continue;
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

// ../edit-store/src/edit-v2.ts
var BLEND_MODES = /* @__PURE__ */ new Set([
  "normal",
  "screen",
  "multiply",
  "add",
  "difference",
  "darken",
  "lighten",
  "overlay",
  "hardlight",
  "softlight"
]);
var SHAPE_KINDS = /* @__PURE__ */ new Set([
  "rect",
  "rounded-rect",
  "ellipse",
  "line",
  "arrow",
  "speech-bubble"
]);
var ITEM_KEYS = /* @__PURE__ */ new Set([
  "id",
  "name",
  "hidden",
  "locked",
  "at",
  "duration",
  "transform",
  "opacity",
  "blend",
  "crop",
  "adjust",
  "perspective",
  "motion",
  "animator",
  "keyframes",
  "items",
  "mask",
  "source"
]);
var AUDIO_ITEM_KEYS = /* @__PURE__ */ new Set([
  "id",
  "name",
  "hidden",
  "locked",
  "at",
  "duration",
  "role",
  "source",
  "gain_db",
  "keyframes",
  "fade_in",
  "fade_out",
  "ducking",
  "duck_db",
  "duck_attack",
  "duck_release",
  "denoise",
  "lowcut_hz",
  "script",
  "reading",
  "provenance"
]);
function readEditV2(json) {
  const parsed = parseInput(json);
  requireRecord(parsed, "edit.json");
  requireExactKeys(parsed, /* @__PURE__ */ new Set(["version", "output", "sources", "tracks", "audio", "captions", "thumbnail"]), "edit.json");
  if (parsed.version !== 2) {
    throw invalid("edit.json.version", "2 \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08v0/v1 \u306F\u3053\u306E reader \u306E\u5BFE\u8C61\u5916\u3067\u3059\uFF09");
  }
  validateOutput(parsed.output);
  if (!Array.isArray(parsed.sources)) {
    throw invalid("edit.json.sources", "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (!Array.isArray(parsed.tracks)) {
    throw invalid("edit.json.tracks", "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(parsed, "audio")) {
    requireRecord(parsed.audio, "edit.json.audio");
    if (hasOwn(parsed.audio, "duck_keys")) {
      if (!Array.isArray(parsed.audio.duck_keys)) throw invalid("edit.json.audio.duck_keys", "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      const keys = parsed.audio.duck_keys;
      if (keys.some((key) => key !== "narration" && key !== "speech")) {
        throw invalid("edit.json.audio.duck_keys", "narration/speech \u306E\u307F\u6307\u5B9A\u3067\u304D\u307E\u3059");
      }
      if (new Set(keys).size !== keys.length) throw invalid("edit.json.audio.duck_keys", "\u91CD\u8907\u3067\u304D\u307E\u305B\u3093");
    }
  }
  if (hasOwn(parsed, "captions") && !Array.isArray(parsed.captions)) {
    throw invalid("edit.json.captions", "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(parsed, "thumbnail")) requireRecord(parsed.thumbnail, "edit.json.thumbnail");
  const sourceIds = /* @__PURE__ */ new Set();
  parsed.sources.forEach((source, index) => validateEditSource(source, index, sourceIds));
  const trackIds = /* @__PURE__ */ new Set();
  const itemIds = /* @__PURE__ */ new Set();
  parsed.tracks.forEach((track, index) => validateTrack(track, index, trackIds, itemIds, sourceIds));
  const edit = parsed;
  return {
    version: 2,
    output: { ...edit.output },
    sources: edit.sources.map((source) => ({ ...source })),
    ...edit.audio !== void 0 ? { audio: edit.audio } : {},
    ...edit.captions !== void 0 ? { captions: edit.captions } : {},
    ...edit.thumbnail !== void 0 ? { thumbnail: { ...edit.thumbnail } } : {},
    tracks: edit.tracks.map((track, z) => {
      if ("items" in track) {
        return {
          ...track,
          z,
          items: track.items.map((item) => cloneItem(item))
        };
      }
      return { ...track, z, content: { ...track.content } };
    })
  };
}
function cloneItem(item) {
  return {
    ...item,
    source: { ...item.source },
    ..."items" in item && Array.isArray(item.items) ? { items: item.items.map((child) => cloneItem(child)) } : {}
  };
}
function parseInput(json) {
  if (typeof json !== "string") return json;
  try {
    return JSON.parse(json);
  } catch (error) {
    throw invalid("edit.json", `JSON \u3068\u3057\u3066\u8AAD\u3081\u307E\u305B\u3093: ${messageOf(error)}`);
  }
}
function validateOutput(value) {
  requireRecord(value, "edit.json.output");
  requirePositiveNumber(value.width, "edit.json.output.width");
  requirePositiveNumber(value.height, "edit.json.output.height");
  requireInteger(value.fps, 1, "edit.json.output.fps");
}
function validateEditSource(value, index, ids) {
  const path = `edit.json.sources[${index}]`;
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["id", "path", "proxy", "chroma_key"]), path);
  requireText(value.id, `${path}.id`);
  if (ids.has(value.id)) throw invalid(`${path}.id`, `source id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  ids.add(value.id);
  requireText(value.path, `${path}.path`);
  if (hasOwn(value, "proxy") && value.proxy !== null) requireText(value.proxy, `${path}.proxy`);
  if (hasOwn(value, "chroma_key") && value.chroma_key !== null) {
    requireRecord(value.chroma_key, `${path}.chroma_key`);
  }
}
function validateTrack(value, index, trackIds, itemIds, sourceIds) {
  const path = `edit.json.tracks[${index}]`;
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["id", "lane", "name", "muted", "items", "content"]), path);
  requireText(value.id, `${path}.id`);
  if (trackIds.has(value.id)) throw invalid(`${path}.id`, `track id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  trackIds.add(value.id);
  if (value.lane !== "visual" && value.lane !== "audio") {
    throw invalid(`${path}.lane`, "visual \u307E\u305F\u306F audio \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "name") && typeof value.name !== "string") {
    throw invalid(`${path}.name`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "muted") && typeof value.muted !== "boolean") {
    throw invalid(`${path}.muted`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  const hasItems = hasOwn(value, "items");
  const hasContent = hasOwn(value, "content");
  if (hasItems === hasContent) {
    throw invalid(path, "items \u3068 content \u306E\u3069\u3061\u3089\u304B\u4E00\u65B9\u3060\u3051\u304C\u5FC5\u8981\u3067\u3059");
  }
  if (hasItems) {
    if (!Array.isArray(value.items)) throw invalid(`${path}.items`, "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    value.items.forEach((item, itemIndex) => {
      const itemPath = `${path}.items[${itemIndex}]`;
      if (value.lane === "audio") validateAudioItem(item, itemPath, itemIds, sourceIds);
      else validateItem(item, itemPath, itemIds, sourceIds);
    });
    return;
  }
  requireRecord(value.content, `${path}.content`);
  requireExactKeys(value.content, /* @__PURE__ */ new Set(["from"]), `${path}.content`);
  if (value.content.from !== "captions.json") {
    throw invalid(`${path}.content.from`, "captions.json \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateAudioItem(value, path, ids, sourceIds) {
  requireRecord(value, path);
  requireExactKeys(value, AUDIO_ITEM_KEYS, path);
  requireText(value.id, `${path}.id`);
  if (ids.has(value.id)) throw invalid(`${path}.id`, `item id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  ids.add(value.id);
  validateItemMetadata(value, path);
  requireInteger(value.at, 0, `${path}.at`);
  requireInteger(value.duration, 0, `${path}.duration`);
  if (hasOwn(value, "role") && value.role !== "sfx" && value.role !== "narration" && value.role !== "bgm") {
    throw invalid(`${path}.role`, "sfx/narration/bgm \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "gain_db")) requireRange(value.gain_db, -60, 12, `${path}.gain_db`);
  if (hasOwn(value, "denoise")) validateAudioClipDenoise(value.denoise, `${path}.denoise`);
  if (hasOwn(value, "lowcut_hz")) requireRange(value.lowcut_hz, 0, 400, `${path}.lowcut_hz`);
  if (hasOwn(value, "keyframes")) validateKeyframes(value.keyframes, `${path}.keyframes`, true);
  if (hasOwn(value, "fade_in")) requireNonNegativeNumber(value.fade_in, `${path}.fade_in`);
  if (hasOwn(value, "fade_out")) requireNonNegativeNumber(value.fade_out, `${path}.fade_out`);
  if (hasOwn(value, "ducking") && typeof value.ducking !== "boolean") {
    throw invalid(`${path}.ducking`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "duck_db")) requireRange(value.duck_db, -40, 0, `${path}.duck_db`);
  if (hasOwn(value, "duck_attack")) requireRange(value.duck_attack, 0, 2, `${path}.duck_attack`);
  if (hasOwn(value, "duck_release")) requireRange(value.duck_release, 0, 5, `${path}.duck_release`);
  if (hasOwn(value, "script") && typeof value.script !== "string") {
    throw invalid(`${path}.script`, "string \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "reading") && typeof value.reading !== "string") {
    throw invalid(`${path}.reading`, "string \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "provenance")) validateNarrationProvenance(value.provenance, `${path}.provenance`);
  validateAudioMediaSource(value.source, `${path}.source`, sourceIds);
}
function validateNarrationProvenance(value, path) {
  requireRecord(value, path);
  requireText(value.provider, `${path}.provider`);
  for (const key of ["engine", "voice", "credit", "generated_at"]) {
    if (hasOwn(value, key) && typeof value[key] !== "string") {
      throw invalid(`${path}.${key}`, "string \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    }
  }
  if (value.provider === "voicevox" && (!hasOwn(value, "credit") || typeof value.credit !== "string" || value.credit.trim().length === 0)) {
    throw invalid(`${path}.credit`, "provider \u304C voicevox \u306E\u3068\u304D\u306F\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u304C\u5FC5\u8981\u3067\u3059");
  }
}
function validateAudioMediaSource(value, path, sourceIds) {
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "src", "in", "out", "speed", "pitch_semitones", "formant"]), path);
  if (value.kind !== "media") throw invalid(`${path}.kind`, "media \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  requireText(value.src, `${path}.src`);
  if (!sourceIds.has(value.src)) throw invalid(`${path}.src`, `sources[].id \u306B\u5B58\u5728\u3057\u307E\u305B\u3093: ${value.src}`);
  if (hasOwn(value, "in")) requireNonNegativeNumber(value.in, `${path}.in`);
  if (hasOwn(value, "out")) {
    requireNonNegativeNumber(value.out, `${path}.out`);
    const inSeconds = hasOwn(value, "in") ? value.in : 0;
    if (value.out <= inSeconds) throw invalid(path, "audio media source \u306F out > in \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "speed")) {
    requireRange(value.speed, 0.25, 4, `${path}.speed`);
    if (value.speed === 0.25) throw invalid(`${path}.speed`, "0.25 \u3088\u308A\u5927\u304D\u3044\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "pitch_semitones")) requireRange(value.pitch_semitones, -24, 24, `${path}.pitch_semitones`);
  if (hasOwn(value, "formant") && value.formant !== "preserve" && value.formant !== "shift") {
    throw invalid(`${path}.formant`, "preserve/shift \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateAudioClipDenoise(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["method", "strength"]), path);
  if (value.method !== "fft" && value.method !== "nlm") {
    throw invalid(`${path}.method`, "fft/nlm \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  requireRange(value.strength, 0, 1, `${path}.strength`);
}
function validateItem(value, path, ids, sourceIds) {
  requireRecord(value, path);
  requireExactKeys(value, ITEM_KEYS, path);
  requireText(value.id, `${path}.id`);
  if (ids.has(value.id)) throw invalid(`${path}.id`, `item id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  ids.add(value.id);
  validateItemMetadata(value, path);
  requireInteger(value.at, 0, `${path}.at`);
  requireInteger(value.duration, 0, `${path}.duration`);
  if (hasOwn(value, "transform")) validateTransform(value.transform, `${path}.transform`);
  if (hasOwn(value, "opacity")) requireRange(value.opacity, 0, 1, `${path}.opacity`);
  if (hasOwn(value, "blend") && !BLEND_MODES.has(value.blend)) {
    throw invalid(`${path}.blend`, "\u672A\u5BFE\u5FDC\u306E blend mode \u3067\u3059");
  }
  if (hasOwn(value, "crop")) validateCrop(value.crop, `${path}.crop`);
  if (hasOwn(value, "adjust")) validateAdjust(value.adjust, `${path}.adjust`);
  if (hasOwn(value, "perspective")) requireRecord(value.perspective, `${path}.perspective`);
  if (hasOwn(value, "motion")) validateMotion(value.motion, `${path}.motion`);
  if (hasOwn(value, "animator")) validateAnimators(value.animator, `${path}.animator`);
  if (hasOwn(value, "keyframes")) validateKeyframes(value.keyframes, `${path}.keyframes`);
  validateItemSource(value.source, `${path}.source`, sourceIds);
  if (hasOwn(value, "mask")) {
    if (value.source.kind !== "media") throw invalid(`${path}.mask`, "media item \u3060\u3051\u304C\u6307\u5B9A\u3067\u304D\u307E\u3059");
    requireText(value.mask, `${path}.mask`);
    if (!sourceIds.has(value.mask)) throw invalid(`${path}.mask`, `sources[].id \u306B\u5B58\u5728\u3057\u307E\u305B\u3093: ${value.mask}`);
  }
  if (hasOwn(value, "items")) {
    if (!Array.isArray(value.items)) throw invalid(`${path}.items`, "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    value.items.forEach((child, index) => validateItem(child, `${path}.items[${index}]`, ids, sourceIds));
  }
}
function validateItemMetadata(value, path) {
  if (hasOwn(value, "name") && typeof value.name !== "string") throw invalid(`${path}.name`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  for (const key of ["hidden", "locked"]) {
    if (hasOwn(value, key) && typeof value[key] !== "boolean") throw invalid(`${path}.${key}`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateItemSource(value, path, sourceIds) {
  requireRecord(value, path);
  switch (value.kind) {
    case "media":
      requireExactKeys(value, /* @__PURE__ */ new Set([
        "kind",
        "src",
        "in",
        "out",
        "framing",
        "transition_out",
        "freeze",
        "fx",
        "speed",
        "chroma_key",
        "gain_db",
        "mute"
      ]), path);
      requireText(value.src, `${path}.src`);
      if (!sourceIds.has(value.src)) throw invalid(`${path}.src`, `sources[].id \u306B\u5B58\u5728\u3057\u307E\u305B\u3093: ${value.src}`);
      requireNonNegativeNumber(value.in, `${path}.in`);
      requireNonNegativeNumber(value.out, `${path}.out`);
      if (value.out <= value.in) throw invalid(path, "media source \u306F out > in \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      for (const key of ["framing", "transition_out", "freeze", "chroma_key"]) {
        if (hasOwn(value, key) && value[key] !== null) requireRecord(value[key], `${path}.${key}`);
      }
      if (hasOwn(value, "fx") && !Array.isArray(value.fx)) throw invalid(`${path}.fx`, "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      if (hasOwn(value, "speed")) requirePositiveNumber(value.speed, `${path}.speed`);
      if (hasOwn(value, "gain_db")) requireRange(value.gain_db, -60, 12, `${path}.gain_db`);
      if (hasOwn(value, "mute") && typeof value.mute !== "boolean") throw invalid(`${path}.mute`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      return;
    case "html":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "path", "part", "style", "text", "exclude", "derivedFrom", "vars", "params"]), path);
      requireText(value.path, `${path}.path`);
      for (const key of ["part", "derivedFrom"]) if (hasOwn(value, key)) requireText(value[key], `${path}.${key}`);
      if (hasOwn(value, "text") && typeof value.text !== "string") throw invalid(`${path}.text`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      if (hasOwn(value, "style")) validateStringMap(value.style, `${path}.style`);
      if (hasOwn(value, "exclude")) validateStringList(value.exclude, `${path}.exclude`);
      if (hasOwn(value, "vars")) requireRecord(value.vars, `${path}.vars`);
      if (hasOwn(value, "params")) {
        requireRecord(value.params, `${path}.params`);
        for (const [name, text] of Object.entries(value.params)) {
          if (typeof text !== "string") throw invalid(`${path}.params.${name}`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
        }
      }
      return;
    case "shape":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "shape", "params"]), path);
      if (!SHAPE_KINDS.has(value.shape)) {
        throw invalid(`${path}.shape`, "\u672A\u5BFE\u5FDC\u306E shape \u3067\u3059");
      }
      if (hasOwn(value, "params")) {
        requireRecord(value.params, `${path}.params`);
        requireExactKeys(value.params, /* @__PURE__ */ new Set([
          "width",
          "height",
          "fill",
          "stroke",
          "strokeWidth",
          "cornerRadius"
        ]), `${path}.params`);
        for (const key of ["width", "height"]) {
          if (hasOwn(value.params, key)) requirePositiveNumber(value.params[key], `${path}.params.${key}`);
        }
        for (const key of ["fill", "stroke"]) {
          if (hasOwn(value.params, key) && typeof value.params[key] !== "string") {
            throw invalid(`${path}.params.${key}`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
          }
        }
        for (const key of ["strokeWidth", "cornerRadius"]) {
          if (hasOwn(value.params, key)) requireNonNegativeNumber(value.params[key], `${path}.params.${key}`);
        }
      }
      return;
    case "telop":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "preset", "params", "baked", "from"]), path);
      requireText(value.preset, `${path}.preset`);
      if (hasOwn(value, "params")) requireRecord(value.params, `${path}.params`);
      if (hasOwn(value, "baked")) requireText(value.baked, `${path}.baked`);
      if (hasOwn(value, "from")) requireText(value.from, `${path}.from`);
      return;
    case "filter":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "filter"]), path);
      validateFilter(value.filter, `${path}.filter`);
      return;
    case "group":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind"]), path);
      return;
    case "captions":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "path", "exclude"]), path);
      if (value.path !== "captions.json") throw invalid(`${path}.path`, "captions.json \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      if (hasOwn(value, "exclude")) validateStringList(value.exclude, `${path}.exclude`);
      return;
    case "caption":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "path", "id"]), path);
      if (value.path !== "captions.json") throw invalid(`${path}.path`, "captions.json \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      requireText(value.id, `${path}.id`);
      return;
    default:
      throw invalid(`${path}.kind`, "media/html/telop/filter/group/captions/caption \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateStringMap(value, path) {
  requireRecord(value, path);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw invalid(`${path}.${key}`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateStringList(value, path) {
  if (!Array.isArray(value)) throw invalid(path, "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  const seen = /* @__PURE__ */ new Set();
  value.forEach((entry, index) => {
    requireText(entry, `${path}[${index}]`);
    if (seen.has(entry)) throw invalid(path, `\u5024\u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${entry}`);
    seen.add(entry);
  });
}
function validateFilter(value, path) {
  requireRecord(value, path);
  switch (value.type) {
    case "invert":
      requireExactKeys(value, /* @__PURE__ */ new Set(["type"]), path);
      return;
    case "lut":
      requireExactKeys(value, /* @__PURE__ */ new Set(["type", "id", "intensity"]), path);
      requireText(value.id, `${path}.id`);
      if (hasOwn(value, "intensity")) requireRange(value.intensity, 0, 1, `${path}.intensity`);
      return;
    case "saturation":
      requireExactKeys(value, /* @__PURE__ */ new Set(["type", "value"]), path);
      requireRange(value.value, 0, 3, `${path}.value`);
      return;
    default:
      throw invalid(`${path}.type`, "invert/lut/saturation \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateTransform(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["x", "y", "scale", "rotate"]), path);
  for (const key of ["x", "y", "rotate"]) {
    if (hasOwn(value, key)) requireNumber(value[key], `${path}.${key}`);
  }
  if (hasOwn(value, "scale")) requirePositiveNumber(value.scale, `${path}.scale`);
}
function validateCrop(value, path) {
  requireRecord(value, path);
  for (const key of ["x", "y"]) requireRange(value[key], 0, 1, `${path}.${key}`);
  for (const key of ["w", "h"]) {
    requireRange(value[key], 0, 1, `${path}.${key}`);
    if (value[key] === 0) throw invalid(`${path}.${key}`, "0 \u3088\u308A\u5927\u304D\u3044\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateAdjust(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["basic", "lut", "sections", "curves", "wheels", "hue"]), path);
  for (const section of ["curves", "hue"]) {
    if (!hasOwn(value, section)) continue;
    const channels = value[section];
    const sectionPath = `${path}.${section}`;
    requireRecord(channels, sectionPath);
    const axis = section === "curves" ? "in" : "hue";
    const output = section === "curves" ? "out" : "value";
    const minimum = section === "curves" ? 2 : 1;
    requireExactKeys(channels, new Set(section === "curves" ? ["master", "r", "g", "b"] : ["hue", "sat", "luma"]), sectionPath);
    for (const [channel, points] of Object.entries(channels)) {
      const channelPath = `${sectionPath}.${channel}`;
      if (!Array.isArray(points) || points.length < minimum || points.length > 16) {
        throw invalid(channelPath, `${minimum} \u304B\u3089 16 \u70B9\u306E\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`);
      }
      let previous = -Infinity;
      for (const [index, point] of points.entries()) {
        const pointPath = `${channelPath}[${index}]`;
        requireRecord(point, pointPath);
        requireExactKeys(point, /* @__PURE__ */ new Set([axis, output]), pointPath);
        requireRange(point[axis], 0, 1, `${pointPath}.${axis}`);
        requireRange(point[output], 0, 1, `${pointPath}.${output}`);
        if (point[axis] <= previous) throw invalid(`${pointPath}.${axis}`, "\u72ED\u7FA9\u5358\u8ABF\u5897\u52A0\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
        previous = point[axis];
      }
    }
  }
  if (hasOwn(value, "wheels")) {
    requireRecord(value.wheels, `${path}.wheels`);
    const ranges = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 };
    requireExactKeys(value.wheels, new Set(Object.keys(ranges)), `${path}.wheels`);
    for (const [wheel, channels] of Object.entries(value.wheels)) {
      const wheelPath = `${path}.wheels.${wheel}`;
      requireRecord(channels, wheelPath);
      requireExactKeys(channels, /* @__PURE__ */ new Set(["r", "g", "b"]), wheelPath);
      for (const [channel, amount] of Object.entries(channels)) requireRange(amount, -ranges[wheel], ranges[wheel], `${wheelPath}.${channel}`);
    }
  }
  if (hasOwn(value, "basic")) {
    requireRecord(value.basic, `${path}.basic`);
    const basicKeys = /* @__PURE__ */ new Set([
      "exposure",
      "contrast",
      "highlights",
      "shadows",
      "blacks",
      "whites",
      "temperature",
      "tint",
      "vibrance",
      "saturation"
    ]);
    requireExactKeys(value.basic, basicKeys, `${path}.basic`);
    for (const key of basicKeys) {
      if (!hasOwn(value.basic, key)) continue;
      const [minimum, maximum] = key === "exposure" ? [-3, 3] : [-1, 1];
      requireRange(value.basic[key], minimum, maximum, `${path}.basic.${key}`);
    }
  }
  if (hasOwn(value, "lut") && value.lut !== null) {
    requireRecord(value.lut, `${path}.lut`);
    requireExactKeys(value.lut, /* @__PURE__ */ new Set(["lut", "intensity"]), `${path}.lut`);
    requireText(value.lut.lut, `${path}.lut.lut`);
    if (hasOwn(value.lut, "intensity")) requireRange(value.lut.intensity, 0, 1, `${path}.lut.intensity`);
  }
  if (hasOwn(value, "sections")) {
    requireRecord(value.sections, `${path}.sections`);
    const sectionKeys = /* @__PURE__ */ new Set(["basic", "lut", "curves", "wheels", "hue"]);
    requireExactKeys(value.sections, sectionKeys, `${path}.sections`);
    for (const key of sectionKeys) {
      if (hasOwn(value.sections, key) && typeof value.sections[key] !== "boolean") {
        throw invalid(`${path}.sections.${key}`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
      }
    }
  }
}
var EASINGS = /* @__PURE__ */ new Set([
  "linear",
  "ease-in-out",
  "in-quad",
  "out-quad",
  "in-out-quad",
  "in-cubic",
  "out-cubic",
  "in-out-cubic",
  "in-quart",
  "out-quart",
  "in-out-quart",
  "in-expo",
  "out-expo",
  "in-out-expo",
  "in-back",
  "out-back",
  "in-out-back",
  "out-bounce",
  "out-elastic",
  "hold"
]);
var CUBIC_BEZIER = /^cubic-bezier\(\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*\)$/;
function validateEasing(value, path) {
  const validateOne = (entry, entryPath) => {
    if (typeof entry !== "string" || !EASINGS.has(entry) && !CUBIC_BEZIER.test(entry)) {
      throw invalid(entryPath, "\u672A\u5BFE\u5FDC\u306E easing \u3067\u3059");
    }
  };
  if (typeof value === "string") return validateOne(value, path);
  requireRecord(value, path);
  for (const [key, entry] of Object.entries(value)) validateOne(entry, `${path}.${key}`);
}
function validateKeyframes(value, path, audio = false) {
  if (!Array.isArray(value)) {
    requireRecord(value, path);
    requireExactKeys(value, /* @__PURE__ */ new Set(["path", "count"]), path);
    requireText(value.path, `${path}.path`);
    if (!/^motion\/.+\.json$/.test(value.path)) throw invalid(`${path}.path`, "motion/ \u914D\u4E0B\u306E JSON \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    requireInteger(value.count, 2, `${path}.count`);
    return;
  }
  if (!Array.isArray(value) || value.length < 2) throw invalid(path, "2 \u8981\u7D20\u4EE5\u4E0A\u306E\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    requireRecord(entry, itemPath);
    requireInteger(entry.t, 0, `${itemPath}.t`);
    if (audio) {
      if (!hasOwn(entry, "gain_db")) throw invalid(`${itemPath}.gain_db`, "audio keyframe \u306B\u5FC5\u8981\u3067\u3059");
      requireRange(entry.gain_db, -60, 12, `${itemPath}.gain_db`);
    }
    if (hasOwn(entry, "transform")) validateTransform(entry.transform, `${itemPath}.transform`);
    if (hasOwn(entry, "crop")) validateCrop(entry.crop, `${itemPath}.crop`);
    if (hasOwn(entry, "perspective")) requireRecord(entry.perspective, `${itemPath}.perspective`);
    if (hasOwn(entry, "opacity")) requireRange(entry.opacity, 0, 1, `${itemPath}.opacity`);
    if (hasOwn(entry, "animator")) {
      requireRecord(entry.animator, `${itemPath}.animator`);
      for (const [id, state] of Object.entries(entry.animator)) {
        requireRecord(state, `${itemPath}.animator.${id}`);
        requireExactKeys(state, /* @__PURE__ */ new Set(["offset", "start", "end"]), `${itemPath}.animator.${id}`);
        if (hasOwn(state, "offset")) requireRange(state.offset, -1, 1, `${itemPath}.animator.${id}.offset`);
        for (const key of ["start", "end"]) if (hasOwn(state, key)) requireRange(state[key], 0, 1, `${itemPath}.animator.${id}.${key}`);
      }
    }
    if (hasOwn(entry, "easing")) validateEasing(entry.easing, `${itemPath}.easing`);
  });
}
function validateMotion(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["in", "out", "loop"]), path);
  for (const slot of ["in", "out", "loop"]) {
    if (!hasOwn(value, slot)) continue;
    const entry = value[slot];
    requireRecord(entry, `${path}.${slot}`);
    requireExactKeys(entry, /* @__PURE__ */ new Set(["preset", slot === "loop" ? "period" : "duration", "ease", "amount"]), `${path}.${slot}`);
    requireText(entry.preset, `${path}.${slot}.preset`);
    requireInteger(entry[slot === "loop" ? "period" : "duration"], slot === "loop" ? 1 : 0, `${path}.${slot}.${slot === "loop" ? "period" : "duration"}`);
    if (hasOwn(entry, "ease")) validateEasing(entry.ease, `${path}.${slot}.ease`);
    if (hasOwn(entry, "amount")) requireNumber(entry.amount, `${path}.${slot}.amount`);
  }
}
function validateAnimators(value, path) {
  if (!Array.isArray(value)) throw invalid(path, "\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    requireRecord(entry, entryPath);
    requireExactKeys(entry, /* @__PURE__ */ new Set(["id", "basis", "shape", "start", "end", "offset", "randomize", "amount", "ease"]), entryPath);
    requireText(entry.id, `${entryPath}.id`);
    if (!["chars", "words", "lines", "segments"].includes(String(entry.basis))) throw invalid(`${entryPath}.basis`, "\u672A\u5BFE\u5FDC\u306E basis \u3067\u3059");
    if (!["ramp", "triangle", "round", "smooth", "square", "ramp-down"].includes(String(entry.shape))) throw invalid(`${entryPath}.shape`, "\u672A\u5BFE\u5FDC\u306E shape \u3067\u3059");
    requireRange(entry.start, 0, 1, `${entryPath}.start`);
    requireRange(entry.end, 0, 1, `${entryPath}.end`);
    requireRange(entry.offset, -1, 1, `${entryPath}.offset`);
    if (hasOwn(entry, "randomize")) {
      requireRecord(entry.randomize, `${entryPath}.randomize`);
      requireExactKeys(entry.randomize, /* @__PURE__ */ new Set(["seed"]), `${entryPath}.randomize`);
      if (!Number.isInteger(entry.randomize.seed)) throw invalid(`${entryPath}.randomize.seed`, "\u6574\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    }
    requireRecord(entry.amount, `${entryPath}.amount`);
    requireExactKeys(entry.amount, /* @__PURE__ */ new Set(["x", "y", "scale", "rotate", "opacity", "letterSpacing", "blur"]), `${entryPath}.amount`);
    for (const [key, amount] of Object.entries(entry.amount)) {
      if (key === "opacity") requireRange(amount, -1, 1, `${entryPath}.amount.opacity`);
      else requireNumber(amount, `${entryPath}.amount.${key}`);
    }
    if (hasOwn(entry, "ease")) validateEasing(entry.ease, `${entryPath}.ease`);
  });
}
function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, "object \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
var UNKNOWN_KEY_GUIDANCE = {
  emphasis_words: "\u8A9E\u30EC\u30D9\u30EB\u6F14\u51FA\u306F captions.json \u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB emphasis_words[] \u3078\u79FB\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5951\u7D04 contract-2026-08-23-captions-emphasis-words-v0.md\uFF09"
};
var DEFAULT_UNKNOWN_KEY_GUIDANCE = "\u3053\u306E\u30AD\u30FC\u306F v2 \u306E\u8A9E\u5F59\u306B\u3042\u308A\u307E\u305B\u3093\u3002\u624B\u3067\u7DE8\u96C6\u3057\u305F\u5834\u5408\u306F\u53D6\u308A\u9664\u304F\u304B\u3001.akari/backup/ \u306E\u539F\u672C\u304B\u3089\u5FA9\u5143\u3057\u3066\u304F\u3060\u3055\u3044";
function requireExactKeys(value, allowed, path) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    const guidance = unknown.map((key) => `${key}: ${UNKNOWN_KEY_GUIDANCE[key] ?? DEFAULT_UNKNOWN_KEY_GUIDANCE}`).join(" / ");
    throw invalid(path, `\u672A\u5B9A\u7FA9\u30AD\u30FC\u3092\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093: ${unknown.join(", ")}\u3002\u6848\u5185: ${guidance}`);
  }
}
function requireText(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) throw invalid(path, "\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
}
function requireNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(path, "\u6709\u9650\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
}
function requirePositiveNumber(value, path) {
  requireNumber(value, path);
  if (value <= 0) throw invalid(path, "0 \u3088\u308A\u5927\u304D\u3044\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
}
function requireNonNegativeNumber(value, path) {
  requireNumber(value, path);
  if (value < 0) throw invalid(path, "0 \u4EE5\u4E0A\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
}
function requireInteger(value, minimum, path) {
  if (!Number.isInteger(value) || value < minimum) {
    throw invalid(path, `${minimum} \u4EE5\u4E0A\u306E\u6574\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`);
  }
}
function requireRange(value, minimum, maximum, path) {
  requireNumber(value, path);
  if (value < minimum || value > maximum) throw invalid(path, `${minimum}..${maximum} \u306E\u7BC4\u56F2\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`);
}
function invalid(path, message) {
  return new Error(`edit.json v2 \u304C\u4E0D\u6B63\u3067\u3059 (${path}): ${message}`);
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// ../edit-store/src/migrate/error.ts
var LegacyEditVersionError = class extends Error {
  constructor(version) {
    super(
      `\u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306F\u53E4\u3044\u5F62\u5F0F\u3067\u3059\uFF08edit.json version ${version}\uFF09\u3002\`akari migrate <dir>\` \u3067\u5909\u63DB\u3057\u3066\u304B\u3089\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002\u5C06\u6765\u672C\u4F53\u304B\u3089\u5909\u63DB\u5668\u304C\u5916\u308C\u305F\u5F8C\u306F \`npx akari-migrate@<\u7248> <dir>\` \u3092\u4F7F\u3044\u307E\u3059\u3002`
    );
    this.version = version;
    this.name = "LegacyEditVersionError";
  }
};

// ../edit-store/src/shape-markup.ts
var DEFAULT_WIDTH = 600;
var DEFAULT_HEIGHT = 340;
var DEFAULT_LINE_HEIGHT = 80;
var DEFAULT_FILL = "#f97316";
var DEFAULT_CORNER_RADIUS = 24;
var DEFAULT_LINE_STROKE_WIDTH = 8;
var SAFE_COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/u;
function positiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function nonNegativeNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function color(value, fallback) {
  if (typeof value !== "string" || !SAFE_COLOR.test(value)) return fallback;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}
function svg(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
function filledShapeAttributes(fill, stroke, strokeWidth) {
  return `fill="${fill}" stroke="${stroke ?? "none"}" stroke-width="${strokeWidth}"`;
}
function shapeMarkup(source) {
  const params = source.params ?? {};
  const width = positiveNumber(params.width, DEFAULT_WIDTH);
  const height = positiveNumber(
    params.height,
    source.shape === "line" || source.shape === "arrow" ? DEFAULT_LINE_HEIGHT : DEFAULT_HEIGHT
  );
  const fill = color(params.fill, DEFAULT_FILL);
  const lineLike = source.shape === "line" || source.shape === "arrow";
  const stroke = params.stroke === void 0 ? void 0 : color(params.stroke, lineLike ? fill : "none");
  const strokeWidth = nonNegativeNumber(
    params.strokeWidth,
    lineLike ? DEFAULT_LINE_STROKE_WIDTH : 0
  );
  const attributes = filledShapeAttributes(fill, stroke, strokeWidth);
  switch (source.shape) {
    case "rect":
      return svg(width, height, `<rect x="0" y="0" width="${width}" height="${height}" ${attributes}/>`);
    case "rounded-rect": {
      const radius = nonNegativeNumber(params.cornerRadius, DEFAULT_CORNER_RADIUS);
      return svg(width, height, `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" ${attributes}/>`);
    }
    case "ellipse":
      return svg(width, height, `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" ${attributes}/>`);
    case "line": {
      const lineColor = stroke ?? fill;
      return svg(width, height, `<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" fill="none" stroke="${lineColor}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`);
    }
    case "arrow": {
      const lineColor = stroke ?? fill;
      const centerY = height / 2;
      const headStart = width - Math.min(width, centerY);
      return svg(width, height, `<path d="M 0 ${centerY} H ${headStart} M ${headStart} 0 L ${width} ${centerY} L ${headStart} ${height}" fill="none" stroke="${lineColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    case "speech-bubble": {
      const bodyBottom = height * 0.75;
      const tailStart = width * 0.6;
      const tailTip = width * 0.72;
      const tailEnd = width * 0.82;
      return svg(width, height, `<path d="M 0 0 H ${width} V ${bodyBottom} H ${tailEnd} L ${tailTip} ${height} L ${tailStart} ${bodyBottom} H 0 Z" ${attributes}/>`);
    }
  }
}

// ../edit-store/src/internal-model.ts
function readInternalEdit(source, options) {
  const text = typeof source === "string" ? source : JSON.stringify(source);
  if (typeof text !== "string") {
    throw new Error("\u7DE8\u96C6\u30C7\u30FC\u30BF\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3002");
  }
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("\u7DE8\u96C6\u30C7\u30FC\u30BF\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3002");
  }
  const record = raw;
  if (record.version !== 2) {
    throw new LegacyEditVersionError(typeof record.version === "number" ? record.version : -1);
  }
  const resolved = options?.captions === void 0 ? record : resolveItemAnchors(record, options.captions).edit;
  return readV2Internal(withoutItemAnchors(resolved));
}
function readV2Internal(raw) {
  const edit = readEditV2(raw);
  const fps = edit.output.fps;
  const sources = edit.sources.map((entry) => ({
    id: entry.id,
    declaredPath: entry.path,
    path: entry.path,
    declaredProxy: entry.proxy,
    proxy: entry.proxy ?? null,
    ...entry.chroma_key !== void 0 && entry.chroma_key !== null ? { chromaKey: entry.chroma_key } : {},
    declarationPath: `sources[${entry.id}]`,
    isDefault: false
  }));
  const pathOf = (id) => sources.find((entry) => entry.id === id)?.path;
  const chromaKeyOf = (id) => sources.find((entry) => entry.id === id)?.chromaKey;
  const warnings = [];
  const refCounters = /* @__PURE__ */ new Map();
  const legacyIndexCounters = /* @__PURE__ */ new Map();
  const overlappingItemIds = computeOverlappingItemIds(edit.tracks.flatMap(
    (track) => "items" in track && track.lane === "visual" ? [track.items] : []
  ), pathOf);
  const contentDurationFrames = edit.tracks.reduce((maximum, track) => "items" in track && track.lane === "visual" ? track.items.reduce((trackMaximum, item) => Math.max(trackMaximum, item.at + item.duration), maximum) : maximum, 0);
  const tracks = edit.tracks.map((track) => {
    const kind = legacyKindOfV2Track(track, chromaKeyOf, overlappingItemIds);
    const ref = kind === "captions" ? void 0 : nextRef(refCounters, kind);
    const items = [];
    if ("items" in track) {
      track.items.forEach((item) => {
        const built = buildV2Item(
          item,
          fps,
          ref ?? 0,
          track.lane,
          pathOf,
          chromaKeyOf,
          legacyIndexCounters,
          overlappingItemIds.has(item.id)
        );
        if (built.warning) {
          warnings.push(built.warning);
        }
        items.push(built.item);
      });
    } else {
      const normalized = buildV2Item(
        {
          id: track.id,
          at: 0,
          duration: contentDurationFrames,
          source: { kind: "captions", path: "captions.json" }
        },
        fps,
        0,
        "visual",
        pathOf,
        chromaKeyOf,
        legacyIndexCounters
      ).item;
      items.push(normalized);
      Object.defineProperty(items, "toJSON", { value: () => [], enumerable: false });
    }
    return {
      id: track.id,
      lane: track.lane,
      z: track.z,
      ...track.name !== void 0 ? { name: track.name } : {},
      ...track.muted === void 0 ? {} : { muted: track.muted },
      origin: "declared",
      ..."content" in track ? { content: { from: "captions.json" } } : {},
      items,
      legacy: { kind, ...ref === void 0 ? {} : { ref } }
    };
  });
  addV2AudioItems(tracks, edit.audio, fps, legacyIndexCounters);
  hideEmptyChildrenForCompatibility(tracks);
  synthesizeHiddenTransitionHandlesForRender(tracks, fps);
  return {
    output: {
      width: edit.output.width,
      height: edit.output.height,
      fps,
      ...edit.output.look !== void 0 ? { look: edit.output.look } : {}
    },
    sources,
    sourceTableDeclared: true,
    emptyProject: sources.length === 0,
    tracks,
    tracksDeclared: true,
    warnings,
    declaration: {
      ...edit.audio !== void 0 ? { audio: edit.audio } : {},
      ...edit.captions !== void 0 ? { captions: edit.captions } : {}
    }
  };
}
function hideEmptyChildrenForCompatibility(tracks) {
  const visit = (item) => {
    for (const child of item.children) visit(child);
    if (item.children.length !== 0 || !Object.prototype.propertyIsEnumerable.call(item, "children")) return;
    delete item.children;
    Object.defineProperty(item, "children", { value: [], enumerable: false, writable: true });
  };
  for (const track of tracks) for (const item of track.items) visit(item);
}
function synthesizeHiddenTransitionHandlesForRender(tracks, fps) {
  const speedOf = (item) => {
    const speed = item.declaration.speed;
    return typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : 1;
  };
  for (const track of tracks) {
    if (track.lane !== "visual") continue;
    const cuts = track.items.filter(
      (item) => item.legacy.collection === "cuts" && item.source.kind === "media"
    );
    for (let index = 0; index + 1 < cuts.length; index++) {
      const outgoing = cuts[index];
      const incoming = cuts[index + 1];
      if (cutOverlapFrames(
        { tlEnd: outgoing.at + outgoing.duration },
        { tlStart: incoming.at },
        fps
      ) !== 0) continue;
      const transition = outgoing.declaration.transition_out;
      if (!isRecord2(transition) || typeof transition.duration !== "number" || !Number.isFinite(transition.duration) || transition.duration <= 0) continue;
      const incomingSpeed = speedOf(incoming);
      const incomingStill = isStillImageSourcePath(incoming.source.path);
      const plan = planTransitionHandleWindow({
        declaredSeconds: transition.duration,
        outgoingTailRoomSeconds: Number.POSITIVE_INFINITY,
        incomingHeadRoomSeconds: incomingStill ? Number.POSITIVE_INFINITY : incoming.source.in / incomingSpeed,
        outgoingDurationSeconds: outgoing.duration,
        incomingDurationSeconds: incoming.duration
      });
      if (plan.effectiveSeconds <= 0) continue;
      const outgoingSpeed = speedOf(outgoing);
      outgoing.declaration = {
        ...outgoing.declaration,
        out: Number(outgoing.declaration.out) + plan.halfSeconds * outgoingSpeed,
        transition_out: { ...transition, duration: plan.effectiveSeconds }
      };
      incoming.declaration = incomingStill ? {
        ...incoming.declaration,
        at: Number(incoming.declaration.at) - plan.halfSeconds,
        out: Number(incoming.declaration.out) + plan.halfSeconds * incomingSpeed
      } : {
        ...incoming.declaration,
        at: Number(incoming.declaration.at) - plan.halfSeconds,
        in: Number(incoming.declaration.in) - plan.halfSeconds * incomingSpeed
      };
    }
  }
}
function legacyKindOfV2Track(track, chromaKeyOf, overlappingItemIds) {
  if (!("items" in track)) {
    return "captions";
  }
  if (track.lane === "audio") {
    return "audio";
  }
  const first = track.items[0];
  switch (first?.source.kind) {
    case "html":
      return "overlays";
    case "shape":
      return "overlays";
    case "captions":
      return "captions";
    case "telop":
    case "filter":
    case "group":
    case "caption":
      return "layers";
    // 空トラック（first === undefined）は中身が無く旧種別は名目上のものでしかない。'layers' を
    // 既定にする: 'cuts' にすると、このトラックも nextRef の 'cuts' カウンタを消費して
    // しまい、後続の実際に中身がある cuts トラックの ref 番号がずれる
    // （旧 track: N を見る needsGapAwareCutTimeline が誤って gap-aware 経路へ倒れる）。
    // 'layers' は別カウンタなので、空トラックの存在が実クリップの分類・ref に影響しない
    // （P0 2026-08-20 track-identity-and-duration r1 で踏んだのと同じ罠）。
    default:
      return first === void 0 || track.items.some((item) => overlappingItemIds.has(item.id)) || needsLayersEngine(first, chromaKeyOf, overlappingItemIds.has(first.id)) ? "layers" : "cuts";
  }
}
function needsLayersEngine(item, chromaKeyOf, hasOverlappingSibling = false) {
  if (item.source.kind !== "media") return false;
  if ("mask" in item && item.mask !== void 0) return true;
  if (item.blend !== void 0 && item.blend !== "normal") return true;
  if (Array.isArray(item.keyframes) && item.keyframes.some(
    (point) => point && typeof point === "object" && "perspective" in point && point.perspective !== void 0
  )) return true;
  const chromaKey = item.source.chroma_key ?? chromaKeyOf?.(item.source.src);
  if (chromaKey !== void 0 && chromaKey !== null) {
    const hasBackground = typeof chromaKey === "object" && typeof chromaKey.background === "string" && chromaKey.background.length > 0;
    if (!hasBackground) return true;
  }
  if (hasOverlappingSibling) return true;
  return false;
}
function analyzeOverlappingItems(itemGroups, pathOf) {
  const overlapping = /* @__PURE__ */ new Set();
  const crossTrackEvacuations = [];
  const entries = itemGroups.flatMap(
    (group, trackIndex) => group.items.map((item) => ({ item, trackIndex, trackId: group.trackId }))
  );
  for (let i = 0; i < entries.length; i++) {
    const { item: a, trackIndex: aTrackIndex, trackId: aTrackId } = entries[i];
    if (a.source.kind !== "media") continue;
    for (let j = i + 1; j < entries.length; j++) {
      const { item: b, trackIndex: bTrackIndex, trackId: bTrackId } = entries[j];
      if (b.source.kind !== "media") continue;
      if (!(a.at < b.at + b.duration && b.at < a.at + a.duration)) continue;
      const sameTrack = aTrackIndex === bTrackIndex;
      if (sameTrack && (a.source.transition_out !== void 0 || b.source.transition_out !== void 0)) continue;
      if (sameTrack) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      } else {
        const upperIsA = aTrackIndex > bTrackIndex;
        const upper = upperIsA ? a : b;
        const lower = upperIsA ? b : a;
        if (needsCrossTrackLayers(upper, pathOf)) {
          overlapping.add(upper.id);
          crossTrackEvacuations.push({
            itemId: upper.id,
            trackId: upperIsA ? aTrackId : bTrackId,
            causeItemId: lower.id,
            causeTrackId: upperIsA ? bTrackId : aTrackId,
            overlapStartFrames: Math.max(a.at, b.at),
            overlapEndFrames: Math.min(a.at + a.duration, b.at + b.duration)
          });
        }
      }
    }
  }
  return { itemIds: overlapping, crossTrackEvacuations };
}
function computeOverlappingItemIds(itemGroups, pathOf) {
  return analyzeOverlappingItems(itemGroups.map((items, index) => ({
    items,
    trackId: String(index)
  })), pathOf).itemIds;
}
var ALPHA_CAPABLE_MEDIA_SOURCE_PATTERN = /\.(webm|mov)$/iu;
function isAlphaCapableMediaSourcePath(path) {
  return typeof path === "string" && ALPHA_CAPABLE_MEDIA_SOURCE_PATTERN.test(path);
}
function needsCrossTrackLayers(item, pathOf) {
  const transform = item.transform;
  return transform?.scale !== void 0 && transform.scale !== 1 || transform?.x !== void 0 && transform.x !== 0 || transform?.y !== void 0 && transform.y !== 0 || transform?.rotate !== void 0 && transform.rotate !== 0 || item.crop !== void 0 || item.opacity !== void 0 && item.opacity < 1 || item.keyframes !== void 0 || item.source.kind === "media" && "mask" in item && item.mask !== void 0 || item.source.kind === "media" && isAlphaCapableMediaSourcePath(pathOf?.(item.source.src));
}
function nextRef(counters, kind) {
  const ref = counters.get(kind) ?? 0;
  counters.set(kind, ref + 1);
  return ref;
}
function nextLegacyIndex(counters, collection) {
  const index = counters.get(collection) ?? 0;
  counters.set(collection, index + 1);
  return index;
}
function buildV2Item(item, fps, ref, lane, pathOf, chromaKeyOf, legacyIndexCounters, hasOverlappingSibling = false, parentAtFrames = 0, parentId) {
  const built = lane === "audio" ? buildV2AudioItem(item, fps, ref, pathOf, legacyIndexCounters) : buildV2VisualItem(
    item,
    fps,
    ref,
    pathOf,
    chromaKeyOf,
    legacyIndexCounters,
    hasOverlappingSibling,
    parentAtFrames,
    parentId
  );
  const children = lane === "visual" && "items" in item && Array.isArray(item.items) ? item.items.map((child) => buildV2Item(
    child,
    fps,
    ref,
    "visual",
    pathOf,
    chromaKeyOf,
    legacyIndexCounters,
    false,
    built.item.atFrames,
    built.item.id
  ).item) : [];
  if (children.length > 0 || "items" in item && Array.isArray(item.items)) {
    built.item.children = children;
  } else {
    delete built.item.children;
    Object.defineProperty(built.item, "children", { value: children, enumerable: false, writable: true });
  }
  if (parentId !== void 0) built.item.parentId = parentId;
  return built;
}
function buildV2VisualItem(item, fps, ref, pathOf, chromaKeyOf, legacyIndexCounters, hasOverlappingSibling = false, parentAtFrames = 0, parentId) {
  const atFrames = parentAtFrames + item.at;
  const durationFrames = item.duration;
  const at = atFrames / fps;
  const duration = durationFrames / fps;
  const declaredKeyframes = item.keyframes;
  const keyframes = Array.isArray(declaredKeyframes) ? declaredKeyframes.map((keyframe) => ({ ...keyframe, t: keyframe.t / fps })) : void 0;
  const common = {
    ...item.hidden !== void 0 ? { hidden: item.hidden } : {},
    ...item.transform !== void 0 ? { transform: item.transform } : {},
    ...item.opacity !== void 0 ? { opacity: item.opacity } : {},
    ...item.blend !== void 0 ? { blend: item.blend } : {},
    ...item.crop !== void 0 ? { crop: item.crop } : {},
    ...item.adjust !== void 0 ? { adjust: structuredClone(item.adjust) } : {},
    ...item.perspective !== void 0 ? { perspective: item.perspective } : {},
    ...item.motion !== void 0 ? { motion: structuredClone(item.motion) } : {},
    ...item.animator !== void 0 ? { animator: structuredClone(item.animator) } : {},
    ...keyframes !== void 0 ? { keyframes } : {},
    ...item.source.kind === "media" && "mask" in item && item.mask !== void 0 ? { mask: pathOf(item.mask) ?? item.mask } : {}
  };
  const finish = (built) => {
    if (!Array.isArray(declaredKeyframes) && declaredKeyframes !== void 0) {
      built.item.keyframesRef = { ...declaredKeyframes };
    }
    if (parentId !== void 0) {
      const relativeSeconds = item.at / fps;
      switch (item.source.kind) {
        case "media":
          built.item.declaration = { ...built.item.declaration, at: relativeSeconds };
          break;
        case "html":
        case "shape":
          built.item.declaration = { ...built.item.declaration, start: relativeSeconds };
          break;
        case "telop":
        case "filter":
          built.item.declaration = { ...built.item.declaration, t: relativeSeconds };
          break;
        default:
          break;
      }
    }
    return built;
  };
  switch (item.source.kind) {
    case "media": {
      const path = pathOf(item.source.src);
      const source = {
        kind: "media",
        sourceId: item.source.src,
        ...path !== void 0 ? { path } : {},
        in: item.source.in,
        out: item.source.out
      };
      const span = item.source.out - item.source.in;
      const freezeSeconds = isRecord2(item.source.freeze) && typeof item.source.freeze.duration_sec === "number" && Number.isFinite(item.source.freeze.duration_sec) ? Math.max(0, item.source.freeze.duration_sec) : 0;
      const playbackDuration = Math.max(0, duration - freezeSeconds);
      const alignsDuration = Math.abs(span - playbackDuration) <= 1 / fps + 1e-9;
      const cutOut = durationFrames === 0 ? item.source.in : alignsDuration ? item.source.in + playbackDuration : item.source.out;
      const speed = playbackDuration > 0 && !alignsDuration ? span / playbackDuration : void 0;
      if (needsLayersEngine(item, chromaKeyOf, hasOverlappingSibling)) {
        const declaration = {
          id: item.id,
          t: at,
          duration,
          kind: "video",
          src: path ?? item.source.src,
          track: ref,
          ...common,
          ...copyMediaSourceFields(item.source)
        };
        const value2 = declaration;
        return finish({
          item: {
            id: item.id,
            atFrames,
            durationFrames,
            at,
            duration,
            children: [],
            source,
            declaration,
            legacy: { collection: "layers", index: nextLegacyIndex(legacyIndexCounters, "layers"), value: value2 }
          }
        });
      }
      const value = {
        in: item.source.in,
        out: cutOut,
        src: item.source.src,
        at,
        track: ref,
        ...speed !== void 0 ? { speed } : {},
        ...item.transform !== void 0 ? { transform: item.transform } : {},
        ...item.opacity !== void 0 ? { opacity: item.opacity } : {},
        ...copyMediaSourceFields(item.source)
      };
      return finish({
        item: {
          id: item.id,
          atFrames,
          durationFrames,
          at,
          duration,
          children: [],
          source,
          declaration: {
            id: item.id,
            src: item.source.src,
            in: item.source.in,
            out: cutOut,
            at,
            track: ref,
            ...common,
            ...copyMediaSourceFields(item.source),
            ...speed !== void 0 ? { speed } : {}
          },
          legacy: { collection: "cuts", index: nextLegacyIndex(legacyIndexCounters, "cuts"), value }
        }
      });
    }
    case "html": {
      const declaration = {
        id: item.id,
        html: item.source.path,
        start: at,
        duration,
        track: ref,
        ...item.source.vars !== void 0 ? { vars: item.source.vars } : {},
        ...item.source.params !== void 0 ? { params: item.source.params } : {},
        ...common
      };
      const value = {
        id: item.id,
        start: at,
        duration,
        track: ref,
        payload: declaration
      };
      return finish({
        item: {
          id: item.id,
          atFrames,
          durationFrames,
          at,
          duration,
          children: [],
          source: {
            kind: "html",
            html: item.source.path,
            ...item.source.params !== void 0 ? { params: item.source.params } : {},
            ...item.source.part !== void 0 ? { part: item.source.part } : {},
            ...item.source.style !== void 0 ? { style: item.source.style } : {},
            ...item.source.text !== void 0 ? { text: item.source.text } : {},
            ...item.source.exclude !== void 0 ? { exclude: item.source.exclude } : {},
            ...item.source.derivedFrom !== void 0 ? { derivedFrom: item.source.derivedFrom } : {}
          },
          declaration,
          legacy: { collection: "overlays", index: nextLegacyIndex(legacyIndexCounters, "overlays"), value }
        }
      });
    }
    case "shape": {
      const html = shapeMarkup(item.source);
      const declaration = {
        id: item.id,
        html,
        htmlPath: "edit.json",
        start: at,
        duration,
        track: ref,
        ...common
      };
      const value = {
        id: item.id,
        start: at,
        duration,
        track: ref,
        payload: declaration
      };
      return finish({
        item: {
          id: item.id,
          atFrames,
          durationFrames,
          at,
          duration,
          children: [],
          // Deliberately omit html here: sourceById stamps a string source.html into htmlPath,
          // which render-inputs later treats as a filesystem path. overlay-runtime parts.mjs
          // uses item.source.html ?? declaration.html, so markup falls back to the declaration;
          // apps/shell consumers protect the absent field with typeof guards or try/catch.
          source: { kind: "html" },
          declaration,
          legacy: { collection: "overlays", index: nextLegacyIndex(legacyIndexCounters, "overlays"), value }
        }
      });
    }
    case "telop": {
      const source = {
        kind: "telop",
        preset: item.source.preset,
        ...item.source.params !== void 0 ? { params: item.source.params } : {},
        ...item.source.baked !== void 0 ? { baked: item.source.baked } : {},
        ...item.source.from !== void 0 ? { from: item.source.from } : {}
      };
      const declaration = {
        id: item.id,
        t: at,
        duration,
        kind: "baked",
        src: item.source.baked,
        preset: item.source.preset,
        params: item.source.params,
        track: ref,
        ...common
      };
      if (item.source.baked === void 0) {
        return finish({
          item: { id: item.id, atFrames, durationFrames, at, duration, children: [], source, declaration, legacy: { collection: "layers", index: nextLegacyIndex(legacyIndexCounters, "layers") } }
        });
      }
      const value = {
        id: item.id,
        t: at,
        duration,
        kind: "baked",
        src: item.source.baked,
        track: ref,
        ...item.source.preset !== void 0 ? { preset: item.source.preset } : {},
        ...item.transform !== void 0 ? { transform: item.transform } : {},
        ...item.opacity !== void 0 ? { opacity: item.opacity } : {},
        ...item.blend !== void 0 ? { blend: item.blend } : {}
      };
      return finish({
        item: { id: item.id, atFrames, durationFrames, at, duration, children: [], source, declaration, legacy: { collection: "layers", index: nextLegacyIndex(legacyIndexCounters, "layers"), value } }
      });
    }
    case "filter": {
      const source = { kind: "filter", filter: item.source.filter };
      return finish({
        item: {
          id: item.id,
          atFrames,
          durationFrames,
          at,
          duration,
          children: [],
          source,
          declaration: {
            id: item.id,
            t: at,
            duration,
            kind: "filter",
            filter: item.source.filter,
            track: ref,
            ...common
          },
          legacy: { collection: "layers", index: nextLegacyIndex(legacyIndexCounters, "layers") }
        }
      });
    }
    case "group":
      return finish({ item: {
        id: item.id,
        atFrames,
        durationFrames,
        at,
        duration,
        children: [],
        source: { kind: "group" },
        declaration: { id: item.id, at: item.at, duration: item.duration, ...common },
        legacy: { collection: "items", index: nextLegacyIndex(legacyIndexCounters, "items") }
      } });
    case "captions":
      return finish({ item: {
        id: item.id,
        atFrames,
        durationFrames,
        at,
        duration,
        children: [],
        source: { kind: "captions", path: "captions.json", ...item.source.exclude !== void 0 ? { exclude: item.source.exclude } : {} },
        declaration: { id: item.id, at: item.at, duration: item.duration, ...common },
        legacy: { collection: "items", index: nextLegacyIndex(legacyIndexCounters, "items") }
      } });
    case "caption":
      return finish({ item: {
        id: item.id,
        atFrames,
        durationFrames,
        at,
        duration,
        children: [],
        source: { kind: "caption", path: "captions.json", id: item.source.id },
        declaration: { id: item.id, at: item.at, duration: item.duration, ...common },
        legacy: { collection: "items", index: nextLegacyIndex(legacyIndexCounters, "items") }
      } });
  }
}
function buildV2AudioItem(item, fps, ref, pathOf, legacyIndexCounters) {
  const atFrames = item.at;
  const durationFrames = item.duration;
  const at = atFrames / fps;
  const duration = durationFrames / fps;
  const inSeconds = item.source.in ?? 0;
  const sourceClipFx = {
    ...item.source.speed !== void 0 ? { speed: item.source.speed } : {},
    ...item.source.pitch_semitones !== void 0 ? { pitch_semitones: item.source.pitch_semitones } : {},
    ...item.source.formant !== void 0 ? { formant: item.source.formant } : {}
  };
  const itemClipFx = {
    ...item.denoise !== void 0 ? { denoise: structuredClone(item.denoise) } : {},
    ...item.lowcut_hz !== void 0 ? { lowcut_hz: item.lowcut_hz } : {}
  };
  const path = pathOf(item.source.src);
  const source = {
    kind: "media",
    sourceId: item.source.src,
    ...path !== void 0 ? { path } : {},
    in: inSeconds,
    out: item.source.out ?? inSeconds,
    ...sourceClipFx
  };
  const resolvedPath = path ?? item.source.src;
  const role = item.role ?? "sfx";
  if (role === "narration") {
    const value2 = {
      id: item.id,
      t: at,
      path: resolvedPath,
      track: ref,
      ...item.gain_db !== void 0 ? { gainDb: item.gain_db } : {},
      ...sourceClipFx,
      ...itemClipFx,
      ...item.keyframes !== void 0 ? { keyframes: structuredClone(item.keyframes) } : {},
      ...item.ducking !== void 0 ? { ducking: item.ducking } : {},
      ...item.duck_db !== void 0 ? { duck_db: item.duck_db } : {},
      ...item.duck_attack !== void 0 ? { duck_attack: item.duck_attack } : {},
      ...item.duck_release !== void 0 ? { duck_release: item.duck_release } : {},
      ...item.source.in !== void 0 ? { in: item.source.in } : {},
      ...item.source.out !== void 0 ? { out: item.source.out } : {},
      ...item.script !== void 0 ? { script: item.script } : {},
      ...item.reading !== void 0 ? { reading: item.reading } : {},
      ...item.provenance !== void 0 ? { provenance: structuredClone(item.provenance) } : {}
    };
    return {
      item: {
        id: item.id,
        atFrames,
        durationFrames,
        at,
        duration,
        children: [],
        source,
        declaration: {
          id: item.id,
          t: at,
          path: resolvedPath,
          ...item.gain_db !== void 0 ? { gain_db: item.gain_db } : {},
          ...sourceClipFx,
          ...itemClipFx,
          ...item.keyframes !== void 0 ? { keyframes: structuredClone(item.keyframes) } : {},
          ...item.ducking !== void 0 ? { ducking: item.ducking } : {},
          ...item.duck_db !== void 0 ? { duck_db: item.duck_db } : {},
          ...item.duck_attack !== void 0 ? { duck_attack: item.duck_attack } : {},
          ...item.duck_release !== void 0 ? { duck_release: item.duck_release } : {},
          ...item.source.in !== void 0 ? { in: item.source.in } : {},
          ...item.source.out !== void 0 ? { out: item.source.out } : {},
          ...item.script !== void 0 ? { script: item.script } : {},
          ...item.reading !== void 0 ? { reading: item.reading } : {},
          ...item.provenance !== void 0 ? { provenance: structuredClone(item.provenance) } : {}
        },
        legacy: {
          collection: "narration",
          index: nextLegacyIndex(legacyIndexCounters, "narration"),
          value: value2
        }
      }
    };
  }
  if (role === "bgm") {
    const value2 = {
      id: "bgm",
      path: resolvedPath,
      track: ref,
      ...item.fade_in !== void 0 ? { fadeIn: item.fade_in } : {},
      ...item.fade_out !== void 0 ? { fadeOut: item.fade_out } : {},
      ...item.gain_db !== void 0 ? { gainDb: item.gain_db } : {},
      ...sourceClipFx,
      ...itemClipFx,
      ...item.ducking !== void 0 ? { ducking: item.ducking } : {},
      ...item.keyframes !== void 0 ? { keyframes: structuredClone(item.keyframes) } : {},
      ...item.duck_db !== void 0 ? { duck_db: item.duck_db } : {},
      ...item.duck_attack !== void 0 ? { duck_attack: item.duck_attack } : {},
      ...item.duck_release !== void 0 ? { duck_release: item.duck_release } : {}
    };
    return {
      item: {
        id: item.id,
        atFrames,
        durationFrames,
        at,
        duration,
        children: [],
        source,
        declaration: {
          path: resolvedPath,
          ...item.source.in !== void 0 ? { in: item.source.in } : {},
          ...item.fade_in !== void 0 ? { fadeIn: item.fade_in } : {},
          ...item.fade_out !== void 0 ? { fadeOut: item.fade_out } : {},
          ...item.gain_db !== void 0 ? { gain_db: item.gain_db } : {},
          ...sourceClipFx,
          ...itemClipFx,
          ...item.ducking !== void 0 ? { ducking: item.ducking } : {},
          ...item.keyframes !== void 0 ? { keyframes: structuredClone(item.keyframes) } : {},
          ...item.duck_db !== void 0 ? { duck_db: item.duck_db } : {},
          ...item.duck_attack !== void 0 ? { duck_attack: item.duck_attack } : {},
          ...item.duck_release !== void 0 ? { duck_release: item.duck_release } : {}
        },
        legacy: { collection: "bgm", index: 0, value: value2 }
      }
    };
  }
  const value = {
    id: item.id,
    t: at,
    duration,
    path: resolvedPath,
    track: ref,
    in: inSeconds,
    ...item.source.out !== void 0 ? { out: item.source.out } : {},
    ...item.gain_db !== void 0 ? { gainDb: item.gain_db } : {},
    ...sourceClipFx,
    ...itemClipFx,
    ...item.keyframes !== void 0 ? { keyframes: structuredClone(item.keyframes) } : {},
    ...item.ducking !== void 0 ? { ducking: item.ducking } : {},
    ...item.duck_db !== void 0 ? { duck_db: item.duck_db } : {},
    ...item.duck_attack !== void 0 ? { duck_attack: item.duck_attack } : {},
    ...item.duck_release !== void 0 ? { duck_release: item.duck_release } : {}
  };
  return {
    item: {
      id: item.id,
      atFrames,
      durationFrames,
      at,
      duration,
      children: [],
      source,
      declaration: {
        id: item.id,
        t: at,
        duration,
        path: resolvedPath,
        track: ref,
        in: inSeconds,
        ...item.source.out !== void 0 ? { out: item.source.out } : {},
        ...item.gain_db !== void 0 ? { gain_db: item.gain_db } : {},
        ...sourceClipFx,
        ...itemClipFx,
        ...item.keyframes !== void 0 ? { keyframes: structuredClone(item.keyframes) } : {},
        ...item.fade_in !== void 0 ? { fade_in: item.fade_in } : {},
        ...item.fade_out !== void 0 ? { fade_out: item.fade_out } : {},
        ...item.ducking !== void 0 ? { ducking: item.ducking } : {},
        ...item.duck_db !== void 0 ? { duck_db: item.duck_db } : {},
        ...item.duck_attack !== void 0 ? { duck_attack: item.duck_attack } : {},
        ...item.duck_release !== void 0 ? { duck_release: item.duck_release } : {}
      },
      legacy: { collection: "sfx", index: nextLegacyIndex(legacyIndexCounters, "sfx"), value }
    }
  };
}
function copyMediaSourceFields(source) {
  return {
    ...source.framing !== void 0 ? { framing: source.framing } : {},
    ...source.transition_out !== void 0 ? { transition_out: source.transition_out } : {},
    ...source.freeze !== void 0 ? { freeze: source.freeze } : {},
    ...source.fx !== void 0 ? { fx: source.fx } : {},
    ...source.speed !== void 0 ? { speed: source.speed } : {},
    ...source.gain_db !== void 0 ? { gain_db: source.gain_db } : {},
    ...source.mute !== void 0 ? { mute: source.mute } : {},
    ...source.chroma_key !== void 0 ? { chroma_key: source.chroma_key } : {}
  };
}
function addV2AudioItems(tracks, audioValue, fps, legacyIndexCounters) {
  const audio = isRecord2(audioValue) ? audioValue : void 0;
  if (!audio) return;
  const ensureTrack = (ref) => {
    let track = tracks.find((candidate) => candidate.lane === "audio" && (candidate.legacy.ref ?? 0) === ref);
    if (!track) {
      track = {
        id: `implicit-audio-${ref}`,
        lane: "audio",
        z: tracks.length,
        origin: "implicit",
        items: [],
        legacy: { kind: "audio", ref }
      };
      tracks.push(track);
    }
    return track;
  };
  const sfx = Array.isArray(audio.sfx) ? audio.sfx : [];
  sfx.forEach((entry, index) => {
    if (!isRecord2(entry) || typeof entry.path !== "string" || !entry.path.trim() || typeof entry.t !== "number") return;
    const ref = normalizeTrackNumber(entry.track);
    const start = typeof entry.in === "number" ? entry.in : 0;
    const end = typeof entry.out === "number" && entry.out > start ? entry.out : start + 1;
    const duration = Math.max(0, end - start);
    const value = {
      id: typeof entry.id === "string" ? entry.id : `sfx-${index}`,
      t: entry.t,
      duration,
      path: entry.path,
      track: ref,
      in: start,
      ...end > start ? { out: end } : {},
      ...typeof entry.gain_db === "number" ? { gainDb: entry.gain_db } : {},
      ...Array.isArray(entry.keyframes) ? { keyframes: structuredClone(entry.keyframes) } : {},
      ...typeof entry.ducking === "boolean" ? { ducking: entry.ducking } : {},
      ...typeof entry.duck_db === "number" ? { duck_db: entry.duck_db } : {},
      ...typeof entry.duck_attack === "number" ? { duck_attack: entry.duck_attack } : {},
      ...typeof entry.duck_release === "number" ? { duck_release: entry.duck_release } : {}
    };
    ensureTrack(ref).items.push({
      id: value.id,
      atFrames: Math.round(value.t * fps),
      durationFrames: Math.round(duration * fps),
      at: value.t,
      duration,
      children: [],
      source: { kind: "media", path: value.path, in: start, out: end },
      declaration: entry,
      legacy: { collection: "sfx", index: nextLegacyIndex(legacyIndexCounters, "sfx"), value }
    });
  });
  const narration = Array.isArray(audio.narration) ? audio.narration : [];
  narration.forEach((entry, index) => {
    if (!isRecord2(entry) || typeof entry.path !== "string" || typeof entry.t !== "number") return;
    const start = typeof entry.in === "number" ? entry.in : 0;
    const end = typeof entry.out === "number" ? entry.out : start;
    const duration = Math.max(0, end - start);
    const value = {
      id: typeof entry.id === "string" ? entry.id : `n-${String(index + 1).padStart(4, "0")}`,
      t: entry.t,
      path: entry.path,
      ...typeof entry.gain_db === "number" ? { gainDb: entry.gain_db } : {},
      ...Array.isArray(entry.keyframes) ? { keyframes: structuredClone(entry.keyframes) } : {},
      ...typeof entry.ducking === "boolean" ? { ducking: entry.ducking } : {},
      ...typeof entry.duck_db === "number" ? { duck_db: entry.duck_db } : {},
      ...typeof entry.duck_attack === "number" ? { duck_attack: entry.duck_attack } : {},
      ...typeof entry.duck_release === "number" ? { duck_release: entry.duck_release } : {},
      ...typeof entry.in === "number" ? { in: entry.in } : {},
      ...typeof entry.out === "number" ? { out: entry.out } : {},
      ...typeof entry.script === "string" ? { script: entry.script } : {},
      ...typeof entry.reading === "string" ? { reading: entry.reading } : {},
      ...isRecord2(entry.provenance) ? { provenance: structuredClone(entry.provenance) } : {}
    };
    ensureTrack(0).items.push({
      id: value.id,
      atFrames: Math.round(value.t * fps),
      durationFrames: Math.round(duration * fps),
      at: value.t,
      duration,
      children: [],
      source: { kind: "media", path: value.path, in: start, out: end },
      declaration: entry,
      legacy: { collection: "narration", index: nextLegacyIndex(legacyIndexCounters, "narration"), value }
    });
  });
  if (isRecord2(audio.bgm) && typeof audio.bgm.path === "string") {
    const entry = audio.bgm;
    const value = {
      id: "bgm",
      path: entry.path,
      ...typeof entry.fadeIn === "number" ? { fadeIn: entry.fadeIn } : {},
      ...typeof entry.fadeOut === "number" ? { fadeOut: entry.fadeOut } : {},
      ...typeof entry.gain_db === "number" ? { gainDb: entry.gain_db } : {},
      ...typeof entry.ducking === "boolean" ? { ducking: entry.ducking } : {},
      ...Array.isArray(entry.keyframes) ? { keyframes: structuredClone(entry.keyframes) } : {},
      ...typeof entry.duck_db === "number" ? { duck_db: entry.duck_db } : {},
      ...typeof entry.duck_attack === "number" ? { duck_attack: entry.duck_attack } : {},
      ...typeof entry.duck_release === "number" ? { duck_release: entry.duck_release } : {}
    };
    ensureTrack(0).items.push({
      id: "bgm",
      atFrames: 0,
      durationFrames: 0,
      at: 0,
      duration: 0,
      children: [],
      source: { kind: "media", path: value.path, in: 0, out: 0 },
      declaration: entry,
      legacy: { collection: "bgm", index: 0, value }
    });
  }
  tracks.forEach((track, index) => {
    track.z = index;
  });
}
function projectLegacyEdit(internal) {
  const cuts = [];
  const overlays = [];
  const layers = [];
  const audioSfx = [];
  const audioNarration = [];
  let audioBgm;
  for (const track of internal.tracks) {
    if (track.lane === "audio" && track.muted === true) continue;
    for (const item of track.items) {
      const value = item.legacy.value;
      if (value === void 0) {
        if (item.source.kind === "telop" || item.source.kind === "filter") {
          layers.push({ index: item.legacy.index, value: item.declaration });
        }
        continue;
      }
      switch (item.source.kind) {
        case "media":
          switch (item.legacy.collection) {
            case "sfx":
              audioSfx.push({ index: item.legacy.index, value });
              break;
            case "narration":
              audioNarration.push({ index: item.legacy.index, value });
              break;
            case "bgm":
              audioBgm = value;
              break;
            case "layers":
              layers.push({ index: item.legacy.index, value });
              break;
            default:
              cuts.push({
                index: item.legacy.index,
                value: track.lane === "visual" && track.muted === true ? { ...value, mute: true } : value
              });
              break;
          }
          break;
        case "html":
          overlays.push({ index: item.legacy.index, value });
          break;
        case "telop":
        case "filter":
          layers.push({ index: item.legacy.index, value });
          break;
        default:
          break;
      }
    }
  }
  const declaredTracks = internal.tracks.filter((track) => track.origin === "declared").map(toLegacyTrack);
  return {
    cuts: byDeclarationOrder(cuts),
    ...internal.sourceTableDeclared ? {
      sources: internal.sources.filter((entry) => entry.path !== void 0).map((entry) => ({ id: entry.id, path: entry.path, proxy: entry.proxy }))
    } : {},
    overlays: byDeclarationOrder(overlays),
    ...internal.beats !== void 0 ? { beats: internal.beats } : {},
    layers: byDeclarationOrder(layers),
    audioSfx: byDeclarationOrder(audioSfx),
    audioNarration: byDeclarationOrder(audioNarration),
    ...audioBgm ? { audioBgm } : {},
    ...internal.tracksDeclared ? { timeline: { tracks: declaredTracks } } : {},
    fps: internal.output.fps,
    warnings: internal.warnings
  };
}
function toLegacyTrack(track) {
  return {
    id: track.id,
    kind: track.legacy.kind,
    ...track.legacy.ref === void 0 ? {} : { ref: track.legacy.ref },
    ...track.name === void 0 ? {} : { label: track.name },
    ...track.muted === void 0 ? {} : { muted: track.muted },
    ...track.hidden === void 0 ? {} : { hidden: track.hidden },
    ...track.locked === void 0 ? {} : { locked: track.locked }
  };
}
function byDeclarationOrder(entries) {
  return [...entries].sort((left, right) => left.index - right.index).map((entry) => entry.value);
}
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizeTrackNumber(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

// ../edit-store/src/item-anchor.ts
function toAnchorCaptions(raw) {
  const rows = Array.isArray(raw) ? raw : isRecord3(raw) && Array.isArray(raw.captions) ? raw.captions : [];
  return rows.filter((row) => isRecord3(row) && typeof row.id === "string" && row.id.trim().length > 0 && typeof row.start === "number" && Number.isFinite(row.start) && typeof row.end === "number" && Number.isFinite(row.end)).map((row) => ({
    id: row.id,
    start: row.start,
    end: row.end,
    ...row.timeDomain === "output" || row.timeDomain === void 0 && row.time_domain === "output" ? { timeDomain: "output" } : {}
  }));
}
function resolveItemAnchor(item, context) {
  const start = item.anchor.range?.start ?? context.caption.start;
  const end = item.anchor.range?.end ?? context.caption.end;
  const startOut = context.caption.timeDomain === "output" ? start : sourceToOutput(context.segments, start);
  const endOut = context.caption.timeDomain === "output" ? end : sourceToOutput(context.segments, end);
  if (startOut === null || endOut === null) {
    return { unresolvable: "no-source-segments" };
  }
  if (startOut === endOut) {
    return { unresolvable: "removed-range" };
  }
  const startFrames = Math.round(startOut * context.fps);
  const endFrames = Math.round(endOut * context.fps);
  return {
    at: startFrames + (item.anchor.offset ?? 0) - context.parentAtFrames,
    duration: (item.anchor.duration ?? "caption") === "caption" ? Math.max(1, endFrames - startFrames) : item.duration
  };
}
function withoutItemAnchors(edit) {
  if (!isRecord3(edit) || !Array.isArray(edit.tracks)) return edit;
  let tracksChanged = false;
  const tracks = edit.tracks.map((track) => {
    if (!isRecord3(track) || !Array.isArray(track.items)) return track;
    const items = stripItems(track.items);
    if (items === track.items) return track;
    tracksChanged = true;
    return { ...track, items };
  });
  return tracksChanged ? { ...edit, tracks } : edit;
}
function resolveItemAnchors(edit, captions, options) {
  if (!hasItemAnchor(edit)) return { edit, changes: [], warnings: [] };
  const fps = validFps(options?.fps) ?? validFps(edit.output?.fps) ?? 30;
  const anchorFreeEdit = withoutItemAnchors(edit);
  const internal = readInternalEdit(anchorFreeEdit);
  const legacy = projectLegacyEdit(internal);
  const segments = buildTimelineMap(legacy.cuts, { fps: legacy.fps }).segments;
  const captionById = new Map(captions.map((caption) => [caption.id, caption]));
  const changes = [];
  const warnings = [];
  let tracksChanged = false;
  const tracks = edit.tracks.map((track) => {
    if (!("items" in track) || !Array.isArray(track.items) || track.lane !== "visual") return track;
    const items = resolveItems(track.items, 0, captionById, segments, fps, changes, warnings);
    if (items === track.items) return track;
    tracksChanged = true;
    return { ...track, items };
  });
  return {
    edit: tracksChanged ? { ...edit, tracks } : edit,
    changes,
    warnings
  };
}
function resolveItems(items, parentAtFrames, captionById, segments, fps, changes, warnings) {
  let changed = false;
  const result = items.map((item) => {
    let next = item;
    if (item.anchor) {
      if (item.source.kind === "captions" || item.source.kind === "caption") {
        warnings.push({ id: item.id, reason: "unsupported-kind" });
      } else {
        const caption = captionById.get(item.anchor.caption);
        if (!caption) {
          warnings.push({ id: item.id, reason: "caption-not-found" });
        } else {
          const resolution = resolveItemAnchor(item, {
            caption,
            segments,
            fps,
            parentAtFrames
          });
          if ("unresolvable" in resolution) {
            warnings.push({ id: item.id, reason: resolution.unresolvable });
          } else if (item.at !== resolution.at || item.duration !== resolution.duration) {
            changes.push({
              id: item.id,
              before: { at: item.at, duration: item.duration },
              after: resolution
            });
            next = { ...item, ...resolution };
            changed = true;
          }
        }
      }
    }
    const absoluteAtFrames = parentAtFrames + next.at;
    if (Array.isArray(next.items)) {
      const children = resolveItems(
        next.items,
        absoluteAtFrames,
        captionById,
        segments,
        fps,
        changes,
        warnings
      );
      if (children !== next.items) {
        next = { ...next, items: children };
        changed = true;
      }
    }
    return next;
  });
  return changed ? result : items;
}
function stripItems(items) {
  let changed = false;
  const result = items.map((item) => {
    if (!isRecord3(item)) return item;
    let next = item;
    if (Object.prototype.hasOwnProperty.call(item, "anchor")) {
      const { anchor: _anchor, ...rest } = item;
      next = rest;
      changed = true;
    }
    if (Array.isArray(next.items)) {
      const children = stripItems(next.items);
      if (children !== next.items) {
        next = { ...next, items: children };
        changed = true;
      }
    }
    return next;
  });
  return changed ? result : items;
}
function hasItemAnchor(edit) {
  const visit = (items) => items.some(
    (item) => item.anchor !== void 0 || Array.isArray(item.items) && visit(item.items)
  );
  return edit.tracks.some((track) => "items" in track && track.lane === "visual" && visit(track.items));
}
function validFps(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function isRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ../edit-store/src/caption-display.ts
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
  const position = isRecord4(positionValue) ? positionValue : void 0;
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
function isRecord4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ../edit-store/src/adjust-css-visual.ts
function computeAdjustCssVisual(adjust, transitionFilter) {
  const source = adjust && typeof adjust === "object" && !Array.isArray(adjust) ? adjust : null;
  const rawBasic = source && source.sections?.basic !== false ? source.basic : null;
  const basic = rawBasic && typeof rawBasic === "object" && !Array.isArray(rawBasic) ? rawBasic : null;
  const rawTransition = typeof transitionFilter === "string" ? transitionFilter.trim() : "";
  const transition = rawTransition === "none" ? "" : rawTransition;
  const clamp01 = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const hasWheels = source?.sections?.wheels !== false && ["lift", "gamma", "gain", "offset"].some((wheel) => ["r", "g", "b"].some((channel) => {
    const value = source?.wheels?.[wheel]?.[channel];
    return Number.isFinite(value) && value !== 0;
  }));
  const hasCurves = source?.sections?.curves !== false && ["master", "r", "g", "b"].some((channel) => {
    const raw = source?.curves?.[channel];
    if (raw == null) return false;
    const points = raw.map((point) => ({ in: clamp01(point.in), out: clamp01(point.out) })).sort((a, b) => a.in - b.in);
    return !(points.length === 2 && Math.abs(points[0].in) < 1e-5 && Math.abs(points[0].out) < 1e-5 && Math.abs(points[1].in - 1) < 1e-5 && Math.abs(points[1].out - 1) < 1e-5);
  });
  const hasHue = source?.sections?.hue !== false && ["hue", "sat", "luma"].some((channel) => (source?.hue?.[channel] ?? []).some((point) => Math.abs((Number.isFinite(point.value) ? clamp01(point.value) : 0.5) - 0.5) > 1e-4));
  const hasUnsupportedSection = hasWheels || hasCurves || hasHue;
  if (!basic && !transition && !hasUnsupportedSection) return null;
  const exposure = basic && Number.isFinite(basic.exposure) ? basic.exposure : 0;
  const contrast = basic && Number.isFinite(basic.contrast) ? basic.contrast : 0;
  const saturation = basic && Number.isFinite(basic.saturation) ? basic.saturation : 0;
  const temperature = basic && Number.isFinite(basic.temperature) ? basic.temperature : 0;
  const parts = [];
  if (Math.abs(exposure) > 5e-3) {
    parts.push("brightness(" + Math.pow(2, exposure).toFixed(2) + ")");
  }
  if (Math.abs(contrast) > 5e-3) {
    parts.push("contrast(" + (1 + contrast).toFixed(2) + ")");
  }
  if (Math.abs(saturation) > 5e-3) {
    parts.push("saturate(" + (1 + saturation).toFixed(2) + ")");
  }
  if (temperature > 5e-3) {
    parts.push("sepia(" + (temperature * 0.3).toFixed(2) + ")");
  } else if (temperature < -5e-3) {
    parts.push("hue-rotate(" + (-temperature * 20).toFixed(0) + "deg)");
  }
  if (transition) parts.push(transition);
  const unsupportedKeys = ["tint", "highlights", "shadows", "blacks", "whites", "vibrance"];
  const hasApproximation = hasUnsupportedSection || Boolean(basic) && unsupportedKeys.some((key) => {
    const value = basic?.[key];
    return Number.isFinite(value) && value !== 0;
  });
  return { filter: parts.join(" "), hasApproximation };
}

// ../edit-store/src/webview-kernel.ts
function findActiveResolvedCaption(cues, outputTime) {
  return cues.find((cue) => cue.start <= outputTime && outputTime < cue.end);
}
export {
  DEFAULT_DUCK_ATTACK_SEC,
  DEFAULT_DUCK_DB,
  DEFAULT_DUCK_KEYS,
  DEFAULT_DUCK_RELEASE_SEC,
  STATIC_DUCK_GAIN_DB,
  TEXTSTYLE_CATALOG,
  TRANSITION_BY_ID,
  TRANSITION_CATEGORIES,
  TRANSITION_TYPE_IDS,
  TRANSITION_VOCABULARY,
  applyCaptionStylePresets,
  buildTimelineMap,
  buildWebAudioSchedule,
  captionAnchorPositionVars,
  captionClockDomainOf,
  captionWindowSeconds,
  composeEnvelopesDb,
  computeAdjustCssVisual,
  computeDuckEnvelope,
  computeDuckIntervals,
  computeTransitionVisual,
  easingProgress,
  envelopeToGainEvents,
  evaluateEnvelopeDb,
  findActiveCaption,
  findActiveResolvedCaption,
  isTransitionType,
  isWithinDuckInterval,
  mergePresetTextStyle,
  normalizeCaptionClock,
  outputToSource,
  projectSpeechDeclarations,
  projectSpeechKeyIntervals,
  resolveCaptionStylePreset,
  resolveItemAnchor,
  resolveItemAnchors,
  sampleEnvelopeLinear,
  sourceToOutput,
  toAnchorCaptions,
  transitionProgressAt,
  withoutItemAnchors
};
