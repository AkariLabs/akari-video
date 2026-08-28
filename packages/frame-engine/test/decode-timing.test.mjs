import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDecoderTimestampOffsetUs,
  describeUnusableDecoder,
  presentationFrameTiming,
} from '../dist/index.js';

const edit = mediaTime => [{
  segment_duration: 2_000,
  media_time: mediaTime,
  media_rate_integer: 1,
  media_rate_fraction: 0,
}];

test('edit-list media time recovers the decoder reorder offset', () => {
  assert.equal(calculateDecoderTimestampOffsetUs(0, 15_360, edit(0)), 0);
  assert.equal(calculateDecoderTimestampOffsetUs(0, 15_360, edit(512)), 33_333);
  assert.equal(calculateDecoderTimestampOffsetUs(0, 15_360, edit(1_024)), 66_667);
  assert.equal(calculateDecoderTimestampOffsetUs(0, 15_360, undefined), 0);
  assert.equal(calculateDecoderTimestampOffsetUs(0, 0, edit(1_024)), 0);
});

test('presentation timing removes reorder delay and av-cliper first-frame padding', () => {
  assert.deepEqual(
    presentationFrameTiming({ timestamp: 66_667, duration: 33_333 }, 66_667),
    { timestamp: 0, duration: 33_333 },
  );
  assert.deepEqual(
    presentationFrameTiming({ timestamp: 0, duration: 100_000 }, 66_667),
    { timestamp: 0, duration: 33_333 },
  );
  assert.deepEqual(
    presentationFrameTiming({ timestamp: 100_000, duration: 33_333 }, 66_667),
    { timestamp: 33_333, duration: 33_333 },
  );
});

test('presentation timing caps only a duration that overlaps the next displayed frame', () => {
  assert.deepEqual(
    presentationFrameTiming(
      { timestamp: 1_966_667, duration: 33_333 },
      0,
      1_983_333,
    ),
    { timestamp: 1_966_667, duration: 16_666 },
  );
  assert.deepEqual(
    presentationFrameTiming(
      { timestamp: 1_966_667, duration: 16_666 },
      0,
      1_983_333,
    ),
    { timestamp: 1_966_667, duration: 16_666 },
  );
  assert.deepEqual(
    presentationFrameTiming(
      { timestamp: 1_966_667, duration: 16_665 },
      0,
      1_983_333,
    ),
    { timestamp: 1_966_667, duration: 16_665 },
  );
  assert.deepEqual(
    presentationFrameTiming(
      { timestamp: 1_966_667, duration: 16_667 },
      0,
      1_983_333,
    ),
    { timestamp: 1_966_667, duration: 16_667 },
  );
});

test('unsupported decoder configuration is described with actionable context', () => {
  const original = 'VideoFinder VideoDecoder err: Unsupported configuration. VideoDecoder.configure()';
  const diagnostic = describeUnusableDecoder(
    'clip-main',
    ['prefer-hardware', 'prefer-software'],
    original,
  );

  assert.ok(diagnostic);
  assert.match(diagnostic, /clip-main/);
  assert.match(diagnostic, /prefer-hardware/);
  assert.match(diagnostic, /prefer-software/);
  assert.ok(diagnostic.includes(original));
});

test('unrelated decoder errors keep their original error path', () => {
  assert.equal(
    describeUnusableDecoder('clip-main', ['prefer-hardware', 'prefer-software'], 'fetch failed: 404'),
    null,
  );
});
