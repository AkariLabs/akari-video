import assert from 'node:assert/strict';
import { test } from 'node:test';

import { supportedMyStyleAttachPart } from '../lib/my-style-parts.js';

const attach = { at: 'whole', offset_frames: 0 };
const sfx = { kind: 'sfx', scope: 'caption', mode: 'attach', attach,
  asset: { category: 'audio', id: 'pop' }, file: 'pop.wav', duration_sec: 0.5 };
const decor = { kind: 'decor', scope: 'caption', mode: 'attach', attach,
  asset: { category: 'overlay', id: 'frame' }, file: 'frame.html' };
const fx = effect => ({ kind: 'fx', scope: 'caption', mode: 'attach', attach, effect });

test('old, future, and extended attach parts are unsupported', () => {
  assert.equal(supportedMyStyleAttachPart({ kind: 'sfx', mode: 'attach', asset: sfx.asset }), false);
  assert.equal(supportedMyStyleAttachPart({ ...decor, attach: { at: 'burst', offset_frames: 0 } }), false);
  assert.equal(supportedMyStyleAttachPart({ ...decor, timeline: 'future' }), false);
});

test('sfx, fx, and decor accept their supported fields and formats', () => {
  assert.equal(supportedMyStyleAttachPart(sfx), true);
  assert.equal(supportedMyStyleAttachPart({ ...sfx, file: 'pop.MP3', in: 0.1, out: 0.4, gain_db: -6 }), true);
  assert.equal(supportedMyStyleAttachPart(decor), true);
  assert.equal(supportedMyStyleAttachPart({ ...decor, file: 'frame.htm', vars: { color: 'red' }, duration_sec: 1 }), true);
  assert.equal(supportedMyStyleAttachPart(fx({ type: 'invert' })), true);
  assert.equal(supportedMyStyleAttachPart(fx({ type: 'lut', id: 'cinema', intensity: 0.5 })), true);
  assert.equal(supportedMyStyleAttachPart(fx({ type: 'saturation', value: 1.5 })), true);
});

test('attach validation rejects unknown keys, invalid files, effects, and audio ranges', () => {
  for (const part of [
    { ...sfx, extra: true }, { ...sfx, file: '../pop.wav' }, { ...sfx, file: 'pop.txt' },
    { ...sfx, gain_db: 13 }, { ...sfx, in: 0.4, out: 0.3 }, { ...sfx, duration_sec: 0 },
    { ...decor, file: 'frame.js' }, { ...decor, asset: { ...decor.asset, extra: true } },
    fx({ type: 'invert', value: 1 }), fx({ type: 'lut', id: '', intensity: 0.5 }),
    fx({ type: 'lut', id: 'cinema', intensity: 2 }), fx({ type: 'saturation', value: 4 }),
  ]) assert.equal(supportedMyStyleAttachPart(part), false, JSON.stringify(part));
});
