// 不具合メモ 第9項（ラベル付きシート側）— 出力側シークで先頭から全デコードしていた。
//
// renderLabeledContactSheet は `-i video -i label -ss T` の順で ffmpeg を呼んでおり、-ss が
// 両方の入力より後ろ = 出力側シークだったため、先頭から T 秒ぶんを全部デコードして捨てていた。
// grab の既定動作と filmstrip 全体がこの経路を通る（実測: 32 分地点 1 枚で 2 分 26 秒。
// 2 時間素材の filmstrip 12 コマなら合計 12 時間ぶん級のデコード）。
//
// 同ファイルの renderContactSheet（ラベル無し）は元から `-ss` が `-i` の前にあり、この不具合の
// 対象ではない（ただし入力側のみなのでキーフレーム境界へ丸まり得る。既存出力を変えないため
// 今回は触っていない）。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    CONTACT_SHEET_PREROLL_SECONDS,
    contactSheetSeekArguments,
} from '../src/contact-sheet.mjs';

function hasFfmpeg() {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

test('入力側シークで手前まで飛び、残りを出力側で詰める', () => {
    const seek = contactSheetSeekArguments(1920);
    assert.equal(seek.input, '1919.000000');
    assert.equal(seek.output, '1.000000');
});

test('分割の和は常に要求時刻と一致する（µs 整数で割るので丸めで動かない）', () => {
    for (const seconds of [0, 0.5, 1, 1.000001, 7.033333, 1920, 5289.366667, 9.966667]) {
        const seek = contactSheetSeekArguments(seconds);
        const sum = Math.round(Number(seek.input) * 1e6) + Math.round(Number(seek.output) * 1e6);
        assert.equal(sum, Math.round(seconds * 1e6), `${seconds} の和が一致する`);
    }
});

test('preroll より手前の時刻は入力側 0 のまま（負にしない）', () => {
    for (const seconds of [0, 0.25, CONTACT_SHEET_PREROLL_SECONDS]) {
        const seek = contactSheetSeekArguments(seconds);
        assert.equal(seek.input, '0.000000');
        assert.equal(Number(seek.output), seconds);
    }
    // 負の要求は 0 へ倒す。
    const negative = contactSheetSeekArguments(-5);
    assert.equal(negative.input, '0.000000');
    assert.equal(negative.output, '0.000000');
});

test('renderLabeledContactSheet の引数列は入力側 -ss を videoPath の前に置く（再発防止）', async () => {
    const source = readFileSync(new URL('../src/contact-sheet.mjs', import.meta.url), 'utf8');
    const labeled = source.slice(source.indexOf('export async function renderLabeledContactSheet'));
    // -ss が videoPath の直前にあること。
    assert.match(labeled, /"-ss", seek\.input,\s*"-i", videoPath,/u);
    // 出力側の残りは labelPath の後（適用したい入力の直前に置く規律）。
    assert.match(labeled, /"-i", labelPath,\s*"-ss", seek\.output,/u);
    // 修正前の形（-i の後に素の -ss）が残っていないこと。
    assert.doesNotMatch(labeled, /"-i", labelPath,\s*"-ss", formatNumber/u);
});

test('実 ffmpeg: 二段構えシークは従来の出力側シークと同じフレームを返す', (t) => {
    if (!hasFfmpeg()) {
        t.skip('ffmpeg が無い');
        return;
    }
    const directory = mkdtempSync(join(tmpdir(), 'akari-contact-sheet-seek-'));
    try {
        const source = join(directory, 'src.mp4');
        // keyint 150 = GOP 5 秒。入力側シーク単独ならキーフレーム境界へ丸まる条件を作る。
        execFileSync('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=14',
            '-c:v', 'libx264', '-g', '150', '-keyint_min', '150', '-sc_threshold', '0',
            '-pix_fmt', 'yuv420p', source,
        ], { stdio: 'pipe' });
        const label = join(directory, 'label.png');
        execFileSync('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'color=c=white:s=40x10:d=1', '-frames:v', '1', label,
        ], { stdio: 'pipe' });

        const filter = [
            '[0:v]scale=320:180:force_original_aspect_ratio=decrease',
            'pad=320:180:(ow-iw)/2:(oh-ih)/2:color=0x808080[base]',
            '[base][1:v]overlay=12:H-h-12',
        ].join(',');
        const grab = (args, out) => {
            execFileSync('ffmpeg', [
                '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                ...args, '-frames:v', '1', '-filter_complex', filter, out,
            ], { stdio: 'pipe' });
            return readFileSync(out);
        };

        // GOP 境界ちょうど・その 1µs 手前・フレーム境界・末尾近く。
        for (const seconds of [0, 0.5, 4.999999, 5, 7, 7.033333, 9.966667, 11.5, 13.9]) {
            const seek = contactSheetSeekArguments(seconds);
            const legacy = grab(
                ['-i', source, '-i', label, '-ss', seconds.toFixed(6)],
                join(directory, 'legacy.png')
            );
            const staged = grab(
                ['-ss', seek.input, '-i', source, '-i', label, '-ss', seek.output],
                join(directory, 'staged.png')
            );
            assert.ok(legacy.equals(staged), `${seconds} 秒でバイト一致する`);
        }

        // 検査に歯があること（隣フレームは別の絵）。
        const at7 = grab(
            ['-ss', contactSheetSeekArguments(7).input, '-i', source, '-i', label,
                '-ss', contactSheetSeekArguments(7).output],
            join(directory, 'a.png')
        );
        const next = grab(
            ['-ss', contactSheetSeekArguments(7 + 1 / 30).input, '-i', source, '-i', label,
                '-ss', contactSheetSeekArguments(7 + 1 / 30).output],
            join(directory, 'b.png')
        );
        assert.ok(!at7.equals(next), '隣のフレームは別の絵');

        // 入力側シーク単独では要求時刻のフレームにならない（出力側の残りが必須であることの証明）。
        // -noaccurate_seek は入力オプションなので -i より前に置く。
        const inputOnly = grab(
            ['-noaccurate_seek', '-ss', '7.000000', '-i', source, '-i', label],
            join(directory, 'c.png')
        );
        assert.ok(!inputOnly.equals(at7), '索引が信用できない素材では入力側単独だとずれる');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
