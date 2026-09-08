// WorkspaceService は WindowTitleService を注入している（task 2026-09-08）。
// WindowTitleService.init() が構築する title contribution に依存があると DI が循環する。
// contribution は依存ゼロ・ローカル状態のみとし、サービス注入は updater に限定する。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../browser/akari-welcome-window-title-contribution.ts', import.meta.url), 'utf8');

test('WindowTitleContribution のクラス本体は依存注入を持たない', () => {
    const classes = [...source.matchAll(/class\s+\w+\s+implements\s+WindowTitleContribution\s*\{([\s\S]*?)^\}/gm)];
    assert.equal(classes.length, 1, 'title contribution must be found');
    assert.doesNotMatch(classes[0][1], /@inject\s*\(/);
});

test('enhanceTitle はサービスや遅延プロバイダを解決しない', () => {
    const contribution = source.match(/class\s+\w+\s+implements\s+WindowTitleContribution\s*\{([\s\S]*?)^\}/m);
    assert.ok(contribution, 'title contribution must be found');
    const enhanceTitle = contribution[1].match(/\benhanceTitle\([^\n]*\)\s*:\s*string\s*\{([\s\S]*?)^    \}/m);
    assert.ok(enhanceTitle, 'enhanceTitle body must be found');
    // applicationName の静的設定取得は DI プロバイダではないため許容する。
    const body = enhanceTitle[1].replace(/\bFrontendApplicationConfigProvider\b/g, '');
    assert.doesNotMatch(body, /workspaceService|fileService|windowTitleService|Provider/);
});

test('WindowTitleService の注入は frontend updater が持つ', () => {
    const updater = source.match(/class\s+AkariWelcomeWindowTitleUpdater\s+implements\s+FrontendApplicationContribution\s*\{([\s\S]*?)^\}/m);
    assert.ok(updater, 'frontend updater must be found');
    assert.match(updater[1], /@inject\s*\(\s*WindowTitleService\s*\)/);
});
