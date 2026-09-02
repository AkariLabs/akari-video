// shell の normalizePreviewCaptionClock と共有カーネル normalizeCaptionClock（edit-store）が
// 同じ入力に対して同じ出力を返すことを固定する（Web UI は共有カーネル側を使う —
// task/2026-09-02-preview-perf: 字幕時計のパリティ）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { normalizeCaptionClock } from '../../../../../packages/edit-store/lib/caption-clock.js';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = readFileSync(join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'), 'utf8');
const normalizerStart = compiled.indexOf('const normalizePreviewCaptionClock =');
const normalizerEnd = compiled.indexOf('exports.normalizePreviewCaptionClock =', normalizerStart);
const declaration = compiled.slice(normalizerStart, normalizerEnd).trim();
const normalizePreviewCaptionClock = vm.runInNewContext(`(${declaration.slice(declaration.indexOf('=') + 1).replace(/;$/u, '')})`);

const segments = [
    { kind: 'src', outStart: 0, outEnd: 3, cutIndex: 0, src: 'main', in: 2, out: 5, speed: 1 },
    { kind: 'gap', outStart: 3, outEnd: 4, cutIndex: null },
    { kind: 'src', outStart: 4, outEnd: 9, cutIndex: 1, src: 'main', in: 7, out: 12, speed: 1 },
    { kind: 'src', outStart: 9, outEnd: 11, cutIndex: 2, src: 'b', in: 0, out: 4, speed: 2 }
];
const captions = [
    { id: 'c-0001', start: 2, end: 3, text: '1', clockDomain: 'source' },
    { id: 'c-0002', start: 3, end: 4, text: '2', clockDomain: 'output' },
    { id: 'c-0003', start: 4, end: 8, text: '3', clockDomain: 'source',
        words: [{ start: 4, end: 4.5, text: 'a' }, { start: 6, end: 7.5, text: 'b' }] },
    { id: 'c-0004', start: 8, end: 9, text: '4', clockDomain: 'legacy' },
    { id: 'c-0005', start: 3.2, end: 3.8, text: '5', clockDomain: 'legacy' },
    { id: 'c-0006', start: 1, end: 3, text: '6', clockDomain: 'source', clockSourceId: 'b' },
    { start: 7, end: 8, text: 'no-id', clockDomain: 'source' }
];

test('shell と共有カーネルの字幕時計は同一出力', () => {
    const fromShell = JSON.parse(JSON.stringify(normalizePreviewCaptionClock(captions, segments)));
    const fromKernel = JSON.parse(JSON.stringify(normalizeCaptionClock(captions, segments)));
    assert.deepEqual(fromKernel, fromShell);
    assert.ok(fromKernel.length >= 8);
    assert.deepEqual(
        JSON.parse(JSON.stringify(normalizeCaptionClock(captions, []))),
        JSON.parse(JSON.stringify(normalizePreviewCaptionClock(captions, [])))
    );
});
