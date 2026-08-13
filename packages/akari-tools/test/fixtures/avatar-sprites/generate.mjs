#!/usr/bin/env node

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const width = 128;
const height = 128;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function png(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function canvas() {
  return Buffer.alloc(width * height * 4);
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function ellipse(pixels, cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) setPixel(pixels, x, y, color);
    }
  }
}

function line(pixels, x0, y0, x1, y1, thickness, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let step = 0; step <= steps; step += 1) {
    const x = x0 + ((x1 - x0) * step) / steps;
    const y = y0 + ((y1 - y0) * step) / steps;
    ellipse(pixels, x, y, thickness, thickness, color);
  }
}

const ink = [55, 41, 72, 255];
const base = canvas();
ellipse(base, 64, 67, 48, 54, [255, 212, 169, 255]);
ellipse(base, 64, 67, 48, 54, ink);
ellipse(base, 64, 67, 44, 50, [255, 222, 184, 255]);
ellipse(base, 42, 75, 7, 4, [255, 160, 160, 100]);
ellipse(base, 86, 75, 7, 4, [255, 160, 160, 100]);

const mouthClosed = canvas();
line(mouthClosed, 53, 91, 75, 91, 2, ink);

const mouthMid = canvas();
ellipse(mouthMid, 64, 92, 12, 5, ink);
ellipse(mouthMid, 64, 91, 8, 2, [245, 125, 142, 255]);

const mouthOpen = canvas();
ellipse(mouthOpen, 64, 92, 13, 12, ink);
ellipse(mouthOpen, 64, 97, 8, 4, [245, 125, 142, 255]);

const mouthA = canvas();
ellipse(mouthA, 64, 92, 13, 17, ink);
ellipse(mouthA, 64, 97, 8, 6, [245, 125, 142, 255]);

const mouthI = canvas();
ellipse(mouthI, 64, 92, 18, 4, ink);
line(mouthI, 50, 91, 78, 91, 1, [245, 125, 142, 255]);

const mouthU = canvas();
ellipse(mouthU, 64, 92, 7, 7, ink);
ellipse(mouthU, 64, 92, 3, 3, [245, 125, 142, 255]);

const mouthE = canvas();
ellipse(mouthE, 64, 92, 16, 7, ink);
ellipse(mouthE, 64, 93, 11, 3, [245, 125, 142, 255]);

const mouthO = canvas();
ellipse(mouthO, 64, 92, 11, 14, ink);
ellipse(mouthO, 64, 94, 6, 8, [245, 125, 142, 255]);

const eyesOpen = canvas();
ellipse(eyesOpen, 46, 62, 5, 8, ink);
ellipse(eyesOpen, 82, 62, 5, 8, ink);
ellipse(eyesOpen, 44, 59, 1.5, 2, [255, 255, 255, 255]);
ellipse(eyesOpen, 80, 59, 1.5, 2, [255, 255, 255, 255]);

const eyesClosed = canvas();
line(eyesClosed, 40, 63, 52, 63, 2, ink);
line(eyesClosed, 76, 63, 88, 63, 2, ink);

for (const [name, pixels] of [
  ["base.png", base],
  ["mouth-closed.png", mouthClosed],
  ["mouth-mid.png", mouthMid],
  ["mouth-open.png", mouthOpen],
  ["mouth-a.png", mouthA],
  ["mouth-i.png", mouthI],
  ["mouth-u.png", mouthU],
  ["mouth-e.png", mouthE],
  ["mouth-o.png", mouthO],
  ["eyes-open.png", eyesOpen],
  ["eyes-closed.png", eyesClosed],
]) writeFileSync(join(root, name), png(pixels));
