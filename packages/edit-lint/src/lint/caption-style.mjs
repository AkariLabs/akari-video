import { captionFinding, isFiniteNumber, isNonEmptyString, isRecord } from "./shared.mjs";
import { CAPTION_ANIMATION_SLOTS, CAPTION_ANIMATION_SLOT_FIELDS, CAPTION_TEXTANIM_IDS, CAPTION_TEXT_STYLE_FIELDS } from "./external.mjs";

const CAPTION_TEXT_STYLE_ZONES = new Set([
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

const CAPTION_HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function validateTextStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  for (const field of Object.keys(value)) {
    if (!CAPTION_TEXT_STYLE_FIELDS.has(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the text style contract`,
        path,
      );
    }
  }
  validateTextStyleV0Fields(value, label, findings, path);
  if (Object.hasOwn(value, "color")) {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  if (
    Object.hasOwn(value, "size_px")
    && (!isFiniteNumber(value.size_px) || value.size_px <= 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.size_px must be a finite number greater than zero`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "reference_height_px")
    && (!Number.isInteger(value.reference_height_px) || value.reference_height_px < 1)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.reference_height_px must be an integer greater than or equal to one`,
      path,
    );
  }
  if (Object.hasOwn(value, "font_weight") && (!Number.isInteger(value.font_weight) || value.font_weight < 1 || value.font_weight > 1000)) {
    captionFinding(findings, "captions.text-style", `${label}.font_weight must be an integer within [1, 1000]`, path);
  }
  if (Object.hasOwn(value, "line_height") && (!isFiniteNumber(value.line_height) || value.line_height <= 0)) {
    captionFinding(findings, "captions.text-style", `${label}.line_height must be a positive finite number`, path);
  }
  if (Object.hasOwn(value, "stroke")) {
    validateCaptionStrokeStyle(value.stroke, `${label}.stroke`, findings, path);
  }
  if (Object.hasOwn(value, "background")) {
    validateCaptionBackgroundStyle(value.background, `${label}.background`, findings, path);
  }
  if (Object.hasOwn(value, "animation")) {
    validateCaptionAnimation(value.animation, `${label}.animation`, findings, path);
  }
  if (Object.hasOwn(value, "zone") && !CAPTION_TEXT_STYLE_ZONES.has(value.zone)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.zone must be one of the nine caption zones`,
      path,
    );
  }
  if (Object.hasOwn(value, "layout")) validateCaptionReferenceLayout(value.layout, `${label}.layout`, findings, path);
  if (Object.hasOwn(value, "zone") && Object.hasOwn(value, "layout")) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label} cannot contain both zone and layout`,
      path,
    );
  }
  if (Object.hasOwn(value, "layout") && Object.hasOwn(value, "reference_height_px")) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label} cannot contain both layout and reference_height_px`,
      path,
    );
  }
}

export function validateCaptionAnimation(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  if (Object.keys(value).length === 0) {
    captionFinding(findings, "captions.text-style", `${label} must contain at least one slot`, path);
  }
  for (const slot of Object.keys(value)) {
    if (!CAPTION_ANIMATION_SLOTS.has(slot)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${slot} is not defined by the animation contract`,
        path,
      );
      continue;
    }
    validateCaptionAnimationSlot(value[slot], `${label}.${slot}`, findings, path);
  }
}

function validateCaptionAnimationSlot(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  for (const field of Object.keys(value)) {
    if (!CAPTION_ANIMATION_SLOT_FIELDS.has(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the animation slot contract`,
        path,
      );
    }
  }
  if (!Object.hasOwn(value, "id")) {
    captionFinding(findings, "captions.text-style", `${label}.id is required`, path);
  } else if (!CAPTION_TEXTANIM_IDS.has(value.id)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.id is not defined in presets/textanim/index.jsonl: ${String(value.id)}`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "duration_sec")
    && (!isFiniteNumber(value.duration_sec) || value.duration_sec <= 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.duration_sec must be a positive finite number`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "ease")
    && value.ease !== null
    && !isNonEmptyString(value.ease)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.ease must be null or a non-empty string`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "amp")
    && value.amp !== null
    && (!isFiniteNumber(value.amp) || value.amp <= 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.amp must be null or a positive finite number`,
      path,
    );
  }
}

const CAPTION_ALIGN_VALUES = new Set(["left", "center", "right"]);

const CAPTION_VERTICAL_ALIGN_VALUES = new Set(["top", "middle", "bottom"]);

const CAPTION_TEXT_TRANSFORM_VALUES = new Set([
  "upper", "uppercase", "lower", "lowercase", "title", "capitalize", "none",
]);

