import { applyReferenceMap } from "./references.mjs";
import { reject } from "./request-shape.mjs";

// Evidence: packages/schemas/fixtures/gen-models/openapi/fal_h3-ref.json
// (2026-09-22). Bare provider labels use a space before the reference number.
export const MAP = Object.freeze({
  prompt: { param: "prompt", format: "text" },
  negative_prompt: "drop-if-empty",
  first_frame: "reject",
  last_frame: "reject",
  reference_images: { param: "reference_image_urls", format: "media-url-array", max: 9, tag: "Image", tag_joiner: " " },
  reference_videos: { param: "reference_video_urls", format: "media-url-array", max: 3, tag: "Video", tag_joiner: " " },
  reference_audios: { param: "reference_audio_urls", format: "media-url-array", max: 3, tag: "Audio", tag_joiner: " " },
  source_video: "reject",
  camera: { into: "prompt", notation: "prose" },
  seed: { param: "seed", format: "integer-any" },
  extra: { allow: ["enable_safety_checker", "prompt_expansion_mode", "sync_mode"] },
  duration_s: { param: "duration", format: "integer", min: 5, max: 15 },
  resolution: { param: "resolution", format: "enum", enum: ["480P", "768P", "2K", "4K"] },
  aspect: { param: "aspect_ratio", format: "enum", enum: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
  audio_out: "reject",
});

const endpoint = "minimax/h3/reference-to-video";
const required = Object.freeze(["prompt"]);

export const adapter = Object.freeze({
  id: "fal:h3-ref",
  endpoint,
  MAP,
  required,
  map(inputs, output, { resolveMedia }) {
    for (const key of ["enable_safety_checker", "sync_mode"]) {
      if (inputs?.extra?.[key] !== undefined && typeof inputs.extra[key] !== "boolean") {
        return reject(`extra.${key}`, "must be a boolean");
      }
    }
    if (inputs?.extra?.prompt_expansion_mode != null && typeof inputs.extra.prompt_expansion_mode !== "string") {
      return reject("extra.prompt_expansion_mode", "must be a string or null");
    }
    return applyReferenceMap({ MAP, endpoint, inputs, output, resolveMedia, required, maxTotal: 12 });
  },
});
