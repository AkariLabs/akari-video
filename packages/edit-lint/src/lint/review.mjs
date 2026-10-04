import { EPSILON, addFinding, addSkipped, isFiniteNumber, isNonEmptyString, isRecord, isRegularFile, relativePath, resolveReferenceBinding, unfetchedLibraryNote } from "./shared.mjs";

const REVIEW_TARGET_KINDS = new Set(["instant", "range", "region", "asset", "insert"]);

const REVIEW_INPUTS = new Set(["typed", "voice", "session"]);

const REVIEW_STATUSES = new Set(["open", "addressed", "resolved"]);

const REVIEW_STROKE_SPACES = new Set(["content-rect", "image-rect", "canvas-rect"]);

const REVIEW_DOC_TARGET_PATTERN = /^doc:(.+)#(.+)$/;

const REVIEW_IMAGE_TARGET_PATTERN = /^image:(.+)$/;

const REVIEW_CANVAS_TARGET_PATTERN = /^canvas:(c-\d{4,})$/;

const REVIEW_REQUIRED_FIELDS = ["id", "createdAt", "sourceT", "text", "input", "status"];

// review.schema.json の annotation.properties と同じ集合を保つ（issue #73: compile-review-session が
// 正式に書く strokeRefs / transcript / session がここに無く、正規の生成物に warning が出ていた）。
const REVIEW_OPTIONAL_FIELDS = [
  "src",
  "sourceRange",
  "timelineT",
  "target",
  "targetKind",
  "region",
  "strokes",
  "strokeRefs",
  "refs",
  "insertPosition",
  "intent",
  "audio",
  "transcript",
  "session",
  "poses",
  "response",
];

