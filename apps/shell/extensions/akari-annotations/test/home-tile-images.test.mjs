import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { images } from '../lib/browser/inspector/ai-tiles.js';

for (const id of ['video', 'still', 'transcribe', 'narration',
  'position', 'color', 'volume', 'motion', 'cutout', 'eraser']) {
  test(`${id} tile embeds the matching WebP bytes`, () => {
    const bytes = readFileSync(new URL(`../src/browser/inspector/ai-images/${id}.webp`, import.meta.url));
    assert.equal(images[id], `data:image/webp;base64,${bytes.toString('base64')}`);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(bytes.toString('ascii', 12, 16), 'VP8 ');
    assert.equal(bytes.readUInt16LE(26) & 0x3fff, 320);
    assert.equal(bytes.readUInt16LE(28) & 0x3fff, 180);
  });
}
