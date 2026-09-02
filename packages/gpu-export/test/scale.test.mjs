import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

const directory = await mkdtemp(join(tmpdir(), "akari-gpu-scale-"));
const modulePath = join(directory, "scale.mjs");
await writeFile(modulePath, `${functionSource("scaleSurfaceForEncode")}\nexport { scaleSurfaceForEncode };\n`, "utf8");
const { scaleSurfaceForEncode } = await import(pathToFileURL(modulePath).href);

function installOffscreenCanvasMock() {
  const records = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = {
        clearRect: (...args) => records.push(["clearRect", ...args]),
        drawImage: (...args) => records.push(["drawImage", ...args]),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      };
    }
    getContext(kind) { return kind === "2d" ? this.context : null; }
  };
  return records;
}

test("same dimensions pass the source canvas through", () => {
  installOffscreenCanvasMock();
  const sourceCanvas = { id: "source" };
  assert.equal(scaleSurfaceForEncode(sourceCanvas, { width: 1920, height: 1080 }), sourceCanvas);
});

test("downscale draws into a high-quality OffscreenCanvas", () => {
  const records = installOffscreenCanvasMock();
  const sourceCanvas = { id: "source" };
  const scaled = scaleSurfaceForEncode(sourceCanvas, {
    width: 1920, height: 1080, outputWidth: 1280, outputHeight: 720,
  });
  assert.deepEqual([scaled.width, scaled.height], [1280, 720]);
  assert.equal(scaled.context.imageSmoothingEnabled, true);
  assert.equal(scaled.context.imageSmoothingQuality, "high");
  assert.deepEqual(records.at(-1), ["drawImage", sourceCanvas, 0, 0, 1280, 720]);
});

test("upscale reuses the supplied target canvas", () => {
  installOffscreenCanvasMock();
  const sourceCanvas = { id: "source" };
  const reusable = new OffscreenCanvas(10, 10);
  const scaled = scaleSurfaceForEncode(sourceCanvas, {
    width: 1920, height: 1080, outputWidth: 3840, outputHeight: 2160,
  }, reusable);
  assert.equal(scaled, reusable);
  assert.deepEqual([scaled.width, scaled.height], [3840, 2160]);
  assert.deepEqual(scaled.context.drawImage ? scaled.context.imageSmoothingQuality : null, "high");
});
