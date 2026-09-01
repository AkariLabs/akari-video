import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
    new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url),
    'utf8'
);

test('旧プレビューは共通 envelope API を注入し deprecated duck API を参照しない', () => {
    assert.match(source, /computeDuckEnvelope\.toString\(\)/u);
    assert.match(source, /evaluateEnvelopeDb\.toString\(\)/u);
    assert.doesNotMatch(source, /\b(?:computeDuckIntervals|isWithinDuckInterval|STATIC_DUCK_GAIN_DB)\b/u);
});

test('旧プレビューに固定 duck 深度を残さず kernel default へ委譲する', () => {
    assert.doesNotMatch(source, /(^|[^\d.])-12(?![\d.])/mu);
    assert.match(source, /duckDb:\s*item\.duckDb/u);
    assert.match(source, /attackSec:\s*item\.duckAttack/u);
    assert.match(source, /releaseSec:\s*item\.duckRelease/u);
});

test('duck_db attack release は legacy 宣言から preview summary へ運ばれる', () => {
    assert.match(source, /value\.duck_db \?\? value\.duckDb/u);
    assert.match(source, /value\.duck_attack \?\? value\.duckAttack/u);
    assert.match(source, /value\.duck_release \?\? value\.duckRelease/u);
    assert.match(source, /\.\.\.duckOptions\(item, label\)/u);
    assert.match(source, /\.\.\.duckOptions\(rawBgm, 'audio\.bgm'\)/u);
});

test('音量 keyframes は省略 gain_db を 0 dB として summary へ運ぶ', () => {
    assert.match(source, /raw\.gain_db === undefined \? 0 : gainDb/u);
    assert.match(source, /evaluateEnvelopeDbFn\(item\.keyframes \|\| \[\], localSec\)/u);
});

test('旧経路の duck 鍵は decoded narration の実尺だけから作る', () => {
    const start = source.indexOf('const narrationDuckIntervals');
    const end = source.indexOf('const fadeMultiplierAt', start);
    const block = source.slice(start, end);
    assert.match(block, /decoded\.narration\.map/u);
    assert.match(block, /endSec:\s*item\.t \+ item\.durationSec/u);
    assert.doesNotMatch(block, /speech/u);
});

test('BGM SFX narration は独立 envelope GainNode で fade と合成する', () => {
    assert.match(source, /gain\.connect\(envelopeGain\)/u);
    assert.match(source, /envelopeGain\.connect\(masterGain\)/u);
    assert.match(source, /envelope\.keyframeGainDb \+ envelope\.duckGainDb/u);
    assert.match(source, /item\.spec, timelineTime, item\.spec\.t, item\.spec\.durationSec/u);
});