const CAPTION_TEXT_ANCHOR_VALUES = new Set(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"]);

const CAPTION_SHADOW_KEYS = ["color", "opacity", "blur_px", "distance_px", "angle_deg"];

const CAPTION_GLOW_KEYS = ["color", "density", "spread", "offset_x", "offset_y"];

const CAPTION_NON_NEGATIVE_SHADOW_KEYS = ["blur_px", "distance_px", "density", "spread"];

// textstyle v0 のフィールド検証。edit-store の validateTextStyleV0 と同じ規則を張る
// （どちらか片方だけが緩いと、lint が通ったのに保存で弾かれる/その逆が起きる）。
function validateTextStyleV0Fields(value, label, findings, path) {
  const has = (key) => Object.hasOwn(value, key);
  const flag = (message) => captionFinding(findings, "captions.text-style", `${label}.${message}`, path);
  if (has("font_family") && (typeof value.font_family !== "string" || value.font_family === "")) {
    flag("font_family must be a non-empty string");
  }
  if (has("weight") && (!Number.isInteger(value.weight) || value.weight < 100 || value.weight > 900)) {
    flag("weight must be an integer within [100, 900]");
  }
  if (has("italic") && typeof value.italic !== "boolean") flag("italic must be a boolean");
  if (has("underline") && typeof value.underline !== "boolean") flag("underline must be a boolean");
  if (has("letter_spacing_em") && !isFiniteNumber(value.letter_spacing_em)) {
    flag("letter_spacing_em must be a finite number");
  }
  if (has("align") && !CAPTION_ALIGN_VALUES.has(value.align)) flag("align must be one of left, center, right");
  if (has("vertical_align") && !CAPTION_VERTICAL_ALIGN_VALUES.has(value.vertical_align)) {
    flag("vertical_align must be one of top, middle, bottom");
  }
  if (has("vertical") && typeof value.vertical !== "boolean") flag("vertical must be a boolean");
  if (has("text_transform") && !CAPTION_TEXT_TRANSFORM_VALUES.has(value.text_transform)) {
    flag("text_transform must be one of upper, uppercase, lower, lowercase, title, capitalize, none");
  }
  if (has("max_width_pct")
    && (!isFiniteNumber(value.max_width_pct) || value.max_width_pct <= 0 || value.max_width_pct >= 100)) {
    flag("max_width_pct must be a finite number within (0, 100)");
  }
  if (has("max_characters") && (!Number.isInteger(value.max_characters) || value.max_characters <= 0)) {
    flag("max_characters must be an integer greater than zero");
  }
  if (has("text_anchor") && !CAPTION_TEXT_ANCHOR_VALUES.has(value.text_anchor)) {
    flag("text_anchor must be one of the nine anchor codes");
  }
  if (has("position")) {
    if (!isRecord(value.position)) {
      flag("position must be an object");
    } else {
      for (const field of Object.keys(value.position)) {
        if (field !== "x" && field !== "y") flag(`position.${field} is not defined by the text style contract`);
      }
      for (const axis of ["x", "y"]) {
        if (Object.hasOwn(value.position, axis) && !isFiniteNumber(value.position[axis])) {
          flag(`position.${axis} must be a finite number`);
        }
      }
    }
  }
  if (has("shadow")) validateCaptionShadowLike(value.shadow, CAPTION_SHADOW_KEYS, `${label}.shadow`, findings, path);
  if (has("glow")) validateCaptionShadowLike(value.glow, CAPTION_GLOW_KEYS, `${label}.glow`, findings, path);
  if (has("animation")) validateCaptionAnimation(value.animation, `${label}.animation`, findings, path);
}

// shadow / glow は「color 必須 + 残りは数値」の同型。color を任意にすると消費側が
// 影を組めず無言で落ちるため必須で揃える。
function validateCaptionShadowLike(value, keys, label, findings, path) {
  if (!isRecord(value)) return captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
  for (const field of Object.keys(value)) {
    if (!keys.includes(field)) {
      captionFinding(findings, "captions.text-style", `${label}.${field} is not defined by the text style contract`, path);
    }
  }
  if (!Object.hasOwn(value, "color")) {
    captionFinding(findings, "captions.text-style", `${label}.color is required`, path);
  } else {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  for (const key of keys) {
    if (key === "color" || !Object.hasOwn(value, key)) continue;
    if (!isFiniteNumber(value[key])) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be a finite number`, path);
      continue;
    }
    if (key === "opacity" && (value[key] < 0 || value[key] > 1)) {
      captionFinding(findings, "captions.text-style", `${label}.opacity must be within [0, 1]`, path);
    }
    // 非負なのは長さ・量のみ。angle_deg は向きなので負値が正当（-90 = 真上）、
    // offset_* も両方向へ動かせる。
    if (CAPTION_NON_NEGATIVE_SHADOW_KEYS.includes(key) && value[key] < 0) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be non-negative`, path);
    }
  }
}

function validateCaptionStrokeStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  for (const field of Object.keys(value)) {
    if (field !== "method" && field !== "color" && field !== "width_px") {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the stroke style contract`,
        path,
      );
    }
  }
  if (Object.hasOwn(value, "method") && value.method !== "webkit-outline") {
    captionFinding(findings, "captions.text-style", `${label}.method must be webkit-outline`, path);
  }
  if (Object.hasOwn(value, "color")) {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  if (
    Object.hasOwn(value, "width_px")
    && (!isFiniteNumber(value.width_px) || value.width_px < 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.width_px must be a non-negative finite number`,
      path,
    );
  }
}

function validateCaptionReferenceLayout(value, label, findings, path) {
  if (!isRecord(value)) return captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
  const keys = ["mode", "reference_width_px", "reference_height_px", "left_px", "width_px", "bottom_px", "text_align", "max_lines"];
  for (const field of Object.keys(value)) if (!keys.includes(field)) captionFinding(findings, "captions.text-style", `${label}.${field} is not defined by reference-pixel layout`, path);
  for (const field of keys) if (!Object.hasOwn(value, field)) captionFinding(findings, "captions.text-style", `${label}.${field} is required`, path);
  const valid = value.mode === "reference-pixel"
    && Number.isInteger(value.reference_width_px) && value.reference_width_px > 0
    && Number.isInteger(value.reference_height_px) && value.reference_height_px > 0
    && isFiniteNumber(value.left_px) && value.left_px >= 0
    && isFiniteNumber(value.width_px) && value.width_px > 0
    && value.left_px + value.width_px <= value.reference_width_px
    && isFiniteNumber(value.bottom_px) && value.bottom_px >= 0
    && value.text_align === "center" && value.max_lines === 1;
  if (!valid) captionFinding(findings, "captions.text-style", `${label} must be a bounded reference-pixel layout with center/max_lines=1`, path);
}

function validateCaptionBackgroundStyle(value, label, findings, path) {
  if (!isRecord(value)) {
    captionFinding(findings, "captions.text-style", `${label} must be an object`, path);
    return;
  }
  const allowed = [
    "color", "opacity", "radius_px", "mode",
    // textstyle v0 の座布団拡張: 一律余白 / 文字box比での拡張 / 座布団だけの平行移動
    "padding_px", "width_pct", "height_pct", "offset_x", "offset_y", "fit",
  ];
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      captionFinding(
        findings,
        "captions.text-style",
        `${label}.${field} is not defined by the background style contract`,
        path,
      );
    }
  }
  for (const key of ["padding_px", "width_pct", "height_pct"]) {
    if (Object.hasOwn(value, key) && (!isFiniteNumber(value[key]) || value[key] < 0)) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be a non-negative finite number`, path);
    }
  }
  for (const key of ["offset_x", "offset_y"]) {
    if (Object.hasOwn(value, key) && !isFiniteNumber(value[key])) {
      captionFinding(findings, "captions.text-style", `${label}.${key} must be a finite number`, path);
    }
  }
  if (Object.hasOwn(value, "color")) {
    validateCaptionHexColor(value.color, `${label}.color`, findings, path);
  }
  if (
    Object.hasOwn(value, "opacity")
    && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.opacity must be a finite number from zero to one`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "radius_px")
    && (!isFiniteNumber(value.radius_px) || value.radius_px < 0)
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.radius_px must be a non-negative finite number`,
      path,
    );
  }
  if (
    Object.hasOwn(value, "mode")
    && value.mode !== "per-line"
    && value.mode !== "block"
  ) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label}.mode must be either per-line or block`,
      path,
    );
  }
  if (Object.hasOwn(value, "fit") && value.fit !== "text" && value.fit !== "frame") {
    captionFinding(findings, "captions.text-style", `${label}.fit must be either text or frame`, path);
  }
}

function validateCaptionHexColor(value, label, findings, path) {
  if (typeof value !== "string" || !CAPTION_HEX_COLOR.test(value)) {
    captionFinding(
      findings,
      "captions.text-style",
      `${label} must be a #RGB, #RRGGBB, or #RRGGBBAA hex color`,
      path,
    );
  }
}
