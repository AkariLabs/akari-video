import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildEditLintArgs,
    buildQuickExportEncoderChoices,
    buildRenderCutArgs,
    buildRenderCutOutputPath,
    buildRenderCutOutputRelativePath,
    describeRenderFailure,
    describeUnexpectedQuickExportFailure,
    determineLintOutcome,
    determineRenderOutcome,
    nextAvailableOutputName,
    sanitizeQuickExportOutputName,
    summarizeStderrTail
} from '../lib/common/quick-export-cli.js';

test('buildQuickExportEncoderChoices: OS ごとに対応エンコーダだけを順序どおり返す', () => {
    assert.deepEqual(buildQuickExportEncoderChoices('darwin'), [
        { label: '自動（既定・ハードウェアが使えれば優先）', value: 'auto' },
        { label: 'ハードウェア（VideoToolbox）', value: 'videotoolbox' },
        { label: 'ソフトウェア（x264）', value: 'x264' }
    ]);
    assert.deepEqual(buildQuickExportEncoderChoices('win32'), [
        { label: '自動（既定・ハードウェアが使えれば優先）', value: 'auto' },
        { label: 'ハードウェア（NVENC）', value: 'nvenc' },
        { label: 'ハードウェア（QSV）', value: 'qsv' },
        { label: 'ハードウェア（AMF）', value: 'amf' },
        { label: 'ハードウェア（Media Foundation）', value: 'mf' },
        { label: 'ソフトウェア（x264）', value: 'x264' }
    ]);
    assert.deepEqual(buildQuickExportEncoderChoices('linux'), [
        { label: '自動（既定・ハードウェアが使えれば優先）', value: 'auto' },
        { label: 'ソフトウェア（x264）', value: 'x264' }
    ]);
});

test('buildEditLintArgs: プロジェクトルート + --json', () => {
    assert.deepEqual(buildEditLintArgs('/tmp/project'), ['/tmp/project', '--json']);
});

test('sanitizeQuickExportOutputName: 素の名前はそのまま', () => {
    assert.equal(sanitizeQuickExportOutputName('final.mp4'), 'final.mp4');
    assert.equal(sanitizeQuickExportOutputName('  spaced.mp4  '), 'spaced.mp4');
});

test('sanitizeQuickExportOutputName: ディレクトリ区切り・親参照を剥がしファイル名1段に収める', () => {
    assert.equal(sanitizeQuickExportOutputName('sub/dir/final.mp4'), 'final.mp4');
    assert.equal(sanitizeQuickExportOutputName('../../etc/final.mp4'), 'final.mp4');
    assert.equal(sanitizeQuickExportOutputName('..\\..\\windows\\final.mp4'), 'final.mp4');
});

test('sanitizeQuickExportOutputName: 空・空白のみ・..のみは既定名にフォールバック', () => {
    assert.equal(sanitizeQuickExportOutputName(''), 'final.mp4');
    assert.equal(sanitizeQuickExportOutputName('   '), 'final.mp4');
    assert.equal(sanitizeQuickExportOutputName('..'), 'final.mp4');
    assert.equal(sanitizeQuickExportOutputName('../..'), 'final.mp4');
});

test('nextAvailableOutputName: 既存名が空なら既定名を返す', () => {
    assert.equal(nextAvailableOutputName('final.mp4', []), 'final.mp4');
});

test('nextAvailableOutputName: 無関係な既存名だけなら衝突しない', () => {
    assert.equal(nextAvailableOutputName('final.mp4', ['draft.mp4']), 'final.mp4');
});

test('nextAvailableOutputName: 1 件衝突すると -2 を付ける', () => {
    assert.equal(nextAvailableOutputName('final.mp4', ['final.mp4']), 'final-2.mp4');
});

test('nextAvailableOutputName: 連番の欠番を最初に使う', () => {
    assert.equal(
        nextAvailableOutputName('final.mp4', ['final.mp4', 'final-2.mp4', 'final-4.mp4']),
        'final-3.mp4'
    );
});

test('nextAvailableOutputName: 拡張子なしでも末尾へ連番を付ける', () => {
    assert.equal(nextAvailableOutputName('final', ['final', 'final-2']), 'final-3');
});

test('buildRenderCutOutputRelativePath (後方互換ラッパー): 常に exports/ 直下', () => {
    assert.equal(buildRenderCutOutputRelativePath('final.mp4'), 'exports/final.mp4');
    assert.equal(buildRenderCutOutputRelativePath('../evil.mp4'), 'exports/evil.mp4');
});

test('buildRenderCutOutputPath: outputDirectory 未指定なら既定の exports/ 直下', () => {
    assert.equal(buildRenderCutOutputPath('final.mp4'), 'exports/final.mp4');
});

test('buildRenderCutOutputPath: outputDirectory 指定時はその絶対パス直下（ファイル名は引き続き脱出防止）', () => {
    assert.equal(buildRenderCutOutputPath('final.mp4', '/chosen/exports'), '/chosen/exports/final.mp4');
    assert.equal(buildRenderCutOutputPath('final.mp4', '/chosen/exports/'), '/chosen/exports/final.mp4');
    assert.equal(buildRenderCutOutputPath('../evil.mp4', '/chosen/exports'), '/chosen/exports/evil.mp4');
});

test('buildRenderCutArgs: 既定設定でも --engine auto と --encoder auto を明示する', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'my-square-export.mp4' }),
        ['/tmp/project', '--out', 'exports/my-square-export.mp4', '--engine', 'auto', '--encoder', 'auto', '--progress']
    );
});

