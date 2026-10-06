import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';
import { lintPartnerPrompt, lintStatusLabel, summarizeLintFindings } from '../lib/common/lint-results.js';

test('runEditLint normalizes findings and counts only retained messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-lint-results-'));
    try {
        await writeFile(join(root, 'edit.json'), '{}');
        const service = {
            fsPath: value => value,
            findEditLintCli: async () => 'edit-lint.mjs',
            runNodeScript: async () => ({ code: 1, stdout: JSON.stringify({ findings: [
                { severity: 'error', check: 'cut', message: '長すぎます', path: 'cuts[3]', details: { secret: 1 } },
                { severity: 'future', check: 'audio', message: '音量を確認', path: 12 },
                { severity: 'warning', check: 'empty' },
                null
            ] }) })
        };
        const result = await AkariProjectServiceImpl.prototype.runEditLint.call(service, root);
        assert.deepEqual(result, { available: true, issueCount: 2, findings: [
            { severity: 'error', check: 'cut', message: '長すぎます', path: 'cuts[3]' },
            { severity: 'info', check: 'audio', message: '音量を確認' }
        ] });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('findings are sorted by severity with three summary counts', () => {
    const findings = [
        { severity: 'info', check: 'i', message: '情報' },
        { severity: 'error', check: 'e', message: 'エラー' },
        { severity: 'warning', check: 'w', message: '注意' },
        { severity: 'error', check: 'e2', message: 'もう一つ' }
    ];
    const summary = summarizeLintFindings(findings);
    assert.deepEqual([summary.error, summary.warning, summary.info], [2, 1, 1]);
    assert.deepEqual(summary.ordered.map(item => item.check), ['e', 'e2', 'w', 'i']);
    assert.deepEqual(findings.map(item => item.check), ['i', 'e', 'w', 'e2']);
});

test('partner prompt includes severity, message and optional path', () => {
    assert.equal(lintPartnerPrompt([
        { severity: 'info', check: 'i', message: '確認してください' },
        { severity: 'warning', check: 'w', message: '短くしてください', path: 'cuts[3]' }
    ]), '【編集内容のチェック】2 件の指摘:\n- [注意] 短くしてください (cuts[3])\n- [情報] 確認してください');
});

test('status line covers unrun, running, clear and findings', () => {
    assert.equal(lintStatusLabel(false), 'チェック: 未実行');
    assert.equal(lintStatusLabel(true, 2), '確認中…');
    assert.equal(lintStatusLabel(false, 0), 'チェック: 問題なし');
    assert.equal(lintStatusLabel(false, 3), 'チェック: 指摘 3 件');
});
