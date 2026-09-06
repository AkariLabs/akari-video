#!/usr/bin/env node

// edit.json v0/v1 の構造と、JSON Schema 単体では表せない参照・範囲制約を検証する。
// v2 の詳細は edit.schema.json + v2 reader が正本なので、ここは版だけ受理する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { TRANSITION_TYPE_IDS } = createRequire(import.meta.url)("../../edit-store/lib/index.js");

const LAYER_KINDS = new Set(["baked", "video", "filter"]);
const LAYER_BLEND_MODES = new Set([
  "normal",
  "screen",
  "multiply",
  "add",
  "difference",
  "darken",
  "lighten",
  "overlay",
  "hardlight",
  "softlight",
]);
const LAYER_KEYFRAME_EASINGS = new Set(["linear", "ease-in-out"]);
const AUDIO_KEYFRAME_EASINGS = new Set([
  "linear", "ease-in-out", "in-quad", "out-quad", "in-out-quad", "in-cubic", "out-cubic",
  "in-out-cubic", "in-quart", "out-quart", "in-out-quart", "in-expo", "out-expo", "in-out-expo",
  "in-back", "out-back", "in-out-back", "out-bounce", "out-elastic", "hold",
]);
const CUBIC_BEZIER = /^cubic-bezier\(\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*\)$/;

const usage = "使い方: node packages/schemas/bin/validate-edit.mjs <edit.json>";
const editArgument = process.argv[2];

