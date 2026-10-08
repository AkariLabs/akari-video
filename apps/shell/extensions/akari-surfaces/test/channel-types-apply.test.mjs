import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelMarkdown, parseChannelMarkdown } from '../lib/browser/channel/channel-design-model.js';
import { parseDesignMd } from '../lib/browser/channel/design-md-model.js';
import { findChannelType, typeContents } from '../lib/browser/channel/channel-types-model.js';
import {
    applyChannelMd, applyDesignMd, defaultChoices, mergeTypeRules, mergeTypeWords, parseNotes, parseTypeUndo,
    parseWordBook, planTypeApply
} from '../lib/browser/channel/channel-types-apply.js';

const type = findChannelType('tech-shorts');
assert.ok(type);
const contents = typeContents(type);

test('辞書と決まりごとは重複を避け、既存の項目を保つ', () => {
    for (const input of [undefined, '', '{']) assert.deepEqual(parseWordBook(input).book.entries, []);
    assert.equal(parseWordBook('{"version":1,"entries":[]}').readOnly, true);
    const parsed = parseWordBook(JSON.stringify({ version: 0, entries: [{ surface: ' GPU ', variants: ['じーぴーゆー'], kind: 'term', extra: 7 }] }));
    const words = mergeTypeWords(parsed.book, [['gpu', 'gpu'], ['えーぴーあい', 'API']], type.name);
    assert.equal(words.added, 1);
    assert.equal(words.book.entries[0].extra, 7);
    assert.equal(words.book.entries[1].kind, 'term');
    assert.equal(words.book.entries[1].source, `type:${type.name}`);
    const notes = mergeTypeRules(parseNotes(JSON.stringify({ version: 0, infos: [], rules: [{ id: 'old', area: '字幕', text: '同じ' }], extra: true })),
        [{ area: '字幕', text: '同じ' }, { area: '音', text: '新しい' }], type.name);
    assert.equal(notes.added, 1);
    assert.equal(notes.notes.rules[1].pack, `type:${type.name}`);
    assert.equal(notes.notes.extra, true);
});

test('channel.md の置換・追加・保持', () => {
    const replaced = applyChannelMd(undefined, contents, type.name, 'テスト', 'replace');
    assert.match(replaced, /^# テスト\n\nジャンル: テック・ガジェット（ショート特化）/);
    assert.match(replaced, /## チャンネルの型/);
    const existing = buildChannelMarkdown({ genre: ['料理'] }, 'テスト');
    const added = applyChannelMd(existing, contents, type.name, 'テスト', 'add');
    assert.match(added, /## ジャンル\n料理/);
    assert.equal(parseChannelMarkdown(added).answers.genre[0], '料理');
    assert.match(added, /## 雰囲気/);
    assert.equal((added.match(/^ジャンル: /gm) ?? []).length, 1);
    assert.equal((applyChannelMd(added, contents, type.name, 'テスト', 'add').match(/^ジャンル: /gm) ?? []).length, 1);
    assert.equal(applyChannelMd(existing, contents, type.name, 'テスト', 'keep'), existing);
});

test('design.md は雰囲気だけを追加または置換する', () => {
    const old = applyDesignMd(undefined, '元の文', 'テスト', 'add');
    const added = applyDesignMd(old, '追加の文', 'テスト', 'add');
    assert.equal(parseDesignMd(added).sections.find(item => item.heading === '雰囲気').body, '元の文\n追加の文');
    const replaced = applyDesignMd(old, '置換の文', 'テスト', 'replace');
    assert.equal(parseDesignMd(replaced).sections.find(item => item.heading === '雰囲気').body, '置換の文');
    assert.match(old, /^---\ncolors:/);
    assert.equal(parseDesignMd(old).sections.length, 5);
});

test('適用計画は書き込みと復元前の内容を対応させる', () => {
    const existing = buildChannelMarkdown({ genre: ['料理'] }, 'テスト');
    assert.equal(defaultChoices({ channelMd: existing, designMd: undefined, existingSkillSlugs: [] }, contents).channel, 'add');
    assert.equal(defaultChoices({ channelMd: '# テスト\n', existingSkillSlugs: [] }, contents).channel, 'replace');
    const inputs = { channelMd: existing, existingSkillSlugs: [], existingSkillTexts: {} };
    const plan = planTypeApply(type, inputs, defaultChoices(inputs, contents), 'テスト', '2026-10-09T00:00:00.000Z');
    for (const path of ['channel.md', 'design.md', '.akari/memory/word-book.json', '.akari/memory/notes.json',
        'skills/write-description/SKILL.md', 'skills/cut-shorts/SKILL.md']) assert.ok(path in plan.writes, path);
    assert.equal(plan.undo.files['channel.md'], existing);
    assert.equal(plan.undo.files['design.md'], null);
    assert.equal(plan.undo.files['skills/cut-shorts/SKILL.md'], null);
    assert.deepEqual(parseTypeUndo(JSON.stringify(plan.undo)), plan.undo);
    const skippedInputs = { ...inputs, existingSkillSlugs: ['write-description'], existingSkillTexts: { 'write-description': '元のスキル' } };
    const skipped = planTypeApply(type, skippedInputs, defaultChoices(skippedInputs, contents), 'テスト', 'now');
    assert.ok(!('skills/write-description/SKILL.md' in skipped.writes));
    const replacedSkill = planTypeApply(type, skippedInputs, { ...defaultChoices(skippedInputs, contents), skills: 'replace' }, 'テスト', 'now');
    assert.equal(replacedSkill.undo.files['skills/write-description/SKILL.md'], '元のスキル');
    const futureWords = planTypeApply(type, { ...inputs, wordBookText: '{"version":1,"entries":[]}' },
        defaultChoices(inputs, contents), 'テスト', 'now');
    assert.ok(!('.akari/memory/word-book.json' in futureWords.writes));
});
