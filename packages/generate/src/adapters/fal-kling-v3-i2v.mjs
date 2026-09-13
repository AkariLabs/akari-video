import { applyMap } from "./request-shape.mjs";

export const MAP = Object.freeze({
  prompt: { param: "prompt", format: "text" },
  negative_prompt: { param: "negative_prompt", format: "text" },
  first_frame: { param: "start_image_url", format: "media-url" },
  last_frame: { param: "end_image_url", format: "media-url" },
  reference_images: { param: "elements", format: "kling-elements" },
  reference_videos: "reject",
  reference_audios: "reject",
  source_video: "reject",
  camera: { into: "prompt", notation: "prose" },
  seed: "reject",
  extra: { allow: ["cfg_scale", "shot_type"] },
  duration_s: { param: "duration", format: "string-int", min: 3, max: 15 },
  resolution: "reject",
  aspect: "reject",
  audio_out: { param: "generate_audio", format: "boolean" },
});

const required = Object.freeze(["first_frame"]);

function makeAdapter(id, endpoint) {
  return Object.freeze({
    id,
    endpoint,
    MAP,
    required,
    map(inputs, output, { resolveMedia }) {
      return applyMap({ MAP, endpoint, inputs, output, resolveMedia, required });
    },
  });
}

export const adapter = makeAdapter(
  "fal:kling-v3-standard-i2v",
  "fal-ai/kling-video/v3/standard/image-to-video",
);

export const proAdapter = makeAdapter(
  "fal:kling-v3-pro-i2v",
  "fal-ai/kling-video/v3/pro/image-to-video",
);
