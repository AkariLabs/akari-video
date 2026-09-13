const ROOT_KEYS = ["version", "kind", "status", "model", "inputs", "output", "cost", "job", "provenance", "result", "history"];
const STATUS_VALUES = ["planned", "generating", "done", "failed"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

export function validateGenerationMeta(meta) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!isObject(meta)) {
    fail("/ は object である必要があります");
    return { ok: false, errors };
  }

  rejectUnknown(meta, ROOT_KEYS, "/", fail);
  requireKeys(meta, ["version", "kind", "status", "model", "inputs", "output", "cost", "job", "provenance", "history"], "/", fail);

  if (meta.version !== 1) fail("/version は 1 である必要があります");
  validateEnum(meta.kind, ["still", "video", "frames"], "/kind", fail);
  validateEnum(meta.status, STATUS_VALUES, "/status", fail);
  validateModel(meta.model, "/model", fail);
  validateInputs(meta.inputs, "/inputs", fail);
  validateOutput(meta.output, "/output", fail);
  validateCost(meta.cost, "/cost", fail);
  validateJob(meta.job, "/job", fail);
  validateProvenance(meta.provenance, "/provenance", fail);
  if (hasOwn(meta, "result")) validateResult(meta.result, "/result", fail);
  validateHistory(meta.history, "/history", fail);

  if (meta.status === "generating" && isObject(meta.job) && !hasOwn(meta.job, "request_id")) {
    fail("/job に必須キー request_id がありません");
  }
  if (meta.status === "done" && !hasOwn(meta, "result")) {
    fail("/ に必須キー result がありません");
  }

  return { ok: errors.length === 0, errors };
}

function validateModel(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["id", "endpoint", "as_of"], path, fail);
  requireKeys(value, ["id", "as_of"], path, fail);
  if (hasOwn(value, "id")) validateNonEmptyString(value.id, `${path}/id`, fail);
  if (hasOwn(value, "endpoint")) validateNonEmptyString(value.endpoint, `${path}/endpoint`, fail);
  if (hasOwn(value, "as_of") && (typeof value.as_of !== "string" || !AS_OF_PATTERN.test(value.as_of))) {
    fail(`${path}/as_of の文字列形式が契約と一致しません`);
  }
}

function validateReference(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["path", "sha256", "source_id", "name", "role", "range_s"], path, fail);
  requireKeys(value, ["path", "sha256"], path, fail);
  if (hasOwn(value, "path")) validateNonEmptyString(value.path, `${path}/path`, fail);
  if (hasOwn(value, "sha256")) validateSha256(value.sha256, `${path}/sha256`, fail);
  for (const key of ["source_id", "name", "role"]) {
    if (hasOwn(value, key)) validateNullableString(value[key], `${path}/${key}`, fail);
  }
  if (hasOwn(value, "range_s") && value.range_s !== null) {
    if (!Array.isArray(value.range_s)) {
      fail(`${path}/range_s は array または null である必要があります`);
    } else {
      if (value.range_s.length !== 2) fail(`${path}/range_s は 2 要素である必要があります`);
      for (let index = 0; index < Math.min(value.range_s.length, 2); index += 1) {
        validateNumber(value.range_s[index], `${path}/range_s/${index}`, fail, { minimum: 0 });
      }
    }
  }
}

function validateNullableReference(value, path, fail) {
  if (value !== null) validateReference(value, path, fail);
}

function validateCamera(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["notation", "value", "from_annotation"], path, fail);
  requireKeys(value, ["notation", "value"], path, fail);
  if (hasOwn(value, "notation")) validateEnum(value.notation, ["bracket", "trajectory", "prose"], `${path}/notation`, fail);
  if (hasOwn(value, "value")) validateNonEmptyString(value.value, `${path}/value`, fail);
  if (hasOwn(value, "from_annotation")) validateNullableString(value.from_annotation, `${path}/from_annotation`, fail);
}

