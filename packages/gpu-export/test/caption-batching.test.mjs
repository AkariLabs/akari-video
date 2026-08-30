import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
const frameEngineSource = await readFile(join(import.meta.dirname, "..", "generated", "frame-engine.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("stable measurements require two consecutive diff-free attempts and expose prior differences", () => {
  const resolveStableMeasurement = new Function(
    "CAPTION_MEASURE_UNSTABLE_REASON",
    `return (${functionSource("resolveStableMeasurement")})`,
  )("caption-measure-unstable");
  const diff = (left, right) => left.y === right.y ? [] : [{ field: "y", previous: left.y, current: right.y, delta: right.y - left.y }];
  assert.deepEqual(resolveStableMeasurement([{ y: 1 }, { y: 1 }], 8, diff), {
    measurement: { y: 1 }, attempts: 2, differences: [],
  });
  assert.deepEqual(resolveStableMeasurement([{ y: 1 }, { y: 2 }, { y: 2 }], 8, diff), {
    measurement: { y: 2 }, attempts: 3,
    differences: [{ field: "y", previous: 1, current: 2, delta: 1, previousAttempt: 1, currentAttempt: 2 }],
  });
  assert.throws(
    () => resolveStableMeasurement(Array.from({ length: 32 }, (_, y) => ({ y })), 32, diff),
    (error) => error.code === "caption-measure-unstable"
      && error.differences.length === 31
      && /after 32 attempts/u.test(error.message),
  );
});

test("caption measurement diff exactly matches frame-engine strict equality and fixes diagnostic shape", () => {
  const serializableMeasurementValue = new Function(`return (${functionSource("serializableMeasurementValue")})`)();
  const captionMeasurementVariantsDiff = new Function(
    "CAPTION_RECT_KEYS",
    "serializableMeasurementValue",
    `return (${functionSource("captionMeasurementVariantsDiff")})`,
  )(["x", "y", "width", "height", "right", "bottom"], serializableMeasurementValue);
  const frameFunction = (name) => {
    const start = frameEngineSource.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `missing generated FE ${name}`);
    const open = frameEngineSource.indexOf("{", start);
    let depth = 0;
    for (let index = open; index < frameEngineSource.length; index += 1) {
      if (frameEngineSource[index] === "{") depth += 1;
      else if (frameEngineSource[index] === "}" && --depth === 0) return frameEngineSource.slice(start, index + 1);
    }
    throw new Error(`unterminated generated FE ${name}`);
  };
  const feEqual = new Function(
    "RECT_KEYS",
    `${frameFunction("captionRectsEqual")};${frameFunction("captionTimingsEqual")};return (${frameFunction("captionMeasurementsEqual")});`,
  )(["x", "y", "width", "height", "right", "bottom"]);
  const rect = { x: 1, y: 2, width: 3, height: 4, right: 4, bottom: 6 };
  const measurement = {
    emPx: 20, wordCount: 1, reveal: false, revealDelay: 0, revealDuration: 0.2,
    plate: { ...rect }, lines: [{ ...rect }],
    tokens: [{
      tokenIndex: 0, rectIndex: 0, role: "pop", style: "pop", lineIndex: 0, rect: { ...rect },
      timing: { role: "pop", delaySec: 0.1, durationSec: 0.2, emPx: 20 },
    }],
  };
  const clone = (value) => structuredClone(value);
  const variants = [
    clone(measurement),
    Object.assign(clone(measurement), { emPx: 21 }),
    Object.assign(clone(measurement), { wordCount: 2 }),
    Object.assign(clone(measurement), { reveal: true }),
    Object.assign(clone(measurement), { revealDelay: 0.1 }),
    Object.assign(clone(measurement), { revealDuration: 0.3 }),
  ];
  for (const key of ["x", "y", "width", "height", "right", "bottom"]) {
    const plate = clone(measurement); plate.plate[key] += 0.25; variants.push(plate);
    const line = clone(measurement); line.lines[0][key] += 0.5; variants.push(line);
    const token = clone(measurement); token.tokens[0].rect[key] += 0.75; variants.push(token);
  }
  for (const key of ["tokenIndex", "rectIndex", "role", "style", "lineIndex"]) {
    const changed = clone(measurement);
    changed.tokens[0][key] = typeof changed.tokens[0][key] === "number" ? changed.tokens[0][key] + 1 : `${changed.tokens[0][key]}-changed`;
    variants.push(changed);
  }
  for (const key of ["role", "delaySec", "durationSec", "emPx"]) {
    const changed = clone(measurement);
    changed.tokens[0].timing[key] = typeof changed.tokens[0].timing[key] === "number"
      ? changed.tokens[0].timing[key] + 0.1 : "plain";
    variants.push(changed);
  }
  variants.push(Object.assign(clone(measurement), { plate: null }));
  variants.push(Object.assign(clone(measurement), { lines: [] }));
  variants.push(Object.assign(clone(measurement), { tokens: [] }));

  for (const current of variants) {
    const differences = captionMeasurementVariantsDiff([measurement], [current], { cueId: "c-1", unitIndex: 2 });
    assert.equal(differences.length === 0, feEqual(measurement, current));
  }
  const differences = captionMeasurementVariantsDiff([measurement], [variants[1]], { cueId: "c-1", unitIndex: 2 });
  assert.deepEqual(differences[0], {
    cueId: "c-1", unitIndex: 2, variantIndex: 0, tokenIndex: null, rectIndex: null,
    role: "measurement", field: "emPx", previous: 20, current: 21, delta: 1,
  });
});

