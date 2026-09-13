/**
 * @typedef {object} MediaRef
 * @property {string} path
 * @property {string} [sha256]
 * @property {string} [source_id]
 * @property {string} [name]
 * @property {string} [role]
 * @property {[number, number]} [range_s]
 */

/**
 * @typedef {object} GenInputs
 * @property {string} prompt
 * @property {string|null} negative_prompt
 * @property {MediaRef|null} first_frame
 * @property {MediaRef|null} last_frame
 * @property {MediaRef[]} reference_images
 * @property {MediaRef[]} reference_videos
 * @property {MediaRef[]} reference_audios
 * @property {MediaRef|null} source_video
 * @property {{notation: "bracket"|"trajectory"|"prose", value: unknown, from_annotation?: unknown}|null} camera
 * @property {number|null} seed
 * @property {object|null} extra
 */

/**
 * @typedef {object} GenOutput
 * @property {number|null} duration_s
 * @property {string|null} resolution
 * @property {string|null} aspect
 * @property {boolean|null} audio_out
 */

/** @typedef {(ref: MediaRef) => string} ResolveMedia */

export const SLOT_KEYS = Object.freeze([
  "prompt",
  "negative_prompt",
  "first_frame",
  "last_frame",
  "reference_images",
  "reference_videos",
  "reference_audios",
  "source_video",
  "camera",
]);

export const KNOB_KEYS = Object.freeze([
  "duration_s",
  "resolution",
  "aspect",
  "audio_out",
]);

export const AUX_KEYS = Object.freeze(["seed", "extra"]);
export const MAP_KEYS = Object.freeze([...SLOT_KEYS, ...AUX_KEYS, ...KNOB_KEYS]);

export function reject(slot, reason) {
  return { ok: false, rejected: [{ slot, reason }] };
}

export function rejectAll(rejected) {
  return { ok: false, rejected };
}

export function ok(endpoint, body) {
  return { ok: true, endpoint, body };
}

