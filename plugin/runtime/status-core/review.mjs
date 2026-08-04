const TARGET_KINDS = new Set(["instant", "range", "region", "asset", "insert"]);
const STATUSES = new Set(["open", "addressed", "resolved"]);
const INPUTS = new Set(["typed", "voice", "session"]);
const STROKE_SPACES = new Set(["content-rect", "image-rect", "canvas-rect"]);
const DOC_TARGET_PATTERN = /^doc:(.+)#(.+)$/u;
const IMAGE_TARGET_PATTERN = /^image:(.+)$/u;
const CANVAS_TARGET_PATTERN = /^canvas:(c-\d{4,})$/u;

// Dependency-free runtime twin of the canonical review validator. Status must be
// distributable in the npm package and copied plugin, so it cannot shell out to
// packages/schemas. The shared review fixtures keep this implementation in parity.
export function validateAndCountReview(value) {
  const counts = { open: 0, addressed: 0, resolved: 0, non_resolved: 0 };
  const problems = [];
  if (value === null || value === undefined) return { counts, problems };
  if (!isRecord(value)) return invalid("review.json root must be an object");
  if (value.version !== 0) return invalid(`review.json has unsupported version ${String(value.version)}`);
  if (!Array.isArray(value.annotations)) return invalid("review.json annotations must be an array");

  const ids = new Set();
  for (const [index, annotation] of value.annotations.entries()) {
    const local = [];
    validateAnnotation(annotation, index, ids, local);
    problems.push(...local);
    if (local.length === 0) counts[annotation.status] += 1;
  }
  counts.non_resolved = counts.open + counts.addressed;
  return { counts, problems };

  function invalid(problem) {
    problems.push(problem);
    return { counts, problems };
  }
}

function validateAnnotation(value, index, ids, problems) {
  const label = `review.json annotations[${index}]`;
  if (!isRecord(value)) {
    problems.push(`${label} must be an object`);
    return;
  }
  if (!isNonEmptyString(value.id)) problems.push(`${label}.id must be a non-empty string`);
  else if (ids.has(value.id)) problems.push(`review.json annotation id is duplicated: ${value.id}`);
  else ids.add(value.id);
  if (typeof value.createdAt !== "string") problems.push(`${label}.createdAt must be a string`);
  if (value.sourceT === null) {
    if (!isDocumentTarget(value.target)) problems.push(`${label}.sourceT may be null only for doc/image/canvas targets`);
  } else if (!isFiniteNumber(value.sourceT) || value.sourceT < 0) {
    problems.push(`${label}.sourceT must be a finite number >= 0`);
  }
  validateTarget(value.target, label, problems);
  if (typeof value.text !== "string") problems.push(`${label}.text must be a string`);
  if (!INPUTS.has(value.input)) problems.push(`${label}.input must be typed, voice, or session`);
  if (!STATUSES.has(value.status)) problems.push(`${label}.status must be open, addressed, or resolved`);
  validateSourceRange(value.sourceRange, label, problems);
  validateOptionalString(value.src, `${label}.src`, problems);
  validateOptionalString(value.audio, `${label}.audio`, problems);
  validateOptionalString(value.intent, `${label}.intent`, problems);
  if (hasOwn(value, "timelineT") && value.timelineT !== null && !isFiniteNumber(value.timelineT)) {
    problems.push(`${label}.timelineT must be null or a finite number`);
  }
  if (value.targetKind !== undefined && value.targetKind !== null && !TARGET_KINDS.has(value.targetKind)) {
    problems.push(`${label}.targetKind is invalid`);
  }
  validateRegion(value.region, label, problems);
  validateStrokes(value.strokes, label, problems);
  validateRefs(value.refs, label, problems);
  if (value.insertPosition !== undefined && value.insertPosition !== null
    && value.insertPosition !== "before" && value.insertPosition !== "after") {
    problems.push(`${label}.insertPosition must be before, after, or null`);
  }
  validateResponse(value.response, label, problems);
}

function isDocumentTarget(value) {
  return typeof value === "string"
    && (DOC_TARGET_PATTERN.test(value) || IMAGE_TARGET_PATTERN.test(value) || CANVAS_TARGET_PATTERN.test(value));
}

