function finiteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} が有限数ではありません`);
  }
  return value;
}

export function parseEventsJsonl(source) {
  const events = [];
  const warnings = [];
  for (const [index, rawLine] of String(source).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      finiteNumber(event?.recT, `events.jsonl ${index + 1} 行目の recT`);
      if (typeof event?.type !== "string") {
        throw new Error("type がありません");
      }
      events.push({ ...event, _order: index });
    } catch (error) {
      warnings.push(`${index + 1} 行目をスキップ: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  events.sort((left, right) => left.recT - right.recT || left._order - right._order);
  return {
    events: events.map(({ _order, ...event }) => event),
    warnings,
  };
}

function positionAt(state, recT) {
  return state.playing
    ? state.anchorTimelineT + (recT - state.anchorRecT) * state.rate
    : state.anchorTimelineT;
}

function applyEvent(state, event) {
  if (event.type === "start") {
    return {
      playing: Boolean(event.playing),
      anchorTimelineT: finiteNumber(event.timelineT, "start.timelineT"),
      anchorRecT: event.recT,
      rate: 1,
    };
  }
  if (state === null) {
    throw new Error(`start より前に ${event.type} イベントがあります`);
  }

  if (event.type === "play") {
    return {
      ...state,
      playing: true,
      anchorTimelineT: Number.isFinite(event.timelineT)
        ? event.timelineT
        : positionAt(state, event.recT),
      anchorRecT: event.recT,
    };
  }
  if (event.type === "pause") {
    return {
      ...state,
      playing: false,
      anchorTimelineT: finiteNumber(event.timelineT, "pause.timelineT"),
      anchorRecT: event.recT,
    };
  }
  if (event.type === "seek") {
    return {
      ...state,
      anchorTimelineT: finiteNumber(event.to, "seek.to"),
      anchorRecT: event.recT,
    };
  }
  if (event.type === "rate") {
    const timelineT = positionAt(state, event.recT);
    const rate = finiteNumber(event.value, "rate.value");
    if (rate <= 0) throw new Error("rate.value は正数である必要があります");
    return {
      ...state,
      rate,
      anchorTimelineT: timelineT,
      anchorRecT: event.recT,
    };
  }
  if (event.type === "tick") {
    return {
      ...state,
      anchorTimelineT: finiteNumber(event.timelineT, "tick.timelineT"),
      anchorRecT: event.recT,
    };
  }
  if (event.type === "end") {
    return {
      ...state,
      anchorTimelineT: Number.isFinite(event.timelineT)
        ? event.timelineT
        : positionAt(state, event.recT),
      anchorRecT: event.recT,
      playing: false,
    };
  }
  return state;
}

export function buildTimelineTrace(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("events.jsonl に有効なイベントがありません");
  }

  function stateAt(queryRecT) {
    finiteNumber(queryRecT, "queryRecT");
    let state = null;
    for (const event of events) {
      if (event.recT > queryRecT) break;
      state = applyEvent(state, event);
    }
    if (state === null) {
      throw new Error(`recT=${queryRecT} より前に start イベントがありません`);
    }
    return {
      ...state,
      timelineT: positionAt(state, queryRecT),
    };
  }

  return { stateAt, events };
}

function computeStopSegments(events) {
  const segments = [];
  let state = null;
  let current = null;
  for (const event of events) {
    const recT = event.recT;
    state = applyEvent(state, event);
    if (state.playing) {
      current = null;
      continue;
    }
    const value = state.anchorTimelineT;
    if (current && current.value === value) {
      // 同一値が継続中。まだ閉じない。
    } else {
      if (current) segments.push({ ...current, end: recT });
      current = { value, start: recT };
    }
  }
  if (current) segments.push({ ...current, end: events.at(-1).recT });
  return segments.map((segment) => ({ ...segment, duration: segment.end - segment.start }));
}

const UI_EVENT_TYPES = new Set(["ui.click", "ui.tab", "ui.panel"]);

export function buildUiTrace(events) {
  const clicks = [];
  const panels = [];
  const tabs = [];
  const warnings = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!UI_EVENT_TYPES.has(event?.type)) continue;
    if (typeof event.target !== "string" || !event.target) {
      warnings.push(`events.jsonl の ${event.type} イベント（recT=${event.recT}）に target がないためスキップします`);
      continue;
    }
    const entry = {
      recT: event.recT,
      target: event.target,
      label: typeof event.label === "string" ? event.label : "",
    };
    if (event.type === "ui.click") {
      clicks.push({ ...entry, intent: event.intent === true });
    } else if (event.type === "ui.panel") {
      panels.push(entry);
    } else {
      tabs.push(entry);
    }
  }
  const byRecT = (left, right) => left.recT - right.recT;
  return {
    clicks: clicks.sort(byRecT),
    panels: panels.sort(byRecT),
    tabs: tabs.sort(byRecT),
    warnings,
  };
}

