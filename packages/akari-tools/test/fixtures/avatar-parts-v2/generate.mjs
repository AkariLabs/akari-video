#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = dirname(fileURLToPath(import.meta.url));

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
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function png(width, height, paint) {
  const pixels = Buffer.alloc(width * height * 4);
  const pixel = (x, y, color) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) pixels[offset + channel] = color[channel];
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) pixel(x, y, color);
    }
  };
  const line = (x0, y0, x1, y1, radius, color) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step += 1) ellipse(x0 + (x1 - x0) * step / steps, y0 + (y1 - y0) * step / steps, radius, radius, color);
  };
  paint({ ellipse, line, pixel });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const ink = [49, 37, 66, 255];
const skin = [255, 221, 185, 255];
const hair = [77, 55, 105, 255];
const pink = [245, 120, 145, 255];
const assets = {
  "body.png": [70, 75, ({ ellipse }) => { ellipse(35, 46, 32, 38, ink); ellipse(35, 45, 28, 34, [105, 165, 210, 255]); }],
  "head.png": [90, 80, ({ ellipse }) => { ellipse(45, 42, 42, 38, ink); ellipse(45, 43, 38, 34, skin); }],
  "hair-back.png": [76, 70, ({ ellipse }) => { ellipse(38, 34, 37, 32, hair); ellipse(38, 54, 31, 16, hair); }],
  "hair-left.png": [18, 66, ({ ellipse }) => { ellipse(9, 26, 8, 25, hair); ellipse(9, 52, 6, 13, hair); }],
  "hair-right.png": [18, 66, ({ ellipse }) => { ellipse(9, 26, 8, 25, hair); ellipse(9, 52, 6, 13, hair); }],
  "eyes-open.png": [60, 20, ({ ellipse }) => { ellipse(17, 10, 4, 7, ink); ellipse(43, 10, 4, 7, ink); }],
  "eyes-closed.png": [60, 20, ({ line }) => { line(12, 11, 22, 11, 1.5, ink); line(38, 11, 48, 11, 1.5, ink); }],
  "mouth-closed.png": [30, 20, ({ line }) => line(8, 10, 22, 10, 1.5, ink)],
  "mouth-a.png": [30, 20, ({ ellipse }) => { ellipse(15, 10, 7, 9, ink); ellipse(15, 13, 4, 3, pink); }],
  "mouth-i.png": [30, 20, ({ ellipse }) => ellipse(15, 10, 10, 3, ink)],
  "mouth-u.png": [30, 20, ({ ellipse }) => ellipse(15, 10, 4, 5, ink)],
  "mouth-e.png": [30, 20, ({ ellipse }) => ellipse(15, 10, 9, 5, ink)],
  "mouth-o.png": [30, 20, ({ ellipse }) => ellipse(15, 10, 6, 8, ink)],
};
for (const [name, [width, height, paint]] of Object.entries(assets)) writeFileSync(join(root, name), png(width, height, paint));

const sampleRate = 16_000;
const samples = sampleRate * 12;
const pcm = Buffer.alloc(samples * 2);
for (let index = 0; index < samples; index += 1) {
  const time = index / sampleRate;
  const speaking = (time >= 1 && time < 4.5) || (time >= 6 && time < 10.5);
  const value = speaking ? Math.round(0.32 * 32767 * Math.sin(2 * Math.PI * 220 * time)) : 0;
  pcm.writeInt16LE(value, index * 2);
}
const wav = Buffer.alloc(44 + pcm.length);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
writeFileSync(join(root, "say.wav"), wav);
