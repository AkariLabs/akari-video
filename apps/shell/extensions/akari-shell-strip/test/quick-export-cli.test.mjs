import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildEditLintArgs,
    buildRenderCutArgs,
    buildRenderCutOutputPath,
    buildRenderCutOutputRelativePath,
    determineLintOutcome,
    determineRenderOutcome,
    sanitizeQuickExportOutputName,
    summarizeStderrTail
} from '../lib/common/quick-export-cli.js';

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

test('buildRenderCutOutputRelativePath (後方互換ラッパー): 常に exports/ 直下', () => {
    assert.equal(buildRenderCutOutputRelativePath('final.mp4'), 'exports/final.mp4');
    assert.equal(buildRenderCutOutputRelativePath('../evil.mp4'), 'exports/evil.mp4');
});

test('buildRenderCutOutputPath: outputDirectory 未指定なら既定の exports/ 直下', () => {
    assert.equal(buildRenderCutOutputPath('final.mp4'), 'exports/final.mp4');
});

test('buildRenderCutOutputPath: outputDirectory 指定時はその絶対パス直下（ファイル名は引き続き脱出防止）', () => {
    assert.equal(buildRenderCutOutputPath('final.mp4', '/Users/someone/Desktop'), '/Users/someone/Desktop/final.mp4');
    assert.equal(buildRenderCutOutputPath('final.mp4', '/Users/someone/Desktop/'), '/Users/someone/Desktop/final.mp4');
    assert.equal(buildRenderCutOutputPath('../evil.mp4', '/Users/someone/Desktop'), '/Users/someone/Desktop/evil.mp4');
});

test('buildRenderCutArgs (task 2026-07-25-export-options backward-compat): 既定設定は --out と --progress のみ', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'my-square-export.mp4' }),
        ['/tmp/project', '--out', 'exports/my-square-export.mp4', '--progress']
    );
    // quality/encoder を明示的に既定値で渡しても、省略時と同じ引数列になる。
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', quality: 'standard', encoder: 'auto' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--progress']
    );
});

test('buildRenderCutArgs: quality/encoder が既定値以外のときだけ引数が増える', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', quality: 'high' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--quality', 'high', '--progress']
    );
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', encoder: 'videotoolbox' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--encoder', 'videotoolbox', '--progress']
    );
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', quality: 'light', encoder: 'x264' }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--quality', 'light', '--encoder', 'x264', '--progress']
    );
});

test('buildRenderCutArgs: fps 指定時のみ --fps が付く', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', fps: 30 }),
        ['/tmp/project', '--out', 'exports/x.mp4', '--fps', '30', '--progress']
    );
});

test('buildRenderCutArgs: outputDirectory 指定時は絶対パスの --out になる', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', { outputName: 'x.mp4', outputDirectory: '/Volumes/Backup/exports' }),
        ['/tmp/project', '--out', '/Volumes/Backup/exports/x.mp4', '--progress']
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