export function buildCutMap(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.cuts) || snapshot.cuts.length === 0) {
    throw new Error("edit.snapshot.json に cuts がありません");
  }
  const trackValues = snapshot.cuts.map((cut) => Number.isInteger(cut?.track) ? cut.track : 0);
  const primaryTrack = Math.min(...trackValues);
  const intervals = [];
  let previousEnd = 0;

  for (let cutIndex = 0; cutIndex < snapshot.cuts.length; cutIndex += 1) {
    const cut = snapshot.cuts[cutIndex];
    const track = Number.isInteger(cut?.track) ? cut.track : 0;
    if (track !== primaryTrack) continue;
    const sourceIn = finiteNumber(cut?.in, `cuts[${cutIndex}].in`);
    const sourceOut = finiteNumber(cut?.out, `cuts[${cutIndex}].out`);
    const speed = cut?.speed === undefined ? 1 : finiteNumber(cut.speed, `cuts[${cutIndex}].speed`);
    if (sourceOut <= sourceIn) throw new Error(`cuts[${cutIndex}] は out > in である必要があります`);
    if (speed <= 0) throw new Error(`cuts[${cutIndex}].speed は正数である必要があります`);
    const timelineStart = cut?.at === undefined
      ? previousEnd
      : finiteNumber(cut.at, `cuts[${cutIndex}].at`);
    const timelineEnd = timelineStart + (sourceOut - sourceIn) / speed;
    intervals.push({
      cutIndex,
      sourceIn,
      sourceOut,
      speed,
      timelineStart,
      timelineEnd,
    });
    previousEnd = timelineEnd;
  }
  if (intervals.length === 0) throw new Error("プライマリトラックに cut がありません");

  const byTimeline = [...intervals].sort((left, right) => (
    left.timelineStart - right.timelineStart || left.cutIndex - right.cutIndex
  ));
  const boundaries = [...new Set(byTimeline.slice(1).map((interval) => interval.timelineStart))]
    .sort((left, right) => left - right);

  function locate(timelineT) {
    finiteNumber(timelineT, "timelineT");
    const exact = byTimeline.find((interval) => (
      timelineT >= interval.timelineStart && timelineT < interval.timelineEnd
    ));
    if (exact) {
      return {
        ...exact,
        timelineT,
        sourceT: exact.sourceIn + (timelineT - exact.timelineStart) * exact.speed,
      };
    }
    const first = byTimeline[0];
    const last = byTimeline.at(-1);
    if (timelineT < first.timelineStart) {
      return { ...first, timelineT: first.timelineStart, sourceT: first.sourceIn, clamped: true };
    }
    if (timelineT >= last.timelineEnd) {
      return { ...last, timelineT: last.timelineEnd, sourceT: last.sourceOut, clamped: true };
    }

    const next = byTimeline.find((interval) => interval.timelineStart > timelineT);
    const previous = [...byTimeline].reverse().find((interval) => interval.timelineEnd <= timelineT);
    if (next && previous) {
      const usePrevious = timelineT - previous.timelineEnd <= next.timelineStart - timelineT;
      return usePrevious
        ? { ...previous, timelineT: previous.timelineEnd, sourceT: previous.sourceOut, clamped: true }
        : { ...next, timelineT: next.timelineStart, sourceT: next.sourceIn, clamped: true };
    }
    throw new Error(`timelineT=${timelineT} を cut に写像できません`);
  }

  return { primaryTrack, intervals: byTimeline, boundaries, locate };
}

function pairableStroke(strokes, utteranceStart, utteranceEnd, maximumDistance) {
  return (Array.isArray(strokes) ? strokes : [])
    .map((stroke, index) => {
      const overlaps = stroke.recTStart <= utteranceEnd && stroke.recTEnd >= utteranceStart;
      const intervalDistance = overlaps
        ? 0
        : Math.min(
          Math.abs(stroke.recTStart - utteranceEnd),
          Math.abs(stroke.recTEnd - utteranceStart),
        );
      const startDistance = Math.min(
        Math.abs(stroke.recTStart - utteranceStart),
        Math.abs(stroke.recTEnd - utteranceStart),
      );
      return { stroke, index, overlaps, intervalDistance, startDistance };
    })
    .filter((candidate) => candidate.intervalDistance <= maximumDistance)
    .sort((left, right) => (
      Number(right.overlaps) - Number(left.overlaps)
      || left.startDistance - right.startDistance
      || left.stroke.recTStart - right.stroke.recTStart
      || left.stroke.recTEnd - right.stroke.recTEnd
      || String(left.stroke.id).localeCompare(String(right.stroke.id))
      || left.index - right.index
    ))[0]?.stroke;
}

