import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  deriveVisualTrackOrder,
  resolveVisualTrackZ,
} = require("../../edit-store/lib/index.js");

export function resolveTrackOrder(edit, { hasCaptions = false } = {}) {
  return Array.isArray(edit?.timeline?.tracks)
    ? edit.timeline.tracks
    : deriveVisualTrackOrder({ ...edit, hasCaptions });
}

export function usesDefaultTrackOrder(edit, { hasCaptions = false } = {}) {
  const resolved = resolveTrackOrder(edit, { hasCaptions }).map(trackKey);
  const derived = deriveVisualTrackOrder({ ...edit, hasCaptions }).map(trackKey);
  return resolved.length === derived.length
    && resolved.every((value, index) => value === derived[index]);
}

export { resolveVisualTrackZ };

function trackKey(track) {
  return `${track?.kind ?? ""}:${Number.isInteger(track?.ref) ? track.ref : ""}`;
}