export async function validateReview(review, edit, findings, paths, skipped) {
  const reviewRelative = relativePath(paths.projectRoot, paths.reviewPath);
  if (!isRecord(review)) {
    reviewFinding(findings, "review.schema", "review.json root must be an object", reviewRelative);
    return;
  }
  if (Number.isInteger(review.version) && review.version > 0) {
    reviewFinding(
      findings,
      "review.version",
      `review.json version ${review.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
      `${reviewRelative}#version`,
    );
    addSkipped(
      skipped,
      "review.validation",
      "a newer review.json version was detected; no format assumptions were made",
    );
    return;
  }
  if (review.version !== 0) {
    reviewFinding(findings, "review.schema", "version must be 0", `${reviewRelative}#version`);
  }
  if (!Array.isArray(review.annotations)) {
    reviewFinding(findings, "review.schema", "annotations must be an array", reviewRelative);
    return;
  }

  const sourceIds = new Set(
    Array.isArray(edit?.sources)
      ? edit.sources.filter(isRecord).map((source) => source.id).filter(isNonEmptyString)
      : [],
  );
  const ids = new Set();

  for (const [index, annotation] of review.annotations.entries()) {
    const itemPath = `review.json#annotations[${index}]`;
    if (!isRecord(annotation)) {
      reviewFinding(findings, "review.schema", "annotation must be an object", itemPath);
      continue;
    }
    for (const field of REVIEW_REQUIRED_FIELDS) {
      if (!Object.hasOwn(annotation, field)) {
        reviewFinding(findings, "review.schema", `${field} is required`, itemPath);
      }
    }
    for (const field of Object.keys(annotation)) {
      if (![...REVIEW_REQUIRED_FIELDS, ...REVIEW_OPTIONAL_FIELDS].includes(field)) {
        // 寛容リーダー原則（contract-2026-07-17 原則 1）に従い未知フィールドは warning に留める
        reviewFinding(
          findings,
          "review.schema",
          `${field} is not defined by review v0`,
          itemPath,
          "warning",
        );
      }
    }
    if (isNonEmptyString(annotation.id)) {
      if (ids.has(annotation.id)) {
        reviewFinding(findings, "review.schema", `duplicate id: ${annotation.id}`, itemPath);
      } else {
        ids.add(annotation.id);
      }
    } else if (Object.hasOwn(annotation, "id")) {
      reviewFinding(findings, "review.schema", "id must be a non-empty string", itemPath);
    }
    if (Object.hasOwn(annotation, "createdAt") && typeof annotation.createdAt !== "string") {
      reviewFinding(findings, "review.schema", "createdAt must be a string", itemPath);
    }
    const nonVideoTarget = isNonVideoReviewTarget(annotation.target);
    if (Object.hasOwn(annotation, "sourceT") && annotation.sourceT === null && !nonVideoTarget) {
      reviewFinding(
        findings,
        "review.schema",
        "sourceT may be null only for doc:, image:, or canvas: targets",
        itemPath,
      );
    } else if (
      Object.hasOwn(annotation, "sourceT") &&
      annotation.sourceT !== null &&
      (!isFiniteNumber(annotation.sourceT) || annotation.sourceT < 0)
    ) {
      reviewFinding(findings, "review.schema", "sourceT must be null or a non-negative finite number (source seconds)", itemPath);
    }
    validateReviewTarget(annotation.target, findings, itemPath);
    if (Object.hasOwn(annotation, "text") && typeof annotation.text !== "string") {
      reviewFinding(findings, "review.schema", "text must be a string", itemPath);
    }
    if (Object.hasOwn(annotation, "input") && !REVIEW_INPUTS.has(annotation.input)) {
      reviewFinding(findings, "review.schema", "input must be typed / voice / session", itemPath);
    }
    if (Object.hasOwn(annotation, "status") && !REVIEW_STATUSES.has(annotation.status)) {
      reviewFinding(findings, "review.schema", "status must be open / addressed / resolved", itemPath);
    }
    validateReviewResponse(annotation.response, findings, itemPath);
    if (annotation.sourceRange !== undefined && annotation.sourceRange !== null) {
      const range = annotation.sourceRange;
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !isFiniteNumber(range[0]) ||
        !isFiniteNumber(range[1]) ||
        range[0] < 0 ||
        range[1] <= range[0]
      ) {
        reviewFinding(
          findings,
          "review.schema",
          "sourceRange must be null or satisfy 0 <= start < end",
          itemPath,
        );
      }
    }
    if (annotation.timelineT !== undefined && annotation.timelineT !== null) {
      reviewFinding(
        findings,
        "review.timeline-t",
        "timelineT is deprecated; project timeline positions from cuts[] instead",
        itemPath,
        "warning",
      );
    }
    if (Object.hasOwn(annotation, "src") && annotation.src !== null) {
      if (!isNonEmptyString(annotation.src)) {
        reviewFinding(findings, "review.schema", "src must be null or a non-empty string", itemPath);
      } else if (!sourceIds.has(annotation.src)) {
        reviewFinding(
          findings,
          "review.src-reference",
          `src does not reference sources[].id: ${annotation.src}`,
          itemPath,
        );
      }
    }
    const targetKind =
      annotation.targetKind === undefined || annotation.targetKind === null
        ? null
        : annotation.targetKind;
    if (targetKind !== null && !REVIEW_TARGET_KINDS.has(targetKind)) {
      reviewFinding(
        findings,
        "review.schema",
        "targetKind must be one of instant / range / region / asset / insert or null",
        itemPath,
      );
    }
    const region = validateReviewRegion(annotation.region, findings, itemPath);
    const strokes = validateReviewStrokes(annotation.strokes, findings, itemPath);
    const refs = await validateReviewRefs(annotation.refs, edit, sourceIds, findings, paths, itemPath);
    const insertPosition =
      annotation.insertPosition === "before" || annotation.insertPosition === "after"
        ? annotation.insertPosition
        : null;
    if (
      annotation.insertPosition !== undefined &&
      annotation.insertPosition !== null &&
      insertPosition === null
    ) {
      reviewFinding(
        findings,
        "review.schema",
        "insertPosition must be before / after or null",
        itemPath,
      );
    }
    if (region && strokes) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "both region and strokes are set; region.box wins",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "range" && !Array.isArray(annotation.sourceRange)) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "targetKind range expects sourceRange",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "region" && !region && !strokes) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "targetKind region expects region or strokes",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "asset" && !refs) {
      reviewFinding(
        findings,
        "review.target-consistency",
        "targetKind asset expects refs",
        itemPath,
        "warning",
      );
    }
    if (targetKind === "insert") {
      if (!insertPosition) {
        reviewFinding(
          findings,
          "review.target-consistency",
          "targetKind insert expects insertPosition",
          itemPath,
          "warning",
        );
      }
      validateInsertAnchor(annotation, edit, findings, itemPath);
    }
  }
}

