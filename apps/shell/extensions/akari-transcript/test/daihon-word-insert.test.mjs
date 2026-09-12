import assert from 'node:assert/strict';
import test from 'node:test';
import { insertWordIntoText } from '../lib/common/daihon-word-insert.js';

const words = [{ text: '今日は', start: 0, end: 1 }, { text: '晴れ', start: 2, end: 3 }];
test('選択語の直後へ挿入する', () => assert.deepEqual(insertWordIntoText({ text: '今日は晴れ', words }, 0, 'とても'), { text: '今日はとても晴れ' }));
test('末尾語の直後へ挿入する', () => assert.deepEqual(insertWordIntoText({ text: '今日は晴れ', words }, 1, 'です'), { text: '今日は晴れです' }));
test('入力を trim する', () => assert.deepEqual(insertWordIntoText({ text: '今日は晴れ', words }, 0, '  とても  '), { text: '今日はとても晴れ' }));
test('入力を NFC 正規化する', () => assert.deepEqual(insertWordIntoText({ text: '今日は晴れ', words }, 0, 'か\u3099'), { text: '今日はが晴れ' }));
test('空入力を拒否する', () => assert.match(insertWordIntoText({ text: '今日は晴れ', words }, 0, '  ').error, /入力/));
test('負の index を拒否する', () => assert.match(insertWordIntoText({ text: '今日は晴れ', words }, -1, '語').error, /位置/));
test('範囲外 index を拒否する', () => assert.match(insertWordIntoText({ text: '今日は晴れ', words }, 2, '語').error, /位置/));
test('words null を拒否する', () => assert.match(insertWordIntoText({ text: '本文', words: null }, 0, '語').error, /位置/));
test('prefix 不一致では対象語の indexOf へフォールバックする', () => assert.deepEqual(insertWordIntoText({ text: '前置き今日は晴れ', words }, 0, 'とても'), { text: '前置き今日はとても晴れ' }));