test("caption difference summaries keep deterministic top 20 by absolute delta", () => {
  const measurementDiffSortKey = new Function(`return (${functionSource("measurementDiffSortKey")})`)();
  const summarize = new Function(
    "CAPTION_MEASURE_DIFF_LIMIT",
    "measurementDiffSortKey",
    `return (${functionSource("summarizeCaptionMeasurementDiffs")})`,
  )(20, measurementDiffSortKey);
  const values = Array.from({ length: 25 }, (_, index) => ({
    cueId: "c-1", unitIndex: 0, variantIndex: 0, tokenIndex: index, rectIndex: 0,
    role: "plain", field: "y", previous: 0, current: index, delta: index,
  })).reverse();
  const summary = summarize(values);
  assert.deepEqual({
    totalCount: summary.totalCount,
    shownCount: summary.shownCount,
    truncated: summary.truncated,
    deltas: summary.entries.map((entry) => entry.delta),
  }, {
    totalCount: 25, shownCount: 20, truncated: true,
    deltas: Array.from({ length: 20 }, (_, index) => 24 - index),
  });
});

test("caption measurement roots are frozen in the same settled state the raster uses", () => {
  const build = functionSource("buildCaptionUnits");
  const stable = functionSource("measureCaptionVariantsStable");
  const key = functionSource("captionMeasurementKey");
  // Measurement and raster must observe the same settled state, while the measurement rule stays
  // scoped to its hidden root so it cannot pause unrelated page animation.
  assert.match(build, /const settleCss = `\*\{animation-play-state:paused!important;animation-delay:-\$\{[^`]+\}s!important\}`;/u);
  assert.match(build, /const measureSettleCss = `\.\$\{CAPTION_MEASURE_ROOT_CLASS\} \*\{animation-play-state:paused!important;animation-delay:-\$\{[^`]+\}s!important\}`;/u);

  const freezeUses = build.match(/\$\{CAPTION_WORD_FREEZE_CSS\}/gu) ?? [];
  const settledFreezeUses = build.match(/\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}/gu) ?? [];
  assert.equal(freezeUses.length, 6);
  assert.equal(settledFreezeUses.length, 6);

  const bandAssignments = [...build.matchAll(/bandCss = \[([^\n]+)\];/gu)].map((match) => match[1]);
  assert.equal(bandAssignments.length, 4);
  assert.equal(bandAssignments.every((assignment) => assignment.includes("${settleCss}")), true);
  assert.equal(bandAssignments.some((assignment) => assignment.includes("measureSettleCss")), false);

  assert.match(key, /function captionMeasurementKey\(value, config, html, cssVariants, unitIndex\)/u);
  assert.match(key, /\n\s*cssVariants,\n/u);
  assert.match(stable, /const contentKey = captionMeasurementKey\(value, config, html, cssVariants, unitIndex\);/u);
  const stableResultKeys = [...stable.matchAll(/stableResults\.(?:has|get|set)\(([^,)]+)/gu)].map((match) => match[1]);
  assert.deepEqual(stableResultKeys, ["contentKey", "contentKey", "contentKey"]);
  assert.match(stable, /if \(!faultInjected\) error\.lastMeasurement = sequence\.at\(-1\);/u);
});

