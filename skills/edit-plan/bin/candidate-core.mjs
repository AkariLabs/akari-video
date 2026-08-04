import { CutCandidateError } from "./errors.mjs";
import { canonicalJson, codePointCompare, round6, sha256 } from "./canonical-json.mjs";
import { RISK_ORDER } from "./contract-semantics.mjs";

function fail(code) {
  throw new CutCandidateError(code);
}

function interval(start, end) {
  return { start: round6(start), end: round6(end) };
}

function intersects(left, right) {
  return left.start < right.end && right.start < left.end;
}

function contains(outer, inner) {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function wordRef(word) {
  return {
    segment_index: word.segmentIndex,
    word_index: word.wordIndex,
    start: word.start,
    end: word.end,
    text: word.text,
  };
}

function normalizedRecords(analysis) {
  const segments = analysis.transcript.map((segment, segmentIndex) => ({ ...segment, segmentIndex }));
  segments.sort((a, b) => a.start - b.start || a.end - b.end || a.segmentIndex - b.segmentIndex);
  const words = [];
  for (const segment of segments) {
    for (const [wordIndex, word] of (segment.words ?? []).entries()) {
      words.push({ ...word, segmentIndex: segment.segmentIndex, wordIndex, owner: segment });
    }
  }
  words.sort((a, b) => a.start - b.start || a.end - b.end
    || a.segmentIndex - b.segmentIndex || a.wordIndex - b.wordIndex);
  const terminalWordBySegment = new Map();
  for (const word of words) terminalWordBySegment.set(word.segmentIndex, word);
  for (const word of words) word.isOwnerTerminalWord = terminalWordBySegment.get(word.segmentIndex) === word;
  const wordsByEnd = [...words].sort((a, b) => a.end - b.end || a.start - b.start
    || a.segmentIndex - b.segmentIndex || a.wordIndex - b.wordIndex);
  const chapters = analysis.events.map((event, eventIndex) => ({ ...event, eventIndex }))
    .filter((event) => event.type === "chapter")
    .sort((a, b) => a.t - b.t || a.eventIndex - b.eventIndex);
  const keyframes = analysis.keyframes.map((keyframe, originalIndex) => ({ ...keyframe, originalIndex }))
    .sort((a, b) => a.t - b.t || codePointCompare(a.path, b.path) || a.originalIndex - b.originalIndex);
  return { words, wordsByEnd, wordIntervals: intervalIndex(words), chapters, keyframes };
}

function intervalIndex(items) {
  let base = 1;
  while (base < items.length) base *= 2;
  const maximumEnds = new Float64Array(base * 2);
  for (let index = 0; index < items.length; index += 1) maximumEnds[base + index] = items[index].end;
  for (let index = base - 1; index > 0; index -= 1) {
    maximumEnds[index] = Math.max(maximumEnds[index * 2], maximumEnds[index * 2 + 1]);
  }
  return { items, base, maximumEnds };
}

function forEachOverlap(index, start, end, callback) {
  if (index.items.length === 0) return;
  const stack = [[1, 0, index.base]];
  while (stack.length > 0) {
    const [node, lower, upper] = stack.pop();
    if (lower >= index.items.length || index.maximumEnds[node] <= start
      || index.items[lower].start >= end) continue;
    if (upper - lower === 1) {
      const item = index.items[lower];
      if (item.start < end && item.end > start) callback(item);
      continue;
    }
    const middle = (lower + upper) >>> 1;
    stack.push([node * 2 + 1, middle, upper], [node * 2, lower, middle]);
  }
}

function lowerBound(items, value, field) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][field] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(items, value, field) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][field] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function timedWindow(items, start, end, field = "start") {
  const first = lowerBound(items, start, field);
  const last = lowerBound(items, end, field);
  return items.slice(first, last);
}

