import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { worldOverviewHtml } = require('../lib/common/world-overview-html.js');

test('overview is self-contained and safely embeds sources and JSON', () => {
  const html = worldOverviewHtml({ runtimeSource: '/* runtime-token */', cameraSource: '/* camera-token */', worldMapJson: '{"schemaVersion":3,"kind":"flat","worlds":[],"zones":[],"cameraStops":[],"edges":[],"x":"</script>"}', seconds: 2 });
  assert.doesNotMatch(html, /<script\s+src/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /runtime-token/); assert.match(html, /camera-token/);
  assert.doesNotMatch(html, /<\/script>"/);
  assert.match(html, /\\u003c\/script>/);
});
