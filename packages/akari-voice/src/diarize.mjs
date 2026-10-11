export const DIARIZE_THRESHOLD = 0.5;

export function speakerLabel(index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('話者番号が不正です');
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}

export function relabelTurns(rawTurns) {
  const labels = new Map();
  return [...rawTurns].sort((a, b) => a.start - b.start || a.end - b.end).map(turn => {
    if (!labels.has(turn.speaker)) labels.set(turn.speaker, speakerLabel(labels.size));
    return { start: turn.start, end: turn.end, speaker: labels.get(turn.speaker) };
  });
}

export function assignSpeakers(segments, turns) {
  return segments.map(segment => {
    const sums = new Map();
    for (const turn of turns) {
      const overlap = Math.max(0, Math.min(segment.end, turn.end) - Math.max(segment.start, turn.start));
      if (overlap) sums.set(turn.speaker, (sums.get(turn.speaker) || 0) + overlap);
    }
    const best = [...sums].sort((a, b) => b[1] - a[1])[0];
    if (!best) { const { speaker, ...rest } = segment; return rest; }
    return { ...segment, speaker: best[0] };
  });
}

export function speakerTracks(turns) {
  const tracks = new Map();
  for (const turn of turns) {
    if (!tracks.has(turn.speaker)) tracks.set(turn.speaker, []);
    tracks.get(turn.speaker).push([turn.start, turn.end]);
  }
  return [...tracks].map(([id, spans]) => ({ id, spans }));
}

export function speakerSeconds(turns) {
  const totals = {};
  for (const turn of turns) totals[turn.speaker] = (totals[turn.speaker] || 0) + turn.end - turn.start;
  return Object.fromEntries(Object.entries(totals).map(([id, seconds]) => [id, +seconds.toFixed(1)]));
}

export function mergeSpeakers(turns, mapping) {
  return relabelTurns(turns.map(turn => ({ ...turn, speaker: mapping[turn.speaker] ?? turn.speaker })));
}

export function clusterCountFor(speakers) {
  if (speakers === 'auto' || speakers === 4 || speakers === '4') return -1;
  if ([1, 2, 3, '1', '2', '3'].includes(speakers)) return Number(speakers);
  throw new Error('話者数は auto または 1〜4 で指定してください');
}

export function createDiarizer(runtime, { segmentationModel, embeddingModel, numClusters = -1, threshold = DIARIZE_THRESHOLD }) {
  const engine = new runtime.sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationModel }, numThreads: 4, debug: 0 },
    embedding: { model: embeddingModel, numThreads: 4, debug: 0 },
    clustering: { numClusters, threshold }, minDurationOn: 0.3, minDurationOff: 0.5,
  });
  return { process(samples) { return engine.process(samples).map(({ start, end, speaker }) => ({ start, end, speaker })); } };
}