function contextFor(records, occurrence, start, end) {
  const contextInterval = {
    start: Math.max(occurrence.start, start - 1),
    end: Math.min(occurrence.end, end + 1),
  };
  let previous = null;
  let previousIndex = upperBound(records.wordsByEnd, start, "end") - 1;
  while (previousIndex >= 0 && previous === null) {
    const targetEnd = records.wordsByEnd[previousIndex].end;
    const tied = [];
    while (previousIndex >= 0 && records.wordsByEnd[previousIndex].end === targetEnd) {
      const word = records.wordsByEnd[previousIndex--];
      if (word.start >= occurrence.start && word.end <= occurrence.end && word.end >= contextInterval.start) tied.push(word);
    }
    previous = tied.sort((a, b) => a.segmentIndex - b.segmentIndex || a.wordIndex - b.wordIndex)[0] ?? null;
  }
  let next = null;
  let nextIndex = lowerBound(records.words, end, "start");
  while (nextIndex < records.words.length && next === null) {
    const targetStart = records.words[nextIndex].start;
    if (targetStart >= occurrence.end || targetStart > contextInterval.end) break;
    const tied = [];
    while (nextIndex < records.words.length && records.words[nextIndex].start === targetStart) {
      const word = records.words[nextIndex++];
      if (word.start >= occurrence.start && word.end <= occurrence.end) tied.push(word);
    }
    next = tied.sort((a, b) => a.segmentIndex - b.segmentIndex || a.wordIndex - b.wordIndex)[0] ?? null;
  }
  const chapters = timedWindow(records.chapters, contextInterval.start, contextInterval.end, "t");
  const keyframes = timedWindow(records.keyframes, contextInterval.start, contextInterval.end, "t");
  return {
    value: {
      start: round6(contextInterval.start),
      end: round6(contextInterval.end),
      previous_word: previous ? wordRef(previous) : null,
      next_word: next ? wordRef(next) : null,
      chapter_event_indexes: chapters.map((event) => event.eventIndex),
      keyframe_input_indexes: [],
    },
    previous,
    next,
    chapters,
    keyframes,
  };
}

function protectedWordsFor(records, occurrence, start, end) {
  const protectedWords = [];
  forEachOverlap(records.wordIntervals, start, end, (word) => {
    if (word.start >= occurrence.start && word.end <= occurrence.end) protectedWords.push(word);
  });
  return protectedWords;
}

function riskFlags(context, semantic, partial = false) {
  const risks = ["UI_WAIT_UNRESOLVED"];
  if (context.keyframes.length === 0) risks.push("SCREEN_CONTEXT_MISSING");
  if (semantic) risks.push("INFORMATION_RETENTION_REVIEW");
  if (partial) risks.push("PARTIAL_EVENT_OCCURRENCE");
  return RISK_ORDER.filter((risk) => risks.includes(risk));
}

function classification(context, policy) {
  if (context.chapters.length > 0) {
    return {
      classification: "topic_transition",
      basis: { kind: "chapter_event", event_index: context.chapters[0].eventIndex },
      target: policy.retained_pause_seconds.topic_transition,
    };
  }
  const previous = context.previous;
  const next = context.next;
  if (previous && next && previous.segmentIndex !== next.segmentIndex) {
    const terminal = previous.owner.text.trim().match(/[。！？!?]$/u)?.[0];
    if (terminal && previous.isOwnerTerminalWord) {
      return {
        classification: "sentence_end",
        basis: { kind: "sentence_terminal", segment_index: previous.segmentIndex, terminal },
        target: policy.retained_pause_seconds.sentence_end,
      };
    }
  }
  return {
    classification: "within_sentence",
    basis: { kind: "default_within_sentence" },
    target: policy.retained_pause_seconds.within_sentence,
  };
}

function skip(source, occurrence, sourceInterval, code, detail, pairIndex = -1) {
  return {
    id: "",
    src: source.src,
    occurrence_index: occurrence?.index ?? null,
    occurrence_origin: occurrence?.origin ?? null,
    source_interval: interval(sourceInterval.start, sourceInterval.end),
    code,
    detail,
    _sourceOrder: source.sourceOrder,
    _pairIndex: pairIndex,
  };
}

