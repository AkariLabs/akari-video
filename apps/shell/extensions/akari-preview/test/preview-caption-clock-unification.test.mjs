import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = readFileSync(
    join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

// The handler module cannot be imported under node --test because Theia's browser dependencies
// touch document at module load. Extract the compiled, self-contained normalizer instead.
const normalizerStart = compiled.indexOf('const normalizePreviewCaptionClock =');
const normalizerEnd = compiled.indexOf('exports.normalizePreviewCaptionClock =', normalizerStart);
assert.notEqual(normalizerStart, -1, 'caption clock normalizer is missing');
assert.notEqual(normalizerEnd, -1, 'caption clock normalizer export is missing');
const normalizerDeclaration = compiled.slice(normalizerStart, normalizerEnd).trim();
const normalizerExpression = normalizerDeclaration
    .slice(normalizerDeclaration.indexOf('=') + 1)
    .replace(/;$/u, '');
const normalizePreviewCaptionClock = vm.runInNewContext(`(${normalizerExpression})`);

const segments = [
    { kind: 'src', outStart: 0, outEnd: 3, cutIndex: 0, src: 'main', in: 2, out: 5, speed: 1 },
    { kind: 'gap', outStart: 3, outEnd: 4, cutIndex: null },
    { kind: 'src', outStart: 4, outEnd: 9, cutIndex: 1, src: 'main', in: 7, out: 12, speed: 1 }
];

const fixtureCaptions = [
    { id: 'c-0001', start: 2, end: 3, text: '残っている1本目の字幕', clockDomain: 'source' },
    { id: 'c-0002', start: 3, end: 4, text: '出力gap数値の字幕', clockDomain: 'output' },
    { id: 'c-0003', start: 4, end: 8, text: '削除区間をまたぐ字幕', clockDomain: 'source' },
    { id: 'c-0004', start: 8, end: 9, text: '残っている2本目の字幕', clockDomain: 'source' }
];

test('source/output domain cues normalize to output intervals across deletion and gap', () => {
    const normalized = normalizePreviewCaptionClock(fixtureCaptions, segments);
    assert.ok(normalized.every(cue => cue.clockDomain === 'output'));
    assert.deepEqual(
        JSON.parse(JSON.stringify(normalized.map(
            cue => [cue.sourceCueId ?? cue.id, cue.start, cue.end, cue.text]
        ))),
        [
            ['c-0001', 0, 1, '残っている1本目の字幕'],
            ['c-0003', 2, 3, '削除区間をまたぐ字幕'],
            ['c-0002', 3, 4, '出力gap数値の字幕'],
            ['c-0003', 4, 5, '削除区間をまたぐ字幕'],
            ['c-0004', 5, 6, '残っている2本目の字幕']
        ]
    );
});

test('the seven Electron observations are selected only by output time', () => {
    // The read-only Electron fixture predates the extension-local time_domain vocabulary, so all
    // four cues enter as legacy. The load normalizer fixes their domain before rendering.
    const normalized = normalizePreviewCaptionClock(
        fixtureCaptions.map(cue => ({ ...cue, clockDomain: 'legacy' })),
        segments
    );
    const activeText = outputTime =>
        normalized.find(cue => cue.start <= outputTime && outputTime < cue.end)?.text ?? '';
    const samples = [
        [0.5, '残っている1本目の字幕'],
        [1.5, ''],
        [2.5, '削除区間をまたぐ字幕'],
        [3.5, '出力gap数値の字幕'],
        [4.5, '削除区間をまたぐ字幕'],
        [5.5, '残っている2本目の字幕'],
        [7.5, '']
    ];
    for (const [outputTime, expected] of samples) {
        assert.equal(activeText(outputTime), expected, `outputTime=${outputTime}`);
    }
});

test('legacy cue whose declared interval is wholly inside an output gap keeps that interval', () => {
    const [normalized] = normalizePreviewCaptionClock([
        { id: 'gap', start: 3, end: 4, text: 'gap', clockDomain: 'legacy' }
    ], segments);
    assert.equal(normalized.start, 3);
    assert.equal(normalized.end, 4);
    assert.equal(normalized.clockDomain, 'output');
});

test('render, caption selection, and styled animation consume outputTime only', () => {
    const renderStart = compiled.indexOf('const renderCaption = () => {');
    const renderEnd = compiled.indexOf('const renderTransitionPlate =', renderStart);
    const renderCaption = compiled.slice(renderStart, renderEnd);
    assert.match(renderCaption, /findActiveCaption\(captions, outputTime\)/u);
    assert.match(renderCaption, /clamp\(outputTime, caption\.start, caption\.end\)/u);
    assert.doesNotMatch(renderCaption, /const time = video\.currentTime|activeSegment &&|resolvedTimeline \?/u);

    const pointerStart = compiled.indexOf("captionPlate.addEventListener('pointerdown'");
    const pointerEnd = compiled.indexOf("wrapper.addEventListener('click'", pointerStart);
    const pointerHandler = compiled.slice(pointerStart, pointerEnd);
    assert.match(pointerHandler, /findActiveCaption\(captions, outputTime\)/u);
    assert.doesNotMatch(pointerHandler, /const time = video\.currentTime|resolvedTimeline \?/u);
});
