// Compatibility entry point retained for render-cut and older preview consumers. New previews
// use the unified FLAC helper directly; the old name now selects the same recipe with zero pads.
export { buildAtempoChain } from './preview-audio-sidecar.mjs';

import { ensurePreviewAudioSidecar } from './preview-audio-sidecar.mjs';

export function ensureSpeechAtempo(options) {
  return ensurePreviewAudioSidecar({
    ...options,
    padBeforeSec: 0,
    padAfterSec: 0,
  });
}
