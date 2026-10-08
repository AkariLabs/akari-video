import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(`../src/browser/${path}`, import.meta.url), 'utf8');
const widget = source('akari-home-widget.tsx');

function evaluateDateFunction(name, date) {
    const body = widget.match(new RegExp(`function ${name}\\(date = new Date\\(\\)\\): string \\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(body, `${name} の本体`);
    return new Function('date', body)(date);
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
    assert.match(widget, /title: newProjectDisplayTitleFor\(destination\.path\.base\)/);
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
    assert.match(widget, /title: newProjectDisplayTitleFor\(destination\.path\.base\)/);
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

test('ホームの状態文とタブ名を更新する', () => {
    assert.match(widget, /企画ができました/);
    assert.match(widget, /素材を入れる/);
    assert.match(widget, /this\.title\.caption = 'ホーム'/);
    assert.match(source('home/project-home-style.ts'), /minmax\(180px,1fr\)/);
});

test('設定のショートカットに Windows 用の表記がある', () => {
    const settings = source('akari-settings-dialog.ts');
    assert.match(settings, /Ctrl\+F/);
    assert.match(settings, /OS\.type\(\) === OS\.Type\.OSX/);
});