function validateReviewRegion(region, findings, itemPath) {
  if (region === undefined || region === null) return null;
  const box = isRecord(region) ? region.box : undefined;
  if (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1) &&
    box[2] > 0 &&
    box[3] > 0 &&
    box[0] + box[2] <= 1 &&
    box[1] + box[3] <= 1
  ) {
    return region;
  }
  reviewFinding(
    findings,
    "review.schema",
    "region must be null or { box: [x, y, w, h] } normalized to the source frame with x+w<=1 and y+h<=1",
    itemPath,
  );
  return null;
}

function validateReviewStrokes(strokes, findings, itemPath) {
  if (strokes === undefined || strokes === null) return null;
  const valid =
    Array.isArray(strokes) &&
    strokes.length > 0 &&
    strokes.every((stroke) => validateReviewStroke(stroke));
  if (valid) return strokes;
  reviewFinding(
    findings,
    "review.schema",
    "strokes must be null or object strokes with tool, space, and normalized points",
    itemPath,
  );
  return null;
}

function validateReviewStroke(stroke) {
  if (!isRecord(stroke) || stroke.tool !== "pen" || !REVIEW_STROKE_SPACES.has(stroke.space)) {
    return false;
  }
  if (
    !Array.isArray(stroke.points) ||
    stroke.points.length < 2 ||
    !stroke.points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1),
    )
  ) {
    return false;
  }
  if (stroke.space === "content-rect") {
    return isRecord(stroke.frame)
      && isFiniteNumber(stroke.frame.sourceT)
      && stroke.frame.sourceT >= 0
      && (!Object.hasOwn(stroke.frame, "cutIndex")
        || stroke.frame.cutIndex === null
        || (Number.isInteger(stroke.frame.cutIndex) && stroke.frame.cutIndex >= 0))
      && isNonEmptyString(stroke.sessionRef);
  }
  if (Object.hasOwn(stroke, "frame")) return false;
  if (stroke.space === "image-rect") {
    return !Object.hasOwn(stroke, "sessionRef") || isNonEmptyString(stroke.sessionRef);
  }
  return !Object.hasOwn(stroke, "canvasRef") || isNonEmptyString(stroke.canvasRef);
}

function isNonVideoReviewTarget(value) {
  return typeof value === "string"
    && (REVIEW_DOC_TARGET_PATTERN.test(value)
      || REVIEW_IMAGE_TARGET_PATTERN.test(value)
      || REVIEW_CANVAS_TARGET_PATTERN.test(value));
}

function validateReviewTarget(value, findings, itemPath) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value === "") {
    reviewFinding(findings, "review.schema", "target must be null or a non-empty string", itemPath);
  } else if (value.startsWith("doc:") && !REVIEW_DOC_TARGET_PATTERN.test(value)) {
    reviewFinding(findings, "review.schema", "target must use doc:<project-relative-path>#<block-id>", itemPath);
  } else if (value.startsWith("image:") && !REVIEW_IMAGE_TARGET_PATTERN.test(value)) {
    reviewFinding(findings, "review.schema", "target must use image:<project-relative-path>", itemPath);
  } else if (value.startsWith("canvas:") && !REVIEW_CANVAS_TARGET_PATTERN.test(value)) {
    reviewFinding(findings, "review.schema", "target must use canvas:<c-NNNN>", itemPath);
  }
}

