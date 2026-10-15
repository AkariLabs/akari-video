import './support/i18n-ja.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { lintBadgeCounts, lintBadgeLabel } from '../lib/browser/lint-badge-counts.js';

test('lint badge counts only errors and warnings as issues', () => {
    const lint = { findings: [
        { severity: 'info', check: 'intake.status', message: 'Draft intake' },
        { severity: 'info', check: 'other', message: 'Information' }
    ] };
    assert.deepEqual(lintBadgeCounts(lint.findings), { issues: 0, info: 2 });
    assert.deepEqual(lintBadgeCounts([...lint.findings, { severity: 'warning', check: 'w', message: 'Warning' }]),
        { issues: 1, info: 2 });
});

test('lint badge labels informational findings as no issues and counts warnings', () => {
    const findings = [
        { severity: 'info', check: 'intake.status', message: 'Draft intake' },
        { severity: 'info', check: 'timeline.duration-derived', message: 'Derived duration' }
    ];
    assert.equal(lintBadgeLabel(false), 'チェック: 未実行');
    assert.equal(lintBadgeLabel(true, findings), '確認中…');
    assert.equal(lintBadgeLabel(false, []), 'チェック: 問題なし');
    assert.equal(lintBadgeLabel(false, findings), 'チェック: 問題なし（情報 2）');
    assert.equal(lintBadgeLabel(false, [...findings, { severity: 'warning', check: 'w', message: 'Warning' }]),
        'チェック: 指摘 1 件');
});
