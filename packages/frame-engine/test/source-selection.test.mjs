import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseSource,
  needsCodecProbe,
  parseSourceSelectionMode,
} from '../dist/index.js';

const hardwareSupport = { codec: 'hvc1.2.4.H156.B0', hw: true, sw: false, any: true };
const decoderSupport = { codec: 'avc1.640028', hw: false, sw: true, any: true };
const unsupported = { codec: 'hvc1.2.4.H156.B0', hw: false, sw: false, any: false };

test('auto selects a declared proxy without probing', () => {
  assert.deepEqual(
    chooseSource({ mode: 'auto', hasProxy: true, support: null }),
    { chosen: 'proxy', reason: 'declared' },
  );
  assert.equal(needsCodecProbe('auto', true), false);
});

test('auto selects an original supported by hardware or another decoder', () => {
  assert.deepEqual(
    chooseSource({ mode: 'auto', hasProxy: false, support: hardwareSupport }),
    { chosen: 'original', reason: 'hardware-ok' },
  );
  assert.deepEqual(
    chooseSource({ mode: 'auto', hasProxy: false, support: decoderSupport }),
    { chosen: 'original', reason: 'decoder-ok' },
  );
});

test('auto requests a proxy for an unsupported original with no declared proxy', () => {
  assert.deepEqual(
    chooseSource({ mode: 'auto', hasProxy: false, support: unsupported }),
    { chosen: 'auto-proxy', reason: 'auto-proxy' },
  );
});

test('auto preserves the original when probing is unavailable', () => {
  assert.deepEqual(
    chooseSource({ mode: 'auto', hasProxy: false, support: null }),
    { chosen: 'original', reason: 'probe-unavailable' },
  );
});

test('original mode skips a declared proxy but retains it as the unsupported-codec fallback', () => {
  assert.deepEqual(
    chooseSource({ mode: 'original', hasProxy: true, support: hardwareSupport }),
    { chosen: 'original', reason: 'hardware-ok' },
  );
  assert.deepEqual(
    chooseSource({ mode: 'original', hasProxy: true, support: unsupported }),
    { chosen: 'proxy', reason: 'codec-unsupported' },
  );
});

test('proxy mode records the preference whether or not a proxy exists', () => {
  assert.deepEqual(
    chooseSource({ mode: 'proxy', hasProxy: true, support: null }),
    { chosen: 'proxy', reason: 'preference:proxy' },
  );
  assert.deepEqual(
    chooseSource({ mode: 'proxy', hasProxy: false, support: null }),
    { chosen: 'original', reason: 'preference:proxy' },
  );
});

test('source selection mode parsing is case-insensitive and defaults to auto', () => {
  assert.equal(parseSourceSelectionMode('proxy'), 'proxy');
  assert.equal(parseSourceSelectionMode('PROXY'), 'proxy');
  assert.equal(parseSourceSelectionMode(' original '), 'original');
  assert.equal(parseSourceSelectionMode(null), 'auto');
  assert.equal(parseSourceSelectionMode('auto'), 'auto');
  assert.equal(parseSourceSelectionMode('xxx'), 'auto');
});

test('codec probing truth table covers every mode and proxy state', () => {
  assert.equal(needsCodecProbe('auto', false), true);
  assert.equal(needsCodecProbe('auto', true), false);
  assert.equal(needsCodecProbe('proxy', false), false);
  assert.equal(needsCodecProbe('proxy', true), false);
  assert.equal(needsCodecProbe('original', false), true);
  assert.equal(needsCodecProbe('original', true), true);
});
