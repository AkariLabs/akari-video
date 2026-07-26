#!/usr/bin/env node

// captions.json v0 のレコード、語タイミング、テキストスタイルを依存ゼロで検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CAPTION_ID = /^c-\d{4}$/;
const LEGACY_CAPTION_ID = /^caption-[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CAPTION_STYLES = new Set(["karaoke", "pop", "reveal"]);
const CAPTION_ZONES = new Set([
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
]);
const CAPTION_FIELDS = new Set([
  "id",
  "start",
  "end",
  "text",
  "speaker",
  "sourceRef",
  "edited",
  "src",
  "words",
  "style",
  "display_text",
  "text_style",
]);
const REQUIRED_CAPTION_FIELDS = ["id", "start", "end", "text", "speaker", "sourceRef", "edited"];
const usage = "使い方: node packages/schemas/bin/validate-captions.mjs <captions.json>";
const captionsArgument = process.argv[2];

if (!captionsArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (captionsArgument === "--help" || captionsArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const captionsPath = path.resolve(captionsArgument);
const schemaPath = fileURLToPath(new URL("../captions.schema.json", import.meta.url));
const errors = [];

if (!isRegularFile(captionsPath)) {
  fail(`captions.json が見つかりません: ${captionsPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`captions.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:captions:v0") {
  fail("captions.schema.json の $id が v0 契約と一致しません");
  finish();
}

let root;
try {
  root = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
} catch (error) {
  fail(`captions.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateCaptionsRoot(root);
finish();

function validateCaptionsRoot(value) {
  let captions;
  if (Array.isArray(value)) {
    captions = value;
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key !== "default_text_style" && key !== "captions") {
        fail(`captions.json のルートに未知のキーがあります: ${key}`);
      }
    }
    if (hasOwn(value, "default_text_style")) {
      validateTextStyle(value.default_text_style, "default_text_style");
    }
    if (!hasOwn(value, "captions")) {
      fail("captions.json の object ルートでは captions が必須です");
      return;
    }
    if (!Array.isArray(value.captions)) {
      fail("captions は配列である必要があります");
      return;
    }
    captions = value.captions;
  } else {
    fail("captions.json のルートは配列または object である必要があります");
    return;
  }
  validateCaptionsArray(captions);
}

function validateCaptionsArray(captions) {
  const ids = new Set();
  captions.forEach((caption, index) => {
    const label = `captions[${index}]`;
    if (!isPlainObject(caption)) {
      fail(`${label} は object である必要があります`);
      return;
    }
    for (const field of REQUIRED_CAPTION_FIELDS) {
      if (!hasOwn(caption, field)) fail(`${label}.${field} は必須です`);
    }
    for (const key of Object.keys(caption)) {
      if (!CAPTION_FIELDS.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
    }
    if (
      typeof caption.id !== "string"
      || (!CAPTION_ID.test(caption.id) && !LEGACY_CAPTION_ID.test(caption.id))
    ) {
      fail(`${label}.id は c- に続く 4 桁の数字である必要があります`);
    } else if (ids.has(caption.id)) {
      fail(`captions[].id が重複しています: ${caption.id}`);
    } else {
      ids.add(caption.id);
    }
    const startValid = isFiniteNumber(caption.start) && caption.start >= 0;
    const endValid = isFiniteNumber(caption.end) && caption.end >= 0;
    if (!startValid || !endValid || caption.end <= caption.start) {
      fail(`${label} は 0 <= start < end を満たす必要があります`);
    }
    if (!isNonEmptyString(caption.text)) {
      fail(`${label}.text は空でない文字列である必要があります`);
    }
    if (caption.speaker !== null && typeof caption.speaker !== "string") {
      fail(`${label}.speaker は文字列または null である必要があります`);
    }
    validateSourceRef(caption.sourceRef, `${label}.sourceRef`);
    if (typeof caption.edited !== "boolean") {
      fail(`${label}.edited は boolean である必要があります`);
    }
    if (hasOwn(caption, "src") && !isNonEmptyString(caption.src)) {
      fail(`${label}.src は空でない文字列である必要があります`);
    }
    if (hasOwn(caption, "words")) validateCaptionWords(caption.words, label);
    if (hasOwn(caption, "style") && !CAPTION_STYLES.has(caption.style)) {
      fail(`${label}.style は karaoke/pop/reveal のいずれかである必要があります`);
    }
    if (hasOwn(caption, "display_text") && typeof caption.display_text !== "string") {
      fail(`${label}.display_text は文字列である必要があります`);
    }
    if (hasOwn(caption, "text_style")) {
      validateTextStyle(caption.text_style, `${label}.text_style`);
    }
  });
}

function validateSourceRef(value, label) {
  if (value === null) return;
  if (!isPlainObject(value)) {
    fail(`${label} は null または object である必要があります`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "segment") fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (!Number.isInteger(value.segment) || value.segment < 0) {
    fail(`${label}.segment は 0 以上の整数である必要があります`);
  }
}

function validateCaptionWords(value, captionLabel) {
  if (!Array.isArray(value)) {
    fail(`${captionLabel}.words は配列である必要があります`);
    return;
  }
  value.forEach((word, index) => {
    const label = `${captionLabel}.words[${index}]`;
    if (!isPlainObject(word)) {
      fail(`${label} は object である必要があります`);
      return;
    }
    for (const field of ["start", "end", "text"]) {
      if (!hasOwn(word, field)) fail(`${label}.${field} は必須です`);
    }
    for (const key of Object.keys(word)) {
      if (!["start", "end", "text"].includes(key)) fail(`${label} に未知のキーがあります: ${key}`);
    }
    const startValid = isFiniteNumber(word.start) && word.start >= 0;
    const endValid = isFiniteNumber(word.end) && word.end >= 0;
    if (!startValid || !endValid || word.end < word.start) {
      fail(`${label} は 0 <= start <= end を満たす必要があります`);
    }
    if (!isNonEmptyString(word.text)) {
      fail(`${label}.text は空でない文字列である必要があります`);
    }
  });
}

function validateTextStyle(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["color", "size_px", "stroke", "background", "zone"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "color")) validateHexColor(value.color, `${label}.color`);
  if (hasOwn(value, "size_px") && (!isFiniteNumber(value.size_px) || value.size_px <= 0)) {
    fail(`${label}.size_px は 0 より大きい有限数である必要があります`);
  }
  if (hasOwn(value, "stroke")) validateTextStrokeStyle(value.stroke, `${label}.stroke`);
  if (hasOwn(value, "background")) {
    validateTextBackgroundStyle(value.background, `${label}.background`);
  }
  if (hasOwn(value, "zone") && !CAPTION_ZONES.has(value.zone)) {
    fail(`${label}.zone は定義済みの 9 値のいずれかである必要があります`);
  }
}

function validateTextStrokeStyle(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "color" && key !== "width_px") fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "color")) validateHexColor(value.color, `${label}.color`);
  if (hasOwn(value, "width_px") && (!isFiniteNumber(value.width_px) || value.width_px < 0)) {
    fail(`${label}.width_px は 0 以上の有限数である必要があります`);
  }
}

function validateTextBackgroundStyle(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["color", "opacity", "radius_px", "mode"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "color")) validateHexColor(value.color, `${label}.color`);
  if (
    hasOwn(value, "opacity")
    && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)
  ) {
    fail(`${label}.opacity は 0 から 1 の範囲の有限数である必要があります`);
  }
  if (hasOwn(value, "radius_px") && (!isFiniteNumber(value.radius_px) || value.radius_px < 0)) {
    fail(`${label}.radius_px は 0 以上の有限数である必要があります`);
  }
  if (hasOwn(value, "mode") && value.mode !== "per-line" && value.mode !== "block") {
    fail(`${label}.mode は per-line または block である必要があります`);
  }
}

function validateHexColor(value, label) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    fail(`${label} は #RGB/#RRGGBB/#RRGGBBAA 形式の hex カラーである必要があります`);
  }
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function finish() {
  if (errors.length > 0) {
    console.error(`NG: ${captionsPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${captionsPath}`);
  process.exit(0);
}
