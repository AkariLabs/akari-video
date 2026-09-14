import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { findChrome } from "../../../akari-tools/bin/avatar-vrm/find-chrome.mjs";
import { renderTextCard } from "../../src/cli/text-card.mjs";

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "akari-text-card-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function stubPuppeteer() {
  return {
    launch: async () => ({
      newPage: async () => ({
        setViewport: async () => {},
        setContent: async () => {},
        evaluate: async () => {},
        screenshot: async ({ path }) => writeFile(path, "chrome"),
      }),
      close: async () => {},
    }),
  };
}

test("text-card: Chrome → ffmpeg drawtext → solid の順で縮退する", async (t) => {
  const directory = await temporaryDirectory(t);
  const font = join(directory, "font.ttf");
  await writeFile(font, "font");
  const cases = [
    {
      expected: "chrome",
      options: { loadPuppeteer: async () => stubPuppeteer(), resolveChrome: () => "/chrome" },
    },
    {
      expected: "ffmpeg-drawtext",
      options: {
        loadPuppeteer: async () => null,
        resolveChrome: () => { throw new Error("Chrome resolver must not run"); },
        resolveBinary: () => "/ffmpeg",
        fontCandidates: [font],
        spawn: () => ({ status: 0, stderr: "" }),
      },
    },
    {
      expected: "solid",
      options: {
        loadPuppeteer: async () => null,
        resolveBinary: () => { throw new Error("ffmpeg unavailable"); },
      },
    },
  ];
  for (const [index, { expected, options }] of cases.entries()) {
    const outPath = join(directory, `${index}.png`);
    const result = await renderTextCard({
      id: "route-test",
      name: "経路テスト",
      prompt: "fallback order",
      outPath,
      logRenderer: () => {},
      ...options,
    });
    assert.deepEqual(result, { path: outPath, renderer: expected });
    if (expected !== "ffmpeg-drawtext") assert.ok((await readFile(outPath)).length > 0);
  }
});

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  let offset = 8;
  let width;
  let height;
  let colorType;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "8-bit PNG expected");
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type: ${colorType}`);
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[source++];
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[source++];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const prediction = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : assert.fail(`unsupported PNG filter: ${filter}`);
      pixels[y * stride + x] = (raw + prediction) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

async function chromeAvailability() {
  let puppeteer;
  try {
    const loaded = await import("puppeteer-core");
    puppeteer = loaded.default ?? loaded;
  } catch {
    return null;
  }
  const executablePath = findChrome();
  return executablePath ? { puppeteer, executablePath } : null;
}

async function renderRealChrome(t, name, filename = "card.png") {
  const available = await chromeAvailability();
  if (!available) {
    t.skip("puppeteer-core または Chrome を解決できないため実 Chrome 検証をスキップ");
    return null;
  }
  const directory = await temporaryDirectory(t);
  const outPath = join(directory, filename);
  const result = await renderTextCard({
    id: "garden-scene",
    name,
    prompt: "静かな部屋から席を立ち、窓の向こうの庭へ歩いていく。午後の自然光。",
    outPath,
    loadPuppeteer: async () => available.puppeteer,
    resolveChrome: () => available.executablePath,
    logRenderer: () => {},
  });
  assert.equal(result.renderer, "chrome");
  return { directory, outPath, buffer: await readFile(outPath), available };
}

test("text-card: 実 Chrome は 1920x1080 の中央帯へ白い文字を描く", async (t) => {
  const rendered = await renderRealChrome(t, "席を立って庭へ");
  if (!rendered) return;
  const png = decodePng(rendered.buffer);
  assert.deepEqual([png.width, png.height], [1920, 1080]);
  let whitePixels = 0;
  for (let y = 360; y < 720; y += 1) {
    for (let x = 200; x < 1720; x += 1) {
      const offset = (y * png.width + x) * png.channels;
      if (png.pixels[offset] >= 220 && png.pixels[offset + 1] >= 220 && png.pixels[offset + 2] >= 220) whitePixels += 1;
    }
  }
  assert.ok(whitePixels > 100, `中央帯の白画素が少なすぎます: ${whitePixels}`);
});

test("text-card: 実 Chrome は同じ入力を 2 回バイト一致で描く", async (t) => {
  const first = await renderRealChrome(t, "決定論カード", "first.png");
  if (!first) return;
  const secondPath = join(first.directory, "second.png");
  const second = await renderTextCard({
    id: "garden-scene",
    name: "決定論カード",
    prompt: "静かな部屋から席を立ち、窓の向こうの庭へ歩いていく。午後の自然光。",
    outPath: secondPath,
    loadPuppeteer: async () => first.available.puppeteer,
    resolveChrome: () => first.available.executablePath,
    logRenderer: () => {},
  });
  assert.equal(second.renderer, "chrome");
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(first.buffer), digest(await readFile(secondPath)));
});

test("text-card: 実 Chrome は日本語の name を描ける", async (t) => {
  const rendered = await renderRealChrome(t, "席を立って庭へ");
  if (!rendered) return;
  assert.ok(rendered.buffer.length > 1_000);
});
