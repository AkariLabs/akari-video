import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { applyCaptionShape, readCaptionShape } from '../lib/common/caption-shape.js';
import { getCaptionDisplayWordStyle, setCaptionDisplayWordStyle } from '@akari-video/edit-store';

const row = (id, style) => ({ id, start: 0, end: 1, text: 'こんにちは', speaker: null,
    sourceRef: null, edited: false, words: [{ start: 0, end: 1, text: 'こんにちは' }],
    ...(style ? { style } : {}) });

test('字幕の形を行へ一括適用して読み戻し、行固有の演出は変えない', () => {
    const input = { captions: [row('c-0001'), row('c-0002', 'pop')] };
    const shape = { chars: 5, lines: 2, timing: 'speech-tight' };
    const written = applyCaptionShape(input, shape);
    assert.deepEqual(readCaptionShape(written), shape);
    assert.equal('style' in written.captions[0], false);
    assert.equal(written.captions[1].style, 'pop');
    const off = applyCaptionShape(written, { ...shape, timing: 'full' });
    assert.deepEqual(readCaptionShape(off), { ...shape, timing: 'full' });
    assert.equal('style' in off.captions[0], false);
    assert.equal(off.captions[1].style, 'pop');
});

test('古い行数と文字数を UI の範囲に丸める', () => {
    const input = { captions: [row('c-0001')], display_policy: { max_line_units: 5, lines: 3 } };
    assert.deepEqual({ chars: readCaptionShape(input).chars, lines: readCaptionShape(input).lines }, { chars: 5, lines: 2 });
    assert.equal(readCaptionShape({ ...input, display_policy: { max_line_units: 40, lines: 6 } }).chars, 28);
    assert.equal(readCaptionShape({ ...input, display_policy: { max_line_units: 40, lines: 6 } }).lines, 2);
});

test('字幕の形を変えても全体のカラオケ表示を保つ', () => {
    const first = applyCaptionShape({ captions: [row('c-0001')] }, { chars: 18, lines: 1, timing: 'full' });
    const karaoke = setCaptionDisplayWordStyle(first, 'karaoke');
    const changed = applyCaptionShape(karaoke, { chars: 12, lines: 2, timing: 'speech-tight' });
    assert.equal(getCaptionDisplayWordStyle(changed), 'karaoke');
    assert.equal(changed.display_policy.word_style, 'karaoke');
    assert.deepEqual(readCaptionShape(changed), { chars: 12, lines: 2, timing: 'speech-tight' });
});

test('一括適用の出力は captions スキーマ検証を通る', async () => {
    const directory = fileURLToPath(new URL('../../../../../.tmp-lane/', import.meta.url));
    const output = join(directory, `caption-shape-${process.pid}.json`);
    await mkdir(directory, { recursive: true });
    try {
        await writeFile(output, JSON.stringify(applyCaptionShape({ captions: [row('c-0001'), row('c-0002')] },
            { chars: 18, lines: 2, timing: 'speech-tight' })));
        const validator = fileURLToPath(new URL('../../../../../packages/schemas/bin/validate-captions.mjs', import.meta.url));
        assert.doesNotThrow(() => execFileSync(process.execPath, [validator, output], { encoding: 'utf8' }));
    } finally {
        await rm(output, { force: true });
    }
});
