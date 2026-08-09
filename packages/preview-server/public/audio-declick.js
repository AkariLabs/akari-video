// 12ms is long enough to cover several hundred samples even at 44.1kHz (so an
// abrupt boundary is attenuated), while staying below the roughly 20ms range
// where a deliberate mute starts to read as a gap in speech.
export const DECLICK_RAMP_SECONDS = 0.012;

// Start checking for a missing media event after 750ms. This is deliberately
// much longer than the normal local seek latency (tens of milliseconds), and
// the check never unmutes merely because time elapsed: it also requires the
// media element to be out of `seeking`, positioned at the target, and holding
// decoded current data. Slow proxy/network seeks therefore stay muted.
export const MEDIA_SEEK_READY_RECHECK_MS = 750;

function finiteGain(value, fallback = 1) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

// A media seek is deliberately delayed until the short fade-out reaches zero.
// Its action may return a promise for the media's real seek/load completion;
// gain stays at zero until that promise settles. Updating a pending request lets
// the playback clock keep advancing without restarting the ramp on every frame.
export function createAudioDeClickController({ audioContext, gainNode, delay = setTimeout }) {
  let pendingAction = null;
  let timer = null;
  let phase = 'idle';
  let generation = 0;

  function rampUp(token) {
    if (token !== generation) return;
    phase = 'idle';
    const param = gainNode.gain;
    const resumeAt = audioContext.currentTime;
    param.cancelScheduledValues(resumeAt);
    param.setValueAtTime(0, resumeAt);
    param.linearRampToValueAtTime(1, resumeAt + DECLICK_RAMP_SECONDS);
  }

  function applyPending() {
    timer = null;
    const apply = pendingAction;
    pendingAction = null;
    const token = ++generation;

    let completion;
    try {
      completion = apply?.();
    } catch {
      rampUp(token);
      return;
    }

    if (completion && typeof completion.then === 'function') {
      phase = 'waiting';
      Promise.resolve(completion).then(() => rampUp(token), () => rampUp(token));
    } else {
      rampUp(token);
    }
  }

  function request(action) {
    pendingAction = action;
    if (phase === 'fading') return false;
    // A newer seek can arrive while an earlier one is still decoding. The gain
    // is already zero, so apply the latest request immediately and let its own
    // completion supersede the stale waiter without introducing another gap.
    if (phase === 'waiting') {
      applyPending();
      return true;
    }

    const param = gainNode.gain;
    const now = audioContext.currentTime;
    const startGain = finiteGain(param.value);
    param.cancelScheduledValues(now);
    param.setValueAtTime(startGain, now);
    param.linearRampToValueAtTime(0, now + DECLICK_RAMP_SECONDS);

    phase = 'fading';
    timer = delay(applyPending, DECLICK_RAMP_SECONDS * 1000);
    return true;
  }

  return {
    request,
    // `pending` intentionally means the pre-apply fade window. Callers may
    // replace that pending action, but must not replace a seek already waiting
    // for decoded media merely to resume playback.
    get pending() { return phase === 'fading'; },
  };
}

// Register this waiter immediately before assigning src/currentTime. Same-source
// seeks complete on `seeked`; source replacements additionally require
// `loadeddata`, so a seek event from source selection cannot expose the new track
// before its first decoded frame/data is available.
export function waitForMediaSeekCompletion({
  mediaElement,
  sourceChanged,
  target,
  expectedSource,
  delay = setTimeout,
  clearDelay = clearTimeout,
  recheckMs = MEDIA_SEEK_READY_RECHECK_MS,
}) {
  return new Promise((resolve) => {
    let sawLoadedData = !sourceChanged;
    let sawSeeked = false;
    let timer = null;
    let settled = false;

    const sourceMatches = () => {
      if (!expectedSource) return true;
      return mediaElement.currentSrc === expectedSource || mediaElement.src === expectedSource;
    };
    const targetMatches = () => Number.isFinite(mediaElement.currentTime)
      && Math.abs(mediaElement.currentTime - target) <= 0.25;

    const cleanup = () => {
      mediaElement.removeEventListener('loadeddata', onLoadedData);
      mediaElement.removeEventListener('seeked', onSeeked);
      mediaElement.removeEventListener('canplay', onCanPlay);
      mediaElement.removeEventListener('error', onError);
      if (timer !== null) clearDelay(timer);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const maybeFinish = () => {
      if (sourceMatches() && targetMatches() && sawLoadedData && sawSeeked) finish();
    };
    function onLoadedData() { sawLoadedData = true; maybeFinish(); }
    function onSeeked() { sawSeeked = true; maybeFinish(); }
    function onCanPlay() { maybeFinish(); }
    // A failed media load has no new audio to expose, so restoring the gain is
    // safe and avoids turning a recoverable source error into permanent mute.
    function onError() { finish(); }
    function recheckReadyState() {
      if (settled) return;
      const hasCurrentData = mediaElement.readyState >= 2; // HAVE_CURRENT_DATA
      if (sourceMatches() && targetMatches() && !mediaElement.seeking && hasCurrentData) {
        finish();
        return;
      }
      timer = delay(recheckReadyState, recheckMs);
    }

    mediaElement.addEventListener('loadeddata', onLoadedData);
    mediaElement.addEventListener('seeked', onSeeked);
    mediaElement.addEventListener('canplay', onCanPlay);
    mediaElement.addEventListener('error', onError);
    timer = delay(recheckReadyState, recheckMs);
  });
}

// Web preview has one media element, so an actual two-source acrossfade is not
// possible. Approximate it inside the declared duration: fade out over its first
// half, switch at the boundary, then fade in over its second half.
export function transitionApproximationGain(time, boundaries) {
  for (const boundary of boundaries) {
    const duration = Number(boundary?.duration);
    const at = Number(boundary?.at);
    if (!(duration > 0) || !Number.isFinite(at)) continue;
    const half = duration / 2;
    const start = at - half;
    const end = at + half;
    if (time < start || time > end) continue;
    if (time <= at) return Math.max(0, Math.min(1, (at - time) / half));
    return Math.max(0, Math.min(1, (time - at) / half));
  }
  return 1;
}
