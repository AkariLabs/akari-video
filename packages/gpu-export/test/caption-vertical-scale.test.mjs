import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/page-runtime.js", import.meta.url), "utf8");

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

const rasterBand = new Function(
  "serializeHtmlToXhtml", "scopeCaptionCss", "isolateCaptionFragmentStyles", "varsCss",
  `return (${functionSource("captionRasterBand")})`,
)((html) => html, (css) => css, (html) => html,
  (vars) => Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";"));
const batchSvg = new Function("captionRasterBand", "removeDuplicateCaptionFontFaces",
  `return (${functionSource("captionBatchRasterSvg")})`)(rasterBand, (svg) => svg);

test("caption measurement retains the unscaled used plate width", () => {
  const relativeRect = new Function(`return (${functionSource("relativeRect")})`)();
  const measure = new Function("getComputedStyle", "relativeRect", `return (${functionSource("measureCaptionUnit")})`)(
    () => ({ fontSize: "45px", width: "108px" }), relativeRect,
  );
  const plate = { getBoundingClientRect: () => ({ left: 938, top: 500, right: 1154, bottom: 1100, width: 216, height: 600 }) };
  const root = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    querySelector: (selector) => selector === ".akari-caption__plate" ? plate : root,
    querySelectorAll: () => [],
  };
  assert.equal(measure(root, 0).plateLayoutWidthPx, 108);
});

function bandStyle(scale, vertical, plateLayoutWidthPx) {
  const value = { vars: {
    "--caption-scale": String(scale),
    "--caption-left": "48.86%",
    ...(vertical ? { "--caption-writing-mode": "vertical-rl" } : {}),
    "--caption-width": "max-content",
  } };
  return batchSvg({ units: [{ value, html: '<div class="akari-caption"><div class="akari-caption__plate"/></div>',
    sharedCss: "", bandCss: [""], textureRect: { y: 400, height: 200 }, plateLayoutWidthPx }] },
  { width: 1920, height: 1080 }).svg;
}

function rasterPlateWidth(svg) {
  const match = svg.match(/--caption-width:([\d.]+)px/u);
  assert.ok(match, "raster must use the measured plate width");
  return Number(match[1]);
}

test("vertical caption scale 2 and 3 retain the measured plate center used by OSR", () => {
  // For a plate at x = 48.86% of 1920, OSR scales its measured 108px box about its center.
  // The unscaled left ink starts 26px inside that box (L = 964); the corresponding
  // OSR edge formula gives L = 936 and 908, within 1px of the observed 936 and 909.
  const inkInset = 26;
  const measuredPlateWidth = 108;
  for (const [scale, osrLeft] of [[2, 936], [3, 909]]) {
    const svg = bandStyle(scale, true, measuredPlateWidth);
    const width = rasterPlateWidth(svg);
    const anchorLeft = 1920 * Number(svg.match(/--caption-left:([\d.]+)%/u)?.[1]) / 100;
    const gpuLeft = anchorLeft + scale * inkInset - (scale - 1) * width / 2;
    assert.ok(Math.abs(gpuLeft - osrLeft) <= 2, `scale ${scale}: gpu ${gpuLeft}, osr ${osrLeft}`);
  }
});

test("horizontal captions and scale 1 keep their existing max-content width", () => {
  for (const [scale, vertical] of [[1, true], [1, false], [3, false]]) {
    const svg = bandStyle(scale, vertical, 108);
    assert.match(svg, /--caption-width:max-content(?:;|"|&)/u);
    assert.equal(svg, bandStyle(scale, vertical, undefined));
  }
});

test("buildCaptionUnits passes the measured width to the raster batch", () => {
  assert.match(source, /plateLayoutWidthPx:\s*unitMeasurement\.plateLayoutWidthPx/u);
  assert.match(functionSource("captionBatchRasterSvg"), /unit\.plateLayoutWidthPx/u);
});