function semanticCandidates(source, records, emitCandidate, ensureEmission) {
  const events = source.analysis.events.map((event, eventIndex) => ({ ...event, eventIndex }))
    .filter((event) => event.type === "filler" || event.type === "trouble")
    .sort((a, b) => a.start - b.start || a.end - b.end || a.eventIndex - b.eventIndex);
  const eventIntervals = intervalIndex(events);
  for (const occurrence of [...source.occurrences].sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)) {
    forEachOverlap(eventIntervals, occurrence.start, occurrence.end, (event) => {
      ensureEmission();
      const projected = { start: Math.max(event.start, occurrence.start), end: Math.min(event.end, occurrence.end) };
      const context = contextFor(records, occurrence, projected.start, projected.end);
      const originalInterval = interval(event.start, event.end);
      const projectedInterval = interval(projected.start, projected.end);
      if (!(originalInterval.start < originalInterval.end && projectedInterval.start < projectedInterval.end)) fail("REPORT_INVALID");
      const partial = projected.start !== event.start || projected.end !== event.end;
      const eventValue = {
        index: event.eventIndex,
        type: event.type,
        ...(event.type === "trouble" ? { note: event.note } : {}),
        event_original_interval: originalInterval,
        projected_interval: projectedInterval,
        partial_event_occurrence: partial,
      };
      emitCandidate(() => ({
        id: "",
        family: "semantic_event_review",
        src: source.src,
        occurrence_index: occurrence.index,
        occurrence_origin: occurrence.origin,
        occurrence_interval: interval(occurrence.start, occurrence.end),
        event: eventValue,
        context: context.value,
        screen_review_required: true,
        suggested_action: "review_drop_or_keep",
        risk_flags: riskFlags(context, true, partial),
        decision: "REVIEW_REQUIRED",
        _sourceOrder: source.sourceOrder,
        _intervalStart: projected.start,
        _intervalEnd: projected.end,
        _recordIndex: event.eventIndex,
        _keyframes: context.keyframes,
      }));
    });
  }
}

