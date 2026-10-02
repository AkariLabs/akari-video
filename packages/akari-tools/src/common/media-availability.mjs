import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { summarize } from "./json-output.mjs";

export function checkMediaAvailability({ fallback = "not found", max = 1000, optionalError = false } = {}) {
  for (const [label, resolver] of [["ffmpeg", resolveFfmpeg], ["ffprobe", resolveFfprobe]]) {
    try {
      resolver();
    } catch (error) {
      return { available: false, reason: `${label}: ${summarize(optionalError ? error?.message : error.message, fallback, max)}` };
    }
  }
  return { available: true };
}
