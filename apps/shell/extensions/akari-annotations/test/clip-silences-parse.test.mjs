import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSilenceDetectOutput } from '../lib/node/akari-annotations-service.js';

test('実際の ffmpeg stderr 抜粋から無音を読む', () => assert.deepEqual(parseSilenceDetectOutput(`
[silencedetect @ 0xabc] silence_start: 8.61
[silencedetect @ 0xabc] silence_end: 11.3 | silence_duration: 2.69
`), [[8.61, 11.3]]));
test('複数件を出力順に読む', () => assert.deepEqual(parseSilenceDetectOutput(`
silence_start: 0
silence_end: 0.591 | silence_duration: 0.591
silence_start: 1.091
silence_end: 1.614 | silence_duration: 0.523
`), [[0, 0.59], [1.09, 1.61]]));
test('閉じない start は捨てる', () => assert.deepEqual(parseSilenceDetectOutput('silence_start: 3.2'), []));
test('区間実行の offset を足す', () => assert.deepEqual(parseSilenceDetectOutput('silence_start: 0.5\nsilence_end: 1.2', 8), [[8.5, 9.2]]));
test('雑音行は無視する', () => assert.deepEqual(parseSilenceDetectOutput('frame=12\nhello\n'), []));
test('負の秒を 0 に丸める', () => assert.deepEqual(parseSilenceDetectOutput('silence_start: -0.25\nsilence_end: 0.345'), [[0, 0.35]]));
test('end だけの行は無視する', () => assert.deepEqual(parseSilenceDetectOutput('silence_end: 2.4'), []));