function pauseResults(source, records, silences, policy, emitCandidate, emitSkipped, ensureEmission) {
  const missing = source.analysis.transcript.length === 0
    ? []
    : source.analysis.transcript.flatMap((segment, index) => !segment.words?.length ? [index] : []);
  const wordsUnavailable = source.analysis.transcript.length === 0 || missing.length > 0;
  if (wordsUnavailable) {
    for (const occurrence of source.occurrences) {
      emitSkipped(() => skip(source, occurrence, occurrence, "WORD_TIMING_UNAVAILABLE", {
        missing_segment_indexes: missing,
      }));
    }
    return;
  }

  const occurrenceOrder = [...source.occurrences].sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
  let occurrenceCursor = 0;
  const activeOccurrences = [];
  for (const [pairIndex, silence] of silences.entries()) {
    while (occurrenceCursor < occurrenceOrder.length && occurrenceOrder[occurrenceCursor].start < silence.end) {
      activeOccurrences.push(occurrenceOrder[occurrenceCursor++]);
    }
    for (let index = activeOccurrences.length - 1; index >= 0; index -= 1) {
      if (activeOccurrences[index].end <= silence.start) activeOccurrences.splice(index, 1);
    }
    const intersecting = activeOccurrences.filter((occurrence) => intersects(occurrence, silence));
    if (intersecting.length === 0) {
      emitSkipped(() => skip(source, null, silence, "OUTSIDE_KEEP_OCCURRENCE", { detector_pair_index: pairIndex }, pairIndex));
      continue;
    }
    for (const occurrence of intersecting) {
      ensureEmission();
      if (!contains(occurrence, silence)) {
        emitSkipped(() => skip(source, occurrence, silence, "CROSSES_OCCURRENCE_BOUNDARY", {
          detector_pair_index: pairIndex,
          occurrence_interval: interval(occurrence.start, occurrence.end),
        }, pairIndex));
        continue;
      }
      const context = contextFor(records, occurrence, silence.start, silence.end);
      const previousAvailable = context.previous !== null && silence.start - context.previous.end <= policy.surrounding_context_seconds;
      const nextAvailable = context.next !== null && context.next.start - silence.end <= policy.surrounding_context_seconds;
      if (!previousAvailable || !nextAvailable) {
        emitSkipped(() => skip(source, occurrence, silence, "MISSING_SPEECH_CONTEXT", {
          previous_word_available: previousAvailable,
          next_word_available: nextAvailable,
        }, pairIndex));
        continue;
      }
      const classified = classification(context, policy);
      const target = classified.target;
      const retainedBefore = silence.end - silence.start;
      if (retainedBefore <= target + 1 / 30) {
        emitSkipped(() => skip(source, occurrence, silence, "NO_EFFECTIVE_CHANGE", {
          retained_before_seconds: round6(retainedBefore),
          target_retained_seconds: target,
          retained_after_seconds: round6(retainedBefore),
        }, pairIndex));
        continue;
      }
      const frameProposal = calculatePauseFrameProposal(silence, target);
      const {
        rawStart, rawEnd, startFrame, endFrame, removeStart, removeEnd, retainedAfter,
      } = frameProposal;
      if (startFrame >= endFrame) {
        emitSkipped(() => skip(source, occurrence, silence, "NO_FRAME_CELL", {
          raw_remove_start: round6(rawStart),
          raw_remove_end: round6(rawEnd),
          remove_start_frame: Math.max(0, startFrame),
          remove_end_frame: Math.max(0, endFrame),
        }, pairIndex));
        continue;
      }
      const guardedStart = removeStart - policy.speech_guard_seconds;
      const guardedEnd = removeEnd + policy.speech_guard_seconds;
      const protectedWords = protectedWordsFor(records, occurrence, guardedStart, guardedEnd)
        .sort((a, b) => a.start - b.start || a.end - b.end
          || a.segmentIndex - b.segmentIndex || a.wordIndex - b.wordIndex);
      if (protectedWords.length > 0) {
        emitSkipped(() => skip(source, occurrence, silence, "PROTECTED_WORD_OVERLAP", {
          protected_words: protectedWords.map(wordRef),
        }, pairIndex));
        continue;
      }
      if (retainedAfter >= retainedBefore - 1 / 30) {
        emitSkipped(() => skip(source, occurrence, silence, "NO_EFFECTIVE_CHANGE", {
          retained_before_seconds: round6(retainedBefore),
          target_retained_seconds: target,
          retained_after_seconds: retainedAfter,
        }, pairIndex));
        continue;
      }
      if (retainedAfter > target + 2 / 30) {
        emitSkipped(() => skip(source, occurrence, silence, "TARGET_NOT_REACHED", {
          retained_before_seconds: round6(retainedBefore),
          target_retained_seconds: target,
          retained_after_seconds: retainedAfter,
        }, pairIndex));
        continue;
      }
      emitCandidate(() => ({
        id: "",
        family: "pause_shortening_review",
        src: source.src,
        occurrence_index: occurrence.index,
        occurrence_origin: occurrence.origin,
        occurrence_interval: interval(occurrence.start, occurrence.end),
        source_interval: interval(silence.start, silence.end),
        classification: classified.classification,
        classification_basis: classified.basis,
        context: context.value,
        proposal: {
          fps: 30,
          target_retained_seconds: target,
          raw_remove_start: round6(rawStart),
          raw_remove_end: round6(rawEnd),
          remove_start_frame: startFrame,
          remove_end_frame: endFrame,
          remove_start: removeStart,
          remove_end: removeEnd,
          actual_retained_seconds: retainedAfter,
        },
        screen_review_required: true,
        risk_flags: riskFlags(context, false),
        decision: "REVIEW_REQUIRED",
        _sourceOrder: source.sourceOrder,
        _intervalStart: silence.start,
        _intervalEnd: silence.end,
        _recordIndex: pairIndex,
        _keyframes: context.keyframes,
      }));
    }
  }
}

export function calculatePauseFrameProposal(silence, target) {
  const rawStart = silence.start + target / 2;
  const rawEnd = silence.end - target / 2;
  const startFrame = Math.ceil((rawStart - 1e-9) * 30);
  const endFrame = Math.floor((rawEnd + 1e-9) * 30);
  const removeStart = round6(startFrame / 30);
  const removeEnd = round6(endFrame / 30);
  const retainedAfter = round6((removeStart - silence.start) + (silence.end - removeEnd));
  return { rawStart, rawEnd, startFrame, endFrame, removeStart, removeEnd, retainedAfter };
}

function candidateCompare(left, right) {
  const family = { semantic_event_review: 0, pause_shortening_review: 1 };
  return left._sourceOrder - right._sourceOrder
    || left.occurrence_index - right.occurrence_index
    || family[left.family] - family[right.family]
    || left._intervalStart - right._intervalStart
    || left._intervalEnd - right._intervalEnd
    || left._recordIndex - right._recordIndex;
}

