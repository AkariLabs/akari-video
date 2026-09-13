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
  camera: { into: "prompt", notation: "prose" },
  seed: "reject",
  extra: { allow: ["bitrate_mode"] },
  duration_s: { param: "duration", format: "string-int-or-auto", min: 4, max: 15 },
  resolution: { param: "resolution", format: "enum", enum: ["480p", "720p", "1080p", "4k"] },
  aspect: { param: "aspect_ratio", format: "enum", enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
  audio_out: { param: "generate_audio", format: "boolean" },
});

const endpoint = "bytedance/seedance-2.0/image-to-video";
const required = Object.freeze(["prompt", "first_frame"]);

export const adapter = Object.freeze({
  id: "fal:seedance-2.0-i2v",
  endpoint,
  MAP,
  required,
  map(inputs, output, { resolveMedia }) {
    return applyMap({ MAP, endpoint, inputs, output, resolveMedia, required });
  },
});
