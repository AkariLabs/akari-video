import assert from 'node:assert/strict';
import test from 'node:test';

import { readInternalEdit } from '../../edit-store/lib/index.js';
import { captionDisplayEdit } from '../src/caption-resolve.mjs';
import { sourceRangeToTimeline } from '../src/captions.mjs';
import { collectDeclaredFadeWindows } from '../src/verify-blank.mjs';
import { readRenderEdit } from '../src/internal-render.mjs';

for (const [align, start, end] of [
  ['before-cut', 3, 4], ['center', 3.5, 4.5], ['after-cut', 4, 5]
]) {
  test(`${align}: captions and declared fade use the projected window`, () => {
    const edit = {
      version: 2, output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
      tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 10, out: 14,
          transition_out: { type: 'fade-black', duration: 1, align } } },
        { id: 'b', at: 120, duration: 120, source: { kind: 'media', src: 'b', in: 2, out: 6 } }
      ] }]
    };
    const cuts = readInternalEdit(edit).tracks[0].items.map(item => item.declaration);
    const display = captionDisplayEdit({ cuts }).cuts;
    assert.deepEqual(display.map(cut => cut.at), [undefined, undefined]);
    // B source [2, 3] maps to [4, 5]; A and B together last 4 + 4 = 8 seconds.
    assert.deepEqual(sourceRangeToTimeline(2, 3, display), [{ start: 4, duration: 1 }]);
    assert.equal((display[0].out - display[0].in) - display[0].transition_out.duration
      + (display[1].out - display[1].in), 8);
    assert.deepEqual(collectDeclaredFadeWindows({ output: edit.output, cuts })
      .filter(window => window.via === 'transition_out:fade-black')
      .map(window => [window.start, window.end]), [[start, end]]);
  });
}

test('freeze fill projection keeps every cut range valid after the render reader', () => {
  const edit = {
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [
      { id: 'a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 2, out: 6,
        transition_out: { type: 'dissolve', duration: 1, fill: 'freeze' } } },
      { id: 'b', at: 120, duration: 120, source: { kind: 'media', src: 'b', in: 0.1, out: 4.1 } }
    ] }]
  };
  const result = readRenderEdit(edit, process.cwd(), { expandParts: false, projectRoot: process.cwd() });
  assert.equal(result.edit.cuts.length, 2);
  for (const cut of result.edit.cuts) assert.ok(cut.in >= 0 && cut.in < cut.out);
});
