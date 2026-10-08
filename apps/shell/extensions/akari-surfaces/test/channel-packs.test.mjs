import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MEMORY_PACKS, MEMORY_PACK_GENRES, packTotal } = require('../lib/browser/channel/memory-packs-builtin.js');
const { emptyPacksFile, normalizePacksFile, isImported, packSource, importPack, removePack, removePackCounts,
    packsByGroup, countPacks, packExamples, packWordExamples } = require('../lib/browser/channel/memory-pack-model.js');
const { emptyPeopleFile, defaultScene } = require('../lib/browser/channel/channel-people-model.js');
const ai = MEMORY_PACKS.find(pack => pack.name === 'AI 業界');
const date = new Date('2026-10-09T00:00:00.000Z');

test('同梱パックは AI 業界だけ取り込み可能で、分類と件数が一致する', () => {
    assert.equal(MEMORY_PACKS.length, 11);
    assert.deepEqual(MEMORY_PACKS.filter(pack => pack.status === 'ready').map(pack => pack.name), ['AI 業界']);
    assert.deepEqual(ai.counts, { people: 6, orgs: 4, products: 6, words: 6 });
    assert.equal(packTotal(ai), 16);
    assert.equal(ai.entries.length, 16);
    assert.equal(ai.entries.filter(entry => entry.kind === 'person').length, 6);
    assert.equal(ai.entries.filter(entry => entry.kind === 'org').length, 4);
    assert.equal(ai.entries.filter(entry => entry.kind === 'product').length, 6);
    assert.equal(ai.words.length, 6);
    assert.ok(MEMORY_PACKS.filter(pack => pack.status === 'planned').every(pack => !pack.entries && !pack.words));
    const groups = new Set(MEMORY_PACK_GENRES.flatMap(item => item.groups.map(group => `${item.genre} › ${group}`)));
    assert.ok(MEMORY_PACKS.every(pack => groups.has(`${pack.genre} › ${pack.group}`)));
    assert.equal(packsByGroup(MEMORY_PACKS).get('テック › AI 業界').length, 3);
});

test('取り込みは人とモノと辞書を足し、同じパックを再度入れても増やさない', () => {
    const first = importPack(ai, emptyPeopleFile(), { version: 0, entries: [] }, emptyPacksFile(), date);
    assert.equal(first.addedPeople, 16);
    assert.equal(first.addedWords, 6);
    assert.equal(first.people.entries.length, 16);
    assert.equal(first.book.entries.length, 6);
    assert.deepEqual(first.packs.imported, [{ name: 'AI 業界', at: date.toISOString() }]);
    assert.ok(first.people.entries.every(entry => entry.pack === 'AI 業界' && entry.edited === undefined));
    assert.ok(first.book.entries.every(entry => entry.source === 'pack:AI 業界'));
    assert.ok(first.people.entries.filter(entry => ['Claude Code', 'Codex', 'Gemini', 'ChatGPT', 'Claude', 'GPT'].includes(entry.name))
        .every(entry => entry.kind === 'org'));
    assert.equal(first.people.entries[0].scene, defaultScene('person'));
    assert.equal(first.people.entries[6].scene, defaultScene('org'));
    assert.equal(countPacks(MEMORY_PACKS, first.packs).imported, 1);
    assert.equal(isImported(first.packs, ai.name), true);
    assert.equal(packSource(ai.name), 'pack:AI 業界');
    const second = importPack(ai, first.people, first.book, first.packs, date);
    assert.equal(second.addedPeople, 0);
    assert.equal(second.addedWords, 0);
    assert.equal(second.people.entries.length, 16);
    assert.equal(second.book.entries.length, 6);
});

test('既存の名前は NFKC・大小文字・空白を無視し、辞書は別名だけを足す', () => {
    const people = { version: 0, entries: [{ id: 'existing', kind: 'org', name: 'Ｏｐｅｎ ＡＩ', aliases: [] }] };
    const book = { version: 0, entries: [{ surface: 'ＯｐｅｎＡＩ', kind: 'notation', variants: ['旧名'], source: 'manual', hits: 2 }] };
    const result = importPack(ai, people, book, emptyPacksFile(), date);
    assert.equal(result.addedPeople, 15);
    assert.equal(result.addedWords, 5);
    assert.equal(result.people.entries.filter(entry => entry.name === 'OpenAI').length, 0);
    assert.deepEqual(result.book.entries[0].variants, ['旧名', 'おーぷんえーあい']);
    assert.equal(result.book.entries[0].source, 'manual');
    assert.equal(result.book.entries[0].hits, 2);
});

test('外すと編集済みだけ残せ、全削除もできる', () => {
    const imported = importPack(ai, emptyPeopleFile(), { version: 0, entries: [] }, emptyPacksFile(), date);
    const people = { ...imported.people, entries: imported.people.entries.map((entry, index) => index === 0 ? { ...entry, edited: true } : entry) };
    assert.deepEqual(removePackCounts(ai.name, people, imported.book), { people: 16, words: 6 });
    const kept = removePack(ai.name, people, imported.book, imported.packs, { keepEdited: true });
    assert.equal(kept.people.entries.length, 1);
    assert.equal(kept.people.entries[0].pack, ai.name);
    assert.equal(kept.book.entries.length, 0);
    assert.deepEqual(kept.packs.imported, []);
    assert.equal(kept.removed, 21);
    const removed = removePack(ai.name, people, imported.book, imported.packs, { keepEdited: false });
    assert.equal(removed.people.entries.length, 0);
    assert.equal(removed.book.entries.length, 0);
    assert.equal(removed.removed, 22);
});

test('見本と壊れた packs.json の正規化', () => {
    assert.equal(packExamples(ai).length, 6);
    assert.deepEqual(packWordExamples(ai).slice(0, 2), ['くろーどこーど → Claude Code', 'じぇみに → Gemini']);
    assert.deepEqual(normalizePacksFile(null), emptyPacksFile());
    assert.deepEqual(normalizePacksFile({ version: 0, imported: [null, { name: ai.name, at: 'today' }, { name: ai.name, at: 'later' }] }),
        { version: 0, imported: [{ name: ai.name, at: 'today' }] });
});
