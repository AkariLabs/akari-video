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

// ../edit-store/src/timeline-map.ts
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

// ../edit-store/src/webview-kernel.ts
function findActiveResolvedCaption(cues, outputTime) {
  return cues.find((cue) => cue.start <= outputTime && outputTime < cue.end);
}
export {
  buildTimelineMap,
  captionWindowSeconds,
  findActiveCaption,
  findActiveResolvedCaption,
  outputToSource,
  transitionProgressAt
};
