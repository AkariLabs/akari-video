import assert from 'node:assert/strict';
import test from 'node:test';

import { readInternalEdit } from '../../edit-store/lib/index.js';
import { captionDisplayEdit } from '../src/lint/captions.mjs';

for (const align of ['before-cut', 'center', 'after-cut']) {
  test(`${align}: caption validation normalizes a projected sequential track`, () => {
    const edit = {
      version: 2, output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
      tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'a', at: 0, duration: 120, source: { kind: 'media', src: 'a', in: 10, out: 14,
          transition_out: { type: 'dissolve', duration: 1, align } } },
        { id: 'b', at: 120, duration: 120, source: { kind: 'media', src: 'b', in: 2, out: 6 } }
      ] }]
    };
    const cuts = readInternalEdit(edit).tracks[0].items.map(item => item.declaration);
    const display = captionDisplayEdit({ cuts }).cuts;
    assert.deepEqual(display.map(cut => cut.at), [undefined, undefined]);
    // The sequential cursor is A length - overlap; B source 2 begins at cursor + (2 - B.in) = 4.
    const bStart = (display[0].out - display[0].in) - display[0].transition_out.duration;
    assert.equal(bStart + 2 - display[1].in, 4);
    assert.equal(bStart + 3 - display[1].in, 5);
    assert.equal(bStart + display[1].out - display[1].in, 8);
  });
}
