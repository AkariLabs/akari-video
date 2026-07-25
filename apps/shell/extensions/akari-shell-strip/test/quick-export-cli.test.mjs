import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildEditLintArgs,
    buildRenderCutArgs,
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

test('buildRenderCutOutputRelativePath: 常に exports/ 直下', () => {
    assert.equal(buildRenderCutOutputRelativePath('final.mp4'), 'exports/final.mp4');
    assert.equal(buildRenderCutOutputRelativePath('../evil.mp4'), 'exports/evil.mp4');
});

test('buildRenderCutArgs: プロジェクトルート + --out exports/<name>', () => {
    assert.deepEqual(
        buildRenderCutArgs('/tmp/project', 'my-square-export.mp4'),
        ['/tmp/project', '--out', 'exports/my-square-export.mp4']
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