if (!editArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (editArgument === "--help" || editArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const editPath = path.resolve(editArgument);
const schemaPath = fileURLToPath(new URL("../edit.schema.json", import.meta.url));
const errors = [];

if (!isRegularFile(editPath)) {
  fail(`edit.json が見つかりません: ${editPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`edit.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:edit:v1") {
  fail("edit.schema.json の $id が v1 契約と一致しません");
  finish();
}

let edit;
try {
  edit = JSON.parse(fs.readFileSync(editPath, "utf8"));
} catch (error) {
  fail(`edit.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateEdit(edit);
finish();

function validateEdit(value) {
  if (!isPlainObject(value)) {
    fail("edit.json のルートは object である必要があります");
    return;
  }
  if (value.version === 2) {
    validateV2Tracks(value.tracks);
    return;
  }
  if (value.version !== 0 && value.version !== 1) {
    fail("version は 0 / 1 / 2 のいずれかである必要があります");
    return;
  }
  validateOutput(value.output);

  const hasSource = hasOwn(value, "source");
  const hasSources = hasOwn(value, "sources");
  if (hasSource && hasSources) fail("source と sources は排他です");

  if (value.version === 0) {
    if (!hasSource) fail("version 0 では source が必須です");
    if (hasSources) fail("version 0 では sources を使用できません");
    validateSourceV0(value.source);
  } else {
    if (!hasSources) fail("version 1 では sources が必須です");
    if (hasSource) fail("version 1 では source を使用できません");
    validateSourcesV1(value.sources);
  }
  validateCuts(value.cuts, value.version, value.sources);
  validateAudio(value.audio);
  validateLayers(value.layers);
  validateBeats(value.beats, value.version, value.sources);
  validateEmphasisWords(value.emphasis_words, value.version, value.sources);
  validateDirection(value.direction);
  validateTracks(value.tracks);
  validateTimeline(value.timeline);
}

function validateV2Tracks(value) {
  if (!Array.isArray(value)) {
    fail("tracks は配列である必要があります");
    return;
  }
  for (const [trackIndex, track] of value.entries()) {
    if (!isPlainObject(track) || !Array.isArray(track.items)) continue;
    for (const [itemIndex, item] of track.items.entries()) {
      validateV2Item(item, `tracks[${trackIndex}].items[${itemIndex}]`);
    }
  }
}

function validateV2Item(item, label) {
  if (!isPlainObject(item)) return;
  if (hasOwn(item, "adjust")) validateAdjust(item.adjust, `${label}.adjust`);
  if (hasOwn(item, "keyframes")) validateV2Keyframes(item.keyframes, `${label}.keyframes`);
  if (!Array.isArray(item.items)) return;
  for (const [index, child] of item.items.entries()) {
    validateV2Item(child, `${label}.items[${index}]`);
  }
}

function validateAdjust(value, label) {
  validateAdjustV1Sections(value, label);
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["basic", "lut", "sections", "curves", "wheels", "hue", "fx"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "basic")) {
    const basic = value.basic;
    if (!isPlainObject(basic)) {
      fail(`${label}.basic は object である必要があります`);
    } else {
      const basicKeys = new Set([
        "exposure", "contrast", "highlights", "shadows", "blacks", "whites",
        "temperature", "tint", "vibrance", "saturation",
      ]);
      for (const key of Object.keys(basic)) {
        if (!basicKeys.has(key)) fail(`${label}.basic に未知のキーがあります: ${key}`);
      }
      for (const key of basicKeys) {
        if (!hasOwn(basic, key)) continue;
        const minimum = key === "exposure" ? -3 : -1;
        const maximum = key === "exposure" ? 3 : 1;
        if (!isFiniteNumber(basic[key]) || basic[key] < minimum || basic[key] > maximum) {
          fail(`${label}.basic.${key} は ${minimum} から ${maximum} の範囲の有限数である必要があります`);
        }
      }
    }
  }
  if (hasOwn(value, "lut") && value.lut !== null) {
    const lut = value.lut;
    if (!isPlainObject(lut)) {
      fail(`${label}.lut は null または object である必要があります`);
    } else {
      const lutKeys = new Set(["lut", "intensity"]);
      for (const key of Object.keys(lut)) {
        if (!lutKeys.has(key)) fail(`${label}.lut に未知のキーがあります: ${key}`);
      }
      validateNonEmptyString(lut.lut, `${label}.lut.lut`);
      if (hasOwn(lut, "intensity")
          && (!isFiniteNumber(lut.intensity) || lut.intensity < 0 || lut.intensity > 1)) {
        fail(`${label}.lut.intensity は 0 から 1 の範囲の有限数である必要があります`);
      }
    }
  }
  if (hasOwn(value, "sections")) {
    const sections = value.sections;
    if (!isPlainObject(sections)) {
      fail(`${label}.sections は object である必要があります`);
    } else {
      const sectionKeys = new Set(["basic", "lut", "curves", "wheels", "hue", "fx"]);
      for (const key of Object.keys(sections)) {
        if (!sectionKeys.has(key)) fail(`${label}.sections に未知のキーがあります: ${key}`);
      }
      for (const key of sectionKeys) {
        if (hasOwn(sections, key) && typeof sections[key] !== "boolean") {
          fail(`${label}.sections.${key} は boolean である必要があります`);
        }
      }
    }
  }
}

// Intentional dependency-free duplicate of the closed adjustV1 structure.
function validateAdjustV1Sections(value, path) {
  if (!isPlainObject(value)) return;
  const report = (section, check, at, message) => fail(at + ' ' + (section === 'fx' ? 'adjust.fx.' + check + ': ' : '') + message);
  const object = (v, keys, section, at) => {
    if (!isPlainObject(v)) { report(section, 'structure', at, 'は object である必要があります'); return false; }
    for (const key of Object.keys(v)) if (!keys.includes(key)) report(section, 'unknown-key', at + '.' + key, 'は未知のキーです');
    return true;
  };
  const number = (v, min, max, section, at) => {
    if (!isFiniteNumber(v) || v < min || v > max) report(section, 'range', at, 'は ' + min + ' から ' + max + ' の範囲の有限数である必要があります');
  };
  if (Object.hasOwn(value, 'fx')) {
    const at = path + '.fx';
    if (!Array.isArray(value.fx)) {
      report('fx', 'structure', at, 'must be an array');
    } else {
      if (value.fx.length > 8) report('fx', 'max-items', at, 'must contain at most 8 effects');
      const ranges = {
        vignette: { amount: [-1, 1], midpoint: [0, 1], roundness: [-1, 1], feather: [0, 1] },
        blur: { px: [0, 50] },
        grain: { amount: [0, 1], size: [0.5, 4] },
        sharpen: { amount: [0, 1] },
        glow: { intensity: [0, 1], radius: [0, 100], threshold: [0, 1], warmth: [-1, 1] },
        clarity: { amount: [-1, 1], radius: [1, 50] },
        dehaze: { amount: [-1, 1] },
        denoise: { amount: [0, 1] },
        motion_blur: { px: [0, 100], angle: [-180, 180] },
      };
      const seen = new Set();
      for (const [index, fx] of value.fx.entries()) {
        const fxPath = at + '[' + index + ']';
        if (!isPlainObject(fx)) { report('fx', 'structure', fxPath, 'must be an object'); continue; }
        if (typeof fx.id !== 'string' || !Object.hasOwn(ranges, fx.id)) {
          report('fx', 'id', fxPath + '.id', 'unknown effect id'); continue;
        }
        if (seen.has(fx.id)) report('fx', 'duplicate-id', fxPath + '.id', 'duplicate effect id: ' + fx.id);
        seen.add(fx.id);
        const params = ranges[fx.id];
        for (const key of Object.keys(fx)) {
          if (key !== 'id' && !Object.hasOwn(params, key)) report('fx', 'unknown-key', fxPath + '.' + key, 'unknown effect parameter');
        }
        for (const [key, [min, max]] of Object.entries(params)) {
          if (Object.hasOwn(fx, key)) number(fx[key], min, max, 'fx', fxPath + '.' + key);
        }
      }
    }
  }
  for (const section of ['curves', 'hue']) {
    if (!Object.hasOwn(value, section)) continue;
    const channels = value[section], at = path + '.' + section;
    const axis = section === 'curves' ? 'in' : 'hue';
    const output = section === 'curves' ? 'out' : 'value';
    const minimum = section === 'curves' ? 2 : 1;
    const keys = section === 'curves' ? ['master', 'r', 'g', 'b'] : ['hue', 'sat', 'luma'];
    if (!object(channels, keys, section, at)) continue;
    for (const channel of keys) {
      if (!Object.hasOwn(channels, channel)) continue;
      const points = channels[channel], channelPath = at + '.' + channel;
      if (!Array.isArray(points) || points.length < minimum || points.length > 16) {
        report(section, 'points', channelPath, 'は ' + minimum + ' から 16 点の配列である必要があります'); continue;
      }
      let previous = -Infinity;
      for (const [index, point] of points.entries()) {
        const pointPath = channelPath + '[' + index + ']';
        if (!object(point, [axis, output], section, pointPath)) continue;
        number(point[axis], 0, 1, section, pointPath + '.' + axis);
        number(point[output], 0, 1, section, pointPath + '.' + output);
        if (isFiniteNumber(point[axis])) {
          if (point[axis] <= previous) report(section, 'order', pointPath + '.' + axis, 'は狭義単調増加である必要があります');
          previous = point[axis];
        }
      }
    }
  }
  if (Object.hasOwn(value, 'wheels')) {
    const ranges = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 };
    if (!object(value.wheels, Object.keys(ranges), 'wheels', path + '.wheels')) return;
    for (const [wheel, range] of Object.entries(ranges)) {
      if (!Object.hasOwn(value.wheels, wheel)) continue;
      const channels = value.wheels[wheel], at = path + '.wheels.' + wheel;
      if (!object(channels, ['r', 'g', 'b'], 'wheels', at)) continue;
      for (const channel of ['r', 'g', 'b']) if (Object.hasOwn(channels, channel)) number(channels[channel], -range, range, 'wheels', at + '.' + channel);
    }
  }
}

function validateV2Keyframes(value, label) {
  if (isPlainObject(value)) {
    if (!isNonEmptyString(value.path) || !/^motion\/.+\.json$/u.test(value.path)) {
      fail(`${label}.path は motion/ 配下の JSON である必要があります`);
    }
    return;
  }
  if (!Array.isArray(value) || value.length < 2) {
    fail(`${label} は 2 点以上の配列または参照 object である必要があります`);
    return;
  }
  let previous = -1;
  for (const [index, point] of value.entries()) {
    const pointLabel = `${label}[${index}]`;
    if (!isPlainObject(point) || !Number.isInteger(point.t) || point.t < 0) {
      fail(`${pointLabel}.t は 0 以上の整数フレームである必要があります`);
      continue;
    }
    if (point.t <= previous) fail(`${label}[].t は昇順かつ重複禁止です（${pointLabel} で違反）`);
    previous = point.t;
  }
}

function validateTracks(value) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail("tracks は object である必要があります");
    return;
  }
  for (const key of ["cuts", "overlays", "layers", "audio"]) {
    if (!hasOwn(value, key)) continue;
    validateTrackStateList(value[key], `tracks.${key}`);
  }
}

function validateTimeline(value) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail("timeline は object である必要があります");
    return;
  }
  if (!Array.isArray(value.tracks)) {
    fail("timeline.tracks は配列である必要があります");
    return;
  }
  const ids = new Set();
  const kinds = new Set(["cuts", "layers", "overlays", "captions", "audio"]);
  value.tracks.forEach((item, index) => {
    const label = `timeline.tracks[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      return;
    }
    if (!isNonEmptyString(item.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(item.id)) {
      fail(`timeline.tracks[].id が重複しています: ${item.id}`);
    } else {
      ids.add(item.id);
    }
    if (!kinds.has(item.kind)) {
      fail(`${label}.kind は cuts/layers/overlays/captions/audio のいずれかである必要があります`);
    }
    if (hasOwn(item, "ref") && (!Number.isInteger(item.ref) || item.ref < 0)) {
      fail(`${label}.ref は 0 以上の整数である必要があります`);
    }
    if (hasOwn(item, "label") && typeof item.label !== "string") {
      fail(`${label}.label は文字列である必要があります`);
    }
    for (const field of ["muted", "hidden", "locked"]) {
      if (hasOwn(item, field) && typeof item[field] !== "boolean") {
        fail(`${label}.${field} は boolean である必要があります`);
      }
    }
  });
}

function validateTrackStateList(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} は配列である必要があります`);
    return;
  }
  value.forEach((item, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${itemLabel} は object である必要があります`);
      return;
    }
    if (hasOwn(item, "muted") && typeof item.muted !== "boolean") {
      fail(`${itemLabel}.muted は boolean である必要があります`);
    }
    if (hasOwn(item, "hidden") && typeof item.hidden !== "boolean") {
      fail(`${itemLabel}.hidden は boolean である必要があります`);
    }
  });
}

