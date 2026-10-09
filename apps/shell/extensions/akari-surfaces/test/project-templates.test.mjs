import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PROJECT_TEMPLATES, defaultProjectTitle, parseTemplateMarkdown, planFileName } from '../lib/browser/home/project-templates.js';

test('同梱テンプレは四種類で企画書の見出しと空欄を持つ', () => {
    assert.equal(BUILTIN_PROJECT_TEMPLATES.length, 4);
    assert.equal(new Set(BUILTIN_PROJECT_TEMPLATES.map(template => template.id)).size, 4);
    for (const template of BUILTIN_PROJECT_TEMPLATES) {
        const headings = template.planMarkdown.match(/^## /gm) ?? [];
        assert.ok(headings.length >= 4 && headings.length <= 6);
        assert.match(template.planMarkdown, /^- $/m);
    }
});

test('チャンネルの front matter から名前と説明を読む', () => {
    const template = parseTemplateMarkdown('特集.md', '---\nname: 朝の特集\ndescription: 今日の話題を整理する\n---\n# 企画\n');
    assert.equal(template.name, '朝の特集');
    assert.equal(template.description, '今日の話題を整理する');
    assert.match(template.planMarkdown, /^---/);
});

test('front matter が無ければファイル名を使う', () => {
    const template = parseTemplateMarkdown('取材メモ.md', '# 取材メモ\n');
    assert.equal(template.name, '取材メモ');
    assert.equal(template.description, '取材メモ');
});

test('一方の項目だけある場合はもう一方をファイル名で補う', () => {
    const template = parseTemplateMarkdown('記録.md', '---\nname: 週末の記録\n---\n');
    assert.equal(template.name, '週末の記録');
    assert.equal(template.description, '記録');
});

test('テンプレ名と日付で表示名を決める', () => {
    assert.equal(defaultProjectTitle('開発ログ', new Date('2026-10-09T00:00:00Z')), '開発ログ 2026-10-09');
});

test('企画書名は既存ファイルを避けて連番にする', () => {
    assert.equal(planFileName([]), '企画書.md');
    assert.equal(planFileName(['企画書.md']), '企画書-2.md');
    assert.equal(planFileName(['企画書.md', '企画書-2.md', '企画書-4.md']), '企画書-3.md');
    assert.equal(planFileName(['企画書.MD']), '企画書-2.md');
});