export function isEmptySlot(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

export function resolveRef(ref, resolveMedia, _slot) {
  if (!isRecord(ref) || typeof ref.path !== "string" || ref.path.trim().length === 0) {
    return null;
  }
  try {
    const resolved = resolveMedia(ref);
    return typeof resolved === "string" && resolved.trim().length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

export function composeCameraPrompt(prompt, camera, notation) {
  if (isEmptySlot(camera)) return prompt;
  if (!isRecord(camera) || typeof camera.value !== "string" || camera.value.trim().length === 0) {
    return null;
  }
  if (camera.notation === "trajectory") return null;

  const value = camera.value.trim();
  const promptText = isEmptySlot(prompt) ? "" : String(prompt);
  if (notation === "bracket") {
    const cameraText = value.startsWith("[") && value.endsWith("]") ? value : `[${value}]`;
    return promptText ? `${cameraText} ${promptText}` : cameraText;
  }
  if (notation === "prose") {
    const cameraText = value.replace(/[。.]+$/u, "");
    return promptText ? `${cameraText}. ${promptText}` : `${cameraText}.`;
  }
  return null;
}

export function applyMap({
  MAP,
  endpoint,
  inputs,
  output,
  resolveMedia,
  required = [],
  duration: _duration,
  camera: cameraSpec,
  build,
}) {
  const shapeErrors = [];
  if (!isRecord(inputs)) shapeErrors.push({ slot: "inputs", reason: "must be an object" });
  if (!isRecord(output)) shapeErrors.push({ slot: "output", reason: "must be an object" });
  if (shapeErrors.length > 0) return rejectAll(shapeErrors);

  const rejected = [];
  for (const key of Object.keys(inputs)) {
    if (!MAP_KEYS.includes(key)) rejected.push({ slot: key, reason: "unknown slot (not in MAP)" });
  }
  for (const key of Object.keys(output)) {
    if (!KNOB_KEYS.includes(key)) rejected.push({ slot: key, reason: "unknown slot (not in MAP)" });
  }

  const body = {};
  const cameraCell = MAP.camera;
  const cameraValue = inputs.camera;
  const cameraPrompt = isRecord(cameraCell)
      && cameraCell.into === "prompt"
      && !isEmptySlot(cameraValue)
    ? composeCameraPrompt(inputs.prompt, cameraValue, cameraCell.notation ?? cameraSpec?.notation)
    : undefined;
  for (const slot of MAP_KEYS) {
    const value = KNOB_KEYS.includes(slot) ? output[slot] : inputs[slot];
    const cell = MAP[slot];

    if (cell === "reject" || cell === "drop-if-empty") {
      if (!isEmptySlot(value)) {
        rejected.push({
          slot,
          reason: cell === "reject"
            ? "slot not supported by this model"
            : "no parameter on this model",
        });
      }
      continue;
    }

    if (isRecord(cell) && cell.into === "prompt") {
      if (isEmptySlot(value)) continue;
      if (cameraPrompt === null) {
        rejected.push({ slot, reason: "camera notation cannot be mapped to prompt" });
      }
      continue;
    }

    if (isRecord(cell) && Array.isArray(cell.allow)) {
      if (isEmptySlot(value)) continue;
      if (!isRecord(value)) {
        rejected.push({ slot, reason: "must be an object" });
        continue;
      }
      for (const key of Object.keys(value)) {
        if (!cell.allow.includes(key)) {
          rejected.push({ slot: `extra.${key}`, reason: "not in extra allow-list" });
        }
      }
      for (const key of cell.allow) {
        if (Object.hasOwn(value, key)) body[key] = value[key];
      }
      continue;
    }

    if (!isRecord(cell) || typeof cell.param !== "string") {
      if (!isEmptySlot(value)) rejected.push({ slot, reason: "slot not supported by this model" });
      continue;
    }

    if (cell.format === "string-int-or-auto") {
      const converted = convertValue(value, cell, resolveMedia, slot);
      if (converted.ok) body[cell.param] = converted.value;
      else rejected.push({ slot, reason: converted.reason });
      continue;
    }

    if (isEmptySlot(value)) {
      if (required.includes(slot)) rejected.push({ slot, reason: "required by this model" });
      if (slot === "prompt" && typeof cameraPrompt === "string") body[cell.param] = cameraPrompt;
      continue;
    }

    const converted = convertValue(value, cell, resolveMedia, slot);
    if (converted.ok) {
      body[cell.param] = slot === "prompt" && typeof cameraPrompt === "string"
        ? cameraPrompt
        : converted.value;
    }
    else rejected.push({ slot, reason: converted.reason });
  }

  if (rejected.length > 0) return rejectAll(rejected);
  const finalBody = typeof build === "function" ? build(body) : body;
  return ok(endpoint, finalBody);
}

function convertValue(value, cell, resolveMedia, slot) {
  switch (cell.format) {
    case "media-url": {
      const resolved = resolveRef(value, resolveMedia, slot);
      return resolved === null
        ? invalid("cannot resolve media reference")
        : valid(resolved);
    }
    case "text":
      return typeof value === "string" ? valid(value) : invalid("must be a string");
    case "boolean":
      return typeof value === "boolean" ? valid(value) : invalid("must be a boolean");
    case "integer":
      return convertInteger(value, cell, false);
    case "string-int":
      return convertInteger(value, cell, true);
    case "string-int-or-auto":
      if (value === null || value === undefined) return valid("auto");
      return convertInteger(value, cell, true);
    case "string-seconds":
      return cell.enum.includes(value)
        ? valid(`${value}s`)
        : invalid(`not in enum [${cell.enum.join(", ")}]`);
    case "enum":
      return cell.enum.includes(value)
        ? valid(value)
        : invalid(`not in enum [${cell.enum.join(", ")}]`);
    case "kling-elements":
      return convertKlingElements(value, resolveMedia, slot);
    case "integer-any":
      return Number.isInteger(value) ? valid(value) : invalid("must be an integer");
    default:
      return valid(value);
  }
}

function convertInteger(value, cell, stringify) {
  if (!Number.isInteger(value)) return invalid("must be an integer");
  if ((cell.min !== undefined && value < cell.min)
      || (cell.max !== undefined && value > cell.max)) {
    return invalid(`out of range (${cell.min}..${cell.max})`);
  }
  return valid(stringify ? String(value) : value);
}

function convertKlingElements(value, resolveMedia, slot) {
  if (!Array.isArray(value) || value.length === 0) return invalid("must be a non-empty array");
  const resolved = value.map((ref) => resolveRef(ref, resolveMedia, slot));
  if (resolved.some((item) => item === null)) return invalid("cannot resolve media reference");
  // v1 では配列全体を 1 element（正面 + 別角度）として扱う近似。
  return valid([{
    frontal_image_url: resolved[0],
    reference_image_urls: resolved.slice(1),
  }]);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valid(value) {
  return { ok: true, value };
}

function invalid(reason) {
  return { ok: false, reason };
}
