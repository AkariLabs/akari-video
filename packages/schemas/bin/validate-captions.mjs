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
  "display_fragments",
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
      if (key !== "default_text_style" && key !== "display_policy" && key !== "captions") {
        fail(`captions.json のルートに未知のキーがあります: ${key}`);
      }
    }
    if (hasOwn(value, "default_text_style")) {
      validateTextStyle(value.default_text_style, "default_text_style");
    }
    if (hasOwn(value, "display_policy")) validateDisplayPolicy(value.display_policy);
    if (!hasOwn(value, "captions")) {
      fail("captions.json の object ルートでは captions が必須です");
      return;
    }
    if (!Array.isArray(value.captions)) {
      fail("captions は配列である必要があります");
      return;
    }
    captions = value.captions;
    if (hasOwn(value, "display_policy")) validateDisplayPolicyCaptions(captions, value.display_policy);
  } else {
    fail("captions.json のルートは配列または object である必要があります");
    return;
  }
  validateCaptionsArray(
    captions,
    isPlainObject(value) && hasOwn(value, "display_policy") ? value.default_text_style : null,
  );
}

function validateCaptionsArray(captions, optInDefaultTextStyle = null) {
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
    if (hasOwn(caption, "display_fragments") && !Array.isArray(caption.display_fragments)) {
      fail(`${label}.display_fragments は配列である必要があります`);
    }
    if (hasOwn(caption, "text_style")) {
      validateTextStyle(caption.text_style, `${label}.text_style`);
      if (isPlainObject(optInDefaultTextStyle) && isPlainObject(caption.text_style)) {
        const mergedHasZone = hasOwn(caption.text_style, "zone") || hasOwn(optInDefaultTextStyle, "zone");
        const mergedHasLayout = hasOwn(caption.text_style, "layout") || hasOwn(optInDefaultTextStyle, "layout");
        if (mergedHasZone && mergedHasLayout) {
          fail(`${label}.text_style は default_text_style とのマージ後に zone と layout を併用できません`);
        }
      }
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
  const allowedKeys = new Set(["color", "size_px", "font_weight", "line_height", "stroke", "background", "zone", "layout"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "color")) validateHexColor(value.color, `${label}.color`);
  if (hasOwn(value, "size_px") && (!isFiniteNumber(value.size_px) || value.size_px <= 0)) {
    fail(`${label}.size_px は 0 より大きい有限数である必要があります`);
  }
  if (hasOwn(value, "font_weight") && (!Number.isInteger(value.font_weight) || value.font_weight < 1 || value.font_weight > 1000)) {
    fail(`${label}.font_weight は 1 から 1000 の整数である必要があります`);
  }
  if (hasOwn(value, "line_height") && (!isFiniteNumber(value.line_height) || value.line_height <= 0)) {
    fail(`${label}.line_height は 0 より大きい有限数である必要があります`);
  }
  if (hasOwn(value, "stroke")) validateTextStrokeStyle(value.stroke, `${label}.stroke`);
  if (hasOwn(value, "background")) {
    validateTextBackgroundStyle(value.background, `${label}.background`);
  }
  if (hasOwn(value, "zone") && !CAPTION_ZONES.has(value.zone)) {
    fail(`${label}.zone は定義済みの 9 値のいずれかである必要があります`);
  }
  if (hasOwn(value, "layout")) validateReferencePixelLayout(value.layout, `${label}.layout`);
  if (hasOwn(value, "zone") && hasOwn(value, "layout")) {
    fail(`${label} では zone と layout を併用できません`);
  }
}

function validateTextStrokeStyle(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "method" && key !== "color" && key !== "width_px") fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "method") && value.method !== "webkit-outline") fail(`${label}.method は webkit-outline である必要があります`);
  if (hasOwn(value, "color")) validateHexColor(value.color, `${label}.color`);
  if (hasOwn(value, "width_px") && (!isFiniteNumber(value.width_px) || value.width_px < 0)) {
    fail(`${label}.width_px は 0 以上の有限数である必要があります`);
  }
}

