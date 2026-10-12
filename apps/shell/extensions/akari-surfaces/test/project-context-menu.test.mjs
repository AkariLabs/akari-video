import test, { after as afterI18nTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));
const { projectContextMenuItems } = await import('../lib/browser/home/project-context-menu.js');

const source = path => readFileSync(new URL(`../src/browser/${path}`, import.meta.url), 'utf8');

test('プロジェクトの右クリックは「プロジェクトを開く」「パスをコピー」、開いているものは開くを出さない', () => {
    assert.deepEqual(projectContextMenuItems({ current: false }).map(item => [item.id, item.label]),
        [['open', 'プロジェクトを開く'], ['copy-path', 'パスをコピー']]);
    assert.deepEqual(projectContextMenuItems({ current: true }).map(item => item.id), ['copy-path']);
});

test('ホームのカード・一覧のポップアップの両方で右クリックを受け、パスは OS のパスでコピーする', () => {
    assert.match(source('home/project-list-view.tsx'), /onContextMenu=\{event => \{ if \(!props\.onContextMenu\) return; event\.preventDefault\(\);/u);
    const home = source('akari-home-widget.tsx');
    assert.match(home, /navigator\.clipboard\.writeText\(row\.uri\.path\.fsPath\(\)\)/u);
    assert.match(home, /onProjectContextMenu: \(row, x, y\) => this\.openProjectContextMenu\(row, x, y, \(\) => dialog\.close\(\)\)/u);
    const dialog = source('akari-project-launcher-dialog.ts');
    assert.equal((dialog.match(/this\.listenProjectContextMenu\(card, row\)/gu) ?? []).length, 2);
});

test('プロジェクトの中の「プロジェクト一覧」はタブではなく専用のポップアップで開く', () => {
    const command = source('akari-home-command-contribution.ts');
    const body = command.slice(command.indexOf('AKARI_COMMANDS.openProjectList'));
    const execute = body.slice(0, body.indexOf('registerCommand('));
    assert.match(execute, /home\.openProjectLauncher\(/u);
    assert.doesNotMatch(execute, /addWidget\(/u);
});
