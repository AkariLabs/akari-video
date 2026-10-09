import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    addInfo, addRule, addWordEntry, applyPreparedInfos, applyPreparedRules, applyPreparedWords,
    emptyNotesFile, filterWordEntries, newNoteId, normalizeNotesFile, notesCount, PREPARED_INFOS,
    PREPARED_RULES, PREPARED_WORDS, removeInfo, removeRule, removeWordEntry, renderNotesMarkdown,
    updateInfo, updateRule, updateWordEntry, wordEntryLabel, wordSourceOptions
} from '../lib/browser/channel/channel-notes-model.js';

test('メモの読み込みは欠けたデータや不正な行に寛容', () => {
    assert.deepEqual(normalizeNotesFile(null), emptyNotesFile());
    const file = normalizeNotesFile({ version: 9, infos: [null, { id: 'i', kind: 'link', name: ' 公式 ', body: 2 }],
        rules: [{ id: 'r', area: 'audio', text: ' 音 ' }, { id: 'bad', area: 'unknown', text: '除外' }] });
    assert.equal(file.version, 0);
    assert.deepEqual(file.infos, [{ id: 'i', kind: 'link', name: '公式', body: '', when: '', pack: undefined }]);
    assert.equal(file.rules.length, 1);
    assert.equal(file.rules[0].text, '音');
});

test('情報と決まりを追加・編集・削除でき、ID が重ならない', () => {
    assert.equal(newNoteId('i', [{ id: 'i-1-1' }], 1), 'i-1-2');
    let file = addInfo(emptyNotesFile(), { kind: 'link', name: '公式', body: 'https://example.com', when: '説明欄' });
    const infoId = file.infos[0].id;
    file = updateInfo(file, infoId, { name: '公式サイト' });
    assert.equal(file.infos[0].name, '公式サイト');
    file = addRule(file, { area: 'audio', text: '声を優先' });
    const ruleId = file.rules[0].id;
    file = updateRule(file, ruleId, { text: '声を聞き取りやすく' });
    assert.equal(file.rules[0].text, '声を聞き取りやすく');
    assert.deepEqual(removeRule(removeInfo(file, infoId), ruleId), emptyNotesFile());
});

test('派生 Markdown は見出し、表、エスケープを持つ', () => {
    let file = addInfo(emptyNotesFile(), { kind: 'phrase', name: 'A|B', body: '一行目\n二行目', when: '最後' });
    file = addRule(file, { area: 'caption', text: '長い|字幕' });
    const md = renderNotesMarkdown(file);
    assert.equal(md.split('\n')[0], '<!-- アプリが生成。編集はアプリの『辞書とメモ』で -->');
    assert.match(md, /## よく使う情報/);
    assert.match(md, /## 決まりごと/);
    assert.match(md, /\| 決まり文句 \| A\\\|B \| 一行目 二行目 \| 最後 \|/);
    assert.match(md, /\| 字幕 \| 長い\\\|字幕 \|/);
    assert.ok(!renderNotesMarkdown(emptyNotesFile()).includes('| リンク |'));
});

test('単語帳の出どころを日本語で表示・絞り込みできる', () => {
    const entry = { surface: '大さじ', variants: ['おおさじ'], kind: 'notation' };
    assert.equal(wordEntryLabel(entry).source, '自分で足した');
    assert.equal(wordEntryLabel({ ...entry, source: 'people' }).source, '人とモノ');
    assert.equal(wordEntryLabel({ ...entry, source: 'pack:料理の単位' }).source, '☆料理の単位');
    const book = { version: 0, entries: [entry, { ...entry, source: 'people' }, { ...entry, source: 'pack:料理の単位' }] };
    assert.equal(wordSourceOptions(book).find(option => option.key === 'manual').count, 2);
    assert.equal(filterWordEntries(book, 'pack:料理の単位').length, 1);
});

test('同じ surface は variants を足し、編集時は表記と重複を除く', () => {
    let book = { version: 0, entries: [] };
    book = addWordEntry(book, { surface: ' ＧＰＵ ', variants: ['じーぴーゆー'], kind: 'term', source: 'manual' });
    book = addWordEntry(book, { surface: 'gpu', variants: ['ジーピーユー', 'じーぴーゆー'], kind: 'notation', source: 'manual' });
    assert.equal(book.entries.length, 1);
    assert.equal(book.entries[0].kind, 'notation');
    assert.equal(book.entries[0].variants.length, 2);
    book = updateWordEntry(book, 0, { surface: ' GPU ', variants: ['gpu', 'じーぴーゆー', 'じーぴーゆー'] });
    assert.deepEqual(book.entries[0].variants, ['じーぴーゆー']);
    assert.equal(removeWordEntry(book, 0).entries.length, 0);
});

test('用意されたまとまりを追加し、再追加は数えない', () => {
    const first = applyPreparedWords({ version: 0, entries: [] }, PREPARED_WORDS[0]);
    assert.equal(first.added, 3);
    assert.ok(first.book.entries.every(entry => entry.kind === 'term'));
    assert.equal(first.book.entries[0].source, 'pack:料理の単位');
    assert.equal(applyPreparedWords(first.book, PREPARED_WORDS[0]).added, 0);
    const existing = { version: 0, entries: [{ surface: '大さじ', variants: [], kind: 'term', source: 'people' }] };
    const merged = applyPreparedWords(existing, PREPARED_WORDS[0]);
    assert.equal(merged.added, 2);
    assert.equal(merged.book.entries[0].kind, 'term');
    assert.equal(merged.book.entries[0].source, 'people');
    assert.deepEqual(merged.book.entries[0].variants, ['おおさじ']);
    const rules = applyPreparedRules(emptyNotesFile(), PREPARED_RULES.find(pack => pack.name === '読みやすい字幕'));
    assert.equal(rules.added, 3);
    assert.equal(applyPreparedRules(rules.file, PREPARED_RULES.find(pack => pack.name === '読みやすい字幕')).added, 0);
    const infos = applyPreparedInfos(emptyNotesFile(), PREPARED_INFOS[0]);
    assert.equal(infos.added, 1);
    assert.equal(notesCount({ ...rules.file, infos: infos.file.infos }, first.book), 7);
    for (const pack of [...PREPARED_WORDS, ...PREPARED_INFOS, ...PREPARED_RULES]) assert.ok(pack.entries.length >= 1);
});