function validateDisplayPolicy(value) {
  if (!isPlainObject(value)) {
    fail("display_policy は object である必要があります");
    return;
  }
  const allowed = new Set(["mode", "algorithm", "unit_metric", "max_line_units", "minimum_fragment_duration_seconds", "locale", "break_hints"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`display_policy に未知のキーがあります: ${key}`);
  if (value.mode !== "single_line_sequential") fail("display_policy.mode は single_line_sequential である必要があります");
  if (value.algorithm !== "a4-ja-two-fragment-v1") fail("display_policy.algorithm は a4-ja-two-fragment-v1 である必要があります");
  if (value.unit_metric !== "ascii-half-other-one-v1") fail("display_policy.unit_metric は ascii-half-other-one-v1 である必要があります");
  if (!isFiniteNumber(value.max_line_units) || value.max_line_units <= 0) fail("display_policy.max_line_units は正の有限数である必要があります");
  if (!isFiniteNumber(value.minimum_fragment_duration_seconds) || value.minimum_fragment_duration_seconds <= 0) fail("display_policy.minimum_fragment_duration_seconds は正の有限数である必要があります");
  if (!strictText(value.locale)) fail("display_policy.locale は NFC かつ前後空白のない文字列である必要があります");
  if (value.break_hints !== undefined) {
    if (!isPlainObject(value.break_hints)) return fail("display_policy.break_hints は object である必要があります");
    const keys = ["preferred_second_starts", "preferred_first_ends", "protected_terms"];
    for (const key of Object.keys(value.break_hints)) if (!keys.includes(key)) fail(`display_policy.break_hints に未知のキーがあります: ${key}`);
    for (const key of keys) {
      const list = value.break_hints[key];
      if (list !== undefined && (!Array.isArray(list) || list.some(item => !strictText(item)))) {
        fail(`display_policy.break_hints.${key} は NFC かつ前後空白のない文字列配列である必要があります`);
      }
    }
  }
}

function validateDisplayPolicyCaptions(captions, policy) {
  if (!isPlainObject(policy) || !isFiniteNumber(policy.max_line_units)) return;
  captions.forEach((caption, index) => {
    if (!isPlainObject(caption)) return;
    const text = caption.display_text ?? caption.text;
    if (!strictText(text)) fail(`captions[${index}] の display_text ?? text は NFC かつ前後空白なしである必要があります`);
    if (["karaoke", "pop", "reveal"].includes(caption.style)) fail(`captions[${index}].style は display_policy と併用できません`);
    if (caption.display_fragments !== undefined) {
      const fragments = caption.display_fragments;
      if (!Array.isArray(fragments) || fragments.length < 1 || fragments.length > 2 || fragments.some(item => !strictText(item))) {
        fail(`captions[${index}].display_fragments は 1〜2 件の NFC かつ前後空白のない文字列である必要があります`);
      } else {
        if (fragments.join("") !== text) fail(`captions[${index}].display_fragments は表示文字列を厳密に保存する必要があります`);
        if (fragments.some(item => measureUnits(item) > policy.max_line_units)) fail(`captions[${index}].display_fragments は max_line_units 以下である必要があります`);
      }
    }
  });
}

function validateReferencePixelLayout(value, label) {
  if (!isPlainObject(value)) return fail(`${label} は object である必要があります`);
  const keys = ["mode", "reference_width_px", "reference_height_px", "left_px", "width_px", "bottom_px", "text_align", "max_lines"];
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label} に未知のキーがあります: ${key}`);
  for (const key of keys) if (!hasOwn(value, key)) fail(`${label}.${key} は必須です`);
  if (value.mode !== "reference-pixel") fail(`${label}.mode は reference-pixel である必要があります`);
  if (!Number.isInteger(value.reference_width_px) || value.reference_width_px <= 0 || !Number.isInteger(value.reference_height_px) || value.reference_height_px <= 0) fail(`${label} の reference dimensions は正整数である必要があります`);
  if (!isFiniteNumber(value.left_px) || value.left_px < 0 || !isFiniteNumber(value.width_px) || value.width_px <= 0 || value.left_px + value.width_px > value.reference_width_px) fail(`${label} の left_px/width_px は参照幅内である必要があります`);
  if (!isFiniteNumber(value.bottom_px) || value.bottom_px < 0) fail(`${label}.bottom_px は 0 以上の有限数である必要があります`);
  if (value.text_align !== "center" || value.max_lines !== 1) fail(`${label} は text_align=center / max_lines=1 である必要があります`);
}

function strictText(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value && value.normalize("NFC") === value;
}

function measureUnits(value) {
  return Array.from(value).reduce((sum, character) => sum + (/^[\x00-\x7F]$/u.test(character) ? 0.5 : 1), 0);
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
