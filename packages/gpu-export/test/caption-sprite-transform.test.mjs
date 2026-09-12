import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGpuPage } from '../src/page-builder.mjs';

test('caption band and single-svg raster roots consume sprite transform variables', () => {
  const built = buildGpuPage({
    edit: {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [],
      cuts: [],
      overlays: [],
    },
    captions: [{
      id: 'c1', start: 0, end: 1, text: 'caption',
      text_style: { scale: 1.35, rotate: -12 },
    }],
    projectRoot: process.cwd(),
    duration: 1,
  });
  const transform = 'transform:translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg));transform-origin:center;';
  const rasterRoots = built.html.match(/class="akari-sprite-root" data-akari-band=[^>]+/gu) ?? [];
  assert.equal(rasterRoots.length, 2);
  assert.ok(rasterRoots.every(root => root.includes(transform)));
});