// docs/contract-2026-07-23-edit-json-v1-direction.md §6。direction は演出宣言の器であり
// 素材参照を持たないため、ファイルシステムも sources[] も見ない（preset は識別子でありパスではない）。
// overrides は語彙が本契約で未定義のため object であることだけを検証する（同 §6）。
function validateDirection(value) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail("direction は object である必要があります");
    return;
  }
  if (!isNonEmptyString(value.preset)) {
    fail("direction.preset は空でない文字列である必要があります");
  }
  if (hasOwn(value, "intensity")) {
    if (!Number.isInteger(value.intensity) || value.intensity < 0 || value.intensity > 100) {
      fail("direction.intensity は 0 から 100 の範囲の整数である必要があります");
    }
  }
  if (hasOwn(value, "overrides") && !isPlainObject(value.overrides)) {
    fail("direction.overrides は object である必要があります");
  }
}

// docs/contract-2026-07-22-edit-json-v1-beats.md §7。id の一意性と src の参照整合は
// 兄弟値の突き合わせが要るため JSON Schema では表現できず、ここで検証する（cuts[].src と同じ分担）。
// beats[].t は source 秒アンカー（同 §3）であり、timeline 尺との突き合わせは行わない。
function validateBeats(value, version, sources) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("beats は配列である必要があります");
    return;
  }
  const sourceIds = new Set(
    Array.isArray(sources)
      ? sources.filter(isPlainObject).map((source) => source.id).filter(isNonEmptyString)
      : [],
  );
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    const label = `beats[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (typeof item.id !== "string" || !/^b-\d{4}$/.test(item.id)) {
      fail(`${label}.id は b- に続く 4 桁の数字である必要があります`);
    } else if (ids.has(item.id)) {
      fail(`beats[].id が重複しています: ${item.id}`);
    } else {
      ids.add(item.id);
    }
    if (!isFiniteNumber(item.t) || item.t < 0) {
      fail(`${label}.t は 0 以上の有限数である必要があります`);
    }
    if (!isNonEmptyString(item.kind)) {
      fail(`${label}.kind は空でない文字列である必要があります`);
    }
    if (!isFiniteNumber(item.strength) || item.strength < 0 || item.strength > 1) {
      fail(`${label}.strength は 0 から 1 の範囲の有限数である必要があります`);
    }
    if (hasOwn(item, "basis") && typeof item.basis !== "string") {
      fail(`${label}.basis は文字列である必要があります`);
    }
    if (hasOwn(item, "src")) {
      if (version === 0) {
        fail(`${label}.src は version 0 では使用できません`);
      } else {
        validateNonEmptyString(item.src, `${label}.src`);
        if (isNonEmptyString(item.src) && !sourceIds.has(item.src)) {
          fail(`${label}.src が sources[].id を参照していません: ${item.src}`);
        }
      }
    }
  }
}

// docs/contract-2026-07-23-edit-json-v1-emphasis-words.md §7。t_end > t_start・id の一意性・
// src の参照整合は兄弟値の突き合わせが要るため JSON Schema では表現できず、ここで検証する
// （cuts[].out > in / cuts[].src と同じ分担）。t_start/t_end は source 秒アンカー（同 §3）であり、
// timeline 尺との突き合わせは行わない。要素は素材ファイルを参照しないため実在チェックもしない。
function validateEmphasisWords(value, version, sources) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("emphasis_words は配列である必要があります");
    return;
  }
  const sourceIds = new Set(
    Array.isArray(sources)
      ? sources.filter(isPlainObject).map((source) => source.id).filter(isNonEmptyString)
      : [],
  );
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    const label = `emphasis_words[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (typeof item.id !== "string" || !/^e-\d{4}$/.test(item.id)) {
      fail(`${label}.id は e- に続く 4 桁の数字である必要があります`);
    } else if (ids.has(item.id)) {
      fail(`emphasis_words[].id が重複しています: ${item.id}`);
    } else {
      ids.add(item.id);
    }
    const hasStart = isFiniteNumber(item.t_start) && item.t_start >= 0;
    const hasEnd = isFiniteNumber(item.t_end) && item.t_end >= 0;
    if (!hasStart) {
      fail(`${label}.t_start は 0 以上の有限数である必要があります`);
    }
    if (!hasEnd) {
      fail(`${label}.t_end は 0 以上の有限数である必要があります`);
    }
    if (hasStart && hasEnd && item.t_end <= item.t_start) {
      fail(`${label}.t_end は t_start より大きい必要があります`);
    }
    if (!isNonEmptyString(item.word)) {
      fail(`${label}.word は空でない文字列である必要があります`);
    }
    if (!isNonEmptyString(item.emotion)) {
      fail(`${label}.emotion は空でない文字列である必要があります`);
    }
    if (hasOwn(item, "style_hint") && typeof item.style_hint !== "string") {
      fail(`${label}.style_hint は文字列である必要があります`);
    }
    if (hasOwn(item, "src")) {
      if (version === 0) {
        fail(`${label}.src は version 0 では使用できません`);
      } else {
        validateNonEmptyString(item.src, `${label}.src`);
        if (isNonEmptyString(item.src) && !sourceIds.has(item.src)) {
          fail(`${label}.src が sources[].id を参照していません: ${item.src}`);
        }
      }
    }
  }
}