function validateInputs(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  const keys = ["prompt", "negative_prompt", "first_frame", "last_frame", "reference_images", "reference_videos", "reference_audios", "source_video", "mode", "camera", "seed", "extra"];
  rejectUnknown(value, keys, path, fail);
  requireKeys(value, ["prompt", "negative_prompt", "first_frame", "last_frame", "reference_images", "reference_videos", "reference_audios", "source_video", "camera", "seed", "extra"], path, fail);
  if (hasOwn(value, "prompt") && typeof value.prompt !== "string") fail(`${path}/prompt は string である必要があります`);
  if (hasOwn(value, "negative_prompt")) validateNullableString(value.negative_prompt, `${path}/negative_prompt`, fail);
  for (const key of ["first_frame", "last_frame", "source_video"]) {
    if (hasOwn(value, key)) validateNullableReference(value[key], `${path}/${key}`, fail);
  }
  for (const key of ["reference_images", "reference_videos", "reference_audios"]) {
    if (!hasOwn(value, key)) continue;
    if (!Array.isArray(value[key])) {
      fail(`${path}/${key} は array である必要があります`);
    } else {
      value[key].forEach((entry, index) => validateReference(entry, `${path}/${key}/${index}`, fail));
    }
  }
  if (hasOwn(value, "mode")) validateEnum(value.mode, ["edit", "extend", "motion", "frame-edit", null], `${path}/mode`, fail);
  if (hasOwn(value, "camera") && value.camera !== null) validateCamera(value.camera, `${path}/camera`, fail);
  if (hasOwn(value, "seed") && value.seed !== null && !Number.isInteger(value.seed)) fail(`${path}/seed は integer または null である必要があります`);
  if (hasOwn(value, "extra") && !isObject(value.extra)) fail(`${path}/extra は object である必要があります`);
}

function validateOutput(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["duration_s", "resolution", "aspect", "audio_out"], path, fail);
  requireKeys(value, ["duration_s"], path, fail);
  if (hasOwn(value, "duration_s")) validateNumber(value.duration_s, `${path}/duration_s`, fail, { exclusiveMinimum: 0 });
  for (const key of ["resolution", "aspect"]) {
    if (hasOwn(value, key)) validateNullableString(value[key], `${path}/${key}`, fail);
  }
  if (hasOwn(value, "audio_out") && value.audio_out !== null && typeof value.audio_out !== "boolean") {
    fail(`${path}/audio_out は boolean または null である必要があります`);
  }
}

function validateCost(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["estimate_usd", "actual_usd", "unit", "source"], path, fail);
  requireKeys(value, ["unit", "source"], path, fail);
  for (const key of ["estimate_usd", "actual_usd"]) {
    if (hasOwn(value, key) && value[key] !== null) validateNumber(value[key], `${path}/${key}`, fail, { minimum: 0 });
  }
  if (hasOwn(value, "unit")) validateNonEmptyString(value.unit, `${path}/unit`, fail);
  if (hasOwn(value, "source")) validateEnum(value.source, ["estimate", "provider"], `${path}/source`, fail);
}

function validateJob(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["provider", "request_id", "status_url", "response_url", "started_at", "stale_after_s"], path, fail);
  requireKeys(value, ["provider", "started_at", "stale_after_s"], path, fail);
  for (const key of ["provider", "request_id", "status_url", "response_url"]) {
    if (hasOwn(value, key)) validateNonEmptyString(value[key], `${path}/${key}`, fail);
  }
  if (hasOwn(value, "started_at")) validateDateTime(value.started_at, `${path}/started_at`, fail);
  if (hasOwn(value, "stale_after_s")) validateNumber(value.stale_after_s, `${path}/stale_after_s`, fail, { minimum: 0 });
}

function validateProvenance(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  rejectUnknown(value, ["created_at", "tool", "key_source"], path, fail);
  requireKeys(value, ["created_at", "tool"], path, fail);
  if (hasOwn(value, "created_at")) validateDateTime(value.created_at, `${path}/created_at`, fail);
  if (hasOwn(value, "tool")) validateNonEmptyString(value.tool, `${path}/tool`, fail);
  if (hasOwn(value, "key_source")) validateNullableString(value.key_source, `${path}/key_source`, fail);
}