test("caption batches preserve order and split at eight units or 4096 pixels", () => {
  const buildCaptionBatches = new Function(
    "CAPTION_BATCH_MAX_UNITS",
    "CAPTION_BATCH_MAX_HEIGHT_PX",
    `return (${functionSource("buildCaptionBatches")})`,
  )(8, 4096);
  const unit = (id, height, bands = 1) => ({ id, textureRect: { height }, bandCss: Array(bands).fill("x") });
  const byCount = Array.from({ length: 10 }, (_, index) => unit(`u-${index}`, 100));
  const countBatches = buildCaptionBatches(byCount);
  assert.deepEqual(countBatches.map((batch) => batch.units.map((entry) => entry.id)), [
    ["u-0", "u-1", "u-2", "u-3", "u-4", "u-5", "u-6", "u-7"],
    ["u-8", "u-9"],
  ]);
  const byHeight = [unit("a", 1000, 2), unit("b", 1000, 2), unit("c", 100, 1)];
  assert.deepEqual(buildCaptionBatches(byHeight).map((batch) => batch.units.map((entry) => entry.id)), [
    ["a", "b"], ["c"],
  ]);
});

test("variant CSS is scoped per band and rejects at-rules", () => {
  const scopeCaptionCss = new Function(`return (${functionSource("scopeCaptionCss")})`)();
  assert.equal(
    scopeCaptionCss(".a,.b{color:red}.c{opacity:0}", '[data-akari-band="2"]'),
    '[data-akari-band="2"] .a,[data-akari-band="2"] .b{color:red}[data-akari-band="2"] .c{opacity:0}',
  );
  assert.throws(() => scopeCaptionCss("@media all{.a{color:red}}", ".band"), /at-rules/u);
});

test("only the first placeholder font-face survives while unrelated fonts remain", () => {
  const matchingBrace = (value, open) => {
    let depth = 0;
    for (let index = open; index < value.length; index += 1) {
      if (value[index] === "{") depth += 1;
      else if (value[index] === "}" && --depth === 0) return index;
    }
    return -1;
  };
  const removeDuplicateCaptionFontFaces = new Function(
    "CAPTION_FONT_PLACEHOLDER",
    "matchingBrace",
    `return (${source.slice(
      source.indexOf("function removeDuplicateCaptionFontFaces"),
      source.indexOf("\n\n  function captionRasterBand"),
    )})`,
  )("/caption-font.ttf", matchingBrace);
  const svg = '<style>@font-face{font-family:a;src:url("/caption-font.ttf")}@font-face{font-family:b;src:url("file.ttf")}@font-face{font-family:a;src:url("/caption-font.ttf")}</style>';
  const result = removeDuplicateCaptionFontFaces(svg);
  assert.equal(result.split("/caption-font.ttf").length - 1, 1);
  assert.match(result, /file\.ttf/u);
});

test("single-band SVG uses a cropped viewBox and explicit foreignObject dimensions", () => {
  const captionRasterSvg = new Function(
    "serializeHtmlToXhtml",
    "scopeCaptionCss",
    "removeDuplicateCaptionFontFaces",
    "varsCss",
    `return (${functionSource("captionRasterSvg")})`,
  )((value) => value, (value) => value, (value) => value, () => "");
  const svg = captionRasterSvg({ vars: {} }, { width: 1920, height: 1080 }, "<div/>", "", "", {
    y: 885, height: 166,
  });
  assert.match(svg, /width="1920" height="166" viewBox="0 885 1920 166"/u);
  assert.match(svg, /<foreignObject x="0" y="0" width="1920" height="1080">/u);
  assert.doesNotMatch(svg, /foreignObject[^>]+100%/u);
});

test("runner persists the unstable-measurement reason and warning", async () => {
  const runner = await readFile(join(import.meta.dirname, "..", "src", "electron-main.mjs"), "utf8");
  assert.match(runner, /reasonCode.*warnings: \[`\$\{reasonCode\}: GPU export failed closed`\]/su);
  assert.match(runner, /message\.includes\(CAPTION_MEASURE_UNSTABLE_REASON\)/u);
});