function validateLayers(value) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("layers は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, layer] of value.entries()) {
    const label = `layers[${index}]`;
    if (!isPlainObject(layer)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (!isNonEmptyString(layer.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(layer.id)) {
      fail(`layers[].id が重複しています: ${layer.id}`);
    } else {
      ids.add(layer.id);
    }
    if (!isFiniteNumber(layer.t) || layer.t < 0) {
      fail(`${label}.t は 0 以上の有限数である必要があります`);
    }
    if (!isFiniteNumber(layer.duration) || layer.duration <= 0) {
      fail(`${label}.duration は 0 より大きい有限数である必要があります`);
    }
    if (!LAYER_KINDS.has(layer.kind)) {
      fail(`${label}.kind は baked/video/filter のいずれかである必要があります`);
    }
    if (layer.kind === "filter") {
      for (const field of ["src", "chroma_key", "blend", "crop", "transform"]) {
        if (hasOwn(layer, field)) fail(`${label}.${field} は kind が filter のとき使用できません`);
      }
      validateLayerFilter(layer.filter, `${label}.filter`);
    } else {
      validateNonEmptyString(layer.src, `${label}.src`);
    }
    if (hasOwn(layer, "opacity")) {
      if (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
        fail(`${label}.opacity は 0 から 1 の範囲の有限数である必要があります`);
      }
    }
    if (hasOwn(layer, "blend") && !LAYER_BLEND_MODES.has(layer.blend)) {
      fail(`${label}.blend は ${[...LAYER_BLEND_MODES].join("/")} のいずれかである必要があります`);
    }
    if (hasOwn(layer, "transform")) {
      validateLayerTransform(layer.transform, `${label}.transform`);
    }
    if (hasOwn(layer, "chroma_key")) {
      if (layer.kind !== "video") {
        fail(`${label}.chroma_key は kind が video のときのみ使用できます`);
      }
      validateLayerChromaKey(layer.chroma_key, `${label}.chroma_key`);
    }
    if (hasOwn(layer, "crop")) {
      validateLayerCrop(layer.crop, `${label}.crop`);
    }
    if (hasOwn(layer, "perspective")) {
      validateLayerPerspective(layer.perspective, `${label}.perspective`);
    }
    if (hasOwn(layer, "keyframes")) {
      validateLayerKeyframes(layer.keyframes, `${label}.keyframes`);
    }
    if (hasOwn(layer, "track")) {
      if (!Number.isInteger(layer.track) || layer.track < 0) {
        fail(`${label}.track は 0 以上の整数である必要があります`);
      }
    }
  }
}

function validateLayerFilter(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeysByType = new Map([
    ["invert", new Set(["type"])],
    ["lut", new Set(["type", "id", "intensity"])],
    ["saturation", new Set(["type", "value"])],
  ]);
  const allowedKeys = allowedKeysByType.get(value.type);
  if (allowedKeys === undefined) {
    fail(`${label}.type は invert/lut/saturation のいずれかである必要があります`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (value.type === "lut") {
    validateNonEmptyString(value.id, `${label}.id`);
    if (hasOwn(value, "intensity")
        && (!isFiniteNumber(value.intensity) || value.intensity < 0 || value.intensity > 1)) {
      fail(`${label}.intensity は 0 から 1 の範囲の有限数である必要があります`);
    }
  }
  if (value.type === "saturation"
      && (!isFiniteNumber(value.value) || value.value < 0 || value.value > 3)) {
    fail(`${label}.value は 0 から 3 の範囲の有限数である必要があります`);
  }
}

function validateLayerTransform(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  for (const field of ["x", "y", "rotate"]) {
    if (hasOwn(value, field) && !isFiniteNumber(value[field])) {
      fail(`${label}.${field} は有限数である必要があります`);
    }
  }
  if (hasOwn(value, "scale") && (!isFiniteNumber(value.scale) || value.scale <= 0)) {
    fail(`${label}.scale は 0 より大きい有限数である必要があります`);
  }
}

function validateLayerCrop(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  for (const field of ["x", "y"]) {
    if (!isFiniteNumber(value[field]) || value[field] < 0 || value[field] > 1) {
      fail(`${label}.${field} は 0 から 1 の範囲の有限数である必要があります`);
    }
  }
  for (const field of ["w", "h"]) {
    if (!isFiniteNumber(value[field]) || value[field] <= 0 || value[field] > 1) {
      fail(`${label}.${field} は 0 より大きく 1 以下の有限数である必要があります`);
    }
  }
  if (isFiniteNumber(value.x) && isFiniteNumber(value.w) && value.x + value.w > 1 + 1e-9) {
    fail(`${label}.x + ${label}.w は 1 以下である必要があります`);
  }
  if (isFiniteNumber(value.y) && isFiniteNumber(value.h) && value.y + value.h > 1 + 1e-9) {
    fail(`${label}.y + ${label}.h は 1 以下である必要があります`);
  }
}

function validateLayerPerspective(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const corners = value.corners;
  if (!Array.isArray(corners) || corners.length !== 4) {
    fail(`${label}.corners は [TL,TR,BL,BR] の 4 要素配列である必要があります`);
    return;
  }
  const names = ["TL", "TR", "BL", "BR"];
  let allFinite = true;
  const points = corners.map((corner, index) => {
    const cornerLabel = `${label}.corners[${index}] (${names[index]})`;
    if (!Array.isArray(corner) || corner.length !== 2) {
      fail(`${cornerLabel} は [x, y] の 2 要素配列である必要があります`);
      allFinite = false;
      return null;
    }
    const [x, y] = corner;
    if (!isFiniteNumber(x) || x < 0 || x > 1) {
      fail(`${cornerLabel}.x は 0 から 1 の範囲の有限数である必要があります`);
      allFinite = false;
    }
    if (!isFiniteNumber(y) || y < 0 || y > 1) {
      fail(`${cornerLabel}.y は 0 から 1 の範囲の有限数である必要があります`);
      allFinite = false;
    }
    return [x, y];
  });
  if (!allFinite) return;
  // 面積ほぼ0（退化四角形）はホモグラフィ計算が特異行列になり得るため拒否する。
  // シューレース公式は境界を一周する順（TL→TR→BR→BL）で評価する必要があるため
  // corners のラスタ順（TL,TR,BL,BR）から並べ替える。
  const [tl, tr, bl, br] = points;
  const ring = [tl, tr, br, bl];
  let area2 = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area2 += x1 * y2 - x2 * y1;
  }
  if (Math.abs(area2) < 1e-4) {
    fail(`${label}.corners は退化した四角形（面積がほぼ 0）であってはなりません`);
  }
}

// contract-2026-08-09-transform-keyframes-v0.md (layers[].keyframes). Mirrors
// validateCutFramingKeyframes' t-ascending/no-duplicate discipline, but each point may carry any
// combination of transform/crop/perspective (or none but t, which is pointless but not invalid --
// render-cut/preview simply treat it as "no override at this instant", matching the hold semantics
// documented on #layerKeyframe).
function validateLayerKeyframes(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    fail(`${label} は 2 件以上の配列である必要があります`);
    return;
  }
  const allowedKeys = new Set(["t", "transform", "crop", "perspective", "easing"]);
  let previousT = null;
  value.forEach((point, index) => {
    const pointLabel = `${label}[${index}]`;
    if (!isPlainObject(point)) {
      fail(`${pointLabel} は object である必要があります`);
      return;
    }
    for (const key of Object.keys(point)) {
      if (!allowedKeys.has(key)) fail(`${pointLabel} に未知のキーがあります: ${key}`);
    }
    const hasT = isFiniteNumber(point.t) && point.t >= 0;
    if (!hasT) {
      fail(`${pointLabel}.t は 0 以上の有限数である必要があります`);
    } else if (previousT !== null && point.t <= previousT) {
      fail(`${label}[].t は昇順かつ重複禁止です（${pointLabel} で違反）`);
    }
    if (hasT) previousT = point.t;
    if (hasOwn(point, "transform")) {
      validateLayerTransform(point.transform, `${pointLabel}.transform`);
    }
    if (hasOwn(point, "crop")) {
      validateLayerCrop(point.crop, `${pointLabel}.crop`);
    }
    if (hasOwn(point, "perspective")) {
      validateLayerPerspective(point.perspective, `${pointLabel}.perspective`);
    }
    if (hasOwn(point, "easing") && !LAYER_KEYFRAME_EASINGS.has(point.easing)) {
      fail(`${pointLabel}.easing は ${[...LAYER_KEYFRAME_EASINGS].join("/")} のいずれかである必要があります`);
    }
  });
}

function validateLayerChromaKey(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  validateNonEmptyString(value.color, `${label}.color`);
  if (hasOwn(value, "similarity")) {
    if (!isFiniteNumber(value.similarity) || value.similarity < 0 || value.similarity > 1) {
      fail(`${label}.similarity は 0 から 1 の範囲の有限数である必要があります`);
    }
  }
  if (hasOwn(value, "blend")) {
    if (!isFiniteNumber(value.blend) || value.blend < 0 || value.blend > 1) {
      fail(`${label}.blend は 0 から 1 の範囲の有限数である必要があります`);
    }
  }
}

function validateAudio(value) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail("audio は object である必要があります");
    return;
  }
  validateNarration(value.narration);
  validateBgm(value.bgm);
  validateSfx(value.sfx);
  validateMaster(value.master);
  if (hasOwn(value, "duck_keys")) {
    if (!Array.isArray(value.duck_keys)
        || value.duck_keys.some(key => key !== "narration" && key !== "speech")
        || new Set(value.duck_keys).size !== value.duck_keys.length) {
      fail("audio.duck_keys は narration / speech の重複しない配列である必要があります");
    }
  }
}