function skipCompare(left, right) {
  return left._sourceOrder - right._sourceOrder
    || (left.occurrence_index ?? -1) - (right.occurrence_index ?? -1)
    || left.source_interval.start - right.source_interval.start
    || left.source_interval.end - right.source_interval.end
    || codePointCompare(left.code, right.code)
    || left._pairIndex - right._pairIndex;
}

function currentPeakRssBytes() {
  return Math.max(process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024);
}

function defaultResourceGuard() {
  if (currentPeakRssBytes() > 512 * 1024 * 1024) fail("INPUT_BUDGET_EXCEEDED");
}

export function buildCandidates(sources, policy, {
  maximumEmitted = 1_000_000,
  resourceGuard = defaultResourceGuard,
} = {}) {
  const candidates = [];
  const skipped = [];
  let emitted = 0;
  const ensureEmission = () => {
    resourceGuard();
    if (emitted >= maximumEmitted) fail("INPUT_BUDGET_EXCEEDED");
  };
  const boundedEmitter = (target) => (factory) => {
    ensureEmission();
    const value = factory();
    target.push(value);
    emitted += 1;
    resourceGuard();
  };
  const emitCandidate = boundedEmitter(candidates);
  const emitSkipped = boundedEmitter(skipped);
  for (const source of sources) {
    resourceGuard();
    const records = normalizedRecords(source.analysis);
    resourceGuard();
    semanticCandidates(source, records, emitCandidate, ensureEmission);
    pauseResults(source, records, source.silences ?? [], policy, emitCandidate, emitSkipped, ensureEmission);
  }
  candidates.sort(candidateCompare);
  skipped.sort(skipCompare);
  let semanticCount = 0;
  let pauseCount = 0;
  for (const candidate of candidates) {
    if (candidate.family === "semantic_event_review") semanticCount += 1;
    else pauseCount += 1;
  }
  const semanticWidth = Math.max(4, String(semanticCount).length);
  const pauseWidth = Math.max(4, String(pauseCount).length);
  let semanticIndex = 0;
  let pauseIndex = 0;
  for (const candidate of candidates) {
    if (candidate.family === "semantic_event_review") {
      semanticIndex += 1;
      candidate.id = `semantic-${String(semanticIndex).padStart(semanticWidth, "0")}`;
    } else {
      pauseIndex += 1;
      candidate.id = `pause-${String(pauseIndex).padStart(pauseWidth, "0")}`;
    }
  }
  const skipWidth = Math.max(4, String(skipped.length).length);
  skipped.forEach((entry, index) => { entry.id = `skip-${String(index + 1).padStart(skipWidth, "0")}`; });
  resourceGuard();
  return { candidates, skipped };
}

export function finalizeCandidateKeyframes(candidates, keyframeIndexResolver) {
  for (const candidate of candidates) {
    candidate.context.keyframe_input_indexes = [...new Set(candidate._keyframes
      .map((keyframe) => keyframeIndexResolver(candidate.src, keyframe)))]
      .sort((a, b) => a - b);
    delete candidate._keyframes;
    delete candidate._sourceOrder;
    delete candidate._intervalStart;
    delete candidate._intervalEnd;
    delete candidate._recordIndex;
  }
}

export function finalizeSkipped(skipped) {
  for (const entry of skipped) {
    delete entry._sourceOrder;
    delete entry._pairIndex;
  }
}

