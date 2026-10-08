import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

test('hollow hexagon has a 2px uncropped outline and line begins below its 16px handle', () => {
  const playhead = source.slice(source.indexOf('Object.assign(this.playhead.style'),
    source.indexOf('this.playheadHandle.addEventListener'));
  assert.match(playhead, /width: '1px'/u);
  assert.match(playhead, /background: `linear-gradient\(to bottom, transparent 16px, \$\{PLAYHEAD_COLOR\} 16px\)`/u);
  assert.match(playhead, /<svg width="14" height="16" viewBox="0 0 14 16"/u);
  assert.match(playhead, /<path d="M1 1H13V9\.5L7 15L1 9\.5Z" fill="none" style="stroke: \$\{PLAYHEAD_COLOR\}" stroke-width="2"/u);
  assert.match(playhead, /top: '0', left: '50%', width: '14px', height: '16px'/u);
});