function validateMaster(value) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail("audio.master は object である必要があります");
    return;
  }
  if (hasOwn(value, "denoise") && !["off", "std", "strong"].includes(value.denoise)) {
    fail("audio.master.denoise は off/std/strong のいずれかである必要があります");
  }
  if (hasOwn(value, "loudnorm")) {
    if (!isFiniteNumber(value.loudnorm) || value.loudnorm < -70 || value.loudnorm > 0) {
      fail("audio.master.loudnorm は -70 から 0 の範囲の有限数である必要があります");
    }
  }
  if (hasOwn(value, "true_peak_dbtp")) {
    if (!isFiniteNumber(value.true_peak_dbtp) || value.true_peak_dbtp < -9 || value.true_peak_dbtp > 0) {
      fail("audio.master.true_peak_dbtp は -9 から 0 の範囲の有限数である必要があります");
    }
  }
}

function validateBgm(value) {
  // docs/contract-2026-07-14-edit-json-v1-audio.md §1 says omission means "no BGM"; real edit.json
  // data (fieldtest/2026-07-14) spells that as an explicit `"bgm": null` instead of omitting the
  // key, the same tolerant-reader convention this schema already uses for source.proxy. Treat
  // both spellings identically.
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail("audio.bgm は object である必要があります");
    return;
  }
  validateNonEmptyString(value.path, "audio.bgm.path");
  if (hasOwn(value, "gain_db")) {
    if (!isFiniteNumber(value.gain_db) || value.gain_db < -60 || value.gain_db > 12) {
      fail("audio.bgm.gain_db は -60 から 12 の範囲の有限数である必要があります");
    }
  }
  if (hasOwn(value, "ducking") && typeof value.ducking !== "boolean") {
    fail("audio.bgm.ducking は boolean である必要があります");
  }
  for (const field of ["in", "fadeIn", "fadeOut"]) {
    if (hasOwn(value, field)) {
      if (!isFiniteNumber(value[field]) || value[field] < 0) {
        fail(`audio.bgm.${field} は 0 以上の有限数である必要があります`);
      }
    }
  }
  validateAudioEnvelope(value, "audio.bgm");
  validateAudioClipFx(value, "audio.bgm");
}

