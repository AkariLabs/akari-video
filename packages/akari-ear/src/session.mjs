export function engineLabel(engineId, backendName) {
  if (engineId === 'speechanalyzer-live' || backendName === 'speech-analyzer') return 'speech-analyzer';
  if (engineId === 'record-then-transcribe' || backendName === 'whisper-cpp') return 'whisper';
  return 'typed';
}

export function createPaperSessions({ nowEpochMs = Date.now, engineStartedAtEpochMs = nowEpochMs(), engine = 'typed' } = {}) {
  let active;
  const completed = new Map();
  return {
    setEngine(value) { engine = value; },
    open(canvasId, atEpochMs = nowEpochMs()) {
      if (active) return 'busy';
      completed.delete(canvasId);
      active = { canvasId, openedRecT: (atEpochMs - engineStartedAtEpochMs) / 1000, segments: [] };
      return 'opened';
    },
    close(canvasId) {
      if (!active || active.canvasId !== canvasId) return false;
      completed.set(canvasId, { engine, locale: 'ja-JP', openedRecT: active.openedRecT, segments: active.segments });
      active = undefined;
      return true;
    },
    onSegment(segment) {
      if (!active || !segment || segment.final === false || !Number.isFinite(segment.t1) || segment.t1 < active.openedRecT) return;
      active.segments.push({ t0: Math.max(0, segment.t0 - active.openedRecT),
        t1: Math.max(0, segment.t1 - active.openedRecT), text: segment.text,
        kind: segment.kind ?? 'speech', ...(Number.isFinite(segment.confidence) ? { confidence: segment.confidence } : {}) });
    },
    takeTranscript(canvasId) {
      const result = completed.get(canvasId);
      completed.delete(canvasId);
      return result;
    },
    isOpen() { return Boolean(active); }
  };
}
