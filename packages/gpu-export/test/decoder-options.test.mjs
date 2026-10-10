import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDecoderOptions } from '../src/decoder-options.mjs';

test('decoder export defaults and overrides', () => {
  assert.deepEqual(resolveDecoderOptions({}), {
    stallMs: 8_000, recoveryAttempts: 3, recoveryBackoffMs: [500, 1_000, 2_000], tickTimeoutMs: 30_000,
  });
  assert.deepEqual(resolveDecoderOptions({
    AKARI_EXPORT_DECODER_STALL_MS: '9000', AKARI_EXPORT_DECODER_RETRIES: '0',
    AKARI_EXPORT_DECODE_TIMEOUT_MS: '5000',
  }), { stallMs: 9_000, recoveryAttempts: 0, recoveryBackoffMs: [500, 1_000, 2_000], tickTimeoutMs: 9_000 });
});

test('invalid decoder env values fail', () => {
  for (const [key, values] of Object.entries({
    AKARI_EXPORT_DECODER_STALL_MS: ['0', '-1', '2.5', 'NaN', ''],
    AKARI_EXPORT_DECODER_RETRIES: ['-1', '2.5', 'NaN', ''],
    AKARI_EXPORT_DECODE_TIMEOUT_MS: ['0', '-1', '2.5', 'NaN', ''],
  })) for (const value of values) assert.throws(() => resolveDecoderOptions({ [key]: value }), /integer/u);
});
