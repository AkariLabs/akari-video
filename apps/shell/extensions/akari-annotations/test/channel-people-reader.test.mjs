import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { channelPeopleLocation, parseChannelPeople, eligibleNarrationPeople, selectNarrationPerson,
    narrationPersonRoute,
    mergeSpeakerDictionary } = require('../lib/common/channel-people-reader.js');

test('チャンネル外は人物を探さず、壊れた JSON は空にする', () => {
    assert.equal(channelPeopleLocation('file:///work/other/project'), undefined);
    assert.deepEqual(channelPeopleLocation('file:///work/channels/a/videos/p'), {
        channel: 'a', peopleUri: 'file:///work/channels/a/people.json'
    });
    assert.deepEqual(parseChannelPeople('invalid'), []);
});

test('存在する声のプロフィールを持つ人物だけを表示し、選択で声とエンジンを決める', () => {
    const people = parseChannelPeople(JSON.stringify({ entries: [
        { id: 'p1', name: '泉', kind: 'person', voice: { profile: 'v1' } },
        { id: 'p2', name: '秋', kind: 'avatar', voice: { profile: 'missing' } },
        { id: 'p3', name: '春', kind: 'person' }
    ] }));
    const profiles = [{ id: 'v1', engines: ['irodori', 'fal-qwen3'] }];
    assert.deepEqual(eligibleNarrationPeople(people, profiles).map(person => person.id), ['p1']);
    assert.deepEqual(selectNarrationPerson(people[0], profiles, 'fal-qwen3'),
        { profile: profiles[0], engineId: 'fal-qwen3' });
    assert.deepEqual(selectNarrationPerson(people[0], profiles, 'other'),
        { profile: profiles[0], engineId: 'irodori' });
    assert.deepEqual(selectNarrationPerson(people[0], profiles, 'fal-qwen3', ['irodori']),
        { profile: profiles[0], engineId: 'irodori' });
    assert.equal(selectNarrationPerson(people[0], profiles, 'fal-qwen3', ['voicevox']), undefined);
    assert.equal(selectNarrationPerson(people[1], profiles), undefined);
    assert.deepEqual(narrationPersonRoute('v1', 'irodori'),
        { engine: 'irodori', voice: 'v1', profile: 'v1' });
});

test('話者辞書の他の値を維持し、つなぎを外すと該当話者だけ消す', () => {
    const source = JSON.stringify({ note: 1, speakers: { A: '旧', B: '残す' } });
    const linked = mergeSpeakerDictionary(source, 'A', { name: '泉', person: 'a/p1' });
    assert.deepEqual(JSON.parse(mergeSpeakerDictionary(linked, 'A', undefined)),
        { note: 1, speakers: { B: '残す' } });
});
