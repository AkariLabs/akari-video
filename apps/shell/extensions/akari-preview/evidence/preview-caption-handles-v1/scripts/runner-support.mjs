// Serialized into the main window by run-l1.mjs; keep this function self-contained.
export function summarizeCommandResult(value) {
  const resultType = typeof value;
  const scalar = value === null || resultType === 'string' || resultType === 'boolean'
    || (resultType === 'number' && Number.isFinite(value));
  // Do not inspect constructor/toJSON/getters or traverse a returned Theia widget.
  return { result: scalar ? value : null, resultType };
}

export function matchesSeekObservation(state, before, expectedTime) {
  const playback = state.playback;
  return state.ready && state.engine === before.engine && state.fps === before.fps
    && state.instance === before.instance && typeof state.instance === 'string'
    && Boolean(playback) && playback.sequence > (before.playback?.sequence ?? 0)
    && playback.playing === false && Number.isFinite(playback.time)
    && Math.abs(playback.time - expectedTime) < 1e-6;
}