function validateSfx(value) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    fail("audio.sfx は配列である必要があります");
    return;
  }
  for (const [index, item] of value.entries()) {
    const label = `audio.sfx[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    validateNonEmptyString(item.path, `${label}.path`);
    if (!isFiniteNumber(item.t) || item.t < 0) {
      fail(`${label}.t は 0 以上の有限数である必要があります`);
    }
    if (hasOwn(item, "in")) {
      if (!isFiniteNumber(item.in) || item.in < 0) {
        fail(`${label}.in は 0 以上の有限数である必要があります`);
      }
    }
    if (hasOwn(item, "out")) {
      if (!isFiniteNumber(item.out) || item.out <= 0) {
        fail(`${label}.out は 0 より大きい有限数である必要があります`);
      }
    }
    if (hasOwn(item, "gain_db")) {
      if (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12) {
        fail(`${label}.gain_db は -60 から 12 の範囲の有限数である必要があります`);
      }
    }
    if (hasOwn(item, "track")) {
      if (!Number.isInteger(item.track) || item.track < 0) {
        fail(`${label}.track は 0 以上の整数である必要があります`);
      }
    }
    for (const field of ["fade_in", "fade_out"]) {
      if (hasOwn(item, field)) {
        if (!isFiniteNumber(item[field]) || item[field] < 0) {
          fail(`${label}.${field} は 0 以上の有限数である必要があります`);
        }
      }
    }
    validateAudioEnvelope(item, label);
    validateAudioClipFx(item, label);
  }
}

function validateNarration(value) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("audio.narration は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    const label = `audio.narration[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (typeof item.id !== "string" || !/^n-\d{4}$/.test(item.id)) {
      fail(`${label}.id は n- に続く 4 桁の数字である必要があります`);
    } else if (ids.has(item.id)) {
      fail(`audio.narration[].id が重複しています: ${item.id}`);
    } else {
      ids.add(item.id);
    }
    validateNonEmptyString(item.path, `${label}.path`);
    if (!isFiniteNumber(item.t) || item.t < 0) {
      fail(`${label}.t は 0 以上の有限数である必要があります`);
    }
    if (hasOwn(item, "gain_db")) {
      if (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12) {
        fail(`${label}.gain_db は -60 から 12 の範囲の有限数である必要があります`);
      }
    }
    validateAudioEnvelope(item, label);
    validateAudioClipFx(item, label);
    validateNarrationProvenance(item.provenance, `${label}.provenance`);
  }
}

function validateAudioClipFx(value, label) {
  if (hasOwn(value, "speed") && (!isFiniteNumber(value.speed) || value.speed <= 0.25 || value.speed > 4)) {
    fail(`${label}.speed は 0.25 より大きく 4 以下の有限数である必要があります`);
  }
  if (hasOwn(value, "pitch_semitones") && (!isFiniteNumber(value.pitch_semitones)
      || value.pitch_semitones < -24 || value.pitch_semitones > 24)) {
    fail(`${label}.pitch_semitones は -24 から 24 の範囲の有限数である必要があります`);
  }
  if (hasOwn(value, "formant") && value.formant !== "preserve" && value.formant !== "shift") {
    fail(`${label}.formant は preserve/shift のいずれかである必要があります`);
  }
  if (hasOwn(value, "lowcut_hz") && (!isFiniteNumber(value.lowcut_hz)
      || value.lowcut_hz < 0 || value.lowcut_hz > 400)) {
    fail(`${label}.lowcut_hz は 0 から 400 の範囲の有限数である必要があります`);
  }
  if (!hasOwn(value, "denoise")) return;
  if (!isPlainObject(value.denoise)) {
    fail(`${label}.denoise は object である必要があります`);
    return;
  }
  if (value.denoise.method !== "fft" && value.denoise.method !== "nlm") {
    fail(`${label}.denoise.method は fft/nlm のいずれかである必要があります`);
  }
  if (!isFiniteNumber(value.denoise.strength)
      || value.denoise.strength < 0 || value.denoise.strength > 1) {
    fail(`${label}.denoise.strength は 0 から 1 の範囲の有限数である必要があります`);
  }
}

function validateAudioEnvelope(value, label) {
  if (hasOwn(value, "ducking") && typeof value.ducking !== "boolean") {
    fail(`${label}.ducking は boolean である必要があります`);
  }
  for (const [field, minimum, maximum] of [
    ["duck_db", -40, 0], ["duck_attack", 0, 2], ["duck_release", 0, 5],
  ]) {
    if (hasOwn(value, field) && (!isFiniteNumber(value[field])
        || value[field] < minimum || value[field] > maximum)) {
      fail(`${label}.${field} は ${minimum} から ${maximum} の範囲の有限数である必要があります`);
    }
  }
  if (!hasOwn(value, "keyframes")) return;
  if (!Array.isArray(value.keyframes) || value.keyframes.length < 2) {
    fail(`${label}.keyframes は 2 件以上の配列である必要があります`);
    return;
  }
  let previous = null;
  value.keyframes.forEach((point, index) => {
    const pointLabel = `${label}.keyframes[${index}]`;
    if (!isPlainObject(point)) {
      fail(`${pointLabel} は object である必要があります`);
      return;
    }
    if (!isFiniteNumber(point.t) || point.t < 0) fail(`${pointLabel}.t は 0 以上の有限数である必要があります`);
    else if (previous !== null && point.t <= previous) fail(`${label}.keyframes[].t は単調増加かつ重複禁止です`);
    if (isFiniteNumber(point.t)) previous = point.t;
    if (!isFiniteNumber(point.gain_db) || point.gain_db < -60 || point.gain_db > 12) {
      fail(`${pointLabel}.gain_db は -60 から 12 の範囲の有限数である必要があります`);
    }
    if (hasOwn(point, "easing") && (typeof point.easing !== "string"
        || (!AUDIO_KEYFRAME_EASINGS.has(point.easing) && !CUBIC_BEZIER.test(point.easing)))) {
      fail(`${pointLabel}.easing は対応する easing 語彙である必要があります`);
    }
  });
}

function validateNarrationProvenance(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  if (!isNonEmptyString(value.provider)) {
    fail(`${label}.provider は空でない文字列である必要があります`);
    return;
  }
  if (value.provider === "voicevox" && !isNonEmptyString(value.credit)) {
    fail(`${label}.credit は provider が voicevox のとき必須です`);
  }
}

