import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("caption rasters are lazy, cropped, released, and timed separately", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const builder = source.slice(source.indexOf("async function buildCaptionUnits"), source.indexOf("async function embeddedCaptionFont"));
  assert.doesNotMatch(builder, /rasterizeCaptionState\s*\(/u);
  assert.match(source, /await registerCaptionUnit\(unit, config, spriteCompositor\)/u);
  assert.match(source, /releaseCaptionUnit\(unit, spriteCompositor\)/u);
  assert.match(source, /spriteCompositor\.releaseSprite\(unit\.id\)/u);
  assert.match(source, /canvas\.width = 0;\s*canvas\.height = 0;/u);
  assert.match(source, /context\.drawImage\(image, 0, -textureRect\.y\)/u);
  assert.match(source, /captionRaster: \[\]/u);
  assert.doesNotMatch(source, /unit\.canvases/u);
});

test("caption font embedding is one cached raster-only substitution", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  assert.match(source, /let captionFontDataUrlPromise = null/u);
  assert.match(source, /captionFontDataUrlPromise \?\?=/u);
  assert.doesNotMatch(source, /for \(const caption of config\.spriteManifest\.captions\).*replaceAll/u);
  assert.match(source, /document\.fonts\.check\(fontDeclaration, fontSample\)/u);
  assert.match(source, /font is not ready for measurement/u);
  assert.match(source, /const embeddedSvg = svg\.replaceAll\("\/caption-font\.ttf", fontDataUrl\)/u);
});

test("small SVG validation precedes font embedding and each raster yields a macrotask", async () => {
  const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  const raster = source.slice(
    source.indexOf("async function rasterizeCaptionState"),
    source.indexOf("async function registerCaptionUnit"),
  );
  assert.ok(raster.indexOf("assertCaptionSvg(svg") < raster.indexOf("decodeCaptionSvg(svg"));
  const register = source.slice(
    source.indexOf("async function registerCaptionUnit"),
    source.indexOf("function releaseCaptionUnit"),
  );
  assert.ok(register.indexOf("canvas.height = 0") < register.indexOf("await yieldMacrotask()"));
});
