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

  return { stateAt };
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

export function resolveUtteranceReference({ utterance, trace, cutMap, rewindWindowSeconds = 3 }) {
  const utteranceStart = utterance.recT[0];
  const startState = trace.stateAt(utteranceStart);
  if (!startState.playing) {
    const located = cutMap.locate(startState.timelineT);
    return {
      timelineT: located.timelineT,
      sourceT: located.sourceT,
      cutIndex: located.cutIndex,
      target: `cut:${located.cutIndex}`,
      sourceRange: null,
      confidence: "high",
      resolutionMethod: "stopped-frame",
      candidates: [],
    };
  }

  const windowStartRecT = Math.max(0, utteranceStart - rewindWindowSeconds);
  const before = trace.stateAt(windowStartRecT).timelineT;
  const now = startState.timelineT;
  const lower = Math.min(before, now);
  const upper = Math.max(before, now);
  const candidates = cutMap.boundaries.filter((boundary) => boundary > lower && boundary <= upper);

  if (candidates.length === 1) {
    const located = cutMap.locate(candidates[0]);
    return {
      timelineT: located.timelineT,
      sourceT: located.sourceT,
      cutIndex: located.cutIndex,
      target: `cut:${located.cutIndex}`,
      sourceRange: null,
      confidence: "high",
      resolutionMethod: "rewind-window-boundary",
      candidates,
    };
  }

  const located = cutMap.locate(now);
  return {
    timelineT: located.timelineT,
    sourceT: located.sourceT,
    cutIndex: located.cutIndex,
    target: `cut:${located.cutIndex}`,
    sourceRange: null,
    confidence: "low",
    resolutionMethod: candidates.length === 0 ? "instantaneous" : "ambiguous-boundaries",
    candidates,
  };
}
