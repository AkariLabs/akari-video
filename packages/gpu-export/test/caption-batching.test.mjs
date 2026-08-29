import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("stable measurements require two consecutive equal attempts and fail closed at 32", () => {
  const resolveStableMeasurement = new Function(
    "CAPTION_MEASURE_UNSTABLE_REASON",
    `return (${functionSource("resolveStableMeasurement")})`,
  )("caption-measure-unstable");
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  assert.deepEqual(resolveStableMeasurement([{ y: 1 }, { y: 1 }], 8, equal), {
    measurement: { y: 1 }, attempts: 2,
  });
  assert.deepEqual(resolveStableMeasurement([{ y: 1 }, { y: 2 }, { y: 2 }], 8, equal), {
    measurement: { y: 2 }, attempts: 3,
  });
  assert.throws(
    () => resolveStableMeasurement(Array.from({ length: 32 }, (_, y) => ({ y })), 32, equal),
    (error) => error.code === "caption-measure-unstable" && /after 32 attempts/u.test(error.message),
  );
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
