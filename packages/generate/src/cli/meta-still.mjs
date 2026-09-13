import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FALLBACK_AS_OF = "2026-09-12";
const CATALOG_PATH = fileURLToPath(new URL("../../../schemas/gen-models.json", import.meta.url));

export async function readCodexModelAsOf() {
  try {
    const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    const model = catalog.models?.find((entry) => entry.id === "codex:image");
    return typeof model?.as_of === "string" ? model.as_of : FALLBACK_AS_OF;
  } catch {
    return FALLBACK_AS_OF;
  }
}

export async function inspectPng(path) {
  const contents = await readFile(path);
  if (contents.length < 24 || contents.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("生成物が PNG ではありません");
  }
  const info = await stat(path);
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: info.size,
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

function baseMeta({ status, prompt, duration_s, at, asOf }) {
  return {
    version: 1,
    kind: "still",
    status,
    model: { id: "codex:image", as_of: asOf },
    inputs: {
      prompt,
      negative_prompt: null,
      first_frame: null,
      last_frame: null,
      reference_images: [],
      reference_videos: [],
      reference_audios: [],
      source_video: null,
      mode: null,
      camera: null,
      seed: null,
      extra: {},
    },
    output: { duration_s, resolution: null, aspect: null, audio_out: null },
    cost: { estimate_usd: 0, actual_usd: null, unit: "usd_per_image", source: "estimate" },
    job: { provider: "codex", started_at: at, stale_after_s: 900 },
    provenance: { created_at: at, tool: "akari generate still", key_source: "login:codex" },
    history: [{ at, status, reason: null }],
  };
}

export function plannedStillMeta({ prompt, duration_s, at, asOf, width = 1920, height = 1080 }) {
  const meta = baseMeta({ status: "planned", prompt, duration_s, at, asOf });
  meta.output.resolution = `${width}x${height}`;
  return meta;
}

export function failedStillMeta({ prompt, duration_s, at, asOf, reason }) {
  const meta = baseMeta({ status: "failed", prompt, duration_s, at, asOf });
  meta.history[0].reason = reason;
  return meta;
}

export function doneStillMeta({ prompt, duration_s, at, asOf, path, image, elapsed_s }) {
  const meta = baseMeta({ status: "done", prompt, duration_s, at, asOf });
  meta.output.resolution = `${image.width}x${image.height}`;
  meta.result = {
    path,
    sha256: image.sha256,
    bytes: image.bytes,
    duration_s_actual: duration_s,
    width: image.width,
    height: image.height,
    ...(elapsed_s === undefined ? {} : { elapsed_s }),
  };
  return meta;
}
