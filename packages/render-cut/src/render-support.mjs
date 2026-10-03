import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

import { ExecutionError } from "./errors.mjs";
import { enumerateDeclaredRenderInputs } from "./render-inputs.mjs";

const packageRequire = createRequire(import.meta.url);
const { projectLegacyAudioView } = packageRequire("../../edit-store/lib/index.js");

export async function additionalBgmInputs({ projectRoot, edit, editText, internalEdit, env }) {
  const bgms = projectLegacyAudioView(internalEdit).bgms ?? [];
  const extra = [];
  for (const [index, bgm] of bgms.slice(1).entries()) {
    const single = await enumerateDeclaredRenderInputs({
      projectRoot,
      edit: { ...edit, cuts: [], sources: [], overlays: [], layers: [], audio: { bgm } },
      editText,
      internalEdit: null,
      env,
    });
    const input = single.find(value => value.role === "audio:bgm");
    if (input) extra.push({ ...input, role: `audio:bgm:${index + 1}` });
  }
  return extra;
}

export function addWarning(state, warning) {
  state.warnings ??= [];
  if (!state.warnings.includes(warning)) state.warnings.push(warning);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

export async function sha256PngDirectory(directory) {
  const frames = (await readdir(directory))
    .filter((name) => /^frame-\d{5}\.png$/u.test(name))
    .sort();
  if (frames.length === 0) throw new ExecutionError("PNG sequence contains no frames");
  const digests = await Promise.all([
    sha256File(join(directory, frames[0])),
    sha256File(join(directory, frames.at(-1))),
    sha256File(join(directory, "audio.wav")),
  ]);
  return sha256(digests.join("\n"));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function relativeOrAbsolute(root, value) {
  const result = relative(root, value);
  return result.startsWith("..") ? value : result;
}