test('buildRenderCutArgs: encoder 未指定と auto 明示は同じ引数列になる', () => {
    const encoderUnspecified = buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4' });
    const autoExplicit = buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', encoder: 'auto' });
    assert.deepEqual(encoderUnspecified, autoExplicit);
    assert.deepEqual(
        autoExplicit,
        ['/tmp/project', '--out', 'exports/x.mp4', '--engine', 'auto', '--encoder', 'auto', '--progress']
    );
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', quality: 'standard', encoder: 'auto' }),
        autoExplicit
    );
});

test('buildRenderCutArgs: engine 未指定と auto 明示は同じ引数列になる', () => {
    const engineUnspecified = buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4' });
    const autoExplicit = buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', engine: 'auto' });
    assert.deepEqual(engineUnspecified, autoExplicit);
});

test('buildRenderCutArgs: gpu 明示時は --engine gpu を渡す', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', engine: 'gpu' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--engine', 'gpu', '--encoder', 'auto', '--progress']
    );
});

test('buildRenderCutArgs: osr 明示時は --engine osr を渡す', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', engine: 'osr' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--engine', 'osr', '--encoder', 'auto', '--progress']
    );
});

test('buildRenderCutArgs: quality は既定値以外で増え、encoder の明示選択は維持される', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', quality: 'high' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--quality', 'high', '--engine', 'auto', '--encoder', 'auto', '--progress']
    );
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', encoder: 'videotoolbox' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--engine', 'auto', '--encoder', 'videotoolbox', '--progress']
    );
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', quality: 'light', encoder: 'x264' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--quality', 'light', '--engine', 'auto', '--encoder', 'x264', '--progress']
    );
});

test('buildRenderCutArgs: fps 指定時のみ --fps が付く', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', fps: 30 }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--engine', 'auto', '--encoder', 'auto', '--fps', '30', '--progress']
    );
});

test('buildRenderCutArgs: --progress は全オプションの末尾に付く', () => {
    const args = buildRenderCutArgs('/tmp/project', {
        outputName: 'x.mp4',
        quality: 'light',
        encoder: 'videotoolbox',
        fps: 60
    });
    assert.deepEqual(
        args,
        [
            '/tmp/project', '--out', 'exports/x.mp4',
            '--quality', 'light', '--engine', 'auto', '--encoder', 'videotoolbox', '--fps', '60', '--progress'
        ]
    );
    assert.equal(args.at(-1), '--progress');
});

test('buildRenderCutArgs: outputDirectory 指定時は絶対パスの --out になる', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', outputDirectory: '/Volumes/Backup/exports' }),
        ['/tmp/project', '--out', '/Volumes/Backup/exports/x.mp4', '--engine', 'auto', '--encoder', 'auto', '--progress']
    );
});

test('determineLintOutcome: exit code 0/1/2/nullの対応', () => {
    assert.equal(determineLintOutcome(0), 'pass');
    assert.equal(determineLintOutcome(1), 'fail');
    assert.equal(determineLintOutcome(2), 'error');
    assert.equal(determineLintOutcome(null), 'error');
});

test('determineRenderOutcome: exit 0 + 実在 + サイズ>0 のみ成功', () => {
    assert.equal(determineRenderOutcome(0, { exists: true, size: 1024 }), 'success');
    assert.equal(determineRenderOutcome(1, { exists: true, size: 1024 }), 'failure');
    assert.equal(determineRenderOutcome(0, { exists: false, size: 0 }), 'failure');
    assert.equal(determineRenderOutcome(0, { exists: true, size: 0 }), 'failure');
    assert.equal(determineRenderOutcome(0, undefined), 'failure');
    assert.equal(determineRenderOutcome(null, { exists: true, size: 1024 }), 'failure');
});

test('summarizeStderrTail: 末尾N行のみ・空行は除外', () => {
    const stderr = 'line1\n\nline2\nline3\nline4\nline5\nline6\n';
    assert.equal(summarizeStderrTail(stderr, 3), 'line4\nline5\nline6');
    assert.equal(summarizeStderrTail('', 3), '');
    assert.equal(summarizeStderrTail('  \n \n', 3), '');
});

test('summarizeStderrTail: スタックの手前にある根本理由を落とさない', () => {
    const stderr = [
        'wrapper failed',
        'renderer failed: browser process could not start',
        'at launch (browser.js:1:1)',
        'at run (render.js:2:2)',
        'at main (cli.js:3:3)',
        'at processTicks (task.js:4:4)',
        'at async entry (entry.js:5:5)'
    ].join('\n');
    const summary = summarizeStderrTail(stderr, 5);
    assert.match(summary, /renderer failed: browser process could not start/);
    assert.equal(summary.split('\n').length, 5);
});

test('describeRenderFailure: exit 0 でも成果物が無ければ理由を必ず返す', () => {
    assert.equal(
        describeRenderFailure(0, '', 'exports/final.mp4', undefined),
        'render-cut は正常終了を返しましたが、成果物 exports/final.mp4 が作成されませんでした'
    );
    assert.match(describeRenderFailure(0, '', 'exports/final.mp4', { size: 0 }), /成果物 exports\/final\.mp4/);
});

test('describeRenderFailure: stderr が無い非0終了でも exit code を見せる', () => {
    assert.equal(
        describeRenderFailure(2, '', 'exports/final.mp4', undefined),
        'render-cut が exit code 2 で終了しました（エラー出力はありません）'
    );
});

test('describeUnexpectedQuickExportFailure: unknown でも空の失敗理由にしない', () => {
    assert.equal(describeUnexpectedQuickExportFailure(new Error('socket closed'), 'RPC 失敗'), 'RPC 失敗: socket closed');
    assert.equal(describeUnexpectedQuickExportFailure(undefined, 'RPC 失敗'), 'RPC 失敗');
});