export function createSilenceOutputParser(duration, policy, maximumPairs = 100_000) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const starts = [];
  const pairs = [];
  let pending = "";
  let finished = false;
  const pushPair = (start, end) => {
    if (pairs.length >= maximumPairs) fail("DETECTOR_OUTPUT_LIMIT");
    pairs.push({ start, end });
  };
  const consumeLine = (line) => {
    const markerCount = [...line.matchAll(/silence_(?:start|end):/gu)].length;
    let matchedCount = 0;
    for (const match of line.matchAll(/silence_(start|end):\s*([^\s]+)/gu)) {
      matchedCount += 1;
      const value = Number(match[2]);
      if (match[1] === "start") {
        if (!Number.isFinite(value) || value < 0 || value > duration || starts.length > 0) fail("DETECTOR_PARSE_INVALID");
        starts.push(value);
      } else {
        const start = starts.pop();
        if (start === undefined || !Number.isFinite(value) || value <= start || value > duration
          || value - start + 1e-9 < policy.minimum_silence_seconds) fail("DETECTOR_PARSE_INVALID");
        pushPair(start, value);
      }
    }
    if (matchedCount !== markerCount) fail("DETECTOR_PARSE_INVALID");
  };
  const consumeAvailableLines = () => {
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/u, "");
      pending = pending.slice(newline + 1);
      consumeLine(line);
    }
  };
  return {
    push(chunk) {
      if (finished) fail("DETECTOR_PARSE_INVALID");
      try { pending += decoder.decode(chunk, { stream: true }); }
      catch { fail("DETECTOR_PARSE_INVALID"); }
      consumeAvailableLines();
      if (pending.length > 65_536) fail("DETECTOR_PARSE_INVALID");
    },
    finish() {
      if (finished) fail("DETECTOR_PARSE_INVALID");
      finished = true;
      try { pending += decoder.decode(); }
      catch { fail("DETECTOR_PARSE_INVALID"); }
      consumeAvailableLines();
      if (pending.length > 0) consumeLine(pending.replace(/\r$/u, ""));
      pending = "";
      if (starts.length === 1) {
        const start = starts.pop();
        if (duration <= start || duration - start + 1e-9 < policy.minimum_silence_seconds) fail("DETECTOR_PARSE_INVALID");
        pushPair(start, duration);
      }
      if (starts.length !== 0) fail("DETECTOR_PARSE_INVALID");
      pairs.sort((a, b) => a.start - b.start || a.end - b.end);
      for (let index = 1; index < pairs.length; index += 1) {
        if (pairs[index].start < pairs[index - 1].end) fail("DETECTOR_PARSE_INVALID");
      }
      return pairs;
    },
  };
}

export function parseSilenceOutput(stderrBuffer, duration, policy, maximumPairs = 100_000) {
  const parser = createSilenceOutputParser(duration, policy, maximumPairs);
  parser.push(stderrBuffer);
  return parser.finish();
}

export function normalizeProbe(raw) {
  const duration = Number(raw?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) fail("MEDIA_DURATION_INVALID");
  const names = [...new Set(String(raw?.format?.format_name ?? "").split(",").filter(Boolean))].sort(codePointCompare);
  const allowed = new Set(["3g2", "3gp", "m4a", "mj2", "mov", "mp4", "matroska", "webm"]);
  if (names.length === 0 || !names.some((name) => allowed.has(name)) || names.some((name) => !allowed.has(name))) {
    fail("MEDIA_CONTAINER_UNSUPPORTED");
  }
  if (!Array.isArray(raw.streams) || raw.streams.length === 0) fail("FFPROBE_FAILED");
  const streams = raw.streams.map((stream) => {
    const index = Number(stream.index);
    if (!Number.isInteger(index) || index < 0 || typeof stream.codec_type !== "string" || stream.codec_type.length === 0) fail("FFPROBE_FAILED");
    const parsedDuration = stream.duration === undefined || stream.duration === "N/A" ? null : Number(stream.duration);
    if (parsedDuration !== null && (!Number.isFinite(parsedDuration) || parsedDuration < 0)) fail("FFPROBE_FAILED");
    return { index, codec_type: stream.codec_type, duration_seconds: parsedDuration };
  }).sort((a, b) => a.index - b.index);
  if (new Set(streams.map((stream) => stream.index)).size !== streams.length) fail("FFPROBE_FAILED");
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  if (audio.length === 0) fail("AUDIO_STREAM_MISSING");
  if (audio.length > 1) fail("MULTIPLE_AUDIO_STREAMS_REQUIRES_SELECTION");
  const audioDuration = audio[0].duration_seconds;
  const delta = audioDuration === null ? null : Math.abs(audioDuration - duration);
  if (delta !== null && delta > 1) fail("AUDIO_STREAM_DURATION_DIVERGENCE");
  const probe = {
    format_names: names,
    format_duration_seconds: duration,
    stream_count: streams.length,
    audio_stream_count: 1,
    streams,
    selected_audio_stream_index: audio[0].index,
    selected_audio_codec_type: "audio",
    selected_audio_duration_seconds: audioDuration,
    audio_format_delta_seconds: delta,
  };
  return { ...probe, normalized_sha256: sha256(Buffer.from(canonicalJson(probe), "utf8")) };
}
