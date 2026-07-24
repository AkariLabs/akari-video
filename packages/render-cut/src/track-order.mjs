import { deriveTracks } from "../../edit-lint/src/derive-tracks.mjs";

export function resolveTrackOrder(edit) {
  return Array.isArray(edit?.timeline?.tracks) ? edit.timeline.tracks : deriveTracks(edit);
}

export function usesDefaultTrackOrder(edit) {
  const resolved = resolveTrackOrder(edit).map(trackKey);
  const derived = deriveTracks(edit).map(trackKey);
  return resolved.length === derived.length
    && resolved.every((value, index) => value === derived[index]);
}

function trackKey(track) {
  return `${track?.kind ?? ""}:${Number.isInteger(track?.ref) ? track.ref : ""}`;
}
