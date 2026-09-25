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
    if (segment.cutIndex !== null && normalizedCuts[segment.cutIndex]?.audio === false) continue;
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
function baseCaptionWindowSeconds(caption) {
  const start = typeof caption.start === "number" && Number.isFinite(caption.start) ? caption.start : 0;
  const duration = typeof caption.duration === "number" && Number.isFinite(caption.duration) ? caption.duration : 0;
  const end = typeof caption.end === "number" && Number.isFinite(caption.end) ? caption.end : start + duration;
  return { start, end };
}
function captionSpeechWindow(caption) {
  if (caption.display_timing !== "speech-tight" || !Array.isArray(caption.words) || caption.words.length === 0) {
    return null;
  }
  const words = caption.words.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const word = value;
    return typeof word.start === "number" && Number.isFinite(word.start) && typeof word.end === "number" && Number.isFinite(word.end) && word.end >= word.start ? [{ start: word.start, end: word.end }] : [];
  });
  if (words.length === 0) return null;
  const base = baseCaptionWindowSeconds(caption);
  const tightStart = Math.max(base.start, Math.min(...words.map((word) => word.start)));
  const tightEnd = Math.min(base.end, Math.max(...words.map((word) => word.end)));
  if (tightEnd - tightStart <= 0 || tightStart <= base.start && tightEnd >= base.end) return null;
  return { start: tightStart, end: tightEnd };
}
function captionWindowSeconds(caption) {
  return captionSpeechWindow(caption) ?? baseCaptionWindowSeconds(caption);
}
function captionFragmentWindows(caption) {
  const sourceText = caption.display_text ?? caption.text;
  const text = typeof sourceText === "string" ? sourceText : null;
  const fragments = caption.display_fragments;
  if (text === null || text.length === 0 || !Array.isArray(fragments) || fragments.length < 2 || fragments.some((fragment) => typeof fragment !== "string") || fragments.join("") !== text) {
    return null;
  }
  const window = captionWindowSeconds(caption);
  const words = Array.isArray(caption.words) ? caption.words : null;
  const validWords = words?.every((word) => isCaptionFragmentWord(word)) === true ? words : null;
  const wordText = validWords?.map((word) => word.text).join("");
  const fragmentEnds = [];
  fragments.reduce((offset, fragment) => {
    fragmentEnds.push(offset + fragment.length);
    return offset + fragment.length;
  }, 0);
  let wordLength = 0;
  const wordEnds = validWords ? validWords.map((word) => wordLength += word.text.length) : [];
  const useWords = validWords !== null && wordText === text && fragmentEnds.slice(0, -1).every((end) => wordEnds.includes(end));
  let characterStart = 0;
  return fragments.map((fragment, index) => {
    const characterEnd = characterStart + fragment.length;
    let start;
    let end;
    if (useWords) {
      const firstWord = characterStart === 0 ? 0 : wordEnds.indexOf(characterStart) + 1;
      const lastWord = wordEnds.indexOf(characterEnd);
      start = clamp(validWords[firstWord].start, window.start, window.end);
      end = clamp(validWords[lastWord].end, window.start, window.end);
    } else {
      const duration = window.end - window.start;
      start = window.start + duration * (characterStart / text.length);
      end = window.start + duration * (characterEnd / text.length);
    }
    characterStart = characterEnd;
    return { text: fragment, start, end, index: index + 1, count: fragments.length };
  });
}
function expandCaptionDisplayFragments(captions) {
  return captions.flatMap((caption) => {
    const windows = captionFragmentWindows(caption);
    if (windows === null) {
      const speechWindow = captionSpeechWindow(caption);
      return speechWindow === null ? [caption] : [{ ...caption, ...speechWindow }];
    }
    let characterStart = 0;
    return windows.map((window) => {
      const characterEnd = characterStart + window.text.length;
      const expanded = {
        ...caption,
        text: window.text,
        start: window.start,
        end: window.end,
        fragmentIndex: window.index,
        fragmentCount: window.count,
        fragmentKey: `${String(caption.id)}#f${window.index}`
      };
      if (Object.prototype.hasOwnProperty.call(caption, "display_text")) expanded.display_text = window.text;
      if (Array.isArray(caption.runs)) {
        const sourceText = String(caption.display_text ?? caption.text ?? "");
        expanded.runSourceText = sourceText;
        expanded.runTextStart = characterStart;
        expanded.runTextEnd = characterEnd;
      }
      if (Array.isArray(caption.words)) {
        let offset = 0;
        expanded.words = caption.words.flatMap((word) => {
          if (!isCaptionFragmentWord(word)) return [];
          const wordStart = offset;
          const wordEnd = offset + word.text.length;
          offset = wordEnd;
          if (wordStart < characterStart || wordEnd > characterEnd) return [];
          return [{
            ...word,
            start: clamp(word.start, window.start, window.end),
            end: clamp(word.end, window.start, window.end)
          }];
        });
      }
      delete expanded.display_fragments;
      characterStart = characterEnd;
      return expanded;
    });
  });
}
function isCaptionFragmentWord(value) {
  if (!value || typeof value !== "object") return false;
  const word = value;
  return typeof word.text === "string" && typeof word.start === "number" && Number.isFinite(word.start) && typeof word.end === "number" && Number.isFinite(word.end) && word.end >= word.start;
}
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function findActiveCaption(captions, sourceSeconds) {
  return captions.find((caption) => {
    const window = captionWindowSeconds(caption);
    return window.start <= sourceSeconds && sourceSeconds < window.end;
  });
}
function findActiveCaptions(captions, seconds) {
  return captions.filter((caption) => {
    const window = captionWindowSeconds(caption);
    return window.start <= seconds && seconds < window.end;
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
function resolveCaptionStylePreset(record2, catalog) {
  const presetId = record2.style_preset;
  if (typeof presetId !== "string") return { record: record2, resolved: false };
  const preset = catalog instanceof Map ? catalog.get(presetId) : Object.prototype.hasOwnProperty.call(catalog, presetId) ? catalog[presetId] : void 0;
  if (!preset) return { record: record2, resolved: false };
  return {
    record: {
      ...record2,
      text_style: mergePresetTextStyle(preset.style, record2.text_style)
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
        "color": "#E53935",
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
  const value = clamp2(progress);
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
  const boundaries = [...new Set([...left, ...right].map((point2) => point2.t))].sort((x, y) => x - y);
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
    ...normalized.filter((point2) => point2.t > clipStartSec && point2.t < clipEndSec).map((point2) => point2.t),
    clipEndSec
  ];
  return [...new Set(clippedTimes)].sort((a, b) => a - b).map((t) => ({
    t: t - clipStartSec,
    gainDb: evaluateEnvelopeDb(normalized, t),
    ...easingAtExactPoint(normalized, t)
  }));
}
function normalizedPoints(points) {
  const sorted = points.filter((point2) => point2 && Number.isFinite(point2.t) && point2.t >= 0 && Number.isFinite(point2.gainDb)).map((point2) => ({ ...point2 })).sort((a, b) => a.t - b.t);
  const result = [];
  for (const point2 of sorted) {
    if (result.length > 0 && Math.abs(result[result.length - 1].t - point2.t) <= 1e-9) result[result.length - 1] = point2;
    else result.push(point2);
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
  const point2 = points.find((candidate) => Math.abs(candidate.t - t) <= 1e-9);
  return point2?.easing ? { easing: point2.easing } : {};
}
function dbToLinear(db) {
  return Math.max(MIN_LINEAR_GAIN, 10 ** (db / 20));
}
function finiteInRange(value, minimum, maximum, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}
function clamp2(value, minimum = 0, maximum = 1) {
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

// ../edit-store/src/audio-ownership.ts
function isAudioItemAudible(track, item) {
  return track?.muted !== true && item?.mute !== true;
}
function isCutAudioAudible(cut, track) {
  return cut.audio !== false && isAudioItemAudible(track, cut);
}
function isLayerAudioAudible(layer, track) {
  return layer.kind === "video" && layer.isImage !== true && typeof layer.src === "string" && layer.src.length > 0 && !/\.(?:png|jpe?g|webp|bmp|gif|svg)(?:[?#].*)?$/iu.test(layer.src) && isCutAudioAudible(layer, track);
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
  const narrationIntervals = computeDuckIntervals(narration.filter((item) => item.spec.duckKey !== true).map((item) => ({
    t: item.t,
    durationSec: item.itemDurationSec
  })));
  const duckKeys = normalizedDuckKeys(audio.duck_keys);
  const speechIntervals = [
    ...input.duckKeyIntervals ?? input.speechKeyIntervals ?? [],
    ...computeDuckIntervals(narration.filter((item) => item.spec.duckKey === true).map((item) => ({
      t: item.t,
      durationSec: item.itemDurationSec
    })))
  ];
  const duckIntervals = mergeDuckIntervals([
    ...duckKeys.includes("narration") ? narrationIntervals : [],
    ...duckKeys.includes("speech") ? speechIntervals : []
  ]);
  const warnUnduckedTarget = (id, clipStartSec, clipDurationSec) => {
    if (duckKeys.length === 0) return;
    const label = `audio ducking target ${id} (duck_keys: ${JSON.stringify(duckKeys)})`;
    if (duckIntervals.length === 0) {
      warnings.push(`${label}: no duck key intervals are available; ducking was not applied`);
    } else if (!duckIntervals.some((interval) => interval.startSec < clipStartSec + clipDurationSec && interval.endSec > clipStartSec)) {
      warnings.push(`${label}: duck key intervals do not overlap the clip; ducking was not applied`);
    }
  };
  const items = [];
  for (const bgm of audio.bgms ?? (audio.bgm ? [audio.bgm] : [])) {
    if (bgm && isAudioItemAudible(void 0, bgm)) {
      const scheduled = scheduleBgm(bgm, timelineDurationSec, startAtSec, duckIntervals, warnings);
      if (scheduled) items.push(scheduled);
      if (bgm.ducking === true && finitePositive(bgm.durationSec)) {
        const clipStartSec = typeof bgm.t === "number" && Number.isFinite(bgm.t) && bgm.t > 0 ? bgm.t : 0;
        const clipDurationSec = finitePositive(bgm.duration) ? Math.min(timelineDurationSec - clipStartSec, bgm.duration) : timelineDurationSec - clipStartSec;
        if (clipDurationSec > 0) {
          warnUnduckedTarget(
            typeof bgm.id === "string" && bgm.id ? bgm.id : "bgm",
            clipStartSec,
            clipDurationSec
          );
        }
      }
      if (bgm.ducking === void 0 && duckKeys.length > 0 && finitePositive(bgm.durationSec)) {
        const clipStartSec = typeof bgm.t === "number" && Number.isFinite(bgm.t) && bgm.t > 0 ? bgm.t : 0;
        const clipDurationSec = finitePositive(bgm.duration) ? Math.min(timelineDurationSec - clipStartSec, bgm.duration) : timelineDurationSec - clipStartSec;
        if (clipDurationSec > 0 && duckIntervals.some((interval) => interval.startSec < clipStartSec + clipDurationSec && interval.endSec > clipStartSec)) {
          warnings.push(`audio bgm ${typeof bgm.id === "string" && bgm.id ? bgm.id : "bgm"} overlaps duck key intervals (duck_keys: ${JSON.stringify(duckKeys)}) but ducking is not enabled; set "ducking": true on the item to duck it under narration`);
        }
      }
    }
  }
  for (const item of sfx) {
    const scheduled = scheduleTimed(item, timelineDurationSec, startAtSec, duckIntervals);
    if (scheduled) items.push(scheduled);
    if (item.spec.ducking === true) {
      warnUnduckedTarget(
        item.id,
        item.t,
        Math.min(item.itemDurationSec, timelineDurationSec - item.t)
      );
    }
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
    if (!isAudioItemAudible(void 0, spec)) continue;
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
      itemDurationSec: spec.duckKey === true && finitePositive(spec.duration) ? Math.min(spec.duration, trim.durationSec / playbackRate) : sidecar ? trim.durationSec : trim.durationSec / playbackRate,
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
  const fadeWindowSec = item.kind === "sfx" ? item.itemDurationSec : Math.min(item.itemDurationSec, Math.max(0, timelineDurationSec - item.t));
  const gainEvents = fadeGainEvents(
    item.spec.fade_in ?? item.spec.fadeIn,
    item.spec.fade_out ?? item.spec.fadeOut,
    fadeWindowSec,
    elapsedIntoItemSec,
    durationSec,
    baseGain
  );
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
  const itemEndSec = finitePositive(spec.duration) ? Math.min(timelineDurationSec, timelineT + spec.duration) : timelineDurationSec;
  if (startAtSec >= itemEndSec) return null;
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
  const timelineAvailableSec = itemEndSec - timelineStartSec;
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
      itemEndSec,
      timelineStartSec,
      durationSec,
      baseGain
    ),
    envelopeEvents: scheduledEnvelopeEvents(
      spec,
      timelineT,
      itemEndSec - timelineT,
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
  const usable = virtualCuts.map((cut, index) => ({ cut, index })).filter(({ cut }) => Number.isFinite(cut.in) && Number.isFinite(cut.out) && cut.in < cut.out);
  const clipWindows = new Map(computeCutTrackSegments(usable.map((entry) => entry.cut)).map((segment) => [
    usable[segment.index].index,
    { start: segment.at, end: segment.end, cutTimelineStart: segment.at }
  ]));
  for (const window of map.transitionWindows) {
    for (const participant of [window.outgoing, window.incoming]) {
      const clip = clipWindows.get(participant.cutIndex);
      const cut = normalizedCuts[participant.cutIndex];
      if (!clip || !cut || typeof participant.in !== "number") continue;
      const speed = finitePositive(cut.speed) ? cut.speed : 1;
      clip.cutTimelineStart = participant.outStart - (participant.in - cut.in) / speed;
    }
    const outgoing = clipWindows.get(window.outgoing.cutIndex);
    const incoming = clipWindows.get(window.incoming.cutIndex);
    if (outgoing) outgoing.end = Math.max(outgoing.end, window.end);
    if (incoming) incoming.start = Math.max(incoming.start, window.end);
  }
  const declarations = [];
  for (const [cutIndex, clip] of clipWindows) {
    const cut = normalizedCuts[cutIndex];
    if (!cut || typeof cut.src !== "string" || !cut.src) continue;
    if (!isCutAudioAudible(cut)) continue;
    const speed = finitePositive(cut.speed) ? cut.speed : 1;
    const cutTimelineStart = clip.cutTimelineStart;
    const baseDurationSec = Math.max(0, cut.out - cut.in) / speed;
    const gainDb = speechGainDb(cut);
    const baseId = speechBaseId(cut, cutIndex);
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
        clipStart: clip.start,
        clipEnd: clip.end,
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
      clipStart: clip.start,
      clipEnd: clip.end,
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
      clipStart: clip.start,
      clipEnd: clip.end,
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
  if (options.layers?.length) declarations.push(...projectLayerSpeechDeclarations(options.layers, { fps }));
  return declarations;
}
function projectLayerSpeechDeclarations(layers, options) {
  const cuts = layers.map((layer, index) => {
    const speed = finitePositive(layer.speed) ? layer.speed : 1;
    const sourceIn = finiteNonNegative(layer.in) ? layer.in : 0;
    return {
      ...layer,
      id: `layer-${layer.id || index}`,
      in: sourceIn,
      out: sourceIn + Math.max(0, layer.duration - freezeDuration(layer.freeze)) * speed,
      at: layer.t,
      speed,
      audio: isLayerAudioAudible(layer) ? void 0 : false
    };
  });
  return projectSpeechDeclarations(cuts, options).map((item) => ({ ...item, scope: "layers" }));
}
function speechBaseId(cut, index) {
  return cut && typeof cut.id === "string" && cut.id ? cut.id : `cut-${index}`;
}
function appendSpeechIntersection(declarations, input) {
  const atSec = Math.max(input.outputStart, input.clipStart);
  const endSec = Math.min(input.outputEnd, input.clipEnd);
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
  ].filter((point2) => point2 >= elapsedIntoItemSec && point2 <= windowEnd)).map((point2, index) => ({
    offsetSec: point2 - elapsedIntoItemSec,
    value: baseGain * multiplierAt(point2),
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
  ].filter((point2) => point2 >= elapsedIntoItemSec && point2 <= windowEnd));
  return points.map((point2, index) => ({
    offsetSec: point2 - elapsedIntoItemSec,
    value: baseGain * multiplierAt(point2),
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
  ].filter((point2) => point2 >= timelineStartSec && point2 <= timelineEndSec));
  return points.map((point2, index) => ({
    offsetSec: point2 - timelineStartSec,
    value: baseGain * multiplierAt(point2),
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
  if (composed.length === 0 || composed.every((point2) => Math.abs(point2.gainDb) <= 1e-12)) return [];
  return envelopeToGainEvents(sliceEnvelope(composed, elapsedIntoClipSec, availableSec));
}
function audioKeyframeEnvelope(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const point2 = entry;
    if (!finiteNonNegative(point2.t) || typeof point2.gain_db !== "number" || !Number.isFinite(point2.gain_db)) return [];
    return [{
      t: point2.t,
      gainDb: point2.gain_db,
      ...typeof point2.easing === "string" ? { easing: point2.easing } : {}
    }];
  }).sort((left, right) => left.t - right.t);
}
function sliceEnvelope(points, startSec, durationSec) {
  if (points.length === 0 || !(durationSec > 0)) return [];
  const endSec = startSec + durationSec;
  return [
    { t: 0, gainDb: evaluateEnvelopeDb(points, startSec) },
    ...points.filter((point2) => point2.t > startSec && point2.t < endSec).map((point2) => ({
      ...point2,
      t: point2.t - startSec
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

// ../edit-store/src/shape-geometry.ts
var numberToken = "-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
var tokenPattern = new RegExp(`[MLCZ]|${numberToken}`, "gu");
var numberPattern = new RegExp(`^${numberToken}$`, "u");
var f = (v) => +v.toFixed(3);
var point = (p) => `${f(p[0])} ${f(p[1])}`;
function parseShapePath(d) {
  if (!d || d.length > 1e5) throw new Error("shape path is empty or too long");
  const tokens = d.match(tokenPattern) ?? [];
  if (d.replace(tokenPattern, "").replace(/[\s,]/gu, "") !== "") {
    throw new Error("unsupported shape path command");
  }
  const subs = [];
  let i = 0;
  let sub;
  const number2 = () => {
    const token = tokens[i++];
    if (!token || !numberPattern.test(token)) throw new Error("invalid shape path coordinate");
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("non-finite shape path coordinate");
    return value;
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M") {
      sub = { start: [number2(), number2()], segs: [], closed: false };
      subs.push(sub);
    } else if (command === "L" && sub && !sub.closed) sub.segs.push({ t: "L", p: [number2(), number2()] });
    else if (command === "C" && sub && !sub.closed) {
      sub.segs.push({
        t: "C",
        c1: [number2(), number2()],
        c2: [number2(), number2()],
        p: [number2(), number2()]
      });
    } else if (command === "Z" && sub && !sub.closed) {
      sub.closed = true;
      const last = sub.segs.length ? sub.segs[sub.segs.length - 1].p : sub.start;
      if (Math.hypot(last[0] - sub.start[0], last[1] - sub.start[1]) > 1e-6) {
        sub.segs.push({ t: "L", p: [...sub.start] });
      }
    } else throw new Error("invalid shape path structure");
  }
  if (!subs.length || subs.some((s) => !s.segs.length)) throw new Error("shape path has no segments");
  return subs;
}
function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
function cubicExtrema(a, b, c, d) {
  const A = -a + 3 * b - 3 * c + d;
  const B = 2 * (a - 2 * b + c);
  const C = b - a;
  if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C / B].filter((t) => t > 0 && t < 1);
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return [];
  return [(-B + Math.sqrt(discriminant)) / (2 * A), (-B - Math.sqrt(discriminant)) / (2 * A)].filter(
    (t) => t > 0 && t < 1
  );
}
function shapePathBounds(subs) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (p) => {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  };
  for (const sub of subs) {
    let prev = sub.start;
    add(prev);
    for (const seg of sub.segs) {
      add(seg.p);
      if (seg.t === "C") {
        for (let axis = 0; axis < 2; axis++) {
          for (const t of cubicExtrema(prev[axis], seg.c1[axis], seg.c2[axis], seg.p[axis])) {
            const p = [...prev];
            p[axis] = cubic(prev[axis], seg.c1[axis], seg.c2[axis], seg.p[axis], t);
            add(p);
          }
        }
      }
      prev = seg.p;
    }
  }
  return { x: x0, y: y0, width: Math.max(1e-6, x1 - x0), height: Math.max(1e-6, y1 - y0) };
}
function serializeShapePath(subs) {
  return subs.map(
    (s) => `M${point(s.start)}` + s.segs.map(
      (g) => g.t === "L" ? `L${point(g.p)}` : `C${point(g.c1)} ${point(g.c2)} ${point(g.p)}`
    ).join("") + (s.closed ? "Z" : "")
  ).join("");
}
function fitShapePath(d, width, height) {
  const subs = parseShapePath(d);
  const b = shapePathBounds(subs);
  const map = (p) => [(p[0] - b.x) * width / b.width, (p[1] - b.y) * height / b.height];
  return subs.map((s) => ({
    start: map(s.start),
    closed: s.closed,
    segs: s.segs.map(
      (g) => g.t === "L" ? { t: "L", p: map(g.p) } : { t: "C", c1: map(g.c1), c2: map(g.c2), p: map(g.p) }
    )
  }));
}
function scaleShapePath(subs, x, y) {
  const map = (p) => [p[0] * x, p[1] * y];
  return subs.map((s) => ({
    start: map(s.start),
    closed: s.closed,
    segs: s.segs.map(
      (g) => g.t === "L" ? { t: "L", p: map(g.p) } : { t: "C", c1: map(g.c1), c2: map(g.c2), p: map(g.p) }
    )
  }));
}
function roundShapePath(subs, radius) {
  if (radius <= 0) return subs;
  return subs.map((sub) => {
    if (!sub.closed || sub.segs.length < 3) return sub;
    const n = sub.segs.length;
    const corners = sub.segs.map((out, i) => {
      const incoming = sub.segs[(i - 1 + n) % n];
      if (incoming.t !== "L" || out.t !== "L") return null;
      const vertex = i === 0 ? sub.start : sub.segs[i - 1].p;
      const before = i === 0 ? n > 1 ? sub.segs[n - 2].p : sub.start : i > 1 ? sub.segs[i - 2].p : sub.start;
      const after = out.p;
      const l1 = Math.hypot(vertex[0] - before[0], vertex[1] - before[1]);
      const l2 = Math.hypot(after[0] - vertex[0], after[1] - vertex[1]);
      if (!l1 || !l2) return null;
      const u1 = [(vertex[0] - before[0]) / l1, (vertex[1] - before[1]) / l1];
      const u2 = [(after[0] - vertex[0]) / l2, (after[1] - vertex[1]) / l2];
      if (Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) < 0.02 && u1[0] * u2[0] + u1[1] * u2[1] > 0) {
        return null;
      }
      const r = Math.min(radius, l1 / 2, l2 / 2);
      if (r < 0.01) return null;
      return {
        vertex,
        a: [vertex[0] - u1[0] * r, vertex[1] - u1[1] * r],
        b: [vertex[0] + u2[0] * r, vertex[1] + u2[1] * r]
      };
    });
    const result = { start: corners[0]?.b ?? sub.start, segs: [], closed: true };
    for (let i = 0; i < n; i++) {
      const segment = sub.segs[i];
      const next = corners[(i + 1) % n];
      result.segs.push(segment.t === "L" ? { t: "L", p: next?.a ?? segment.p } : segment);
      if (next) {
        const K = 0.5523;
        result.segs.push({
          t: "C",
          c1: [
            next.a[0] + (next.vertex[0] - next.a[0]) * K,
            next.a[1] + (next.vertex[1] - next.a[1]) * K
          ],
          c2: [
            next.b[0] + (next.vertex[0] - next.b[0]) * K,
            next.b[1] + (next.vertex[1] - next.b[1]) * K
          ],
          p: next.b
        });
      }
    }
    return result;
  });
}

// ../edit-store/src/shape-source-validation.ts
var oldKinds = /* @__PURE__ */ new Set(["rect", "rounded-rect", "ellipse", "line", "arrow", "speech-bubble"]);
var kinds = /* @__PURE__ */ new Set([...oldKinds, "path", "bubble"]);
var capKinds = /* @__PURE__ */ new Set(["none", "triangle", "chevron", "bar", "square", "circle", "diamond"]);
var bubbleStyles = /* @__PURE__ */ new Set(["ellipse", "rounded", "rect", "jagged", "burst", "cloud", "wobble"]);
var paramsKeys = /* @__PURE__ */ new Set([
  "width",
  "height",
  "fill",
  "stroke",
  "strokeWidth",
  "cornerRadius",
  "path",
  "preset",
  "dash",
  "startCap",
  "endCap",
  "startCapFilled",
  "endCapFilled",
  "lineCap",
  "style",
  "count",
  "depth",
  "jitter",
  "seed",
  "tail",
  "tailAngle",
  "tailLength",
  "tailWidth",
  "tailCurve"
]);
var hex = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;
var record = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var fail = (path, message) => {
  throw new Error(`edit.json v2 \u304C\u4E0D\u6B63\u3067\u3059 (${path}): ${message}`);
};
function requireRecord(value, path) {
  if (!record(value)) fail(path, "object \u304C\u5FC5\u8981\u3067\u3059");
}
var number = (v, min, max, integer = false) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
function assertKeys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, "\u672A\u5BFE\u5FDC\u306E\u30AD\u30FC\u3067\u3059");
}
function paint(value, path, v1) {
  if (typeof value === "string") {
    if (v1 && value !== "none" && !hex.test(value)) fail(path, "#RRGGBB(AA) \u307E\u305F\u306F none \u304C\u5FC5\u8981\u3067\u3059");
    return;
  }
  requireRecord(value, path);
  assertKeys(value, /* @__PURE__ */ new Set(["type", "angle", "stops"]), path);
  if (value.type !== "linear" && value.type !== "radial") {
    fail(`${path}.type`, "linear \u307E\u305F\u306F radial \u304C\u5FC5\u8981\u3067\u3059");
  }
  if (value.type === "linear" ? !number(value.angle, 0, 360) : "angle" in value) {
    fail(`${path}.angle`, "\u89D2\u5EA6\u304C\u4E0D\u6B63\u3067\u3059");
  }
  if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 5) {
    fail(`${path}.stops`, "2\u301C5 \u8272\u304C\u5FC5\u8981\u3067\u3059");
  }
  const stops = value.stops;
  let last = -1;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    requireRecord(stop, `${path}.stops[${i}]`);
    assertKeys(stop, /* @__PURE__ */ new Set(["color", "offset"]), `${path}.stops[${i}]`);
    if (typeof stop.color !== "string" || !hex.test(stop.color)) {
      fail(`${path}.stops[${i}].color`, "\u8272\u304C\u4E0D\u6B63\u3067\u3059");
    }
    if (!number(stop.offset, 0, 1) || stop.offset < last) {
      fail(`${path}.stops[${i}].offset`, "\u4F4D\u7F6E\u306F\u6607\u9806\u306E 0\u301C1 \u3067\u3059");
    }
    last = stop.offset;
  }
}
function validateShapeSource(value, path) {
  assertKeys(value, /* @__PURE__ */ new Set(["kind", "shape", "params"]), path);
  if (!kinds.has(value.shape)) fail(`${path}.shape`, "\u672A\u5BFE\u5FDC\u306E shape \u3067\u3059");
  if (value.params === void 0) {
    if (value.shape === "path") fail(`${path}.params.path`, "path \u304C\u5FC5\u8981\u3067\u3059");
    return;
  }
  requireRecord(value.params, `${path}.params`);
  const p = value.params;
  assertKeys(p, paramsKeys, `${path}.params`);
  const v1 = value.shape === "path" || value.shape === "bubble" || [
    "preset",
    "dash",
    "startCap",
    "endCap",
    "startCapFilled",
    "endCapFilled",
    "lineCap",
    "style",
    "count",
    "depth",
    "jitter",
    "seed",
    "tail",
    "tailAngle",
    "tailLength",
    "tailWidth",
    "tailCurve"
  ].some((k) => k in p) || record(p.fill) || record(p.stroke);
  for (const key of ["width", "height"]) {
    if (key in p && !number(p[key], Number.MIN_VALUE, Infinity)) {
      fail(`${path}.params.${key}`, "\u6B63\u306E\u6709\u9650\u6570\u304C\u5FC5\u8981\u3067\u3059");
    }
  }
  if ("strokeWidth" in p && !number(p.strokeWidth, 0, v1 ? 100 : Infinity)) {
    fail(`${path}.params.strokeWidth`, "\u7BC4\u56F2\u5916\u3067\u3059");
  }
  if ("cornerRadius" in p && !number(p.cornerRadius, 0, value.shape === "path" ? 100 : Infinity)) {
    fail(`${path}.params.cornerRadius`, "\u7BC4\u56F2\u5916\u3067\u3059");
  }
  for (const key of ["fill", "stroke"]) if (key in p) paint(p[key], `${path}.params.${key}`, v1);
  if ("preset" in p && (typeof p.preset !== "string" || !p.preset.trim())) {
    fail(`${path}.params.preset`, "ID \u304C\u5FC5\u8981\u3067\u3059");
  }
  if ("path" in p || value.shape === "path") {
    if (value.shape !== "path") fail(`${path}.params.path`, "path \u578B\u3060\u3051\u304C\u6301\u3066\u307E\u3059");
    requireRecord(p.path, `${path}.params.path`);
    const pathValue = p.path;
    assertKeys(pathValue, /* @__PURE__ */ new Set(["d", "vb", "rule"]), `${path}.params.path`);
    if (typeof pathValue.d !== "string" || !Array.isArray(pathValue.vb) || pathValue.vb.length !== 2 || !pathValue.vb.every((n) => number(n, Number.MIN_VALUE, Infinity)) || pathValue.rule !== void 0 && !["nonzero", "evenodd"].includes(pathValue.rule)) fail(`${path}.params.path`, "path \u304C\u4E0D\u6B63\u3067\u3059");
    try {
      parseShapePath(pathValue.d);
    } catch {
      fail(`${path}.params.path.d`, "\u7D76\u5BFE\u5EA7\u6A19\u306E M/L/C/Z \u304C\u5FC5\u8981\u3067\u3059");
    }
  }
  if (["startCap", "endCap", "startCapFilled", "endCapFilled", "lineCap"].some((k) => k in p) && !["line", "arrow"].includes(value.shape)) fail(`${path}.params`, "\u7AEF\u306E\u5024\u306F line/arrow \u3060\u3051\u304C\u6301\u3066\u307E\u3059");
  if ("dash" in p && !["solid", "dash", "dot"].includes(p.dash)) {
    fail(`${path}.params.dash`, "\u7DDA\u7A2E\u304C\u4E0D\u6B63\u3067\u3059");
  }
  for (const key of ["startCap", "endCap"]) {
    if (key in p && !capKinds.has(p[key])) {
      fail(`${path}.params.${key}`, "\u7AEF\u306E\u7A2E\u985E\u304C\u4E0D\u6B63\u3067\u3059");
    }
  }
  for (const key of ["startCapFilled", "endCapFilled"]) {
    if (key in p && typeof p[key] !== "boolean") fail(`${path}.params.${key}`, "boolean \u304C\u5FC5\u8981\u3067\u3059");
  }
  if ("lineCap" in p && !["butt", "round"].includes(p.lineCap)) {
    fail(`${path}.params.lineCap`, "\u7AEF\u306E\u5F62\u304C\u4E0D\u6B63\u3067\u3059");
  }
  if ([
    "style",
    "count",
    "depth",
    "jitter",
    "seed",
    "tail",
    "tailAngle",
    "tailLength",
    "tailWidth",
    "tailCurve"
  ].some((k) => k in p) && value.shape !== "bubble") fail(`${path}.params`, "\u5439\u304D\u51FA\u3057\u306E\u5024\u306F bubble \u3060\u3051\u304C\u6301\u3066\u307E\u3059");
  if ("style" in p && !bubbleStyles.has(p.style)) {
    fail(`${path}.params.style`, "\u5439\u304D\u51FA\u3057\u306E\u5F62\u304C\u4E0D\u6B63\u3067\u3059");
  }
  if ("tail" in p && !["point", "dots", "none"].includes(p.tail)) {
    fail(`${path}.params.tail`, "\u3057\u3063\u307D\u304C\u4E0D\u6B63\u3067\u3059");
  }
  for (const key of ["count", "depth", "jitter", "tailAngle", "tailLength", "tailWidth", "tailCurve", "seed"]) {
    if (key in p) {
      const range = key === "count" ? [4, 48, true] : key === "seed" ? [-2147483648, 2147483647, true] : key === "tailCurve" ? [-100, 100, false] : key === "tailAngle" ? [0, 360, false] : [0, 100, false];
      const [min, max, integer] = range;
      if (!number(p[key], min, max, integer)) fail(`${path}.params.${key}`, "\u7BC4\u56F2\u5916\u3067\u3059");
    }
  }
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
var ITEM_KEYS = /* @__PURE__ */ new Set([
  "id",
  "name",
  "hidden",
  "locked",
  "reason",
  "label",
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
  "erase",
  "flip",
  "source",
  "audio",
  "anchor"
]);
var AUDIO_ITEM_KEYS = /* @__PURE__ */ new Set([
  "id",
  "name",
  "hidden",
  "locked",
  "at",
  "duration",
  "role",
  "link",
  "mute",
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
  "caption_ref",
  "provenance",
  "anchor"
]);
function readEditV2(json) {
  const parsed = parseInput(json);
  requireRecord2(parsed, "edit.json");
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
    requireRecord2(parsed.audio, "edit.json.audio");
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
  if (hasOwn(parsed, "thumbnail")) requireRecord2(parsed.thumbnail, "edit.json.thumbnail");
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
    ..."erase" in item && item.erase ? { erase: structuredClone(item.erase) } : {},
    ..."flip" in item && item.flip ? { flip: { ...item.flip } } : {},
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
  requireRecord2(value, "edit.json.output");
  requirePositiveNumber(value.width, "edit.json.output.width");
  requirePositiveNumber(value.height, "edit.json.output.height");
  requireInteger(value.fps, 1, "edit.json.output.fps");
}
function validateEditSource(value, index, ids) {
  const path = `edit.json.sources[${index}]`;
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["id", "path", "proxy", "chroma_key"]), path);
  requireText(value.id, `${path}.id`);
  if (ids.has(value.id)) throw invalid(`${path}.id`, `source id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  ids.add(value.id);
  requireText(value.path, `${path}.path`);
  if (hasOwn(value, "proxy") && value.proxy !== null) requireText(value.proxy, `${path}.proxy`);
  if (hasOwn(value, "chroma_key") && value.chroma_key !== null) {
    requireRecord2(value.chroma_key, `${path}.chroma_key`);
  }
}
function validateTrack(value, index, trackIds, itemIds, sourceIds) {
  const path = `edit.json.tracks[${index}]`;
  requireRecord2(value, path);
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
  requireRecord2(value.content, `${path}.content`);
  requireExactKeys(value.content, /* @__PURE__ */ new Set(["from"]), `${path}.content`);
  if (value.content.from !== "captions.json") {
    throw invalid(`${path}.content.from`, "captions.json \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateAudioItem(value, path, ids, sourceIds) {
  requireRecord2(value, path);
  requireExactKeys(value, AUDIO_ITEM_KEYS, path);
  requireText(value.id, `${path}.id`);
  if (ids.has(value.id)) throw invalid(`${path}.id`, `item id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  ids.add(value.id);
  validateItemMetadata(value, path);
  if (hasOwn(value, "anchor")) validateItemAnchor(value.anchor, `${path}.anchor`);
  requireInteger(value.at, 0, `${path}.at`);
  requireInteger(value.duration, 0, `${path}.duration`);
  if (hasOwn(value, "role") && value.role !== "sfx" && value.role !== "narration" && value.role !== "bgm" && value.role !== "speech") {
    throw invalid(`${path}.role`, "sfx/narration/bgm/speech \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "link")) requireText(value.link, `${path}.link`);
  if (hasOwn(value, "mute") && typeof value.mute !== "boolean") {
    throw invalid(`${path}.mute`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
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
  if (hasOwn(value, "caption_ref") && (typeof value.caption_ref !== "string" || !/^c-\d{4}$/.test(value.caption_ref))) {
    throw invalid(`${path}.caption_ref`, "\u5B57\u5E55 id \u304C\u5FC5\u8981\u3067\u3059");
  }
  if (hasOwn(value, "provenance")) validateNarrationProvenance(value.provenance, `${path}.provenance`);
  validateAudioMediaSource(value.source, `${path}.source`, sourceIds);
}
function validateNarrationProvenance(value, path) {
  requireRecord2(value, path);
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
  requireRecord2(value, path);
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
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["method", "strength"]), path);
  if (value.method !== "fft" && value.method !== "nlm") {
    throw invalid(`${path}.method`, "fft/nlm \u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  requireRange(value.strength, 0, 1, `${path}.strength`);
}
function validateItem(value, path, ids, sourceIds) {
  requireRecord2(value, path);
  requireExactKeys(value, ITEM_KEYS, path);
  requireText(value.id, `${path}.id`);
  if (ids.has(value.id)) throw invalid(`${path}.id`, `item id \u304C\u91CD\u8907\u3057\u3066\u3044\u307E\u3059: ${value.id}`);
  ids.add(value.id);
  validateItemMetadata(value, path);
  if (hasOwn(value, "anchor")) validateItemAnchor(value.anchor, `${path}.anchor`);
  requireInteger(value.at, 0, `${path}.at`);
  requireInteger(value.duration, 0, `${path}.duration`);
  if (hasOwn(value, "transform")) validateTransform(value.transform, `${path}.transform`);
  if (hasOwn(value, "opacity")) requireRange(value.opacity, 0, 1, `${path}.opacity`);
  if (hasOwn(value, "blend") && !BLEND_MODES.has(value.blend)) {
    throw invalid(`${path}.blend`, "\u672A\u5BFE\u5FDC\u306E blend mode \u3067\u3059");
  }
  if (hasOwn(value, "crop")) validateCrop(value.crop, `${path}.crop`);
  if (hasOwn(value, "adjust")) validateAdjust(value.adjust, `${path}.adjust`);
  if (hasOwn(value, "perspective")) requireRecord2(value.perspective, `${path}.perspective`);
  if (hasOwn(value, "motion")) validateMotion(value.motion, `${path}.motion`);
  if (hasOwn(value, "animator")) validateAnimators(value.animator, `${path}.animator`);
  if (hasOwn(value, "keyframes")) validateKeyframes(value.keyframes, `${path}.keyframes`);
  validateItemSource(value.source, `${path}.source`, sourceIds);
  if (value.source.kind === "group") {
    const transforms = [value.transform, ...Array.isArray(value.keyframes) ? value.keyframes.map((point2) => point2.transform) : []];
    for (const transform of transforms) {
      if (transform !== null && typeof transform === "object" && (hasOwn(transform, "scaleX") || hasOwn(transform, "scaleY"))) {
        throw invalid(`${path}.transform`, "group \u306F scaleX / scaleY \u3092\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093");
      }
    }
  }
  if (hasOwn(value, "audio")) {
    if (value.source.kind !== "media") throw invalid(`${path}.audio`, "media item \u3060\u3051\u304C\u6307\u5B9A\u3067\u304D\u307E\u3059");
    if (value.audio !== false) throw invalid(`${path}.audio`, "false \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
  if (hasOwn(value, "mask")) {
    if (value.source.kind !== "media") throw invalid(`${path}.mask`, "media item \u3060\u3051\u304C\u6307\u5B9A\u3067\u304D\u307E\u3059");
    requireText(value.mask, `${path}.mask`);
    if (!sourceIds.has(value.mask)) throw invalid(`${path}.mask`, `sources[].id \u306B\u5B58\u5728\u3057\u307E\u305B\u3093: ${value.mask}`);
  }
  if (hasOwn(value, "erase")) {
    if (value.source.kind !== "media" || !Array.isArray(value.erase)) throw invalid(`${path}.erase`, "media item \u306E\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    value.erase.forEach((stroke, index) => {
      const at = `${path}.erase[${index}]`;
      requireRecord2(stroke, at);
      requireExactKeys(stroke, /* @__PURE__ */ new Set(["mode", "points", "size", "hardness"]), at);
      if (stroke.mode !== "erase" && stroke.mode !== "restore") throw invalid(`${at}.mode`, "erase \u307E\u305F\u306F restore \u304C\u5FC5\u8981\u3067\u3059");
      if (!Array.isArray(stroke.points) || stroke.points.length === 0) throw invalid(`${at}.points`, "\u70B9\u304C\u5FC5\u8981\u3067\u3059");
      stroke.points.forEach((point2, pointIndex) => {
        if (!Array.isArray(point2) || point2.length !== 2) throw invalid(`${at}.points[${pointIndex}]`, "2 \u5EA7\u6A19\u304C\u5FC5\u8981\u3067\u3059");
        requireRange(point2[0], 0, 1, `${at}.points[${pointIndex}][0]`);
        requireRange(point2[1], 0, 1, `${at}.points[${pointIndex}][1]`);
      });
      requireRange(stroke.size, Number.EPSILON, 1, `${at}.size`);
      requireRange(stroke.hardness, 0, 1, `${at}.hardness`);
    });
  }
  if (hasOwn(value, "flip")) {
    if (value.source.kind !== "media") throw invalid(`${path}.flip`, "media item \u3060\u3051\u304C\u6307\u5B9A\u3067\u304D\u307E\u3059");
    requireRecord2(value.flip, `${path}.flip`);
    requireExactKeys(value.flip, /* @__PURE__ */ new Set(["h", "v"]), `${path}.flip`);
    for (const axis of ["h", "v"]) if (hasOwn(value.flip, axis) && typeof value.flip[axis] !== "boolean") throw invalid(`${path}.flip.${axis}`, "boolean \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
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
function validateItemAnchor(value, path) {
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["caption", "range", "offset", "edge", "duration", "attached_by"]), path);
  if (typeof value.caption !== "string" || !/^c-\d{4}$/.test(value.caption)) throw invalid(`${path}.caption`, "\u5B57\u5E55 id \u304C\u5FC5\u8981\u3067\u3059");
  if (hasOwn(value, "range")) {
    requireRecord2(value.range, `${path}.range`);
    requireExactKeys(value.range, /* @__PURE__ */ new Set(["start", "end"]), `${path}.range`);
    requireNonNegativeNumber(value.range.start, `${path}.range.start`);
    requireNonNegativeNumber(value.range.end, `${path}.range.end`);
    if (value.range.end <= value.range.start) throw invalid(`${path}.range`, "end > start \u304C\u5FC5\u8981\u3067\u3059");
  }
  if (hasOwn(value, "offset") && !Number.isInteger(value.offset)) throw invalid(`${path}.offset`, "\u6574\u6570\u304C\u5FC5\u8981\u3067\u3059");
  if (hasOwn(value, "edge") && value.edge !== "start" && value.edge !== "end") throw invalid(`${path}.edge`, "start/end \u304C\u5FC5\u8981\u3067\u3059");
  if (hasOwn(value, "duration") && value.duration !== "caption" && value.duration !== "own") throw invalid(`${path}.duration`, "caption/own \u304C\u5FC5\u8981\u3067\u3059");
  if (hasOwn(value, "attached_by")) validateAttachedBy(value.attached_by, `${path}.attached_by`);
}
function validateAttachedBy(value, path) {
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["style_uid", "caption"]), path);
  requireText(value.style_uid, `${path}.style_uid`);
  if (typeof value.caption !== "string" || !/^c-\d{4}$/.test(value.caption)) throw invalid(`${path}.caption`, "\u5B57\u5E55 id \u304C\u5FC5\u8981\u3067\u3059");
}
function validateItemSource(value, path, sourceIds) {
  requireRecord2(value, path);
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
        if (hasOwn(value, key) && value[key] !== null) requireRecord2(value[key], `${path}.${key}`);
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
      if (hasOwn(value, "vars")) requireRecord2(value.vars, `${path}.vars`);
      if (hasOwn(value, "params")) {
        requireRecord2(value.params, `${path}.params`);
        for (const [name, text] of Object.entries(value.params)) {
          if (typeof text !== "string") throw invalid(`${path}.params.${name}`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
        }
      }
      return;
    case "shape":
      validateShapeSource(value, path);
      return;
    case "telop":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "preset", "params", "baked", "from"]), path);
      requireText(value.preset, `${path}.preset`);
      if (hasOwn(value, "params")) requireRecord2(value.params, `${path}.params`);
      if (hasOwn(value, "baked")) requireText(value.baked, `${path}.baked`);
      if (hasOwn(value, "from")) requireText(value.from, `${path}.from`);
      return;
    case "filter":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "filter"]), path);
      validateFilter(value.filter, `${path}.filter`);
      return;
    case "group":
      requireExactKeys(value, /* @__PURE__ */ new Set(["kind", "canvas"]), path);
      if (hasOwn(value, "canvas")) {
        requireRecord2(value.canvas, `${path}.canvas`);
        requireExactKeys(value.canvas, /* @__PURE__ */ new Set(["origin", "durationMode", "intent", "background"]), `${path}.canvas`);
        if (value.canvas.origin !== "user" && value.canvas.origin !== "plan") throw invalid(`${path}.canvas.origin`, "user / plan \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
        if (value.canvas.durationMode !== "fixed") throw invalid(`${path}.canvas.durationMode`, "fixed \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
        if (hasOwn(value.canvas, "intent") && typeof value.canvas.intent !== "string") throw invalid(`${path}.canvas.intent`, "\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
        if (hasOwn(value.canvas, "background")) {
          requireRecord2(value.canvas.background, `${path}.canvas.background`);
          requireExactKeys(value.canvas.background, /* @__PURE__ */ new Set(["type", "color"]), `${path}.canvas.background`);
          if (value.canvas.background.type === "color") {
            if (typeof value.canvas.background.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.canvas.background.color)) throw invalid(`${path}.canvas.background.color`, "#RRGGBB \u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
          } else if (value.canvas.background.type !== "none" || hasOwn(value.canvas.background, "color")) throw invalid(`${path}.canvas.background`, "none \u307E\u305F\u306F color \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
        }
      }
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
  requireRecord2(value, path);
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
  requireRecord2(value, path);
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
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["x", "y", "scale", "scaleX", "scaleY", "rotate"]), path);
  for (const key of ["x", "y", "rotate"]) {
    if (hasOwn(value, key)) requireNumber(value[key], `${path}.${key}`);
  }
  for (const key of ["scale", "scaleX", "scaleY"]) {
    if (hasOwn(value, key)) requirePositiveNumber(value[key], `${path}.${key}`);
  }
}
function validateCrop(value, path) {
  requireRecord2(value, path);
  for (const key of ["x", "y"]) requireRange(value[key], 0, 1, `${path}.${key}`);
  for (const key of ["w", "h"]) {
    requireRange(value[key], 0, 1, `${path}.${key}`);
    if (value[key] === 0) throw invalid(`${path}.${key}`, "0 \u3088\u308A\u5927\u304D\u3044\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  }
}
function validateAdjust(value, path) {
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["basic", "lut", "sections", "curves", "wheels", "hue", "fx"]), path);
  if (hasOwn(value, "fx")) {
    const fxPath = path + ".fx";
    if (!Array.isArray(value.fx) || value.fx.length > 8) {
      throw invalid(fxPath, "adjust.fx.structure: must be an array of at most 8 effects");
    }
    const ranges = {
      vignette: { amount: [-1, 1], midpoint: [0, 1], roundness: [-1, 1], feather: [0, 1] },
      blur: { px: [0, 50] },
      grain: { amount: [0, 1], size: [0.5, 4] },
      sharpen: { amount: [0, 1] },
      glow: { intensity: [0, 1], radius: [0, 100], threshold: [0, 1], warmth: [-1, 1] },
      clarity: { amount: [-1, 1], radius: [1, 50] },
      dehaze: { amount: [-1, 1] },
      denoise: { amount: [0, 1] },
      motion_blur: { px: [0, 100], angle: [-180, 180] }
    };
    const seen = /* @__PURE__ */ new Set();
    for (const [index, fx] of value.fx.entries()) {
      const at = fxPath + "[" + index + "]";
      requireRecord2(fx, at);
      if (typeof fx.id !== "string" || !hasOwn(ranges, fx.id)) {
        throw invalid(at + ".id", "adjust.fx.id: unknown effect id");
      }
      if (seen.has(fx.id)) throw invalid(at + ".id", "adjust.fx.duplicate-id: " + fx.id);
      seen.add(fx.id);
      const params = ranges[fx.id];
      requireExactKeys(fx, /* @__PURE__ */ new Set(["id", ...Object.keys(params)]), at);
      for (const [key, [min, max]] of Object.entries(params)) {
        if (hasOwn(fx, key)) requireRange(fx[key], min, max, at + "." + key);
      }
    }
  }
  for (const section of ["curves", "hue"]) {
    if (!hasOwn(value, section)) continue;
    const channels = value[section];
    const sectionPath = `${path}.${section}`;
    requireRecord2(channels, sectionPath);
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
      for (const [index, point2] of points.entries()) {
        const pointPath = `${channelPath}[${index}]`;
        requireRecord2(point2, pointPath);
        requireExactKeys(point2, /* @__PURE__ */ new Set([axis, output]), pointPath);
        requireRange(point2[axis], 0, 1, `${pointPath}.${axis}`);
        requireRange(point2[output], 0, 1, `${pointPath}.${output}`);
        if (point2[axis] <= previous) throw invalid(`${pointPath}.${axis}`, "\u72ED\u7FA9\u5358\u8ABF\u5897\u52A0\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
        previous = point2[axis];
      }
    }
  }
  if (hasOwn(value, "wheels")) {
    requireRecord2(value.wheels, `${path}.wheels`);
    const ranges = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 };
    requireExactKeys(value.wheels, new Set(Object.keys(ranges)), `${path}.wheels`);
    for (const [wheel, channels] of Object.entries(value.wheels)) {
      const wheelPath = `${path}.wheels.${wheel}`;
      requireRecord2(channels, wheelPath);
      requireExactKeys(channels, /* @__PURE__ */ new Set(["r", "g", "b"]), wheelPath);
      for (const [channel, amount] of Object.entries(channels)) requireRange(amount, -ranges[wheel], ranges[wheel], `${wheelPath}.${channel}`);
    }
  }
  if (hasOwn(value, "basic")) {
    requireRecord2(value.basic, `${path}.basic`);
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
    requireRecord2(value.lut, `${path}.lut`);
    requireExactKeys(value.lut, /* @__PURE__ */ new Set(["lut", "intensity"]), `${path}.lut`);
    requireText(value.lut.lut, `${path}.lut.lut`);
    if (hasOwn(value.lut, "intensity")) requireRange(value.lut.intensity, 0, 1, `${path}.lut.intensity`);
  }
  if (hasOwn(value, "sections")) {
    requireRecord2(value.sections, `${path}.sections`);
    const sectionKeys = /* @__PURE__ */ new Set(["basic", "lut", "curves", "wheels", "hue", "fx"]);
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
  requireRecord2(value, path);
  for (const [key, entry] of Object.entries(value)) validateOne(entry, `${path}.${key}`);
}
function validateKeyframes(value, path, audio = false) {
  if (!Array.isArray(value)) {
    requireRecord2(value, path);
    requireExactKeys(value, /* @__PURE__ */ new Set(["path", "count"]), path);
    requireText(value.path, `${path}.path`);
    if (!/^motion\/.+\.json$/.test(value.path)) throw invalid(`${path}.path`, "motion/ \u914D\u4E0B\u306E JSON \u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    requireInteger(value.count, 2, `${path}.count`);
    return;
  }
  if (!Array.isArray(value) || value.length < 2) throw invalid(path, "2 \u8981\u7D20\u4EE5\u4E0A\u306E\u914D\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
  value.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    requireRecord2(entry, itemPath);
    requireInteger(entry.t, 0, `${itemPath}.t`);
    if (audio) {
      if (!hasOwn(entry, "gain_db")) throw invalid(`${itemPath}.gain_db`, "audio keyframe \u306B\u5FC5\u8981\u3067\u3059");
      requireRange(entry.gain_db, -60, 12, `${itemPath}.gain_db`);
    }
    if (hasOwn(entry, "transform")) validateTransform(entry.transform, `${itemPath}.transform`);
    if (hasOwn(entry, "crop")) validateCrop(entry.crop, `${itemPath}.crop`);
    if (hasOwn(entry, "perspective")) requireRecord2(entry.perspective, `${itemPath}.perspective`);
    if (hasOwn(entry, "opacity")) requireRange(entry.opacity, 0, 1, `${itemPath}.opacity`);
    if (hasOwn(entry, "animator")) {
      requireRecord2(entry.animator, `${itemPath}.animator`);
      for (const [id, state] of Object.entries(entry.animator)) {
        requireRecord2(state, `${itemPath}.animator.${id}`);
        requireExactKeys(state, /* @__PURE__ */ new Set(["offset", "start", "end"]), `${itemPath}.animator.${id}`);
        if (hasOwn(state, "offset")) requireRange(state.offset, -1, 1, `${itemPath}.animator.${id}.offset`);
        for (const key of ["start", "end"]) if (hasOwn(state, key)) requireRange(state[key], 0, 1, `${itemPath}.animator.${id}.${key}`);
      }
    }
    if (hasOwn(entry, "easing")) validateEasing(entry.easing, `${itemPath}.easing`);
  });
}
function validateMotion(value, path) {
  requireRecord2(value, path);
  requireExactKeys(value, /* @__PURE__ */ new Set(["in", "out", "loop"]), path);
  for (const slot of ["in", "out", "loop"]) {
    if (!hasOwn(value, slot)) continue;
    const entry = value[slot];
    requireRecord2(entry, `${path}.${slot}`);
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
    requireRecord2(entry, entryPath);
    requireExactKeys(entry, /* @__PURE__ */ new Set(["id", "basis", "shape", "start", "end", "offset", "randomize", "amount", "ease"]), entryPath);
    requireText(entry.id, `${entryPath}.id`);
    if (!["chars", "words", "lines", "segments"].includes(String(entry.basis))) throw invalid(`${entryPath}.basis`, "\u672A\u5BFE\u5FDC\u306E basis \u3067\u3059");
    if (!["ramp", "triangle", "round", "smooth", "square", "ramp-down"].includes(String(entry.shape))) throw invalid(`${entryPath}.shape`, "\u672A\u5BFE\u5FDC\u306E shape \u3067\u3059");
    requireRange(entry.start, 0, 1, `${entryPath}.start`);
    requireRange(entry.end, 0, 1, `${entryPath}.end`);
    requireRange(entry.offset, -1, 1, `${entryPath}.offset`);
    if (hasOwn(entry, "randomize")) {
      requireRecord2(entry.randomize, `${entryPath}.randomize`);
      requireExactKeys(entry.randomize, /* @__PURE__ */ new Set(["seed"]), `${entryPath}.randomize`);
      if (!Number.isInteger(entry.randomize.seed)) throw invalid(`${entryPath}.randomize.seed`, "\u6574\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059");
    }
    requireRecord2(entry.amount, `${entryPath}.amount`);
    requireExactKeys(entry.amount, /* @__PURE__ */ new Set(["x", "y", "scale", "rotate", "opacity", "letterSpacing", "blur"]), `${entryPath}.amount`);
    for (const [key, amount] of Object.entries(entry.amount)) {
      if (key === "opacity") requireRange(amount, -1, 1, `${entryPath}.amount.opacity`);
      else requireNumber(amount, `${entryPath}.amount.${key}`);
    }
    if (hasOwn(entry, "ease")) validateEasing(entry.ease, `${entryPath}.ease`);
  });
}
function requireRecord2(value, path) {
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

// ../edit-store/src/transform.ts
function effectiveScale(transform) {
  return { x: transform?.scaleX ?? transform?.scale ?? 1, y: transform?.scaleY ?? transform?.scale ?? 1 };
}
function normalizeTransform(transform) {
  const result = { ...transform };
  if (result.scaleX === void 0 && result.scaleY === void 0) return result;
  const axes = effectiveScale(result);
  if (axes.x === axes.y) {
    result.scale = axes.x;
    delete result.scaleX;
    delete result.scaleY;
  }
  return result;
}

// ../edit-store/src/tree-ops.ts
function composeTransforms(parent, child) {
  if (parent === void 0) return child === void 0 ? void 0 : normalizeTransform(child);
  if (child === void 0) return { ...parent };
  const scale = parent.scale ?? 1;
  const radians = (parent.rotate ?? 0) * Math.PI / 180;
  const childX = child.x ?? 0;
  const childY = child.y ?? 0;
  const result = {};
  if (parent.x !== void 0 || child.x !== void 0 || child.y !== void 0) {
    result.x = (parent.x ?? 0) + scale * (childX * Math.cos(radians) - childY * Math.sin(radians));
  }
  if (parent.y !== void 0 || child.x !== void 0 || child.y !== void 0) {
    result.y = (parent.y ?? 0) + scale * (childX * Math.sin(radians) + childY * Math.cos(radians));
  }
  if (parent.scale !== void 0 || child.scale !== void 0) result.scale = scale * (child.scale ?? 1);
  if (child.scaleX !== void 0 || child.scaleY !== void 0) {
    const axes = effectiveScale(child);
    result.scaleX = scale * axes.x;
    result.scaleY = scale * axes.y;
  }
  if (parent.rotate !== void 0 || child.rotate !== void 0) result.rotate = (parent.rotate ?? 0) + (child.rotate ?? 0);
  return Object.keys(result).length === 0 ? void 0 : normalizeTransform(result);
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

// ../edit-store/src/shape-bubble.ts
function seededRandom(seed) {
  let a = ((seed | 0) * 2654435761 ^ 2654435769) >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function ellipsePerimeter(A, B) {
  const M = 1440;
  const raw = [];
  const cum = [0];
  for (let i = 0; i <= M; i++) {
    const t = i / M * 2 * Math.PI;
    raw.push([A * Math.sin(t), -B * Math.cos(t), t]);
    if (i) {
      cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    }
  }
  const L = cum[M];
  const at = (s) => {
    s = (s % 1 + 1) % 1;
    const tg = s * L;
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (cum[mid] <= tg) lo = mid;
      else hi = mid;
    }
    const f2 = (tg - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const t = raw[lo][2] + (raw[hi][2] - raw[lo][2]) * f2;
    const x = A * Math.sin(t);
    const y = -B * Math.cos(t);
    const nx = x / (A * A);
    const ny = y / (B * B);
    const nl = Math.hypot(nx, ny) || 1;
    return [x, y, nx / nl, ny / nl];
  };
  return { at, L };
}
function normalizeBody(P, A, B) {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  P.forEach(([x, y]) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  });
  const sx = 2 * A / (x1 - x0 || 1);
  const sy = 2 * B / (y1 - y0 || 1);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return P.map(([x, y]) => [(x - cx) * sx, (y - cy) * sy]);
}
function bodyPoints(A, B, p) {
  const st = p.style;
  const rnd = seededRandom(p.seed || 0);
  const jit = (p.jitter || 0) / 100;
  const dep = (p.depth || 0) / 100;
  const m = Math.min(A, B);
  const P = [];
  if (st === "rect" || st === "round") {
    const r = st === "round" ? m * 0.35 : 0;
    const step = Math.max(1, (A + B) / 60);
    const line = (x0, y0, x1, y1) => {
      const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let i = 0; i < k; i++) P.push([x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k]);
    };
    const arc = (cx, cy, a0) => {
      if (!r) return;
      for (let i = 0; i < 12; i++) {
        const a = (a0 + 90 * i / 12) * Math.PI / 180;
        P.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    line(0, -B, A - r, -B);
    arc(A - r, -B + r, -90);
    line(A, -B + r, A, B - r);
    arc(A - r, B - r, 0);
    line(A - r, B, -A + r, B);
    arc(-A + r, B - r, 90);
    line(-A, B - r, -A, -B + r);
    arc(-A + r, -B + r, 180);
    line(-A + r, -B, 0, -B);
    return P;
  }
  const E = ellipsePerimeter(A, B);
  const n = Math.max(3, Math.round(p.count || 12));
  if (st === "spike" || st === "burst") {
    const bu = st === "burst";
    const dp = dep * m * (bu ? 0.8 : 0.5);
    const pts = [];
    const o0 = 0.5 / n * 0.37;
    for (let i = 0; i < n; i++) {
      const s1 = (i + (rnd() - 0.5) * jit * (bu ? 0.6 : 0.4)) / n + o0;
      const s2 = (i + 0.5 + (rnd() - 0.5) * jit * (bu ? 0.36 : 0.3)) / n + o0;
      const t = E.at(s1);
      const pull = dp * rnd() * jit * (bu ? 0.9 : 0.45);
      pts.push([t[0] - t[2] * pull, t[1] - t[3] * pull]);
      const v = E.at(s2);
      const dv = dp * (1 - rnd() * jit * (bu ? 0.45 : 0.3));
      pts.push([v[0] - v[2] * dv, v[1] - v[3] * dv]);
    }
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      for (let j = 0; j < 6; j++) {
        P.push([a[0] + (b[0] - a[0]) * j / 6, a[1] + (b[1] - a[1]) * j / 6]);
      }
    });
    return normalizeBody(P, A, B);
  }
  if (st === "cloud") {
    const bf = 0.35 + 0.6 * dep;
    const h0 = E.L / n / 2 * bf * 0.9;
    const V = [];
    const TAU = 2 * Math.PI;
    const nm = (x) => (x % TAU + TAU) % TAU;
    for (let i = 0; i < n; i++) {
      const q = E.at((i + (rnd() - 0.5) * jit * 0.5) / n);
      V.push([q[0] - q[2] * h0, q[1] - q[3] * h0]);
    }
    for (let i = 0; i < n; i++) {
      const a = V[i];
      const b = V[(i + 1) % n];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const c = Math.hypot(dx, dy) || 1;
      const no = [dy / c, -dx / c];
      const h = Math.max(0.5, Math.min(c / 2 * 0.95, c / 2 * bf * (1 + (rnd() - 0.5) * jit * 0.7)));
      const R = (c * c / 4 + h * h) / (2 * h);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const cx = mx - no[0] * (R - h);
      const cy = my - no[1] * (R - h);
      const a0 = Math.atan2(a[1] - cy, a[0] - cx);
      const a1 = Math.atan2(b[1] - cy, b[0] - cx);
      const ap = Math.atan2(my + no[1] * h - cy, mx + no[0] * h - cx);
      const d1 = nm(ap - a0);
      const d2 = nm(a1 - a0);
      const sw = d1 < d2 ? d2 : d2 - TAU;
      const k = Math.max(8, Math.ceil(Math.abs(sw) * R / 2));
      for (let j = 0; j < k; j++) {
        const q = a0 + sw * j / k;
        P.push([cx + R * Math.cos(q), cy + R * Math.sin(q)]);
      }
    }
    return normalizeBody(P, A, B);
  }
  if (st === "wave") {
    const N = Math.max(480, n * 14);
    const amp = dep * m * 0.12;
    const Wa = [];
    for (let i = 0; i < n; i++) Wa.push(1 + (rnd() - 0.5) * jit * 1.4);
    for (let i = 0; i < N; i++) {
      const s = i / N;
      const q = E.at(s);
      const w = s * n;
      const o = amp * Wa[Math.floor(w) % n] * Math.sin(2 * Math.PI * w);
      P.push([q[0] + q[2] * o, q[1] + q[3] * o]);
    }
    return normalizeBody(P, A, B);
  }
  for (let i = 0; i < 480; i++) {
    const q = E.at(i / 480);
    P.push([q[0], q[1]]);
  }
  return P;
}
function bubbleGeometry(A, B, p) {
  const P = bodyPoints(A, B, p);
  const S_ = (A + B) / 2;
  const N = P.length;
  const subs = [];
  let tip = null;
  const tail = p.tail || "none";
  if (tail === "none") subs.push(P);
  else {
    const phi = (p.tailAngle || 0) * Math.PI / 180;
    const dx = Math.sin(phi);
    const dy = -Math.cos(phi);
    const qx = Math.cos(phi);
    const qy = Math.sin(phi);
    const c = Math.max(-1, Math.min(1, (p.tailCurve || 0) / 100));
    const L = Math.max(2, (p.tailLength || 0) / 100 * 1.5 * S_);
    let i0 = 0;
    let best = -2;
    P.forEach((q, i) => {
      const r = Math.hypot(q[0], q[1]) || 1;
      const cs = (q[0] * dx + q[1] * dy) / r;
      if (cs > best) {
        best = cs;
        i0 = i;
      }
    });
    const rp = P[i0][0] * dx + P[i0][1] * dy;
    const base = [dx * rp, dy * rp];
    if (tail === "point") {
      const hw = Math.max(2, (p.tailWidth || 0) / 100 * S_ * 0.9) / 2;
      const inb = (q) => Math.abs(q[0] * dy - q[1] * dx) < hw && q[0] * dx + q[1] * dy > 0;
      let ia = i0;
      let ib = i0;
      let k = 0;
      while (k < N / 3 && inb(P[(ia - 1 + N) % N])) {
        ia = (ia - 1 + N) % N;
        k++;
      }
      ia = (ia - 1 + N) % N;
      k = 0;
      while (k < N / 3 && inb(P[(ib + 1) % N])) {
        ib = (ib + 1) % N;
        k++;
      }
      ib = (ib + 1) % N;
      const Pa = P[ia];
      const Pb = P[ib];
      const R0 = [(Pa[0] + Pb[0]) / 2, (Pa[1] + Pb[1]) / 2];
      const fw = L * (1 - 0.15 * Math.abs(c));
      tip = [base[0] + dx * fw + qx * c * L * 0.6, base[1] + dy * fw + qy * c * L * 0.6];
      const ctl = [base[0] + dx * L * 0.5, base[1] + dy * L * 0.5];
      const Qa = [ctl[0] + (Pa[0] - R0[0]) * 0.35, ctl[1] + (Pa[1] - R0[1]) * 0.35];
      const Qb = [ctl[0] + (Pb[0] - R0[0]) * 0.35, ctl[1] + (Pb[1] - R0[1]) * 0.35];
      const quad = (a, q, b) => {
        const o = [];
        for (let j = 1; j < 18; j++) {
          const t = j / 18;
          const u = 1 - t;
          o.push([
            u * u * a[0] + 2 * u * t * q[0] + t * t * b[0],
            u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]
          ]);
        }
        return o;
      };
      const out = [];
      for (let j = ib; j !== ia; j = (j + 1) % N) out.push(P[j]);
      out.push(Pa, ...quad(Pa, Qa, tip), tip, ...quad(tip, Qb, Pb));
      subs.push(out);
    } else {
      subs.push(P);
      const rd = S_ * (0.06 + 0.16 * (p.tailWidth || 0) / 100);
      const rs = [rd, rd * 0.66, rd * 0.42];
      const g = 1.5 + L * 0.16;
      const cen = [];
      let d = 0;
      const minD = (x, y) => {
        let mn = 1e9;
        for (const q of P) {
          const e = Math.hypot(q[0] - x, q[1] - y);
          if (e < mn) mn = e;
        }
        return mn;
      };
      rs.forEach((r, i) => {
        d += (i ? rs[i - 1] : 0) + g + r;
        const pos = () => {
          const lat = c * d * d / (L + rd * 3) * 0.5;
          return [base[0] + dx * d + qx * lat, base[1] + dy * d + qy * lat];
        };
        let q = pos();
        for (let it = 0; it < 30; it++) {
          const md = minD(q[0], q[1]);
          if (md >= r + g * 0.8) break;
          d += r + g * 0.8 - md + 0.5;
          q = pos();
        }
        cen.push([q[0], q[1], r]);
      });
      cen.forEach(([x, y, r]) => {
        const o = [];
        for (let j = 0; j < 40; j++) {
          const a = j / 40 * 2 * Math.PI;
          o.push([x + r * Math.sin(a), y - r * Math.cos(a)]);
        }
        subs.push(o);
      });
      tip = [cen[2][0], cen[2][1]];
    }
  }
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  subs.forEach(
    (s) => s.forEach(([x, y]) => {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    })
  );
  return { subs, tip, x0, y0, x1, y1 };
}
function fitBubble(W, H, p) {
  let A = W / 2;
  let B = H / 2;
  let g;
  for (let i = 0; i < 80; i++) {
    g = bubbleGeometry(A, B, p);
    const ex = W / (g.x1 - g.x0 || 1);
    const ey = H / (g.y1 - g.y0 || 1);
    if (Math.abs(ex - 1) < 1e-7 && Math.abs(ey - 1) < 1e-7) break;
    A *= ex;
    B *= ey;
    if (i === 79) g = bubbleGeometry(A, B, p);
  }
  return { A, B, g };
}
var serializeBubble = (g, sx, sy, ox, oy) => g.subs.map(
  (s) => "M" + s.map(
    (q) => +((q[0] - g.x0) * sx + ox).toFixed(2) + " " + +((q[1] - g.y0) * sy + oy).toFixed(2)
  ).join("L") + "Z"
).join("");
function bubblePath(width, height, params) {
  const style = params.style === "rounded" ? "round" : params.style === "jagged" ? "spike" : params.style === "wobble" ? "wave" : params.style;
  const p = {
    ...params,
    style
  };
  const f2 = fitBubble(width, height, p);
  const g = f2.g;
  return serializeBubble(g, width / (g.x1 - g.x0 || 1), height / (g.y1 - g.y0 || 1), 0, 0);
}

// ../edit-store/src/shape-markup-v1.ts
var validColor = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;
var num = (v) => String(+v.toFixed(3));
var clamp3 = (v, fallback, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
var fallbackId = (id) => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
};
var itemKey = (itemId, source) => {
  if (itemId === void 0) return fallbackId(JSON.stringify(source));
  let result = "";
  for (let i = 0; i < itemId.length; i++) result += itemId.charCodeAt(i).toString(16).padStart(4, "0");
  return result || "0";
};
var isGradient = (v) => typeof v === "object" && v !== null;
var validPaint = (v, fallback) => {
  if (typeof v === "string") return v === "none" || validColor.test(v) ? v : fallback;
  if (!v || !["linear", "radial"].includes(v.type) || !Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > 5) return fallback;
  if (v.type === "linear" && (typeof v.angle !== "number" || !Number.isFinite(v.angle) || v.angle < 0 || v.angle > 360)) return fallback;
  if (!v.stops.every(
    (s) => validColor.test(s.color) && Number.isFinite(s.offset) && s.offset >= 0 && s.offset <= 1
  )) return fallback;
  if (v.stops.some((s, i) => i > 0 && s.offset < v.stops[i - 1].offset)) return fallback;
  return v;
};
function paint2(value, id, width, height) {
  if (!isGradient(value)) return { value, def: "" };
  const stops = value.stops.map(
    (s) => `<stop offset="${num(s.offset)}" stop-color="${s.color.slice(0, 7)}" stop-opacity="${s.color.length === 9 ? num(parseInt(s.color.slice(7), 16) / 255) : 1}"/>`
  ).join("");
  if (value.type === "radial") {
    return {
      value: `url(#${id})`,
      def: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(width / 2)}" cy="${num(height / 2)}" r="${num(Math.max(width, height) / 2)}">${stops}</radialGradient>`
    };
  }
  const a = ((value.angle ?? 90) - 90) * Math.PI / 180;
  const dx = Math.cos(a) / 2;
  const dy = Math.sin(a) / 2;
  return {
    value: `url(#${id})`,
    def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(width * (0.5 - dx))}" y1="${num(height * (0.5 - dy))}" x2="${num(width * (0.5 + dx))}" y2="${num(height * (0.5 + dy))}">${stops}</linearGradient>`
  };
}
function cap(kind, filled, x, y, direction, size, color2, sw, minimumOutline) {
  if (kind === "none") return "";
  const h = size / 2;
  const center = x - direction * h;
  const ow = Math.max(minimumOutline, sw * 0.7);
  const outline = `fill="${filled ? color2 : "none"}" stroke="${color2}" stroke-width="${num(ow)}"`;
  const tip = x - direction * (filled ? 0 : ow / 2);
  if (kind === "triangle") {
    return `<polygon points="${num(tip)},${num(y)} ${num(x - direction * size)},${num(y - h)} ${num(x - direction * size)},${num(y + h)}" ${filled ? `fill="${color2}"` : outline}/>`;
  }
  if (kind === "chevron") {
    return `<polyline points="${num(x - direction * size * 0.75)},${num(y - h)} ${num(x - direction * sw / 2)},${num(y)} ${num(x - direction * size * 0.75)},${num(y + h)}" fill="none" stroke="${color2}" stroke-width="${num(sw)}" stroke-linejoin="round"/>`;
  }
  if (kind === "bar") {
    return `<line x1="${num(x - direction * sw / 2)}" y1="${num(y - h)}" x2="${num(x - direction * sw / 2)}" y2="${num(y + h)}" stroke="${color2}" stroke-width="${num(sw)}"/>`;
  }
  if (kind === "square") {
    return `<rect x="${num(center - h + ow / 2)}" y="${num(y - h + ow / 2)}" width="${num(size - ow)}" height="${num(size - ow)}" ${outline}/>`;
  }
  if (kind === "circle") {
    return `<circle cx="${num(center)}" cy="${num(y)}" r="${num(h - ow / 2)}" ${outline}/>`;
  }
  return `<polygon points="${num(center - h + ow / 2)},${num(y)} ${num(center)},${num(y - h + ow / 2)} ${num(center + h - ow / 2)},${num(y)} ${num(center)},${num(y + h - ow / 2)}" ${outline}/>`;
}
function capInset(kind, size) {
  return kind === "triangle" ? size * 0.6 : ["square", "circle", "diamond"].includes(kind) ? size * 0.5 : 0;
}
function strokeMetrics(visibleWidth, scaleX, scaleY) {
  const correction = Math.sqrt(scaleX * scaleY);
  return {
    width: visibleWidth / correction,
    gap: Math.max(visibleWidth * 2, 3) / correction,
    capSize: Math.max(visibleWidth * 3.2, 8) / correction,
    minimumOutline: 1 / correction
  };
}
function dashAttribute(dash, metrics, roundCaps = false) {
  if (dash === "dot") return ` stroke-dasharray="${num(metrics.width)} ${num(metrics.gap)}"`;
  if (dash === "dash") {
    const gap = metrics.gap + (roundCaps ? metrics.width : 0);
    return ` stroke-dasharray="${num(metrics.width * 3)} ${num(gap)}"`;
  }
  return "";
}
function lineBody(p, width, height, metrics, color2) {
  const sw = metrics.width;
  const y = height / 2;
  const size = metrics.capSize;
  const start = p.startCap ?? "none";
  const end = p.endCap ?? "none";
  const dash = p.dash ?? "solid";
  const rounded = p.lineCap === "round" && dash !== "dot";
  const dashAttr = dashAttribute(dash, metrics, rounded);
  const x1 = capInset(start, size) + (rounded && start === "none" ? sw / 2 : 0);
  const x2 = Math.max(x1, width - capInset(end, size) - (rounded && end === "none" ? sw / 2 : 0));
  return `<line x1="${num(x1)}" y1="${num(y)}" x2="${num(x2)}" y2="${num(y)}" fill="none" stroke="${color2}" stroke-width="${num(sw)}" stroke-linecap="${rounded ? "round" : "butt"}"${dashAttr}/>` + cap(start, p.startCapFilled ?? true, 0, y, -1, size, color2, sw, metrics.minimumOutline) + cap(end, p.endCapFilled ?? true, width, y, 1, size, color2, sw, metrics.minimumOutline);
}
function primitivePath(shape, width, height) {
  if (shape === "ellipse") {
    return `M${width / 2} 0C${width * 0.776} 0 ${width} ${height * 0.224} ${width} ${height / 2}C${width} ${height * 0.776} ${width * 0.776} ${height} ${width / 2} ${height}C${width * 0.224} ${height} 0 ${height * 0.776} 0 ${height / 2}C0 ${height * 0.224} ${width * 0.224} 0 ${width / 2} 0Z`;
  }
  if (shape === "speech-bubble") {
    const bottom = height * 0.75;
    return `M0 0L${width} 0L${width} ${bottom}L${width * 0.82} ${bottom}L${width * 0.72} ${height}L${width * 0.6} ${bottom}L0 ${bottom}Z`;
  }
  return `M0 0L${width} 0L${width} ${height}L0 ${height}Z`;
}
function shapeMarkupV1(source, itemId, outputWidth = 1920, transform) {
  const p = source.params ?? {};
  const width = clamp3(p.width, 600, 1, 1e5);
  const height = clamp3(p.height, source.shape === "line" || source.shape === "arrow" ? 80 : 340, 1, 1e5);
  const scaleX = clamp3(transform?.scaleX ?? transform?.scale, 1, Number.MIN_VALUE, 1e5);
  const scaleY = clamp3(transform?.scaleY ?? transform?.scale, 1, Number.MIN_VALUE, 1e5);
  const key = itemKey(itemId, source);
  const svg2 = (defs2, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">${defs2 ? `<defs>${defs2}</defs>` : ""}${body}</svg>`;
  const line = source.shape === "line" || source.shape === "arrow";
  const fill = paint2(
    validPaint(p.fill, line ? "none" : source.shape === "bubble" ? "#ffffff" : "#a6a6a6"),
    `sh-${key}-fill`,
    width,
    height
  );
  const stroke = paint2(
    validPaint(p.stroke, line ? "#000000" : source.shape === "bubble" ? "#000000" : "none"),
    `sh-${key}-stroke`,
    width,
    height
  );
  const visibleStrokeWidth = clamp3(p.strokeWidth, line ? 4 : source.shape === "bubble" ? 5 : 0, 0, 100) * outputWidth / 1920;
  const metrics = strokeMetrics(visibleStrokeWidth, scaleX, scaleY);
  const sw = metrics.width;
  if (line) {
    const color2 = stroke.value === "none" ? fill.value : stroke.value;
    const q = source.shape === "arrow" ? { ...p, endCap: p.endCap ?? "triangle" } : p;
    return svg2(stroke.def + fill.def, lineBody(q, width, height, metrics, color2));
  }
  let d;
  let rule = "nonzero";
  let closed = true;
  if (source.shape === "bubble") {
    const placed = bubblePath(width * scaleX, height * scaleY, {
      style: p.style ?? "ellipse",
      count: clamp3(p.count, 16, 4, 48),
      depth: clamp3(p.depth, 40, 0, 100),
      jitter: clamp3(p.jitter, 25, 0, 100),
      seed: clamp3(p.seed, 1, -2147483648, 2147483647),
      tail: p.tail ?? "point",
      tailAngle: clamp3(p.tailAngle, 210, 0, 360),
      tailLength: clamp3(p.tailLength, 45, 0, 100),
      tailWidth: clamp3(p.tailWidth, 30, 0, 100),
      tailCurve: clamp3(p.tailCurve, 0, -100, 100)
    });
    d = scaleX === 1 && scaleY === 1 ? placed : serializeShapePath(scaleShapePath(parseShapePath(placed), 1 / scaleX, 1 / scaleY));
  } else {
    const original = source.shape === "path" ? p.path?.d : primitivePath(source.shape, width, height);
    if (!original) throw new Error("path shape requires params.path");
    rule = p.path?.rule ?? "nonzero";
    const fitted = fitShapePath(original, width * scaleX, height * scaleY);
    closed = fitted.every((s) => s.closed);
    const radius = source.shape === "path" ? clamp3(p.cornerRadius, 0, 0, 100) / 100 * Math.min(width * scaleX, height * scaleY) / 2 : source.shape === "rounded-rect" ? clamp3(p.cornerRadius, 24, 0, Infinity) * Math.sqrt(scaleX * scaleY) : 0;
    d = serializeShapePath(scaleShapePath(roundShapePath(fitted, radius), 1 / scaleX, 1 / scaleY));
  }
  const clipId = `sh-${key}-clip`;
  const dash = dashAttribute(p.dash, metrics);
  const defs = fill.def + stroke.def + (closed && sw > 0 && stroke.value !== "none" ? `<clipPath id="${clipId}"><path d="${d}" fill-rule="${rule}" clip-rule="${rule}"/></clipPath>` : "");
  const interior = closed ? `<path d="${d}" fill-rule="${rule}" fill="${fill.value}"/>` : "";
  const border = sw > 0 && stroke.value !== "none" ? `<path d="${d}" fill="none" stroke="${stroke.value}" stroke-width="${num(sw * (closed ? 2 : 1))}" stroke-linejoin="round" stroke-linecap="butt"${dash}${closed ? ` clip-path="url(#${clipId})"` : ""}/>` : "";
  return svg2(defs, interior + border);
}

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
function shapeMarkup(source, itemId, outputWidth, transform) {
  const params = source.params ?? {};
  if (source.shape === "path" || source.shape === "bubble" || params.preset !== void 0 || params.dash !== void 0 || params.startCap !== void 0 || params.endCap !== void 0 || params.startCapFilled !== void 0 || params.endCapFilled !== void 0 || params.lineCap !== void 0 || typeof params.fill === "object" || typeof params.stroke === "object") {
    return shapeMarkupV1(source, itemId, outputWidth, transform);
  }
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

// ../edit-store/src/group-flatten.ts
function flattenGroupDescendants(internal) {
  const result = [];
  const fps = internal.output.fps;
  let order = 0;
  const visit = (item, track, parent, descendant = false) => {
    const currentOrder = order++;
    if (!descendant && item.source.kind !== "group") {
      result.push({ item, track, order: currentOrder, descendant: false });
      return;
    }
    const start = Math.max(item.atFrames, parent?.clipStart ?? -Infinity);
    const end = Math.min(item.atFrames + item.durationFrames, parent?.clipEnd ?? Infinity);
    const hidden = parent?.hidden === true || track.hidden === true || item.declaration?.hidden === true;
    if (hidden || end <= start) return;
    const localTransform = item.groupCaptionLocal ? item.groupCaptionLocal.transform : item.declaration?.transform;
    const localOpacity = item.groupCaptionLocal ? item.groupCaptionLocal.opacity : item.declaration?.opacity;
    const transform = composeTransforms(parent?.transform, localTransform);
    const opacity = (parent?.opacity ?? 1) * (typeof localOpacity === "number" ? localOpacity : 1);
    if (item.source.kind === "group") {
      const context = { transform, opacity, clipStart: start, clipEnd: end, hidden };
      for (const child of item.children ?? []) visit(child, track, context, true);
      return;
    }
    const at = start / fps;
    const duration = (end - start) / fps;
    const declaration = {
      ...item.declaration,
      ...transform === void 0 ? {} : { transform },
      opacity,
      at,
      t: at,
      start: at,
      duration
    };
    let source = item.source;
    let legacy = item.legacy;
    if (item.source.kind === "media") {
      const speed = typeof item.declaration.speed === "number" && item.declaration.speed > 0 ? item.declaration.speed : 1;
      const sourceIn = item.source.in + (start - item.atFrames) / fps * speed;
      const sourceOut = Math.min(item.source.out, sourceIn + duration * speed);
      source = { ...item.source, in: sourceIn, out: sourceOut };
      Object.assign(declaration, {
        kind: "video",
        src: item.source.path ?? item.source.sourceId,
        in: sourceIn,
        out: sourceOut
      });
      legacy = {
        collection: "layers",
        index: item.legacy.index,
        value: declaration
      };
    }
    const flat = {
      ...item,
      atFrames: start,
      durationFrames: end - start,
      at,
      duration,
      source,
      declaration,
      legacy,
      children: []
    };
    result.push({ item: flat, track, order: currentOrder, descendant: true });
    for (const child of item.children ?? []) visit(child, track, {
      transform,
      opacity,
      clipStart: start,
      clipEnd: end,
      hidden
    }, true);
  };
  for (const track of internal.tracks) for (const item of track.items) visit(item, track);
  return result;
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
  const record2 = raw;
  if (record2.version !== 2) {
    throw new LegacyEditVersionError(typeof record2.version === "number" ? record2.version : -1);
  }
  const resolved = options?.captions === void 0 ? record2 : resolveItemAnchors(record2, options.captions).edit;
  return readV2Internal(withoutItemAnchors(resolved));
}
function extractV2MediaCaptionSwitches(raw) {
  const captionsByItemId = /* @__PURE__ */ new Map();
  const visit = (value) => {
    if (!isRecord2(value)) return value;
    const children = Array.isArray(value.items) ? value.items.map(visit) : value.items;
    const isMedia = isRecord2(value.source) && value.source.kind === "media";
    const validSwitch = value.captions === "on" || value.captions === "off";
    if (isMedia && validSwitch && typeof value.id === "string") {
      captionsByItemId.set(value.id, value.captions);
      const { captions: _captions, ...withoutCaptions } = value;
      return {
        ...withoutCaptions,
        ...Array.isArray(value.items) ? { items: children } : {}
      };
    }
    return Array.isArray(value.items) ? { ...value, items: children } : value;
  };
  const tracks = Array.isArray(raw.tracks) ? raw.tracks.map((track) => isRecord2(track) && Array.isArray(track.items) ? { ...track, items: track.items.map(visit) } : track) : raw.tracks;
  return {
    input: Array.isArray(raw.tracks) ? { ...raw, tracks } : raw,
    captionsByItemId
  };
}
function readV2Internal(raw) {
  const { input, captionsByItemId } = extractV2MediaCaptionSwitches(raw);
  const edit = readEditV2(input);
  const restoreCaptionSwitches = (items) => {
    for (const item of items) {
      const captions = captionsByItemId.get(item.id);
      if (captions !== void 0) item.captions = captions;
      if ("items" in item && Array.isArray(item.items)) restoreCaptionSwitches(item.items);
    }
  };
  for (const track of edit.tracks) {
    if ("items" in track && track.lane === "visual") restoreCaptionSwitches(track.items);
  }
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
          edit.output.width,
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
        legacyIndexCounters,
        edit.output.width
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
    (point2) => point2 && typeof point2 === "object" && "perspective" in point2 && point2.perspective !== void 0
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
  return transform?.scale !== void 0 && transform.scale !== 1 || transform?.scaleX !== void 0 && transform.scaleX !== 1 || transform?.scaleY !== void 0 && transform.scaleY !== 1 || transform?.x !== void 0 && transform.x !== 0 || transform?.y !== void 0 && transform.y !== 0 || transform?.rotate !== void 0 && transform.rotate !== 0 || item.crop !== void 0 || item.opacity !== void 0 && item.opacity < 1 || item.keyframes !== void 0 || item.source.kind === "media" && "mask" in item && item.mask !== void 0 || item.source.kind === "media" && ("erase" in item && item.erase !== void 0 || "flip" in item && item.flip !== void 0) || item.source.kind === "media" && isStillImageSourcePath(pathOf?.(item.source.src)) || item.source.kind === "media" && isAlphaCapableMediaSourcePath(pathOf?.(item.source.src));
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
function buildV2Item(item, fps, ref, lane, pathOf, chromaKeyOf, legacyIndexCounters, outputWidth, hasOverlappingSibling = false, parentAtFrames = 0, parentId) {
  const built = lane === "audio" ? buildV2AudioItem(item, fps, ref, pathOf, legacyIndexCounters) : buildV2VisualItem(
    item,
    fps,
    ref,
    pathOf,
    chromaKeyOf,
    legacyIndexCounters,
    hasOverlappingSibling,
    parentAtFrames,
    parentId,
    outputWidth
  );
  const children = lane === "visual" && "items" in item && Array.isArray(item.items) ? item.items.map((child) => buildV2Item(
    child,
    fps,
    ref,
    "visual",
    pathOf,
    chromaKeyOf,
    legacyIndexCounters,
    outputWidth,
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
  if (lane === "visual" && item.source.kind === "group") {
    const groupItem = item;
    const clipStart = built.item.atFrames;
    const clipEnd = clipStart + built.item.durationFrames;
    const clipCaptions = (node) => {
      if (node.source.kind === "caption") {
        node.groupCaptionLocal ??= {
          transform: node.declaration.transform,
          opacity: typeof node.declaration.opacity === "number" ? node.declaration.opacity : void 0
        };
        const start = Math.max(clipStart, node.atFrames);
        const end = Math.min(clipEnd, node.atFrames + node.durationFrames);
        node.atFrames = start;
        node.durationFrames = Math.max(0, end - start);
        node.at = start / fps;
        node.duration = node.durationFrames / fps;
        const transform = composeTransforms(groupItem.transform, node.declaration.transform);
        node.declaration = {
          ...node.declaration,
          ...transform ? { transform } : {},
          ...groupItem.opacity !== void 0 ? { opacity: groupItem.opacity * (typeof node.declaration.opacity === "number" ? node.declaration.opacity : 1) } : {}
        };
        if (node.durationFrames === 0) node.declaration = { ...node.declaration, hidden: true };
      }
      for (const child of node.children) clipCaptions(child);
    };
    for (const child of children) clipCaptions(child);
  }
  if (parentId !== void 0) built.item.parentId = parentId;
  return built;
}
function buildV2VisualItem(item, fps, ref, pathOf, chromaKeyOf, legacyIndexCounters, hasOverlappingSibling = false, parentAtFrames = 0, parentId, outputWidth = 1920) {
  const atFrames = parentAtFrames + item.at;
  const durationFrames = item.duration;
  const at = atFrames / fps;
  const duration = durationFrames / fps;
  const declaredKeyframes = item.keyframes;
  const captionSwitch = item.captions;
  const keyframes = Array.isArray(declaredKeyframes) ? declaredKeyframes.map((keyframe) => ({ ...keyframe, t: keyframe.t / fps })) : void 0;
  const common = {
    ...item.hidden !== void 0 ? { hidden: item.hidden } : {},
    ...item.transform !== void 0 ? { transform: item.transform } : {},
    ...item.opacity !== void 0 ? { opacity: item.opacity } : {},
    ...item.blend !== void 0 ? { blend: item.blend } : {},
    ...item.crop !== void 0 ? { crop: item.crop } : {},
    ...item.source.kind === "media" && "erase" in item && item.erase !== void 0 ? { erase: structuredClone(item.erase) } : {},
    ...item.source.kind === "media" && "flip" in item && item.flip !== void 0 ? { flip: { ...item.flip } } : {},
    ...item.adjust !== void 0 ? { adjust: structuredClone(item.adjust) } : {},
    ...item.perspective !== void 0 ? { perspective: item.perspective } : {},
    ...item.motion !== void 0 ? { motion: structuredClone(item.motion) } : {},
    ...item.animator !== void 0 ? { animator: structuredClone(item.animator) } : {},
    ...keyframes !== void 0 ? { keyframes } : {},
    ...item.source.kind === "media" && "mask" in item && item.mask !== void 0 ? { mask: pathOf(item.mask) ?? item.mask } : {},
    ...item.source.kind === "media" && captionSwitch !== void 0 ? { captions: captionSwitch } : {}
  };
  const finish = (built) => {
    if (item.source.kind === "media" && captionSwitch !== void 0) built.item.captions = captionSwitch;
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
          in: item.source.in,
          track: ref,
          ...common,
          ...copyMediaSourceFields(item.source, captionSwitch),
          // cuts 側（下の EditCut / declaration）と同じく、素材窓が出力尺と 1 フレーム超ずれた
          // ときの再生速度をレイヤー宣言にも渡す。落とすと out - in ≠ duration の追加映像が
          // 等倍のまま伸びて（= 速度が落ちて）書き出される。
          ...speed !== void 0 ? { speed } : {},
          ..."audio" in item && item.audio === false ? { audio: false } : {}
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
        ...copyMediaSourceFields(item.source, captionSwitch),
        ..."audio" in item && item.audio === false ? { audio: false } : {}
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
            ...copyMediaSourceFields(item.source, captionSwitch),
            ..."audio" in item && item.audio === false ? { audio: false } : {},
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
      const html = shapeMarkup(item.source, item.id, outputWidth, item.transform);
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
        source: { kind: "group", ...item.source.canvas ? { canvas: item.source.canvas } : {} },
        declaration: { id: item.id, ...item.name ? { name: item.name } : {}, at: item.at, duration: item.duration, ...common },
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
    ...item.mute !== void 0 ? { mute: item.mute } : {},
    ...item.role === "speech" ? { role: "speech", duration, track: ref } : {},
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
  if (role === "narration" || role === "speech") {
    const value2 = {
      id: item.id,
      t: at,
      path: resolvedPath,
      track: ref,
      // fade_in / fade_out は render-cut の resolveSfxFadeSeconds が snake_case で読む
      // （sfx 宣言と同じ綴り。bgm だけが camelCase の fadeIn / fadeOut）。
      // 落とすと afade が生成コマンドから丸ごと消え、会話音声のフェードが書き出しに乗らない。
      ...item.fade_in !== void 0 ? { fade_in: item.fade_in } : {},
      ...item.fade_out !== void 0 ? { fade_out: item.fade_out } : {},
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
          ...item.fade_in !== void 0 ? { fade_in: item.fade_in } : {},
          ...item.fade_out !== void 0 ? { fade_out: item.fade_out } : {},
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
          collection: role,
          index: nextLegacyIndex(legacyIndexCounters, role),
          value: value2
        }
      }
    };
  }
  if (role === "bgm") {
    const value2 = {
      id: "bgm",
      ...duration > 0 ? { t: at, duration } : {},
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
          ...duration > 0 ? { t: at, duration } : {},
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
function copyMediaSourceFields(source, captions) {
  return {
    ...source.framing !== void 0 ? { framing: source.framing } : {},
    ...source.transition_out !== void 0 ? { transition_out: source.transition_out } : {},
    ...source.freeze !== void 0 ? { freeze: source.freeze } : {},
    ...source.fx !== void 0 ? { fx: source.fx } : {},
    ...source.speed !== void 0 ? { speed: source.speed } : {},
    ...source.gain_db !== void 0 ? { gain_db: source.gain_db } : {},
    ...source.mute !== void 0 ? { mute: source.mute } : {},
    ...source.chroma_key !== void 0 ? { chroma_key: source.chroma_key } : {},
    ...captions !== void 0 ? { captions } : {}
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
  const audioSpeech = [];
  const audioBgms = [];
  const flattened = flattenGroupDescendants(internal);
  const hasGroupMedia = flattened.some((entry) => entry.descendant && entry.item.source.kind === "media");
  const byTrack = new Map(internal.tracks.map((track) => [track, []]));
  for (const entry of flattened) byTrack.get(entry.track)?.push(entry);
  for (const track of internal.tracks) {
    if (track.lane === "audio" && !isAudioItemAudible(track, void 0)) continue;
    for (const { item, descendant, order } of byTrack.get(track) ?? []) {
      if (descendant && item.source.kind !== "media") continue;
      const value = item.legacy.value;
      if (value === void 0) {
        if (item.source.kind === "telop" || item.source.kind === "filter") {
          layers.push({
            index: hasGroupMedia ? order : item.legacy.index,
            value: item.declaration
          });
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
            case "speech":
              audioSpeech.push({ index: item.legacy.index, value });
              break;
            case "bgm":
              audioBgms.push(value);
              break;
            case "layers":
              layers.push({
                index: hasGroupMedia ? order : item.legacy.index,
                value: track.lane === "visual" && track.muted === true ? { ...value, mute: true } : value
              });
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
          layers.push({ index: hasGroupMedia ? order : item.legacy.index, value });
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
    ...audioSpeech.length ? { audioSpeech: byDeclarationOrder(audioSpeech) } : {},
    audioBgms: audioBgms.sort((a, b) => (a.t ?? 0) - (b.t ?? 0)),
    ...audioBgms.length ? { audioBgm: audioBgms[0] } : {},
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
    at: (item.anchor.edge === "end" ? endFrames : startFrames) + (item.anchor.offset ?? 0) - context.parentAtFrames,
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
function removeStyleAttachedItems(edit, captionId) {
  let changed = false;
  const prune = (items) => items.flatMap((item) => {
    if (item.anchor?.attached_by?.caption === captionId) {
      changed = true;
      return [];
    }
    if ("items" in item && Array.isArray(item.items)) {
      const children = prune(item.items);
      if (children.length !== item.items.length || children.some((child, index) => child !== item.items[index])) {
        changed = true;
        return [{ ...item, items: children }];
      }
    }
    return [item];
  });
  const tracks = edit.tracks.map((track) => "items" in track ? { ...track, items: prune(track.items) } : track);
  return changed ? { ...edit, tracks } : edit;
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
    if (!("items" in track) || !Array.isArray(track.items)) return track;
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
    if ("items" in next && Array.isArray(next.items)) {
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
    (item) => item.anchor !== void 0 || "items" in item && Array.isArray(item.items) && visit(item.items)
  );
  return edit.tracks.some((track) => "items" in track && visit(track.items));
}
function validFps(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function isRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// ../edit-store/src/caption-display.ts
var CAPTION_ALIGN_VALUES = /* @__PURE__ */ new Set(["left", "center", "right"]);
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
var CaptionDisplayError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CaptionDisplayError";
    this.code = code;
  }
};
function normalizeCaptionAnimationSlot(value) {
  if (!isRecord4(value) || typeof value.id !== "string" || value.id === "") return void 0;
  return {
    id: value.id,
    ...finitePositive2(value.duration_sec) ? { duration_sec: value.duration_sec } : {},
    ...typeof value.ease === "string" && value.ease !== "" ? { ease: value.ease } : {},
    ...finitePositive2(value.amp) ? { amp: value.amp } : {}
  };
}
function normalizeCaptionLineTextStyle(value) {
  if (!isRecord4(value)) return {};
  const animationIn = normalizeCaptionAnimationSlot(value.animation?.in);
  const animationLoop = normalizeCaptionAnimationSlot(value.animation?.loop);
  const animationOut = normalizeCaptionAnimationSlot(value.animation?.out);
  return {
    ...typeof value.color === "string" ? { color: value.color } : {},
    ...finiteNumber(value.size_px) ? { size_px: value.size_px } : {},
    ...finiteNumber(value.scale) && value.scale >= 0.4 && value.scale <= 3 ? { scale: value.scale } : {},
    ...finiteNumber(value.rotate) && value.rotate >= -180 && value.rotate <= 180 ? { rotate: value.rotate } : {},
    ...positiveInteger(value.reference_height_px) ? { reference_height_px: value.reference_height_px } : {},
    ...typeof value.font_family === "string" && value.font_family !== "" ? { font_family: value.font_family } : {},
    ...finiteNumber(value.weight) && value.weight >= 100 && value.weight <= 900 ? { weight: value.weight } : Number.isInteger(value.font_weight) && value.font_weight >= 1 && value.font_weight <= 1e3 ? { weight: value.font_weight } : {},
    ...value.italic === true ? { italic: true } : {},
    ...value.underline === true ? { underline: true } : {},
    ...finiteNumber(value.letter_spacing_em) ? { letter_spacing_em: value.letter_spacing_em } : {},
    ...finitePositive2(value.line_height) ? { line_height: value.line_height } : {},
    ...CAPTION_ALIGN_VALUES.has(value.align) ? { align: value.align } : {},
    ...CAPTION_VERTICAL_ALIGN_VALUES.has(value.vertical_align) ? { vertical_align: value.vertical_align } : {},
    ...value.vertical === true ? { vertical: true } : {},
    ...CAPTION_TEXT_TRANSFORM_MAP[value.text_transform] ? { text_transform: CAPTION_TEXT_TRANSFORM_MAP[value.text_transform] } : {},
    ...finiteNumber(value.max_width_pct) && value.max_width_pct > 0 && value.max_width_pct < 100 ? { max_width_pct: value.max_width_pct } : {},
    ...finiteNumber(value.wrap_width_pct) && value.wrap_width_pct > 0 && value.wrap_width_pct <= 100 ? { wrap_width_pct: value.wrap_width_pct } : {},
    ...positiveInteger(value.max_characters) ? { max_characters: value.max_characters } : {},
    ...CAPTION_TEXT_ANCHOR_VALUES.has(value.text_anchor) ? { text_anchor: value.text_anchor } : {},
    ...isRecord4(value.position) && (finiteNumber(value.position.x) || finiteNumber(value.position.y)) ? { position: {
      ...finiteNumber(value.position.x) ? { x: value.position.x } : {},
      ...finiteNumber(value.position.y) ? { y: value.position.y } : {}
    } } : {},
    ...isRecord4(value.shadow) && typeof value.shadow.color === "string" ? { shadow: {
      color: value.shadow.color,
      ...finiteNumber(value.shadow.opacity) ? { opacity: value.shadow.opacity } : {},
      ...finiteNumber(value.shadow.blur_px) ? { blur_px: value.shadow.blur_px } : {},
      ...finiteNumber(value.shadow.distance_px) ? { distance_px: value.shadow.distance_px } : {},
      ...finiteNumber(value.shadow.angle_deg) ? { angle_deg: value.shadow.angle_deg } : {}
    } } : {},
    ...isRecord4(value.glow) && typeof value.glow.color === "string" ? { glow: {
      color: value.glow.color,
      ...finiteNumber(value.glow.density) ? { density: value.glow.density } : {},
      ...finiteNumber(value.glow.spread) ? { spread: value.glow.spread } : {},
      ...finiteNumber(value.glow.offset_x) ? { offset_x: value.glow.offset_x } : {},
      ...finiteNumber(value.glow.offset_y) ? { offset_y: value.glow.offset_y } : {}
    } } : {},
    ...animationIn || animationLoop || animationOut ? { animation: {
      ...animationIn ? { in: animationIn } : {},
      ...animationLoop ? { loop: animationLoop } : {},
      ...animationOut ? { out: animationOut } : {}
    } } : {},
    ...isRecord4(value.stroke) ? { stroke: {
      ...typeof value.stroke.color === "string" ? { color: value.stroke.color } : {},
      ...finiteNumber(value.stroke.width_px) ? { width_px: value.stroke.width_px } : {}
    } } : {},
    ...isRecord4(value.background) ? { background: {
      ...typeof value.background.color === "string" ? { color: value.background.color } : {},
      ...finiteNumber(value.background.opacity) ? { opacity: value.background.opacity } : {},
      ...finiteNumber(value.background.radius_px) ? { radius_px: value.background.radius_px } : {},
      ...finiteNumber(value.background.padding_px) ? { padding_px: value.background.padding_px } : {},
      ...finiteNumber(value.background.height_pct) ? { height_pct: value.background.height_pct } : {},
      ...finiteNumber(value.background.width_pct) ? { width_pct: value.background.width_pct } : {},
      ...finiteNumber(value.background.offset_x) ? { offset_x: value.background.offset_x } : {},
      ...finiteNumber(value.background.offset_y) ? { offset_y: value.background.offset_y } : {},
      ...value.background.mode === "per-line" || value.background.mode === "block" ? { mode: value.background.mode } : {},
      ...value.background.fit === "text" || value.background.fit === "frame" ? { fit: value.background.fit } : {}
    } } : {},
    ...typeof value.zone === "string" ? { zone: value.zone } : {}
  };
}
function mergeCaptionLineTextStyles(base, override) {
  const left = normalizeCaptionLineTextStyle(base);
  const right = normalizeCaptionLineTextStyle(override);
  const merged = { ...left, ...right };
  for (const key of ["stroke", "background", "shadow", "glow", "position", "animation"]) {
    if (isRecord4(left[key]) || isRecord4(right[key])) {
      merged[key] = { ...isRecord4(left[key]) ? left[key] : {}, ...isRecord4(right[key]) ? right[key] : {} };
      if (Object.keys(merged[key]).length === 0) delete merged[key];
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
function usesPercentageBackground(background) {
  return isRecord4(background) && (background.fit !== "frame" && finiteNumber(background.width_pct) && background.width_pct > 0 || finiteNumber(background.height_pct) && background.height_pct > 0);
}
function usesExtendedPerLineBackground(background) {
  if (!isRecord4(background) || background.mode === "block") return false;
  return usesPercentageBackground(background) || finiteNumber(background.offset_x) && background.offset_x !== 0 || finiteNumber(background.offset_y) && background.offset_y !== 0;
}
function captionZoneVars(zone) {
  if (typeof zone !== "string" || zone === "" || zone === "bottom") return {};
  const [vertical, horizontal] = zone.includes("-") ? zone.split("-") : zone === "top" || zone === "center" ? [zone, "center"] : ["center", zone];
  return {
    "--caption-top": vertical === "top" ? "7%" : vertical === "center" ? "0" : "auto",
    "--caption-bottom": vertical === "bottom" ? "7%" : vertical === "center" ? "0" : "auto",
    "--caption-left": "4%",
    "--caption-right": "4%",
    "--caption-justify-content": vertical === "center" ? "center" : "flex-start",
    "--caption-align-items": horizontal === "left" ? "flex-start" : horizontal === "right" ? "flex-end" : "center",
    "--caption-line-margin": "0",
    "--caption-line-max-width": "100%",
    "--caption-text-align": horizontal
  };
}
function resolveCaptionReferenceScale(style, output) {
  if (!isRecord4(style) || style.reference_height_px === void 0) return 1;
  if (style.layout !== void 0) {
    fail2("STYLE_LAYOUT_CONFLICT", "caption text style cannot contain both layout and reference_height_px");
  }
  if (!positiveInteger(style.reference_height_px)) {
    fail2("INVALID_TEXT_STYLE", "text_style.reference_height_px must be an integer >= 1");
  }
  if (!output || !finitePositive2(output.height)) {
    fail2("INVALID_OUTPUT_GEOMETRY", "output height is required for reference_height_px caption text style");
  }
  return output.height / style.reference_height_px;
}
function scaleCaptionPx(value, scale) {
  return scale === 1 ? value : Number((value * scale).toFixed(6));
}
function captionAnchorPositionVars(anchorValue, positionValue, verticalAlignValue) {
  const anchor = typeof anchorValue === "string" && CAPTION_TEXT_ANCHOR_VALUES.has(anchorValue) ? anchorValue : void 0;
  const position = isRecord4(positionValue) ? positionValue : void 0;
  const verticalAlign = typeof verticalAlignValue === "string" && CAPTION_VERTICAL_ALIGN_VALUES.has(verticalAlignValue) ? verticalAlignValue : void 0;
  if (!anchor && !position && !verticalAlign) return {};
  const vars = {};
  const vertical = anchor ? anchor[0] : verticalAlign === "top" ? "t" : verticalAlign === "middle" ? "m" : "b";
  const horizontal = anchor ? anchor[1] : "c";
  if (typeof position?.y === "number" && Number.isFinite(position.y)) {
    const clamped = typeof position?.x === "number" && Number.isFinite(position.x) ? position.y : Math.min(1, Math.max(0, position.y));
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
    const left = Math.round(position.x * 1e4) / 100;
    vars["--caption-left"] = `${left}%`;
    vars["--caption-right"] = `${Math.round((8 - left) * 100) / 100}%`;
    vars["--caption-width"] = "max-content";
    vars["--caption-align-items"] = "flex-start";
    vars["--caption-line-margin"] = "0";
    vars["--caption-line-max-width"] = "100%";
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
function resolveCaptionLineStyleVarsAtScale(style, scale) {
  const vars = {};
  const px = (value) => scaleCaptionPx(value, scale);
  const extendedBackground = usesExtendedPerLineBackground(style.background);
  const percentageBackground = usesPercentageBackground(style.background);
  if (isRecord4(style.background) && style.background.fit === "frame") {
    vars["--caption-plate-fit"] = "frame";
  }
  if (typeof style.color === "string") vars["--caption-color"] = style.color;
  if (finiteNumber(style.size_px)) vars["--caption-font-size"] = `${px(style.size_px)}px`;
  if (isRecord4(style.stroke) && (typeof style.stroke.color === "string" || finiteNumber(style.stroke.width_px))) {
    const width = finiteNumber(style.stroke.width_px) ? px(style.stroke.width_px) : 1.5;
    const color2 = typeof style.stroke.color === "string" ? style.stroke.color : "rgba(0,0,0,.9)";
    vars["--caption-stroke"] = `${width * 2}px ${color2}`;
  }
  if (isRecord4(style.background) && (typeof style.background.color === "string" || finiteNumber(style.background.opacity))) {
    const name = style.background.mode === "block" ? "--plate-block-bg" : extendedBackground ? "--plate-ext-bg" : "--plate-bg";
    vars[name] = colorWithOpacity(
      typeof style.background.color === "string" ? style.background.color : "#000000",
      finiteNumber(style.background.opacity) ? style.background.opacity : void 0
    );
  }
  if (isRecord4(style.background) && finiteNumber(style.background.radius_px)) {
    const name = style.background.mode === "block" ? "--plate-block-radius" : extendedBackground ? "--plate-ext-radius" : "--plate-radius";
    vars[name] = `${px(style.background.radius_px)}px`;
  }
  if (typeof style.font_family === "string") vars["--caption-font-family"] = style.font_family;
  if (finiteNumber(style.weight)) vars["--caption-font-weight"] = String(style.weight);
  else if (Number.isInteger(style.font_weight)) vars["--caption-font-weight"] = String(style.font_weight);
  if (style.italic) vars["--caption-font-style"] = "italic";
  if (style.underline) vars["--caption-text-decoration"] = "underline";
  if (finiteNumber(style.letter_spacing_em)) vars["--caption-letter-spacing"] = `${style.letter_spacing_em}em`;
  if (finiteNumber(style.line_height)) vars["--caption-line-height"] = String(style.line_height);
  if (typeof style.text_transform === "string" && CAPTION_TEXT_TRANSFORM_MAP[style.text_transform]) {
    vars["--caption-text-transform"] = CAPTION_TEXT_TRANSFORM_MAP[style.text_transform];
  }
  if (finiteNumber(style.max_width_pct)) vars["--caption-line-max-width"] = `${style.max_width_pct}%`;
  if (finiteNumber(style.wrap_width_pct)) vars["--caption-wrap-width"] = `${style.wrap_width_pct}%`;
  if (style.vertical) vars["--caption-writing-mode"] = "vertical-rl";
  if (extendedBackground && isRecord4(style.background)) {
    if (style.background.fit !== "frame") {
      vars["--plate-ext-width"] = percentageBackground ? `${style.background.width_pct ?? 0}%` : `${px(style.background.padding_px ?? 0)}px`;
    }
    vars["--plate-ext-height"] = percentageBackground ? `${style.background.height_pct ?? 0}%` : `${px(style.background.padding_px ?? 0)}px`;
    if (finiteNumber(style.background.offset_x)) vars["--plate-offset-x"] = `${px(style.background.offset_x)}px`;
    if (finiteNumber(style.background.offset_y)) vars["--plate-offset-y"] = `${px(style.background.offset_y)}px`;
  } else if (isRecord4(style.background) && finiteNumber(style.background.padding_px)) {
    vars["--plate-pad-y"] = `${px(style.background.padding_px)}px`;
    vars["--plate-pad-x"] = `${px(style.background.padding_px)}px`;
  }
  const textShadow = captionTextShadowValue(style.shadow, style.glow, scale);
  if (textShadow !== null) vars["--caption-text-shadow"] = textShadow;
  Object.assign(vars, captionZoneVars(style.zone));
  Object.assign(vars, captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align));
  if (style.align) {
    vars["--caption-text-align"] = style.align;
    vars["--caption-align-items"] = style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center";
  }
  return vars;
}
function resolveCaptionLineStyleVars(style, output) {
  if (!isRecord4(style)) return {};
  return resolveCaptionLineStyleVarsAtScale(style, resolveCaptionReferenceScale(style, output));
}
var CAPTION_TEXT_TRANSFORM_MAP = {
  upper: "uppercase",
  uppercase: "uppercase",
  lower: "lowercase",
  lowercase: "lowercase",
  title: "capitalize",
  capitalize: "capitalize",
  none: "none"
};
function captionTextShadowValue(shadow, glow, scale = 1) {
  const parts = [];
  if (isRecord4(shadow) && typeof shadow.color === "string") {
    const angle = (shadow.angle_deg ?? 90) * Math.PI / 180;
    const distance = scaleCaptionPx(shadow.distance_px ?? 0, scale);
    const dx = Math.round(Math.cos(angle) * distance * 100) / 100;
    const dy = Math.round(Math.sin(angle) * distance * 100) / 100;
    parts.push(`${dx}px ${dy}px ${scaleCaptionPx(shadow.blur_px ?? 0, scale)}px ${colorWithOpacity(shadow.color, shadow.opacity)}`);
  }
  if (isRecord4(glow) && typeof glow.color === "string") {
    const spread = glow.spread === void 0 ? 40 : scaleCaptionPx(glow.spread, scale);
    const alpha = Math.min(1, (glow.density ?? 50) / 60);
    const offsetX = scaleCaptionPx(glow.offset_x ?? 0, scale);
    const offsetY = scaleCaptionPx(glow.offset_y ?? 0, scale);
    parts.push(
      `${offsetX}px ${offsetY}px ${spread}px ${colorWithOpacity(glow.color, alpha)}`,
      `${offsetX}px ${offsetY}px ${spread * 2}px ${colorWithOpacity(glow.color, Number((alpha * 0.7).toFixed(4)))}`
    );
  }
  return parts.length > 0 ? parts.join(", ") : null;
}
function colorWithOpacity(color2, explicitOpacity) {
  const raw = color2.slice(1);
  const expanded = raw.length === 3 ? raw.split("").map((character) => character + character).join("") : raw;
  const rgb = expanded.slice(0, 6).padEnd(6, "0");
  const alphaFromColor = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  const alpha = explicitOpacity ?? alphaFromColor;
  return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},${parseInt(rgb.slice(4, 6), 16)},${Number(alpha.toFixed(4))})`;
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function finitePositive2(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}
function isRecord4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail2(code, message) {
  throw new CaptionDisplayError(code, message);
}

// ../edit-store/src/adjust-css-visual.ts
function computeAdjustCssVisual(adjust, transitionFilter, blurScale = 1) {
  const source = adjust && typeof adjust === "object" && !Array.isArray(adjust) ? adjust : null;
  const rawBasic = source && source.sections?.basic !== false ? source.basic : null;
  const basic = rawBasic && typeof rawBasic === "object" && !Array.isArray(rawBasic) ? rawBasic : null;
  const rawFx = source && source.sections?.fx !== false ? source.fx : null;
  const fx = Array.isArray(rawFx) ? rawFx : [];
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
    const points = raw.map((point2) => ({ in: clamp01(point2.in), out: clamp01(point2.out) })).sort((a, b) => a.in - b.in);
    return !(points.length === 2 && Math.abs(points[0].in) < 1e-5 && Math.abs(points[0].out) < 1e-5 && Math.abs(points[1].in - 1) < 1e-5 && Math.abs(points[1].out - 1) < 1e-5);
  });
  const hasHue = source?.sections?.hue !== false && ["hue", "sat", "luma"].some((channel) => (source?.hue?.[channel] ?? []).some((point2) => Math.abs((Number.isFinite(point2.value) ? clamp01(point2.value) : 0.5) - 0.5) > 1e-4));
  const hasUnsupportedSection = hasWheels || hasCurves || hasHue || fx.some((effect) => effect.id !== "blur");
  if (!basic && !transition && !hasUnsupportedSection && fx.length === 0) return null;
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
  const scale = Number.isFinite(blurScale) ? blurScale : 1;
  for (const effect of fx) {
    if (effect.id === "blur") {
      const px = typeof effect.px === "number" && Number.isFinite(effect.px) ? effect.px : 8;
      if (px > 0) parts.push("blur(" + (px * scale).toFixed(2) + "px)");
    }
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
  captionFragmentWindows,
  captionSpeechWindow,
  captionWindowSeconds,
  composeEnvelopesDb,
  computeAdjustCssVisual,
  computeDuckEnvelope,
  computeDuckIntervals,
  computeTransitionVisual,
  easingProgress,
  envelopeToGainEvents,
  evaluateEnvelopeDb,
  expandCaptionDisplayFragments,
  findActiveCaption,
  findActiveCaptions,
  findActiveResolvedCaption,
  isAudioItemAudible,
  isCutAudioAudible,
  isLayerAudioAudible,
  isTransitionType,
  isWithinDuckInterval,
  mergeCaptionLineTextStyles,
  mergePresetTextStyle,
  normalizeCaptionClock,
  outputToSource,
  projectLayerSpeechDeclarations,
  projectSpeechDeclarations,
  projectSpeechKeyIntervals,
  removeStyleAttachedItems,
  resolveCaptionLineStyleVars,
  resolveCaptionStylePreset,
  resolveItemAnchor,
  resolveItemAnchors,
  sampleEnvelopeLinear,
  sourceToOutput,
  toAnchorCaptions,
  transitionProgressAt,
  withoutItemAnchors
};
