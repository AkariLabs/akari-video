import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(packageRoot, "fixtures", "gen-models", "openapi");
const catalog = JSON.parse(readFileSync(join(packageRoot, "gen-models.json"), "utf8"));

const fieldMap = {
  "fal:h3-i2v": { first: "image_url", last: "end_image_url" },
  "fal:h3-ref": {
    references: {
      reference_images: "reference_image_urls",
      reference_videos: "reference_video_urls",
      reference_audios: "reference_audio_urls",
    },
  },
  "fal:kling-v3-standard-i2v": {
    first: "start_image_url",
    last: "end_image_url",
    references: { reference_images: "elements", reference_videos: "elements" },
  },
  "fal:kling-v3-pro-i2v": {
    first: "start_image_url",
    last: "end_image_url",
    references: { reference_images: "elements", reference_videos: "elements" },
  },
  "fal:veo-3.1-flf": { first: "first_frame_url", last: "last_frame_url" },
  "fal:veo-3.1-ref": { references: { reference_images: "image_urls" } },
  "fal:seedance-2.0-i2v": { first: "image_url", last: "end_image_url" },
  "fal:seedance-2.0-ref": {
    references: {
      reference_images: "image_urls",
      reference_videos: "video_urls",
      reference_audios: "audio_urls",
    },
  },
  "fal:seedance-2.5-i2v": { first: "image_url", last: "end_image_url" },
  "fal:wan-2.7-i2v": { first: "image_url", last: "end_image_url" },
  "fal:grok-imagine-i2v": { first: "image_url" },
  "fal:vidu-q3-i2v": { first: "image_url", last: "end_image_url" },
  "fal:nano-banana-pro-edit": { references: { reference_images: "image_urls" } },
};

for (const model of catalog.models.filter((row) => row.provider === "fal")) {
  test(`${model.id} は保存済み OpenAPI と一致する`, () => {
    const fixturePath = join(fixtureRoot, `${model.id.replaceAll(":", "_")}.json`);
    const document = JSON.parse(readFileSync(fixturePath, "utf8"));
    const input = inputSchema(document);
    const mapping = fieldMap[model.id];
    assert.ok(mapping, `${model.id} の OpenAPI 写像がありません`);

    checkFrame(model, input, "first_frame", mapping.first);
    checkFrame(model, input, "last_frame", mapping.last);
    checkReferences(model, input, mapping.references ?? {});
    checkDuration(model, input.properties.duration);
    checkResolutions(model, input.properties.resolution);
    compare(model, "seed", model.seed, Object.hasOwn(input.properties, "seed"));
    checkAudio(model, input.properties);
  });
}

test("保存済み OpenAPI の URL は servers[0].url だけに残る", () => {
  const violations = [];
  for (const model of catalog.models.filter((row) => row.provider === "fal")) {
    const fixtureName = `${model.id.replaceAll(":", "_")}.json`;
    const document = JSON.parse(readFileSync(join(fixtureRoot, fixtureName), "utf8"));
    collectUrlViolations(document, "$", fixtureName, violations);
  }
  if (violations.length > 0) {
    assert.fail(`servers[0].url 以外に URL が残っています:\n${violations.join("\n")}`);
  }
});

