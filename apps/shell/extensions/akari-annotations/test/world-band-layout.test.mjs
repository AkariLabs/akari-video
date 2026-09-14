import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { worldBandLayout } = require('../lib/common/world-band-layout.js');
const map = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/examples/world-map-v3-flat-valid/planning/world-map.json', import.meta.url), 'utf8'));

test('six stop bands and one marker per non-move edge use monotonic geometry', () => {
  const layout = worldBandLayout(map, seconds => seconds * 10);
  assert.equal(layout.bands.length, 6);
  assert.equal(layout.markers.length, map.edges.filter(edge => edge.type !== 'move').length);
  assert.ok(layout.bands.every((band, index, all) => index === 0 || band.left > all[index - 1].left));
  assert.ok(layout.bands.every(band => band.width > 0));
});
