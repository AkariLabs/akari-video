import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_FIELDS, TYPE_BASES, TYPE_VARIANTS } from '../lib/browser/channel/channel-types-data.js';
import { allChannelTypes, findChannelType, findChannelTypeByName, filterChannelTypes, nearChannelTypes, typeContents, buildMyTypeJson } from '../lib/browser/channel/channel-types-model.js';

test('型の分野、元、違いと無料枠', () => {
    assert.equal(TYPE_FIELDS.length, 8);
    assert.equal(TYPE_BASES.length, 29);
    assert.equal(TYPE_VARIANTS.length, 8);
    assert.equal(allChannelTypes().length, 28 * 8 + 1);
    assert.deepEqual(allChannelTypes().filter(type => type.tier === 'free').map(type => type.id), ['talkch-basic', 'daily-basic', 'free-basic']);
    const tech = findChannelType('tech-shorts');
    assert.equal(tech.name, 'テック・ガジェット・ショート特化');
    assert.equal(tech.derivedFrom, 'テック・ガジェット（Akari）');
    assert.equal(findChannelTypeByName(tech.name)?.id, tech.id);
});

test('絞り込み、検索、並び、近い型', () => {
    const options = { fieldId: 'learn', query: '', author: 'all', sort: 'uses' };
    const field = filterChannelTypes(options);
    assert.ok(field.length > 0 && field.every(type => type.fieldId === 'learn'));
    assert.ok(field.every((type, index) => index === 0 || field[index - 1].uses >= type.uses));
    assert.ok(filterChannelTypes({ ...options, author: 'akari' }).every(type => type.author === 'Akari'));
    assert.ok(filterChannelTypes({ ...options, author: 'community' }).every(type => type.author !== 'Akari'));
    assert.deepEqual(filterChannelTypes({ ...options, author: 'free', query: '決めない' }).map(type => type.id), ['free-basic']);
    assert.ok(filterChannelTypes({ ...options, query: 'ガジェット' }).some(type => type.id === 'tech-shorts'));
    const newest = filterChannelTypes({ ...options, sort: 'new' });
    assert.ok(newest.every((type, index) => index === 0 || newest[index - 1].createdOrder >= type.createdOrder));
    const tech = findChannelType('tech-shorts');
    assert.ok(nearChannelTypes(tech).length <= 4);
    assert.ok(nearChannelTypes(tech).every(type => type.id !== tech.id && (type.baseId === tech.baseId || type.variantId === tech.variantId)));
});

test('型から下書きの中身を組み立てる', () => {
    const tech = typeContents(findChannelType('tech-shorts'));
    assert.equal(tech.genreLine, 'ジャンル: テック・ガジェット（ショート特化）');
    assert.deepEqual(tech.answers.len, ['縦ショート 60 秒まで']);
    assert.ok(tech.words.some(([from, to]) => from === 'じーぴーゆー' && to === 'GPU'));
    assert.match(tech.rules[0].text, /下から 20%/);
    assert.ok(tech.skillSlugs.includes('cut-shorts'));
    assert.ok(tech.designSentence.startsWith('縦 9:16'));
    assert.ok(typeContents(findChannelType('edu-deep')).skillSlugs.includes('add-chapters'));
    assert.ok(Object.values(typeContents(findChannelType('free-basic')).answers).every(values => values.length === 0));
    const saved = JSON.parse(buildMyTypeJson({ channelName: '私のチャンネル', skillSlugs: [], now: '2026-10-09T00:00:00.000Z' }));
    assert.equal(saved.version, 0);
    assert.equal(saved.name, '私のチャンネル');
});
