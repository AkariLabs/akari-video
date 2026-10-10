import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { channelPeopleLocation, parseChannelPeople, orderChannelPeople, mergeSpeakerDictionary } =
    require('../lib/common/channel-people-reader.js');

test('プロジェクトの URI からチャンネルの人物ファイルを求める', () => {
    assert.deepEqual(channelPeopleLocation('file:///work/channels/sample/videos/episode'), {
        channel: 'sample', peopleUri: 'file:///work/channels/sample/people.json'
    });
    assert.equal(channelPeopleLocation('file:///work/videos/episode'), undefined);
});

test('人物だけを読み、声のサンプルとプロフィールを拾う', () => {
    const people = parseChannelPeople(JSON.stringify({ version: 0, entries: [
        { id: 'one', name: 'いずみ', kind: 'person', voice: { samples: [{ file: 'voice.wav' }], profile: 'voice-1' } },
        { id: 'two', name: 'あき', kind: 'avatar' },
        { id: 'org', name: '会社', kind: 'org' }, { id: 'bad', kind: 'person' }
    ] }));
    assert.deepEqual(people, [
        { id: 'one', name: 'いずみ', kind: 'person', hasVoiceSample: true, voiceProfile: 'voice-1' },
        { id: 'two', name: 'あき', kind: 'avatar', hasVoiceSample: false }
    ]);
    assert.deepEqual(orderChannelPeople(people).map(person => person.id), ['one', 'two']);
    assert.deepEqual(parseChannelPeople('{'), []);
});

test('話者の差し替えと解除は他の辞書キーを保持する', () => {
    const original = JSON.stringify({ meta: { keep: true }, speakers: { A: '旧名', B: { name: '別人' } } });
    const linked = mergeSpeakerDictionary(original, 'A', { name: '新名', person: 'sample/one' });
    assert.deepEqual(JSON.parse(linked), { meta: { keep: true },
        speakers: { A: { name: '新名', person: 'sample/one' }, B: { name: '別人' } } });
    assert.deepEqual(JSON.parse(mergeSpeakerDictionary(linked, 'A', undefined)), {
        meta: { keep: true }, speakers: { B: { name: '別人' } }
    });
    assert.deepEqual(JSON.parse(mergeSpeakerDictionary('', 'A', { name: '名前' })),
        { speakers: { A: { name: '名前' } } });
});
