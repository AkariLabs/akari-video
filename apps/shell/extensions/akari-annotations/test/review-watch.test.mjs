import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { coalesceReviewOpens, shouldOpenReviewPanelFor } = require('../lib/common/review-watch.js');

const decisions = [
  ['direct child', '/ws/review.json', ['/ws'], undefined, true, 'ok'],
  ['nested child', '/ws/.akari/reviews/dogfood/review.json', ['/ws'], undefined, true, 'ok'],
  ['outside root', '/elsewhere/review.json', ['/ws'], undefined, false, 'outside-roots'],
  ['sibling prefix is outside', '/ws2/review.json', ['/ws'], undefined, false, 'outside-roots'],
  ['node_modules', '/ws/node_modules/pkg/review.json', ['/ws'], undefined, false, 'skipped-directory'],
  ['vendor', '/ws/package/vendor/fixture/review.json', ['/ws'], undefined, false, 'skipped-directory'],
  ['cli package vendor', '/ws/AKARI_HOME/cli/1.2.3/package/vendor/x/review.json', ['/ws'], undefined, false, 'skipped-directory'],
  ['git', '/ws/.git/worktrees/x/review.json', ['/ws'], undefined, false, 'skipped-directory'],
  ['akari history pair', '/ws/.akari/history/2026/review.json', ['/ws'], undefined, false, 'skipped-directory'],
  ['history alone is allowed', '/ws/history/review.json', ['/ws'], undefined, true, 'ok'],
  ['multiple roots second match', '/two/reviews/review.json', ['/one', '/two'], undefined, true, 'ok'],
  ['multiple roots outside both', '/three/review.json', ['/one', '/two'], undefined, false, 'outside-roots'],
  ['trailing root separator', '/ws/review.json', ['/ws/'], undefined, true, 'ok'],
  ['windows separators', 'C:\\ws\\reviews\\review.json', ['C:\\ws'], undefined, true, 'ok'],
  ['custom skipped segment', '/ws/cache/review.json', ['/ws'], { skippedSegments: ['cache'] }, false, 'skipped-directory'],
  ['custom list replaces defaults', '/ws/vendor/review.json', ['/ws'], { skippedSegments: ['cache'] }, true, 'ok'],
  ['root itself under vendor is allowed', '/vendor/project/review.json', ['/vendor/project'], undefined, true, 'ok'],
  ['root itself under cli is allowed', '/ws/cli/reviews/review.json', ['/ws/cli'], undefined, true, 'ok'],
  ['one safe matching root is enough', '/ws/vendor/project/review.json', ['/ws', '/ws/vendor/project'], undefined, true, 'ok']
];

for (const [name, resource, roots, options, open, reason] of decisions) {
  test(`shouldOpenReviewPanelFor: ${name}`, () => {
    assert.deepEqual(shouldOpenReviewPanelFor(resource, roots, options), { open, reason }, name);
  });
}

const fakeTimers = () => {
  let nextId = 1;
  const callbacks = new Map();
  return {
    api: {
      setTimeout(callback) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      clearTimeout(id) { callbacks.delete(id); }
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    size() { return callbacks.size; }
  };
};

test('coalesceReviewOpens turns five calls into one open after the burst', () => {
  const timers = fakeTimers();
  const schedule = coalesceReviewOpens(500, timers.api);
  let opens = 0;
  for (let index = 0; index < 5; index++) schedule(() => { opens += 1; });
  assert.equal(timers.size(), 1);
  assert.equal(opens, 0);
  timers.flush();
  assert.equal(opens, 1);
});

test('coalesceReviewOpens permits a second open after the first burst fires', () => {
  const timers = fakeTimers();
  const schedule = coalesceReviewOpens(500, timers.api);
  let opens = 0;
  schedule(() => { opens += 1; });
  timers.flush();
  schedule(() => { opens += 1; });
  timers.flush();
  assert.equal(opens, 2);
});