function collectUrlViolations(value, jsonPath, fixtureName, violations) {
  if (typeof value === "string") {
    const urls = value.match(/https?:\/\/[^\s<>"'`)\]}]+/g) ?? [];
    if (jsonPath !== "$.servers[0].url") {
      for (const url of urls) violations.push(`${fixtureName} ${jsonPath}: ${url}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectUrlViolations(value[index], `${jsonPath}[${index}]`, fixtureName, violations);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)
      ? `${jsonPath}.${key}`
      : `${jsonPath}[${JSON.stringify(key)}]`;
    collectUrlViolations(child, childPath, fixtureName, violations);
  }
}

function inputSchema(document) {
  const operation = Object.values(document.paths).map((pathItem) => pathItem.post).find(Boolean);
  const reference = operation?.requestBody?.content?.["application/json"]?.schema?.$ref;
  assert.match(reference ?? "", /^#\/components\/schemas\//, "request body の $ref がありません");
  return document.components.schemas[reference.split("/").at(-1)];
}

function checkFrame(model, input, catalogField, openApiField) {
  const propertyExists = Boolean(openApiField && Object.hasOwn(input.properties, openApiField));
  const apiValue = propertyExists
    ? (input.required ?? []).includes(openApiField) ? "required" : "optional"
    : "none";
  compare(model, `inputs.${catalogField}`, model.inputs[catalogField], apiValue);
}

function checkReferences(model, input, mappings) {
  const aliases = {
    reference_images: ["reference_image_urls", "image_urls", "elements"],
    reference_videos: ["reference_video_urls", "video_urls", "elements"],
    reference_audios: ["reference_audio_urls", "audio_urls"],
  };
  for (const catalogField of ["reference_images", "reference_videos", "reference_audios"]) {
    const openApiField = mappings[catalogField]
      ?? aliases[catalogField].find((field) => Object.hasOwn(input.properties, field));
    const property = openApiField ? input.properties[openApiField] : undefined;
    const expectedPresent = model.inputs[catalogField].max !== 0;
    compare(model, `inputs.${catalogField} の有無`, expectedPresent, Boolean(property));
    if (!property) continue;
    compare(model, `inputs.${catalogField} の型`, true, isArraySchema(property));
    const maxItems = arrayKeyword(property, "maxItems");
    // maxItems が無い場合は文書由来の値を残し、配列欄の存在だけを検査する。
    if (maxItems !== undefined) {
      compare(model, `inputs.${catalogField}.max`, model.inputs[catalogField].max, maxItems);
    }
  }
}

function checkDuration(model, property) {
  if (model.duration === null) {
    compare(model, "duration の有無", false, Boolean(property));
    return;
  }
  compare(model, "duration の有無", true, Boolean(property));
  if (!property) return;

  compare(model, "duration.format.type", model.duration.format.type, schemaType(property));
  const rawValues = property.enum ?? (Object.hasOwn(property, "const") ? [property.const] : undefined);
  const auto = rawValues?.includes("auto") ?? false;
  compare(model, "duration.format.auto", model.duration.format.auto ?? false, auto);

  const suffix = detectSuffix(rawValues);
  compare(model, "duration.format.suffix", model.duration.format.suffix ?? null, suffix ?? null);

  if (Object.hasOwn(property, "default")) {
    compare(model, "duration.default", model.duration.default, normalizeDuration(property.default, suffix));
  }

  // 正規化規則: auto は数値集合から除外し、"4s" は suffix を剥がす。
  // OpenAPI の連続整数 enum と range(min/max/step:1) は両方向で同値とする。
  if (rawValues) {
    const apiValues = rawValues
      .filter((value) => value !== "auto")
      .map((value) => normalizeDuration(value, suffix));
    const catalogValues = durationValues(model.duration);
    compareSet(model, "duration.values", catalogValues, apiValues);
    if (model.duration.kind === "range" && isContinuousIntegers(apiValues)) {
      compare(model, "duration.step", model.duration.step, 1);
    }
  } else if (property.minimum !== undefined || property.maximum !== undefined) {
    // enum/min/max が共に無い場合は型と default 以外を検査しない。
    if (property.minimum !== undefined) {
      compare(model, "duration.min", durationMinimum(model.duration), property.minimum);
    }
    if (property.maximum !== undefined) {
      compare(model, "duration.max", durationMaximum(model.duration), property.maximum);
    }
    if (property.minimum !== undefined && property.maximum !== undefined && schemaType(property) === "integer") {
      const apiValues = [];
      for (let value = property.minimum; value <= property.maximum; value += 1) apiValues.push(value);
      compareSet(model, "duration.values", durationValues(model.duration), apiValues);
      if (model.duration.kind === "range") compare(model, "duration.step", model.duration.step, 1);
    }
  }
}

function checkResolutions(model, property) {
  compare(model, "resolutions の有無", model.resolutions !== null, Boolean(property));
  if (!property) return;
  const values = enumValues(property);
  // enum が無い OpenAPI から値を捏造しない。
  if (values) compareSet(model, "resolutions", model.resolutions, values);
}

function checkAudio(model, properties) {
  const field = properties.generate_audio ?? properties.audio;
  if (field) {
    compare(model, "audio_out", model.audio_out, true);
    return;
  }
  // H3 の always は OpenAPI 外の実測事実なので、欄の不在から false を捏造しない。
  if (model.id === "fal:h3-i2v" || model.id === "fal:h3-ref") return;
  compare(model, "audio_out", model.audio_out, false);
}

function enumValues(property) {
  if (Array.isArray(property.enum)) return property.enum;
  for (const branch of property.anyOf ?? []) {
    if (Array.isArray(branch.enum)) return branch.enum;
  }
  return undefined;
}

function arrayKeyword(property, keyword) {
  if (property.type === "array" && Object.hasOwn(property, keyword)) return property[keyword];
  for (const branch of property.anyOf ?? []) {
    if (branch.type === "array" && Object.hasOwn(branch, keyword)) return branch[keyword];
  }
  return undefined;
}

function isArraySchema(property) {
  return property.type === "array" || (property.anyOf ?? []).some((branch) => branch.type === "array");
}

function schemaType(property) {
  if (property.type) return property.type;
  if (Object.hasOwn(property, "const")) return typeof property.const;
  return (property.anyOf ?? []).find((branch) => branch.type && branch.type !== "null")?.type;
}

function detectSuffix(values) {
  if (!values) return undefined;
  const strings = values.filter((value) => typeof value === "string" && value !== "auto");
  if (strings.length === 0) return undefined;
  const suffixes = new Set(strings.map((value) => value.replace(/^[0-9]+/, "")));
  return suffixes.size === 1 && !suffixes.has("") ? [...suffixes][0] : undefined;
}

function normalizeDuration(value, suffix) {
  if (value === "auto" || value === null) return null;
  if (typeof value === "number") return value;
  const normalized = suffix && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  return Number(normalized);
}

function durationValues(duration) {
  if (duration.kind === "enum") return duration.values;
  const values = [];
  for (let value = duration.min; value <= duration.max; value += duration.step) values.push(value);
  return values;
}

function durationMinimum(duration) {
  return duration.kind === "range" ? duration.min : Math.min(...duration.values);
}

function durationMaximum(duration) {
  return duration.kind === "range" ? duration.max : Math.max(...duration.values);
}

function isContinuousIntegers(values) {
  return values.every((value, index) => Number.isInteger(value) && (index === 0 || value === values[index - 1] + 1));
}

function compare(model, field, catalogValue, openApiValue) {
  if (!Object.is(catalogValue, openApiValue)) {
    assert.fail(`${model.id} の ${field} が OpenAPI (${JSON.stringify(openApiValue)}) と一致しません: ${JSON.stringify(catalogValue)}`);
  }
}

function compareSet(model, field, catalogValues, openApiValues) {
  const actual = [...catalogValues].sort(compareValues);
  const expected = [...openApiValues].sort(compareValues);
  if (!isDeepEqual(actual, expected)) {
    assert.fail(`${model.id} の ${field} が OpenAPI (${JSON.stringify(expected)}) と一致しません: ${JSON.stringify(actual)}`);
  }
}

function compareValues(left, right) {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));
}

function isDeepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