function attachPairedStroke(reference, stroke) {
  if (!stroke) return reference;
  if (reference.resolutionMethod === "stopped-frame") {
    return { ...reference, pairedStroke: stroke };
  }
  return {
    ...reference,
    timelineT: stroke.frame.timelineT,
    sourceT: stroke.frame.sourceT,
    cutIndex: stroke.frame.cutIndex,
    target: stroke.frame.cutIndex !== null ? `cut:${stroke.frame.cutIndex}` : reference.target,
    confidence: "high",
    resolutionMethod: "stroke-pair",
    pairedStroke: stroke,
  };
}

function normalizeForMatch(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function mentionsLabel(transcriptText, label) {
  const normalizedLabel = normalizeForMatch(label);
  if (!normalizedLabel) return false;
  return normalizeForMatch(transcriptText).includes(normalizedLabel);
}

// 呼称照合の前に intent:true（選択ツールでの明示クリック）を優先する。intent 済みが
// 複数あるときだけ呼称で絞り込む。intent が無い受動記録は、呼称一致がある唯一の
// クリックだけを採用する（単発の無関係クリックを勝手に対象化しない）。
function pickUiClickCandidate(clicksInWindow, transcriptText) {
  const intentClicks = clicksInWindow.filter((click) => click.intent === true);
  let pool = intentClicks.length > 0 ? intentClicks : clicksInWindow;
  if (pool.length > 1) {
    const labelMatched = pool.filter((click) => mentionsLabel(transcriptText, click.label));
    if (labelMatched.length > 0) pool = labelMatched;
  }
  if (pool.length !== 1) {
    return { resolved: null, ambiguous: pool.length > 1, candidates: pool };
  }
  const [candidate] = pool;
  if (intentClicks.length === 0 && !mentionsLabel(transcriptText, candidate.label)) {
    return { resolved: null, ambiguous: false, candidates: [] };
  }
  return { resolved: candidate, ambiguous: false, candidates: [candidate] };
}

function resolveUiSignal({ utterance, uiClicks, windowSeconds }) {
  const utteranceStart = utterance.recT[0];
  const utteranceEnd = Number.isFinite(utterance.recT[1]) ? utterance.recT[1] : utteranceStart;
  const windowStart = utteranceStart - windowSeconds;
  const windowEnd = utteranceEnd + windowSeconds;
  const inWindow = (Array.isArray(uiClicks) ? uiClicks : [])
    .filter((click) => click.recT >= windowStart && click.recT <= windowEnd);
  if (inWindow.length === 0) return { resolved: null, ambiguous: false, candidates: [] };
  return pickUiClickCandidate(inWindow, utterance.text);
}

function parseUiClickTarget(target) {
  if (typeof target !== "string") return null;
  const cutMatch = /^timeline:cut:(\d+)$/.exec(target);
  if (cutMatch) return { kind: "cut", cutIndex: Number(cutMatch[1]) };
  const overlayMatch = /^timeline:overlay:(.+)$/.exec(target);
  if (overlayMatch) return { kind: "overlay", overlayId: overlayMatch[1] };
  const assetMatch = /^asset:(.+)$/.exec(target);
  if (assetMatch) return { kind: "asset", path: assetMatch[1] };
  return null;
}

function locateCutByIndex(cutMap, cutIndex) {
  return cutMap.intervals.find((interval) => interval.cutIndex === cutIndex) ?? null;
}

function locateOverlayAnchor(overlays, overlayId, cutMap) {
  const overlay = (Array.isArray(overlays) ? overlays : []).find((item) => item?.id === overlayId);
  if (!overlay || !Number.isFinite(overlay.start)) return null;
  try {
    return cutMap.locate(overlay.start);
  } catch {
    return null;
  }
}

// UI クリック解決は既存の 4 段階（停止中発話 > ストロークペア > 巻き戻し再生 > 再生中発話）の
// 最後に適用する追加層であり、既存段の意味は変えない。一意に解決できた timeline:cut: /
// timeline:overlay: だけが target・timelineT・sourceT を上書きする。asset: は timeline
// 位置を持たないため target には触れず refs だけを足す。複数候補で一意に決まらない場合は
// 対象を書き換えず confidence だけ low に倒す（黙って断定しない）。
function attachUiSignal(reference, { utterance, uiClicks, cutMap, overlays, windowSeconds }) {
  const signal = resolveUiSignal({ utterance, uiClicks, windowSeconds });
  if (signal.ambiguous) {
    return {
      ...reference,
      confidence: "low",
      uiCandidates: signal.candidates.map((click) => ({ target: click.target, label: click.label })),
    };
  }
  if (!signal.resolved) return reference;
  const parsed = parseUiClickTarget(signal.resolved.target);
  if (!parsed) return reference;

  if (parsed.kind === "asset") {
    return { ...reference, refs: [{ path: parsed.path }] };
  }
  if (parsed.kind === "cut") {
    const interval = locateCutByIndex(cutMap, parsed.cutIndex);
    if (!interval) return reference;
    return {
      ...reference,
      timelineT: interval.timelineStart,
      sourceT: interval.sourceIn,
      cutIndex: parsed.cutIndex,
      target: `cut:${parsed.cutIndex}`,
      confidence: "high",
      resolutionMethod: "ui-click-cut",
      candidates: [],
      uiEvent: { target: signal.resolved.target, label: signal.resolved.label },
    };
  }
  const located = locateOverlayAnchor(overlays, parsed.overlayId, cutMap);
  if (!located) return reference;
  return {
    ...reference,
    timelineT: located.timelineT,
    sourceT: located.sourceT,
    cutIndex: located.cutIndex,
    target: `overlay:${parsed.overlayId}`,
    confidence: "high",
    resolutionMethod: "ui-click-overlay",
    candidates: [],
    uiEvent: { target: signal.resolved.target, label: signal.resolved.label },
  };
}

export function resolveUtteranceReference({
  utterance,
  trace,
  cutMap,
  strokes = [],
  rewindWindowSeconds = 3,
  uiClicks = [],
  overlays = [],
  uiWindowSeconds = 5,
}) {
  function finalize(reference) {
    return attachUiSignal(reference, { utterance, uiClicks, cutMap, overlays, windowSeconds: uiWindowSeconds });
  }
  const utteranceStart = utterance.recT[0];
  const utteranceEnd = Number.isFinite(utterance.recT[1]) ? utterance.recT[1] : utteranceStart;
  const pairedStroke = pairableStroke(
    strokes,
    utteranceStart,
    utteranceEnd,
    rewindWindowSeconds,
  );
  const startState = trace.stateAt(utteranceStart);
  const seeksDuringUtterance = trace.events.filter((event) => (
    event.type === "seek" && event.recT > utteranceStart && event.recT <= utteranceEnd
  ));

  if (seeksDuringUtterance.length > 0) {
    const endState = trace.stateAt(utteranceEnd);
    const located = cutMap.locate(endState.timelineT);
    const segments = computeStopSegments(trace.events);
    const activeSegment = segments.find((segment) => (
      segment.start <= utteranceEnd && utteranceEnd <= segment.end
    ));
    const settled = !endState.playing && Boolean(activeSegment) && activeSegment.duration >= 1;
    const windowStartRecT = Math.max(0, utteranceStart - rewindWindowSeconds);
    const candidateValues = settled
      ? []
      : segments
        .filter((segment) => (
          segment.duration >= 1
          && segment.end > windowStartRecT
          && segment.start < utteranceEnd
        ))
        .map((segment) => segment.value);

    return finalize(attachPairedStroke({
      timelineT: located.timelineT,
      sourceT: located.sourceT,
      cutIndex: located.cutIndex,
      target: `cut:${located.cutIndex}`,
      sourceRange: null,
      confidence: settled ? "high" : "low",
      resolutionMethod: settled ? "scrub-settle" : "scrub-unsettled",
      candidates: candidateValues,
    }, pairedStroke));
  }

  if (!startState.playing) {
    const located = cutMap.locate(startState.timelineT);
    return finalize(attachPairedStroke({
      timelineT: located.timelineT,
      sourceT: located.sourceT,
      cutIndex: located.cutIndex,
      target: `cut:${located.cutIndex}`,
      sourceRange: null,
      confidence: "high",
      resolutionMethod: "stopped-frame",
      candidates: [],
    }, pairedStroke));
  }

  const windowStartRecT = Math.max(0, utteranceStart - rewindWindowSeconds);
  const before = trace.stateAt(windowStartRecT).timelineT;
  const now = startState.timelineT;
  const lower = Math.min(before, now);
  const upper = Math.max(before, now);
  const candidates = cutMap.boundaries.filter((boundary) => boundary > lower && boundary <= upper);

  if (candidates.length === 1) {
    const located = cutMap.locate(candidates[0]);
    return finalize(attachPairedStroke({
      timelineT: located.timelineT,
      sourceT: located.sourceT,
      cutIndex: located.cutIndex,
      target: `cut:${located.cutIndex}`,
      sourceRange: null,
      confidence: "high",
      resolutionMethod: "rewind-window-boundary",
      candidates,
    }, pairedStroke));
  }

  const located = cutMap.locate(now);
  return finalize(attachPairedStroke({
    timelineT: located.timelineT,
    sourceT: located.sourceT,
    cutIndex: located.cutIndex,
    target: `cut:${located.cutIndex}`,
    sourceRange: null,
    confidence: "low",
    resolutionMethod: candidates.length === 0 ? "instantaneous" : "ambiguous-boundaries",
    candidates,
  }, pairedStroke));
}
