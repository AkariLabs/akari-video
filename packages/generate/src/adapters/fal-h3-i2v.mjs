import { applyMap } from "./request-shape.mjs";

export const MAP = Object.freeze({
  prompt: { param: "prompt", format: "text" },
  negative_prompt: "drop-if-empty",
  first_frame: { param: "image_url", format: "media-url" },
  last_frame: { param: "end_image_url", format: "media-url" },
  reference_images: "reject",
  reference_videos: "reject",
  reference_audios: "reject",
  source_video: "reject",
  camera: { into: "prompt", notation: "bracket" },
  seed: { param: "seed", format: "integer-any" },
  extra: { allow: ["prompt_expansion_mode"] },
  duration_s: { param: "duration", format: "integer", min: 5, max: 15 },
  resolution: { param: "resolution", format: "enum", enum: ["480P", "768P", "2K", "4K"] },
  aspect: "reject",
  audio_out: "reject",
});

const endpoint = "minimax/h3/image-to-video";
const required = Object.freeze(["prompt"]);

export const adapter = Object.freeze({
  id: "fal:h3-i2v",
  endpoint,
  MAP,
  required,
  map(inputs, output, { resolveMedia }) {
    return applyMap({ MAP, endpoint, inputs, output, resolveMedia, required });
  },
});
