import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseWorldMapMarker } = require('../lib/common/world-map-marker.js');

for (const [name, source, state] of [
  ['missing', undefined, 'absent'],
  ['unknown kind', '{"schemaVersion":3,"kind":"blob"}', 'invalid'],
  ['flat', '{"schemaVersion":3,"kind":"flat"}', 'present'],
  ['spatial', '{"schemaVersion":3,"kind":"spatial"}', 'present'],
  ['broken', '{', 'invalid'],
  ['old version', '{"schemaVersion":2,"kind":"flat"}', 'invalid']
]) test(name, () => assert.equal(parseWorldMapMarker(source).state, state));
