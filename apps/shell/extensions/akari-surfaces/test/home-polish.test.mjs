import test, { after as afterI18nTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertCatalogCopy } from './i18n-source-copy.mjs';
import { setLanguage, t } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));


const source = path => readFileSync(new URL(`../src/browser/${path}`, import.meta.url), 'utf8');
const widget = source('akari-home-widget.tsx');

function evaluateDateFunction(name, date) {
    const body = widget.match(new RegExp(`function ${name}\\(date = new Date\\(\\)\\): string \\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(body, `${name} の本体`);
    return new Function('date', 't', body)(date, t);
}

function evaluateDisplayTitleFor(name) {
    const body = widget.match(/function newProjectDisplayTitleFor\(name: string\): string \{([\s\S]*?)\n\}/)?.[1];
    assert.ok(body, 'newProjectDisplayTitleFor の本体');
    return new Function('name', 'newProjectDisplayTitle', body)(name, date => evaluateDateFunction('newProjectDisplayTitle', date ?? new Date()));
}

test('フォルダ名の日時を表示名に使う', () => {
    assert.equal(evaluateDisplayTitleFor('2026-10-09-0456'), '新しい動画 10/9 04:56');
    assert.equal(evaluateDisplayTitleFor('2026-10-09-0456-2'), '新しい動画 10/9 04:56');
    assert.match(evaluateDisplayTitleFor('foo'), /^新しい動画 /);
    assert.match(widget, /this\.pendingCreateTitle \|\| newProjectDisplayTitleFor\(destination\.path\.base\)/);
});

test('新規プロジェクト名と表示名にローカル日時を使う', () => {
    const date = new Date(2026, 9, 8, 19, 18);
    assert.equal(evaluateDateFunction('newProjectNameStem', date), '2026-10-08-1918');
    assert.equal(evaluateDateFunction('newProjectDisplayTitle', date), '新しい動画 10/8 19:18');
    const reserve = widget.split('protected async reserveNewProjectName(')[1]?.split('startNewProject =')[0];
    assert.ok(reserve);
    assert.match(reserve, /newProjectNameStem\(\)/);
    assert.doesNotMatch(reserve, /toISOString\(\)\.slice\(0, 10\)/);
    assert.doesNotMatch(widget, /new-video/);
    assert.match(widget, /this\.pendingCreateTitle \|\| newProjectDisplayTitleFor\(destination\.path\.base\)/);
});

test('進め方フォームを閉じられるシートとして表示する', () => {
    const form = widget.split('protected renderIntakeForm(): React.ReactNode {')[1];
    assert.ok(form);
    assert.match(form, /<HomeScrim kind='intake' onClose={this\.closeIntakeForm}>/);
    assert.match(form, /className='akari-home-dialog-actions'/);
    assert.doesNotMatch(form, /ホームに戻る/);
    const css = source('home/home-panels.tsx');
    assert.match(css, /max-height:calc\(100vh - 48px\)/);
    assert.match(css, /position:sticky/);
});

test('ホームのタブ名と下段のカードの幅', () => {
    assertCatalogCopy(widget, 'ホーム');
    assert.match(source('home/project-home-style.ts'), /minmax\(180px,1fr\)/);
});

test('プロジェクトのホームは「いまの状態」でなく過去のプロジェクトと新しい動画を出す（2026-10-12 オーナー指摘）', () => {
    const body = widget.match(/protected renderProjectHome\(\): React\.ReactNode \{([\s\S]*?)\n    \}\n/)?.[1];
    assert.ok(body, 'renderProjectHome の本体');
    assert.doesNotMatch(body, /projectHomeCurrentState|akari-os-status/);
    // 単体のプロジェクト（チャンネルの外）でも一覧が出る — チャンネルで絞らない
    assert.match(body, /const others = rows\.filter\(row => !row\.current\)\.sort/);
    assert.doesNotMatch(body, /\{channel && <section/);
    assert.match(body, /data-akari-recent-projects='true'/);
    assert.match(body, /data-akari-new-project='true'[\s\S]*?this\.startNewProject\(\)/);
    assert.match(body, /others\.slice\(0, PROJECT_HOME_RECENT_LIMIT\)/);
    assert.match(body, /AKARI_COMMANDS\.openProjectList/);
});

test('設定のショートカットに Windows 用の表記がある', () => {
    const settings = source('akari-settings-dialog.ts');
    assert.match(settings, /Ctrl\+F/);
    assert.match(settings, /OS\.type\(\) === OS\.Type\.OSX/);
});

test('新しい動画も「開きますか」の問いを出す — 問いを飛ばして「この画面」に決め打ちしない（2026-10-12 オーナー指摘）', () => {
    const body = widget.match(/protected async createAndOpenProject\(destination: URI, originRect\?: DOMRect\): Promise<void> \{([\s\S]*?)\n    \}\n/)?.[1];
    assert.ok(body, 'createAndOpenProject の本体');
    assert.match(body, /reason: 'new-project'/);
    assert.doesNotMatch(body, /chooseOpen\(/);
    // 一覧の全件読み直しを待ってから開かない（数百件で数分止まった）
    assert.doesNotMatch(body, /await this\.loadCreatorRootProjects\(\)/);
});
