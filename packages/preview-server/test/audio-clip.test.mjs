import assert from 'node:assert/strict';
import test from 'node:test';

import { dbToGain, resolveSfxWindow, scheduleSfxAt } from '../public/audio-clip.js';

test('gain_db remains the sole dB spelling and converts to the expected linear gain', () => {
  assert.ok(Math.abs(dbToGain(-18) - 0.12589254117941673) < 1e-12);
  assert.ok(Math.abs(dbToGain(-6) - 0.5011872336272722) < 1e-12);
});

test('SFX in/out trim determines scheduled offset, duration, and fade window duration', () => {
  const window = resolveSfxWindow({ in: 0.2, out: 0.7, duration: 0.5 }, 4);
  assert.deepEqual(window, { sourceIn: 0.2, effectiveDuration: 0.49999999999999994 });
  const schedule = scheduleSfxAt({ t: 1, ...window }, 1.1);
  assert.ok(Math.abs(schedule.offset - 0.3) < 1e-12);
  assert.ok(Math.abs(schedule.duration - 0.4) < 1e-12);
});
