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
function cutsUseGapsOrTracks(cuts) {
  return cuts.some((cut) => cut.at !== void 0 || typeof cut.track === "number" && Number.isInteger(cut.track) && cut.track !== 0);
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
  const gapsOrTracks = cutsUseGapsOrTracks(usableCuts);
  if (!gapsOrTracks) {
    const segments2 = [];
    const transitionPlates = [];
    for (let index = 0; index < trackSegments.length; index++) {
      const segment = trackSegments[index];
      const cut = usableCuts[segment.index];
      const speed = typeof cut.speed === "number" && cut.speed > 0 ? cut.speed : 1;
      segments2.push({
        kind: "src",
        outStart: segment.at,
        outEnd: segment.end,
        cutIndex: usable[segment.index].index,
        ...cut.src !== void 0 ? { src: cut.src } : {},
        in: cut.in,
        out: cut.out,
        speed,
        track: 0,
        transitionOut: cut.transitionOut ?? null
      });
      if (cut.transitionOut && index < trackSegments.length - 1 && (cut.transitionOut.type === "fade-black" || cut.transitionOut.type === "fade-white")) {
        const duration = cut.transitionOut.duration;
        transitionPlates.push({
          start: segment.end - duration / 2,
          end: segment.end + duration / 2,
          mid: segment.end,
          color: cut.transitionOut.type === "fade-black" ? "#000000" : "#ffffff"
        });
      }
    }
    const totalDuration = segments2.reduce((max, segment) => Math.max(max, segment.outEnd), 0);
    return { segments: segments2, totalDuration, transitionPlates, usesGapsOrTracks: false };
  }
  const trackZ = options?.trackZ ?? ((track) => -track);
  const resolved = trackSegments.map((segment) => ({
    start: segment.at,
    end: segment.end,
    track: segment.track,
    cut: usableCuts[segment.index],
    cutIndex: usable[segment.index].index
  }));
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
    const cut = run.winner.cut;
    const speed = typeof cut.speed === "number" && cut.speed > 0 ? cut.speed : 1;
    return {
      kind: "src",
      outStart: run.start,
      outEnd: run.end,
      cutIndex: run.winner.cutIndex,
      ...cut.src !== void 0 ? { src: cut.src } : {},
      in: cut.in + (run.start - run.winner.start) * speed,
      out: cut.in + (run.end - run.winner.start) * speed,
      speed,
      track: run.winner.track,
      transitionOut: null
    };
  });
  return { segments, totalDuration: outputDuration, transitionPlates: [], usesGapsOrTracks: true };
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
export {
  buildTimelineMap,
  cutsUseGapsOrTracks,
  outputToSource
};
