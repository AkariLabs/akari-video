import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("caption rasters are prefetched with a lazy fallback, batched, cropped, released, and timed separately", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const builder = source.slice(source.indexOf("async function buildCaptionUnits"), source.indexOf("async function embeddedCaptionFont"));
  assert.doesNotMatch(builder, /rasterizeCaptionState\s*\(/u);
  assert.match(source, /await rasterizeCaptionBatch\(batch, config, spriteCompositor, captionStartupMetrics\)/u);
  assert.match(source, /releaseCaptionUnit\(unit, spriteCompositor\)/u);
  assert.match(source, /spriteCompositor\.releaseSprite\(unit\.id\)/u);
  assert.match(source, /canvas\.width = 0;\s*canvas\.height = 0;/u);
  assert.match(source, /context\.drawImage\(sheet, 0, band\.offsetY, config\.width, band\.height, 0, 0, config\.width, band\.height\)/u);
  assert.match(source, /captionRaster: \[\]/u);
  assert.match(source, /captionRasterBatch: \[\]/u);
  assert.doesNotMatch(source, /unit\.canvases/u);
});

test("caption font embedding caches one encoded value and splits the SVG around it", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  assert.match(source, /let captionEncodedFontPromise = null/u);
  assert.match(source, /captionEncodedFontPromise \?\?=/u);
  assert.doesNotMatch(source, /for \(const caption of config\.spriteManifest\.captions\).*replaceAll/u);
  assert.match(source, /document\.fonts\.check\(fontDeclaration, fontSample\)/u);
  assert.match(source, /font is not ready for measurement/u);
  assert.match(source, /parts\.map\(encodeURIComponent\)\.join\(encodedFont\)/u);
  assert.doesNotMatch(source, /svg\.replaceAll\("\/caption-font\.ttf"/u);
});

test("small SVG validation precedes font embedding and each batch yields a macrotask", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const raster = source.slice(
    source.indexOf("async function rasterizeCaptionBatch"),
    source.indexOf("function releaseCaptionUnit"),
  );
  assert.ok(raster.indexOf("assertCaptionSvg(raster.svg") < raster.indexOf("decodeCaptionSvg(raster.svg"));
  assert.ok(source.indexOf("canvas.height = 0") < source.indexOf("await yieldMacrotask();", source.indexOf("rasterizeCaptionBatch")));
});
