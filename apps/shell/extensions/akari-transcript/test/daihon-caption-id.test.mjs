import assert from 'node:assert/strict';
import test from 'node:test';
import { nextDaihonCaptionId } from '../lib/common/daihon-caption-id.js';

test('空なら c-0001', () => assert.equal(nextDaihonCaptionId([]), 'c-0001'));
test('最大番号の次を返す', () => assert.equal(nextDaihonCaptionId(['c-0002', 'c-0010']), 'c-0011'));
test('4 桁より長い番号も扱う', () => assert.equal(nextDaihonCaptionId(['c-99999']), 'c-100000'));
test('規約外 id は採番値に影響しない', () => assert.equal(nextDaihonCaptionId(['caption-99', 'c-12']), 'c-0001'));
test('同じ id が並んでも最大値から一度だけ進む', () => assert.equal(nextDaihonCaptionId(['c-0004', 'c-0004']), 'c-0005'));
