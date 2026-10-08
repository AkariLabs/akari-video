import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    normalizePeopleFile, emptyPeopleFile, addPerson, removePeople, peopleCounts, defaultScene,
    splitAliases, summarizeNames, mergeAliasesIntoWordBook, normalizeWordBook
} = require('../lib/browser/channel/channel-people-model.js');

test('人とモノは壊れた行を飛ばして別名を配列に整える', () => {
    assert.deepEqual(normalizePeopleFile(null), emptyPeopleFile());
    const file = normalizePeopleFile({ entries: [null, { id: 'a', kind: 'person', name: '中島', aliases: 'なかじま' },
        { id: 'b', kind: 'org', name: '会社', aliases: ['別名', 1, ''] }, { id: '', kind: 'avatar', name: 'なし' }] });
    assert.equal(file.entries.length, 2);
    assert.deepEqual(file.entries[0].aliases, []);
    assert.deepEqual(file.entries[1].aliases, ['別名']);
});

test('省略された caps と edited は足さず、指定された値は保つ', () => {
    const file = normalizePeopleFile({ entries: [
        { id: 'a', kind: 'person', name: '中島' },
        { id: 'b', kind: 'avatar', name: 'キャラクター', aliases: [], caps: ['voice'], edited: true }
    ] });
    assert.deepEqual(file.entries[0], { id: 'a', kind: 'person', name: '中島', aliases: [] });
    assert.deepEqual(file.entries[1].caps, ['voice']);
    assert.equal(file.entries[1].edited, true);
});

test('足してから選んで消せる。ID は同じ時刻でも衝突しない', () => {
    const first = addPerson(emptyPeopleFile(), { kind: 'person', name: '中島', aliases: [] }, 100);
    const second = addPerson(first.file, { kind: 'person', name: '田中', aliases: [] }, 100);
    assert.notEqual(first.entry.id, second.entry.id);
    assert.deepEqual(removePeople(second.file, [first.entry.id]).entries.map(entry => entry.name), ['田中']);
});

test('種類と出どころを数える', () => {
    const file = normalizePeopleFile({ entries: [
        { id: 'a', kind: 'person', name: 'A' }, { id: 'b', kind: 'avatar', name: 'B', pack: 'AI 業界' },
        { id: 'c', kind: 'org', name: 'C', pack: 'AI 業界' }
    ] });
    const counts = peopleCounts(file);
    assert.deepEqual(counts.byKind, { person: 1, avatar: 1, org: 1 });
    assert.deepEqual(counts.bySource, [{ key: 'manual', label: '自分で足した', count: 1 }, { key: 'AI 業界', label: '☆AI 業界', count: 2 }]);
});

test('既定の場面、別名の分割、確認の名前を整える', () => {
    assert.equal(defaultScene('person'), '名前が出たら右下に顔と肩書き');
    assert.equal(defaultScene('org'), 'ロゴは白の単色');
    assert.equal(defaultScene('avatar'), '');
    assert.deepEqual(splitAliases('なかじま, ナカジマ、中嶋'), ['なかじま', 'ナカジマ', '中嶋']);
    assert.deepEqual(splitAliases('A，A、B'), ['A', 'B']);
    assert.equal(summarizeNames(['A', 'B', 'C', 'D', 'E', 'F', 'G']), 'A、B、C、D、E、F ほか 1 件');
});

test('単語帳へ新しい名前と別名を足す', () => {
    const book = mergeAliasesIntoWordBook(normalizeWordBook(undefined), '中島さん', ['なかじま', '中島さん'], 'people');
    assert.equal(book.entries[0].kind, 'term');
    assert.equal(book.entries[0].source, 'people');
    assert.deepEqual(book.entries[0].variants, ['なかじま']);
    assert.ok(book.entries[0].added_at);
});

test('既存行には別名だけを足し、未知フィールドと全角半角の一致を守る', () => {
    const original = normalizeWordBook({ version: 0, custom: '保持', entries: [{ surface: 'Ａ ＢＣ', kind: 'notation', variants: ['別名'], hits: 4, extra: '残す' }] });
    const result = mergeAliasesIntoWordBook(original, 'a bc', ['別名', '新しい別名', 'ＡＢＣ'], 'people');
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.entries[0].variants, ['別名', '新しい別名']);
    assert.equal(result.entries[0].hits, 4);
    assert.equal(result.entries[0].extra, '残す');
    assert.equal(result.entries[0].kind, 'notation');
    assert.equal(result.custom, '保持');
    assert.deepEqual(normalizeWordBook({ version: 1, entries: result.entries }), { version: 0, entries: [] });
});
