import { applyReferenceMap } from "./references.mjs";
import { reject } from "./request-shape.mjs";

// Evidence: test/fixtures/openapi/bytedance_seedance-2.0_reference-to-video.json
// (2026-09-22). Tags and per-modality limits also match the catalog row.
export const MAP = Object.freeze({
  prompt: { param: "prompt", format: "text" },
  negative_prompt: "drop-if-empty",
  first_frame: "reject",
  last_frame: "reject",
  reference_images: { param: "image_urls", format: "media-url-array", max: 9, tag: "@Image" },
  reference_videos: { param: "video_urls", format: "media-url-array", max: 3, tag: "@Video" },
  reference_audios: { param: "audio_urls", format: "media-url-array", max: 3, tag: "@Audio" },
  source_video: "reject",
  camera: { into: "prompt", notation: "prose" },
  seed: "reject",
  extra: { allow: ["bitrate_mode", "end_user_id"] },
  duration_s: { param: "duration", format: "string-int-or-auto", min: 4, max: 15 },
  resolution: { param: "resolution", format: "enum", enum: ["480p", "720p", "1080p", "4k"] },
  aspect: { param: "aspect_ratio", format: "enum", enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
  audio_out: { param: "generate_audio", format: "boolean" },
});

const endpoint = "bytedance/seedance-2.0/reference-to-video";
const required = Object.freeze(["prompt"]);

export const adapter = Object.freeze({
  id: "fal:seedance-2.0-ref",
  endpoint,
  MAP,
  required,
  map(inputs, output, { resolveMedia }) {
    if (inputs?.reference_audios?.length && !inputs?.reference_images?.length && !inputs?.reference_videos?.length) {
      return reject("reference_audios", "reference audio requires at least one reference image or video");
    }
    if (inputs?.extra?.bitrate_mode !== undefined && !["standard", "high"].includes(inputs.extra.bitrate_mode)) {
      return reject("extra.bitrate_mode", "must be standard or high");
    }
    if (inputs?.extra?.end_user_id != null && typeof inputs.extra.end_user_id !== "string") {
      return reject("extra.end_user_id", "must be a string or null");
    }
    return applyReferenceMap({ MAP, endpoint, inputs, output, resolveMedia, required, maxTotal: 12 });
  },
});