function validateReviewResponse(value, findings, itemPath) {
  if (value === undefined || value === null) return;
  if (
    !isRecord(value)
    || typeof value.summary !== "string"
    || (value.action !== "edited" && value.action !== "declined")
    || typeof value.respondedAt !== "string"
  ) {
    reviewFinding(
      findings,
      "review.schema",
      "response must be null or { summary, action: edited|declined, respondedAt }",
      itemPath,
    );
  }
}

async function validateReviewRefs(refs, edit, sourceIds, findings, paths, itemPath) {
  if (refs === undefined || refs === null) return null;
  if (!Array.isArray(refs) || refs.length === 0) {
    reviewFinding(findings, "review.schema", "refs must be null or a non-empty array", itemPath);
    return null;
  }
  let valid = true;
  for (const [refIndex, ref] of refs.entries()) {
    const refPath = `${itemPath}.refs[${refIndex}]`;
    if (!isRecord(ref)) {
      reviewFinding(findings, "review.schema", "ref must be an object", refPath);
      valid = false;
      continue;
    }
    const hasSrc = Object.hasOwn(ref, "src");
    const hasPath = Object.hasOwn(ref, "path");
    if (hasSrc === hasPath) {
      reviewFinding(
        findings,
        "review.schema",
        "ref must contain exactly one of src / path",
        refPath,
      );
      valid = false;
      continue;
    }
    if (hasSrc) {
      if (!isNonEmptyString(ref.src)) {
        reviewFinding(findings, "review.schema", "ref src must be a non-empty string", refPath);
        valid = false;
      } else if (!sourceIds.has(ref.src)) {
        reviewFinding(
          findings,
          "review.refs-reference",
          `ref src does not reference sources[].id: ${ref.src}`,
          refPath,
        );
        valid = false;
      }
    } else if (!isNonEmptyString(ref.path)) {
      reviewFinding(findings, "review.schema", "ref path must be a non-empty string", refPath);
      valid = false;
    } else {
      const binding = resolveReferenceBinding(paths.editPath, ref.path, paths);
      const filePath = binding.path;
      if (!(await isRegularFile(filePath))) {
        // 注釈は助言データのため、参照先の実体欠落は warning に留める（契約 §4 劣化規約）
        reviewFinding(
          findings,
          "review.refs-file",
          `ref path does not resolve to a regular file: ${ref.path}${unfetchedLibraryNote(binding)}`,
          refPath,
          "warning",
        );
      }
    }
  }
  return valid ? refs : null;
}

function validateInsertAnchor(annotation, edit, findings, itemPath) {
  if (!Array.isArray(edit?.cuts) || !isFiniteNumber(annotation.sourceT)) return;
  const anchorSrc = isNonEmptyString(annotation.src) ? annotation.src : null;
  if (anchorSrc === null) {
    reviewFinding(
      findings,
      "review.insert-anchor-unresolved",
      "insert anchor cannot resolve without src on a multi-source edit.json",
      itemPath,
      "warning",
    );
    return;
  }
  let matches = 0;
  for (const cut of edit.cuts) {
    if (!isRecord(cut) || !isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) continue;
    if (cut.src !== anchorSrc) continue;
    if (annotation.sourceT >= cut.in - EPSILON && annotation.sourceT <= cut.out + EPSILON) {
      matches += 1;
    }
  }
  if (matches === 0) {
    reviewFinding(
      findings,
      "review.insert-anchor-unresolved",
      "insert anchor (src, sourceT) is not covered by any cut; automatic placement is unresolved",
      itemPath,
      "warning",
    );
  } else if (matches > 1) {
    reviewFinding(
      findings,
      "review.insert-anchor-ambiguous",
      "insert anchor matches multiple cuts; the first match in cuts[] array order wins",
      itemPath,
      "warning",
    );
  }
}

function reviewFinding(findings, check, message, path, severity = "error") {
  addFinding(findings, { severity, check, message, path });
}
