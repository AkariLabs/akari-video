import { applyMap } from "./request-shape.mjs";

export const MAP = Object.freeze({
  prompt: { param: "prompt", format: "text" },
  negative_prompt: { param: "negative_prompt", format: "text" },
  first_frame: { param: "first_frame_url", format: "media-url" },
  last_frame: { param: "last_frame_url", format: "media-url" },
  reference_images: "reject",
  reference_videos: "reject",
  reference_audios: "reject",
  source_video: "reject",
  camera: { into: "prompt", notation: "prose" },
  seed: { param: "seed", format: "integer-any" },
  extra: { allow: ["safety_tolerance", "auto_fix"] },
  duration_s: { param: "duration", format: "string-seconds", enum: [4, 6, 8] },
  resolution: { param: "resolution", format: "enum", enum: ["720p", "1080p", "4k"] },
  aspect: { param: "aspect_ratio", format: "enum", enum: ["auto", "16:9", "9:16"] },
  audio_out: { param: "generate_audio", format: "boolean" },
});

const endpoint = "fal-ai/veo3.1/first-last-frame-to-video";
const required = Object.freeze(["prompt", "first_frame", "last_frame"]);

export const adapter = Object.freeze({
  id: "fal:veo-3.1-flf",
  endpoint,
  MAP,
  required,
  map(inputs, output, { resolveMedia }) {
    return applyMap({ MAP, endpoint, inputs, output, resolveMedia, required });
  },
});
