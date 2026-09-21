import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { MAX_INLINE_BYTES } from "../cli/media-ref.mjs";
import { applyMap, reject, rejectAll } from "./request-shape.mjs";

const REFERENCE_LABELS = Object.freeze({
  reference_images: "画像",
  reference_videos: "動画",
  reference_audios: "音声",
});

function inlineBytes(uri) {
  if (typeof uri !== "string" || !/^data:[^;,]+;base64,/u.test(uri)) {
    throw new Error("参照は base64 data URI で解決する必要があります");
  }
  const encoded = uri.slice(uri.indexOf(",") + 1);
  if (Buffer.byteLength(encoded, "base64") > MAX_INLINE_BYTES) {
    throw new Error("20 MB 超の参照は未対応（fal storage は後日）");
  }
  return Buffer.from(encoded, "base64");
}

function resolveReference(ref, slot, resolveMedia) {
  if (!ref || typeof ref.path !== "string" || !ref.path.trim()) {
    throw new Error("参照には path が必要です");
  }
  const range = slot === "reference_audios" ? ref.range_s : null;
  if (range != null && (!Array.isArray(range) || range.length !== 2
      || !range.every(Number.isFinite) || range[0] < 0 || range[1] <= range[0])) {
    throw new Error("range_s は [in, out]（0 <= in < out）で指定してください");
  }
  const uri = resolveMedia(ref);
  const bytes = inlineBytes(uri);
  if (range == null) return uri;

  const temporary = mkdtempSync(path.join(os.tmpdir(), "akari-gen-reference-audio-"));
  try {
    const source = path.join(temporary, "source");
    const destination = path.join(temporary, "clip.wav");
    writeFileSync(source, bytes);
    execFileSync(resolveFfmpeg(), [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-protocol_whitelist", "file,pipe", "-i", source,
      "-ss", String(range[0]), "-t", String(range[1] - range[0]),
      "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", destination,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    if (statSync(destination).size > MAX_INLINE_BYTES) {
      throw new Error("20 MB 超の参照は未対応（fal storage は後日）");
    }
    return `data:audio/wav;base64,${readFileSync(destination).toString("base64")}`;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// Scalar cells use the existing mapper. Reference arrays are validated before any
// media is resolved, then mapped in order without changing the caller's inputs.
export function applyReferenceMap({ MAP, endpoint, inputs, output, resolveMedia, required, maxTotal }) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return reject("inputs", "must be an object");
  }
  const scalarInputs = { ...inputs };
  const scalarMap = { ...MAP };
  const lists = {};
  const rejected = [];
  for (const slot of Object.keys(REFERENCE_LABELS)) {
    const refs = inputs[slot] ?? [];
    lists[slot] = refs;
    scalarInputs[slot] = [];
    scalarMap[slot] = "reject";
    if (!Array.isArray(refs)) rejected.push({ slot, reason: "must be an array" });
    else if (refs.length > MAP[slot].max) rejected.push({ slot, reason: `at most ${MAP[slot].max} references` });
  }
  const result = applyMap({ MAP: scalarMap, endpoint, inputs: scalarInputs, output, resolveMedia, required });
  if (!result.ok) rejected.push(...result.rejected);
  if (rejected.length) return rejectAll(rejected);
  const count = Object.values(lists).reduce((sum, refs) => sum + refs.length, 0);
  if (count > maxTotal) return reject("reference_images", `at most ${maxTotal} reference files in total`);

  // Check Japanese labels and only @-prefixed provider labels, including camera
  // prose. Bare English such as "Image 1 of 3" is not a reference assertion.
  for (const [slot, label] of Object.entries(REFERENCE_LABELS)) {
    const tag = MAP[slot].tag + (MAP[slot].tag_joiner ?? "");
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const labels = tag.startsWith("@") ? `@${label}|${escapedTag}` : `@${label}`;
    const pattern = new RegExp(`(?:${labels})([+-]?\\d+(?:\\.\\d+)?)`, "gu");
    result.body.prompt = result.body.prompt.replace(pattern, (match, number) => {
      const index = Number(number);
      if (!Number.isSafeInteger(index) || index <= 0 || index > lists[slot].length) {
        rejected.push({ slot: "prompt", reason: `${match}: ${slot} の参照番号は 1..${lists[slot].length} です` });
      }
      return `${tag}${index}`;
    });
  }
  if (rejected.length) return rejectAll(rejected);
  for (const slot of Object.keys(REFERENCE_LABELS)) {
    if (!lists[slot].length) continue;
    try {
      result.body[MAP[slot].param] = lists[slot].map((ref) => resolveReference(ref, slot, resolveMedia));
    } catch (error) {
      return reject(slot, error.message);
    }
  }
  return result;
}