function validateTarget(value, label, problems) {
  if (value === undefined || value === null) return;
  if (!isNonEmptyString(value)) {
    problems.push(`${label}.target must be null or a non-empty string`);
    return;
  }
  if (value.startsWith("doc:") && !DOC_TARGET_PATTERN.test(value)) problems.push(`${label}.target has invalid doc syntax`);
  else if (value.startsWith("image:") && !IMAGE_TARGET_PATTERN.test(value)) problems.push(`${label}.target has invalid image syntax`);
  else if (value.startsWith("canvas:") && !CANVAS_TARGET_PATTERN.test(value)) problems.push(`${label}.target has invalid canvas syntax`);
}

function validateSourceRange(value, label, problems) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isFiniteNumber)) {
    problems.push(`${label}.sourceRange must be null or [start, end]`);
  } else if (value[0] < 0 || value[1] <= value[0]) {
    problems.push(`${label}.sourceRange must satisfy 0 <= start < end`);
  }
}

function validateRegion(value, label, problems) {
  if (value === undefined || value === null) return;
  if (!isRecord(value) || !Array.isArray(value.box) || value.box.length !== 4) {
    problems.push(`${label}.region must be null or {box:[x,y,w,h]}`);
    return;
  }
  const [x, y, width, height] = value.box;
  if (!value.box.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1)
    || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    problems.push(`${label}.region.box must be a valid normalized rectangle`);
  }
}

function validateStrokes(value, label, problems) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${label}.strokes must be null or a non-empty array`);
    return;
  }
  for (const [index, stroke] of value.entries()) validateStroke(stroke, `${label}.strokes[${index}]`, problems);
}

function validateStroke(stroke, label, problems) {
  if (!isRecord(stroke) || stroke.tool !== "pen") {
    problems.push(`${label} must be a pen stroke object`);
    return;
  }
  if (!STROKE_SPACES.has(stroke.space)) {
    problems.push(`${label}.space is invalid`);
    return;
  }
  if (!Array.isArray(stroke.points) || stroke.points.length < 2
    || stroke.points.some((point) => !Array.isArray(point) || point.length !== 2
      || !point.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1))) {
    problems.push(`${label}.points must contain at least two normalized points`);
  }
  if (stroke.space === "content-rect") {
    if (!isRecord(stroke.frame) || !isFiniteNumber(stroke.frame.sourceT) || stroke.frame.sourceT < 0
      || (hasOwn(stroke.frame ?? {}, "cutIndex") && stroke.frame.cutIndex !== null
        && (!Number.isInteger(stroke.frame.cutIndex) || stroke.frame.cutIndex < 0))) {
      problems.push(`${label}.frame is invalid for content-rect`);
    }
    if (!isNonEmptyString(stroke.sessionRef)) problems.push(`${label}.sessionRef is required for content-rect`);
  } else if (hasOwn(stroke, "frame")) {
    problems.push(`${label}.frame is forbidden for ${stroke.space}`);
  }
  if (stroke.space === "image-rect" && hasOwn(stroke, "sessionRef") && !isNonEmptyString(stroke.sessionRef)) {
    problems.push(`${label}.sessionRef must be non-empty when present`);
  }
  if (stroke.space === "canvas-rect" && hasOwn(stroke, "canvasRef") && !isNonEmptyString(stroke.canvasRef)) {
    problems.push(`${label}.canvasRef must be non-empty when present`);
  }
}

function validateRefs(value, label, problems) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${label}.refs must be null or a non-empty array`);
    return;
  }
  for (const [index, ref] of value.entries()) {
    const hasSrc = isRecord(ref) && hasOwn(ref, "src");
    const hasPath = isRecord(ref) && hasOwn(ref, "path");
    if (!isRecord(ref) || hasSrc === hasPath || !isNonEmptyString(hasSrc ? ref.src : ref.path)) {
      problems.push(`${label}.refs[${index}] must contain exactly one non-empty src or path`);
    }
  }
}

function validateResponse(value, label, problems) {
  if (value === undefined || value === null) return;
  if (!isRecord(value) || typeof value.summary !== "string"
    || (value.action !== "edited" && value.action !== "declined")
    || typeof value.respondedAt !== "string") {
    problems.push(`${label}.response is invalid`);
  }
}

function validateOptionalString(value, label, problems) {
  if (value !== undefined && value !== null && !isNonEmptyString(value)) problems.push(`${label} must be null or non-empty`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