function validateOutput(value) {
  if (!isPlainObject(value)) {
    fail("output は object である必要があります");
    return;
  }
  for (const field of ["width", "height", "fps"]) {
    if (!isFiniteNumber(value[field]) || value[field] <= 0) {
      fail(`output.${field} は 0 より大きい有限数である必要があります`);
    }
  }
  validateLook(value.look);
  validateEncoding(value.encoding);
}

function validateEncoding(value) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail("output.encoding は object である必要があります");
    return;
  }
  for (const key of Object.keys(value)) if (key !== "quality" && key !== "encoder") fail(`output.encoding に未知のキーがあります: ${key}`);
  if (hasOwn(value, "quality") && !["master", "high", "standard", "light"].includes(value.quality)) {
    fail("output.encoding.quality は master/high/standard/light のいずれかである必要があります");
  }
  if (hasOwn(value, "encoder") && !["auto", "videotoolbox", "nvenc", "qsv", "amf", "mf", "x264"].includes(value.encoder)) {
    fail("output.encoding.encoder は auto/videotoolbox/nvenc/qsv/amf/mf/x264 のいずれかである必要があります");
  }
}

function validateLook(value) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail("output.look は object である必要があります");
    return;
  }
  validateNonEmptyString(value.lut, "output.look.lut");
  if (hasOwn(value, "intensity")) {
    if (!isFiniteNumber(value.intensity) || value.intensity < 0 || value.intensity > 1) {
      fail("output.look.intensity は 0 から 1 の範囲の有限数である必要があります");
    }
  }
}

function validateSourceV0(value) {
  if (!isPlainObject(value)) {
    fail("source は object である必要があります");
    return;
  }
  validateNonEmptyString(value.path, "source.path");
  validateProxy(value.proxy, "source.proxy", false);
  validateChromaKey(value.chroma_key, "source.chroma_key");
}

function validateChromaKey(value, label) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  validateNonEmptyString(value.color, `${label}.color`);
  for (const field of ["similarity", "blend"]) {
    if (hasOwn(value, field)) {
      if (!isFiniteNumber(value[field]) || value[field] < 0 || value[field] > 1) {
        fail(`${label}.${field} は 0 から 1 の範囲の有限数である必要があります`);
      }
    }
  }
  if (hasOwn(value, "background")) {
    validateNonEmptyString(value.background, `${label}.background`);
  }
}

function validateSourcesV1(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("sources は 1 件以上の配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, source] of value.entries()) {
    const label = `sources[${index}]`;
    if (!isPlainObject(source)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    validateNonEmptyString(source.id, `${label}.id`);
    if (typeof source.id === "string") {
      if (ids.has(source.id)) fail(`sources[].id が重複しています: ${source.id}`);
      ids.add(source.id);
    }
    validateNonEmptyString(source.path, `${label}.path`);
    validateProxy(source.proxy, `${label}.proxy`, true);
    validateChromaKey(source.chroma_key, `${label}.chroma_key`);
  }
}

function validateCuts(value, version, sources) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("cuts は配列である必要があります");
    return;
  }
  const sourceIds = new Set(
    Array.isArray(sources)
      ? sources.filter(isPlainObject).map((source) => source.id).filter(isNonEmptyString)
      : [],
  );
  for (const [index, cut] of value.entries()) {
    const label = `cuts[${index}]`;
    if (!isPlainObject(cut)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (!isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) {
      fail(`${label}.in/out は有限数である必要があります`);
    } else if (cut.in < 0 || cut.out <= cut.in) {
      fail(`${label} は 0 <= in < out を満たす必要があります`);
    }
    if (version === 0 && hasOwn(cut, "src")) {
      fail(`${label}.src は version 0 では使用できません`);
    }
    if (version === 1) {
      validateNonEmptyString(cut.src, `${label}.src`);
      if (isNonEmptyString(cut.src) && !sourceIds.has(cut.src)) {
        fail(`${label}.src が sources[].id を参照していません: ${cut.src}`);
      }
    }
    if (hasOwn(cut, "speed")) {
      if (!isFiniteNumber(cut.speed) || cut.speed <= 0) {
        fail(`${label}.speed は 0 より大きい有限数である必要があります`);
      }
    }
    if (hasOwn(cut, "at")) {
      if (!isFiniteNumber(cut.at) || cut.at < 0) {
        fail(`${label}.at は 0 以上の有限数である必要があります`);
      }
    }
    if (hasOwn(cut, "track")) {
      if (!Number.isInteger(cut.track) || cut.track < 0) {
        fail(`${label}.track は 0 以上の整数である必要があります`);
      }
    }
    if (hasOwn(cut, "opacity")) {
      if (!isFiniteNumber(cut.opacity) || cut.opacity < 0 || cut.opacity > 1) {
        fail(`${label}.opacity は 0 から 1 の範囲の有限数である必要があります`);
      }
    }
    if (hasOwn(cut, "transform")) {
      validateCutTransform(cut.transform, `${label}.transform`);
    }
    validateTransitionOut(cut.transition_out, `${label}.transition_out`);
    if (hasOwn(cut, "framing")) {
      validateCutFraming(cut.framing, `${label}.framing`);
    }
    validateCutFreeze(cut, label);
    if (hasOwn(cut, "fx")) {
      validateCutFxList(cut.fx, `${label}.fx`);
    }
  }
}

