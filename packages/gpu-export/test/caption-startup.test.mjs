import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
const electronSource = await readFile(join(import.meta.dirname, "..", "src", "electron-main.mjs"), "utf8");

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

async function loadExtracted(moduleSource) {
  const dir = await mkdtemp(join(tmpdir(), "akari-caption-startup-"));
  const file = join(dir, "extracted.mjs");
  await writeFile(file, moduleSource, "utf8");
  return import(pathToFileURL(file).href);
}

test("font samples preserve first-seen code points, remove duplicates, and keep the empty fallback", async () => {
  const { dedupeFontSample } = await loadExtracted(
    `${functionSource("dedupeFontSample")}\nexport { dedupeFontSample };`,
  );
  assert.equal(dedupeFontSample("字字幕字😀😀幕"), "字幕😀");
  assert.equal(dedupeFontSample(""), "字幕");
  assert.match(source, /document\.fonts\.load\(fontDeclaration, fontSample\)/u);
  assert.match(source, /document\.fonts\.check\(fontDeclaration, fontSample\)/u);
  assert.match(source, /captionFontCheckCache\.set\(fontCheckKey, true\)/u);
});

test("stable measurement keys contain only the five declared inputs and preserve variant order", async () => {
  const extracted = await loadExtracted(
    `export default (varsCss) => { ${functionSource("captionMeasurementKey")} return captionMeasurementKey; };`,
  );
  const captionMeasurementKey = extracted.default(
    (vars) => Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(";"),
  );
  const value = { vars: { "--caption-size": "64px" } };
  const config = { width: 1920, height: 1080 };
  const left = captionMeasurementKey(value, config, "<p>字幕</p>", [".a{}", ".b{}"], 2);
  const right = captionMeasurementKey(value, config, "<p>字幕</p>", [".b{}", ".a{}"], 2);
  assert.deepEqual(JSON.parse(left), [1920, 1080, "--caption-size:64px", "<p>字幕</p>", 2, [".a{}", ".b{}"]]);
  assert.notEqual(left, right);
  assert.match(source, /stableResults\.set\(contentKey, stable\.measurement\)/u);
  assert.match(source, /reusedStableCalls \+= 1/u);
});

test("each caption batch rasterizes its SVG once and blits bands from the intermediate sheet", () => {
  const raster = source.slice(
    source.indexOf("async function rasterizeCaptionBatch"),
    source.indexOf("function releaseCaptionUnit"),
  );
  assert.equal(raster.match(/drawImage\(image, 0, 0\)/gu)?.length, 1);
  assert.match(raster, /context\.drawImage\(sheet, 0, band\.offsetY, config\.width, band\.height, 0, 0, config\.width, band\.height\)/u);
  assert.match(raster, /sheet\.width = 0;\s*sheet\.height = 0;/u);
});

test("caption batch prefetch runs before the frame loop without recording frame-loop batch stages", () => {
  const prefetchStart = source.indexOf("let captionPrefetchBytes = 0");
  const frameLoopStart = source.indexOf("for (let frameNumber = 0;");
  assert.ok(prefetchStart >= 0 && prefetchStart < frameLoopStart);
  const prefetch = source.slice(prefetchStart, source.indexOf('const overlayFrame = document.getElementById("akari-overlays")'));
  assert.match(prefetch, /CAPTION_PREFETCH_MAX_BYTES/u);
  assert.match(prefetch, /prefetchedBatches \+= 1/u);
  assert.match(prefetch, /await yieldMacrotask\(\)/u);
  assert.doesNotMatch(prefetch, /stages\.captionRasterBatch\.push/u);
  assert.match(source.slice(frameLoopStart), /stages\.captionRasterBatch\.push\(elapsed\)/u);
});

test("unstable measurement degrades one unit to a sprite and fault injection stays opt-in", () => {
  const builder = source.slice(source.indexOf("async function buildCaptionUnits"), source.indexOf("function buildCaptionBatches"));
  assert.match(builder, /error\?\.code !== CAPTION_MEASURE_UNSTABLE_REASON/u);
  assert.match(builder, /unitMeasurement = error\.lastMeasurement\?\.\[0\]/u);
  assert.match(builder, /mode = "sprite"/u);
  assert.match(builder, /degraded to sprite: \$\{CAPTION_MEASURE_UNSTABLE_REASON\}/u);
  assert.match(source, /error\.lastMeasurement = sequence\.at\(-1\)/u);
  assert.match(source, /config\.captionMeasureFault\s*\? captionMeasureFaultMatches/u);
  assert.match(electronSource, /process\.env\.AKARI_GPU_CAPTION_MEASURE_FAULT\s*\? \{ captionMeasureFault:/u);
  assert.doesNotMatch(electronSource, /captionMeasureFault:\s*"all"/u);
});

test("caption measurement settles every variant within the shared measurement-root scope", () => {
  const builder = source.slice(source.indexOf("async function buildCaptionUnits"), source.indexOf("function buildCaptionBatches"));
  assert.match(source, /const CAPTION_MEASURE_ROOT_CLASS = "akari-measure-root"/u);
  assert.match(source, /root\.className = CAPTION_MEASURE_ROOT_CLASS/u);
  assert.match(builder, /const measureSettleCss = `\.\$\{CAPTION_MEASURE_ROOT_CLASS\} \*\{animation-play-state:paused!important;animation-delay:-\$\{Math\.max\(0, Number\(settled\) \|\| 0\)\}s!important\}`/u);
  assert.doesNotMatch(builder, /const measureSettleCss = `\*\{/u);
  assert.equal(builder.match(/\$\{measureSettleCss\}/gu)?.length, 6);
  assert.match(builder, /captionRoot\(value, config, html, `\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}`\)/u);
  assert.match(builder, /const unitCss = `\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}\$\{captionUnitCss\(revealIndex\)\}`/u);
  assert.match(builder, /`\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}\$\{baseCss\}`/u);
  assert.match(builder, /`\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}\$\{highlightCss\}`/u);
  assert.match(builder, /`\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}\$\{plateCss\}`/u);
  assert.match(builder, /`\$\{CAPTION_WORD_FREEZE_CSS\}\$\{measureSettleCss\}\$\{textCss\}`/u);
});

test("caption raster band CSS keeps the original unscoped settle rule", () => {
  const builder = source.slice(source.indexOf("async function buildCaptionUnits"), source.indexOf("function buildCaptionBatches"));
  assert.match(builder, /const settleCss = `\*\{animation-play-state:paused!important;animation-delay:-\$\{Math\.max\(0, Number\(settled\) \|\| 0\)\}s!important\}`/u);
  const assignments = [...builder.matchAll(/bandCss = \[[^\n]+\];/gu)].map(([assignment]) => assignment);
  assert.equal(assignments.length, 4);
  for (const assignment of assignments) {
    assert.match(assignment, /\$\{settleCss\}/u);
    assert.doesNotMatch(assignment, /measureSettleCss/u);
  }
});