function validateResult(value, path, fail) {
  if (!validateObject(value, path, fail)) return;
  const keys = ["path", "sha256", "bytes", "duration_s_actual", "width", "height", "fps", "has_audio", "expanded_prompt", "elapsed_s"];
  rejectUnknown(value, keys, path, fail);
  requireKeys(value, ["path", "sha256", "bytes", "duration_s_actual"], path, fail);
  if (hasOwn(value, "path")) validateNonEmptyString(value.path, `${path}/path`, fail);
  if (hasOwn(value, "sha256")) validateSha256(value.sha256, `${path}/sha256`, fail);
  if (hasOwn(value, "bytes")) validateInteger(value.bytes, `${path}/bytes`, fail, 0);
  if (hasOwn(value, "duration_s_actual")) validateNumber(value.duration_s_actual, `${path}/duration_s_actual`, fail, { minimum: 0 });
  for (const key of ["width", "height"]) {
    if (hasOwn(value, key)) validateInteger(value[key], `${path}/${key}`, fail, 1);
  }
  if (hasOwn(value, "fps")) validateNonEmptyString(value.fps, `${path}/fps`, fail);
  if (hasOwn(value, "has_audio") && typeof value.has_audio !== "boolean") fail(`${path}/has_audio は boolean である必要があります`);
  if (hasOwn(value, "expanded_prompt") && typeof value.expanded_prompt !== "string") fail(`${path}/expanded_prompt は string である必要があります`);
  if (hasOwn(value, "elapsed_s")) validateNumber(value.elapsed_s, `${path}/elapsed_s`, fail, { minimum: 0 });
}

function validateHistory(value, path, fail) {
  if (!Array.isArray(value)) {
    fail(`${path} は array である必要があります`);
    return;
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}/${index}`;
    if (!validateObject(entry, entryPath, fail)) return;
    rejectUnknown(entry, ["at", "status", "reason"], entryPath, fail);
    requireKeys(entry, ["at", "status", "reason"], entryPath, fail);
    if (hasOwn(entry, "at")) validateDateTime(entry.at, `${entryPath}/at`, fail);
    if (hasOwn(entry, "status")) validateEnum(entry.status, STATUS_VALUES, `${entryPath}/status`, fail);
    if (hasOwn(entry, "reason")) validateNullableString(entry.reason, `${entryPath}/reason`, fail);
  });
}

function validateObject(value, path, fail) {
  if (isObject(value)) return true;
  fail(`${path} は object である必要があります`);
  return false;
}

function rejectUnknown(value, allowed, path, fail) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path} に未定義キー ${key} があります`);
  }
}

function requireKeys(value, required, path, fail) {
  for (const key of required) {
    if (!hasOwn(value, key)) fail(`${path} に必須キー ${key} がありません`);
  }
}

function validateEnum(value, allowed, path, fail) {
  if (!allowed.includes(value)) fail(`${path} の値が許可された候補と一致しません`);
}

function validateNonEmptyString(value, path, fail) {
  if (typeof value !== "string") fail(`${path} は string である必要があります`);
  else if (value.length < 1 || !/\S/.test(value)) fail(`${path} の文字列形式が契約と一致しません`);
}

function validateNullableString(value, path, fail) {
  if (value !== null && typeof value !== "string") fail(`${path} は string または null である必要があります`);
}

function validateSha256(value, path, fail) {
  if (typeof value !== "string") fail(`${path} は string である必要があります`);
  else if (!SHA256_PATTERN.test(value)) fail(`${path} の文字列形式が契約と一致しません`);
}

function validateDateTime(value, path, fail) {
  if (typeof value !== "string") fail(`${path} は string である必要があります`);
  else if (!DATE_TIME_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) fail(`${path} は date-time 形式である必要があります`);
}

function validateNumber(value, path, fail, bounds = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} は number である必要があります`);
    return;
  }
  if (bounds.minimum !== undefined && value < bounds.minimum) fail(`${path} が契約を満たしません（minimum）`);
  if (bounds.exclusiveMinimum !== undefined && value <= bounds.exclusiveMinimum) fail(`${path} が契約を満たしません（exclusiveMinimum）`);
}

function validateInteger(value, path, fail, minimum) {
  if (!Number.isInteger(value)) {
    fail(`${path} は integer である必要があります`);
    return;
  }
  if (value < minimum) fail(`${path} が契約を満たしません（minimum）`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
