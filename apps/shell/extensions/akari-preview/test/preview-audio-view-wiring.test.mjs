import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { previewAudioTrimOf } from '../lib/common/preview-audio-trim.js';

const handlerSource = await readFile(
    new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url),
    'utf8'
);

test('プレビュー音源列挙は tracks 射影だけを読み、audio.master indicator は宣言を維持する', () => {
    assert.match(handlerSource, /projectLegacyAudioView/);
    assert.match(handlerSource, /resolveAudioAssets\(\s*projectLegacyAudioView\(internal\),/);
    assert.doesNotMatch(handlerSource, /resolveAudioAssets\(internal\.declaration\.audio/);
    assert.match(
        handlerSource,
        /isTruthyObject\(\(internal\.declaration\.audio as \{ master\?: unknown \} \| undefined\)\?\.master\)/
    );
});

test('narration と SFX の非ゼロ in/out を sidecar 用の秒数として保持する', () => {
    for (const label of ['audio.narration a-main', 'audio.sfx[0]']) {
        const warnings = [];
        const warn = (...args) => warnings.push(args);
        assert.deepEqual(previewAudioTrimOf({ in: 13.033, out: 5322.94 }, label, warn), {
            inSec: 13.033, outSec: 5322.94,
        });
        assert.deepEqual(previewAudioTrimOf({ in: 0, out: Number.MIN_VALUE }, label, warn), {
            inSec: 0, outSec: Number.MIN_VALUE,
        });
        assert.deepEqual(previewAudioTrimOf({}, label, warn), {});
        assert.deepEqual(previewAudioTrimOf({ in: undefined, out: undefined }, label, warn), {});
        assert.deepEqual(warnings, []);
    }
});

test('narration と SFX の不正 trim はフィールドごとに無視し、既存の警告文と値を返す', () => {
    for (const label of ['audio.narration a-main', 'audio.sfx[0]']) {
        for (const field of ['in', 'out']) {
            const invalidValues = [-1, NaN, Infinity, -Infinity, '13.033', null, true];
            if (field === 'out') invalidValues.push(0);
            for (const value of invalidValues) {
                const warnings = [];
                const item = { in: 13.033, out: 5322.94, [field]: value };
                assert.deepEqual(previewAudioTrimOf(item, label, (...args) => warnings.push(args)),
                    field === 'in' ? { outSec: 5322.94 } : { inSec: 13.033 });
                const boundary = field === 'in' ? '0以上の' : '0より大きい';
                assert.deepEqual(warnings, [[
                    `[akari-preview] ${label}.${field} を無視しました（${boundary}有限 number ではありません）`, value,
                ]]);
            }
        }
    }
});

test('timed の trim は narration でも sidecar 要求とサマリーへ渡り、fade/duck だけ SFX に限定する', () => {
    const timed = handlerSource.match(/const timed = async \(items: unknown, kind: 'sfx' \| 'narration' \| 'speech'\)[\s\S]*?\n        let bgm:/)?.[0];
    assert.ok(timed, 'timed audio resolver exists');
    const beforeSource = timed.slice(0, timed.indexOf('const source = await resolveSource'));
    assert.match(beforeSource, /const \{ inSec: trimIn, outSec: trimOut \} = previewAudioTrimOf\(item, label, console\.warn\);/);
    assert.doesNotMatch(beforeSource, /kind === 'sfx'/);
    assert.match(timed, /resolveSource\(item\.path, label, \{\s*inSec: trimIn \?\? 0,\s*\.\.\.\(trimOut !== undefined \? \{ outSec: trimOut \} : \{\}\)/);
    const summary = timed.slice(timed.indexOf('                return {'));
    assert.match(summary, /\.\.\.\(trimIn !== undefined \? \{ in: trimIn \} : \{\}\),\s*\.\.\.\(trimOut !== undefined \? \{ out: trimOut \} : \{\}\),\s*\.\.\.\(kind === 'sfx'/);
    const sfxSummary = summary.slice(summary.indexOf("...(kind === 'sfx'"));
    assert.doesNotMatch(sfxSummary, /trimIn|trimOut/);
    assert.match(sfxSummary, /duckOptions\(item, label\)[\s\S]*fadeIn[\s\S]*fadeOut/);
    assert.match(timed, /if \(kind === 'sfx'\) \{\s*if \(item\.fade_in !== undefined\)[\s\S]*if \(item\.fade_out !== undefined\)/);
});
