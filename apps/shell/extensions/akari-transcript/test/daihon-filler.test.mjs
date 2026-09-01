import assert from 'node:assert/strict';
import test from 'node:test';
import { FILLER_WORDS, isFillerWord, normalizeFillerWord } from '../lib/common/daihon-filler.js';

test('辞書は確定 7 語を持つ', () => assert.deepEqual([...FILLER_WORDS], ['あの', 'えー', 'えっと', 'その', 'まあ', 'え', 'あー']));
test('あのを検出する', () => assert.equal(isFillerWord('あの'), true));
test('えー、を句読点込みで検出する', () => assert.equal(isFillerWord('えー、'), true));
test('全角句読点を除去する', () => assert.equal(normalizeFillerWord(' えっと。'), 'えっと'));
test('通常語は検出しない', () => assert.equal(isFillerWord('これは'), false));
test('部分一致は検出しない', () => assert.equal(isFillerWord('あの人'), false));
test('空白だけは検出しない', () => assert.equal(isFillerWord('  '), false));