// docs/contract-2026-08-05-fx-v0.md: cuts[].fx = [{id, intensity, params?}]。2026-08-11 撤去
// 以降、id は enum ではなく空でない文字列（presets/fx/ の FX_BUILDERS に未登録の id は
// render 側が警告 + no-op で通す — ここでは形だけを検証する）。intensity 省略時は render 側の
// 既定 1 を使うため、ここでは範囲だけを検証する。
function validateCutFxList(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} は配列である必要があります`);
    return;
  }
  value.forEach((item, index) => validateCutFx(item, `${label}[${index}]`));
}

function validateCutFx(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["id", "intensity", "params"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`${label} に未知のキーがあります: ${key}`);
    }
  }
  if (!isNonEmptyString(value.id)) {
    fail(`${label}.id は空でない文字列である必要があります`);
  }
  if (hasOwn(value, "intensity") && (!isFiniteNumber(value.intensity) || value.intensity < 0 || value.intensity > 1)) {
    fail(`${label}.intensity は 0 から 1 の範囲の有限数である必要があります`);
  }
  if (hasOwn(value, "params")) {
    if (!isPlainObject(value.params)) {
      fail(`${label}.params は object である必要があります`);
    } else {
      if (hasOwn(value.params, "color") && !isNonEmptyString(value.params.color)) {
        fail(`${label}.params.color は空でない文字列である必要があります`);
      }
      for (const key of Object.keys(value.params)) {
        if (key !== "color") {
          fail(`${label}.params に未知のキーがあります: ${key}`);
        }
      }
    }
  }
}

// docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing). Mirrors validateCutTransform's
// convention: the schema marks framing/crop/each keyframe point additionalProperties:false, and
// this hand-written unknown-key loop is what actually enforces it (validate-edit.mjs does not
// run edit.schema.json through a JSON Schema validator -- see the header comment -- so every
// constraint the schema documents must also be reproduced here by hand).
function validateCutFraming(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["crop", "keyframes"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  if (hasOwn(value, "crop")) {
    validateCutCrop(value.crop, `${label}.crop`);
  }
  if (hasOwn(value, "keyframes")) {
    validateCutFramingKeyframes(value.keyframes, `${label}.keyframes`);
  }
}

function validateCutCrop(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["x", "y", "w", "h"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label} に未知のキーがあります: ${key}`);
  }
  for (const field of ["x", "y"]) {
    if (!isFiniteNumber(value[field]) || value[field] < 0 || value[field] > 1) {
      fail(`${label}.${field} は 0 から 1 の範囲の有限数である必要があります`);
    }
  }
  for (const field of ["w", "h"]) {
    if (!isFiniteNumber(value[field]) || value[field] <= 0 || value[field] > 1) {
      fail(`${label}.${field} は 0 より大きく 1 以下の有限数である必要があります`);
    }
  }
  if (isFiniteNumber(value.x) && isFiniteNumber(value.w) && value.x + value.w > 1 + 1e-9) {
    fail(`${label} は x + w <= 1（クロップ窓がキャンバス内に収まる）を満たす必要があります`);
  }
  if (isFiniteNumber(value.y) && isFiniteNumber(value.h) && value.y + value.h > 1 + 1e-9) {
    fail(`${label} は y + h <= 1（クロップ窓がキャンバス内に収まる）を満たす必要があります`);
  }
}

function validateCutFramingKeyframes(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    fail(`${label} は 2 件以上の配列である必要があります（2 点でズーム・3 点以上で段階縮小）`);
    return;
  }
  const allowedKeys = new Set(["t", "scale", "cx", "cy"]);
  let previousT = null;
  value.forEach((point, index) => {
    const pointLabel = `${label}[${index}]`;
    if (!isPlainObject(point)) {
      fail(`${pointLabel} は object である必要があります`);
      return;
    }
    for (const key of Object.keys(point)) {
      if (!allowedKeys.has(key)) fail(`${pointLabel} に未知のキーがあります: ${key}`);
    }
    const hasT = isFiniteNumber(point.t) && point.t >= 0;
    if (!hasT) {
      fail(`${pointLabel}.t は 0 以上の有限数である必要があります`);
    } else if (previousT !== null && point.t <= previousT) {
      fail(`${label}[].t は昇順かつ重複禁止です（${pointLabel} で違反）`);
    }
    if (hasT) previousT = point.t;
    if (!isFiniteNumber(point.scale) || point.scale <= 0) {
      fail(`${pointLabel}.scale は 0 より大きい有限数である必要があります`);
    }
    for (const field of ["cx", "cy"]) {
      if (hasOwn(point, field) && (!isFiniteNumber(point[field]) || point[field] < 0 || point[field] > 1)) {
        fail(`${pointLabel}.${field} は 0 から 1 の範囲の有限数である必要があります`);
      }
    }
  });
}

// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze). at_sec must not exceed the
// cut's own playable duration -- a sibling-value comparison against in/out/speed that JSON
// Schema cannot express on its own (mirrors cutSpeed's default in render-cut's
// cut-timeline.mjs: speed omitted -> 1, so the same default is used here for parity).
function validateCutFreeze(cut, label) {
  const value = cut.freeze;
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail(`${label}.freeze は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["at_sec", "duration_sec"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label}.freeze に未知のキーがあります: ${key}`);
  }
  const hasAt = isFiniteNumber(value.at_sec) && value.at_sec >= 0;
  if (!hasAt) {
    fail(`${label}.freeze.at_sec は 0 以上の有限数である必要があります`);
  }
  if (!isFiniteNumber(value.duration_sec) || value.duration_sec <= 0) {
    fail(`${label}.freeze.duration_sec は 0 より大きい有限数である必要があります`);
  }
  if (hasAt && isFiniteNumber(cut.in) && isFiniteNumber(cut.out) && cut.out > cut.in) {
    const speed = isFiniteNumber(cut.speed) && cut.speed > 0 ? cut.speed : 1;
    const base = (cut.out - cut.in) / speed;
    if (value.at_sec > base + 1e-9) {
      fail(`${label}.freeze.at_sec はカットの再生尺（${base}秒）を超えられません`);
    }
  }
}

function validateCutTransform(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const allowedKeys = new Set(["x", "y", "scale", "rotate"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`${label} に未知のキーがあります: ${key}`);
    }
  }
  for (const field of ["x", "y", "rotate"]) {
    if (hasOwn(value, field) && !isFiniteNumber(value[field])) {
      fail(`${label}.${field} は有限数である必要があります`);
    }
  }
  if (hasOwn(value, "scale") && (!isFiniteNumber(value.scale) || value.scale <= 0)) {
    fail(`${label}.scale は 0 より大きい有限数である必要があります`);
  }
}

function validateTransitionOut(value, label) {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  if (!TRANSITION_TYPE_IDS.includes(value.type)) {
    fail(`${label}.type は ${TRANSITION_TYPE_IDS.join("/")} のいずれかである必要があります`);
  }
  if (!isFiniteNumber(value.duration) || value.duration <= 0) {
    fail(`${label}.duration は 0 より大きい有限数である必要があります`);
  }
}

function validateProxy(value, label, required) {
  if (value === undefined && !required) return;
  if (value !== null && !isNonEmptyString(value)) {
    fail(`${label} は null または空でない文字列である必要があります`);
  }
}

function validateNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) fail(`${label} は空でない文字列である必要があります`);
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
    console.error(`NG: ${editPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${editPath}`);
  process.exit(0);
}
