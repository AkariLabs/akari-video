import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const model = require('../lib/browser/channel/channel-people-model.js');
const entry = { id: 'p-1', kind: 'person', name: '中島', aliases: [] };
const one = value => model.normalizePeopleFile({ entries: [{ ...entry, ...value }] }).entries[0];

test('パーソナルの文字とリンクを整え、未知キーを保持する', () => {
    assert.deepEqual(one({ profile: { birthday: ' 04-01 ', personality: ' 穏やか ', background: ' ', notes: ' メモ ',
        links: [' https://example.org ', 3, ''], custom: { deep: true } } }).profile,
    { birthday: '04-01', personality: '穏やか', notes: 'メモ', links: ['https://example.org'], custom: { deep: true } });
});
test('不正な誕生日と空の profile を落とす', () => {
    assert.equal(one({ profile: { birthday: '2023-02-29', notes: ' ' } }).profile, undefined);
});
test('写真の文字を整え、空の配列は付けない', () => {
    assert.deepEqual(one({ photos: [' a.jpg ', 1, '', 'b.png'] }).photos, ['a.jpg', 'b.png']);
    assert.equal(one({ photos: [] }).photos, undefined);
});
test('声の値とサンプルを整え、未知キーを入れ子でも保持する', () => {
    const voice = one({ voice: { profile: ' owner ', avatar: ' me ', extra: 7, samples: [
        { file: ' a.wav ', consent: 'self', added_at: ' today ', extra: { x: 1 } },
        { file: 'b.wav' }, { file: 'c.wav', consent: 'other' }] } }).voice;
    assert.deepEqual(voice, { profile: 'owner', avatar: 'me', extra: 7, samples: [
        { file: 'a.wav', consent: 'self', added_at: 'today', extra: { x: 1 } }] });
});
test('声に使える値が無ければ voice を付けない', () => {
    assert.equal(one({ voice: { profile: ' ', samples: [{ file: 'a.wav' }], extra: 1 } }).voice, undefined);
});
test('旧 image とトップの未知キーを保持する', () => {
    const value = one({ image: ' people/a.jpg ', custom: { x: 1 } });
    assert.equal(value.image, 'people/a.jpg');
    assert.deepEqual(value.custom, { x: 1 });
    assert.equal(model.personPhoto(value), 'people/a.jpg');
});
test('誕生日の形と閏年を判定する', () => {
    for (const value of ['1990-04-01', '04-01', '02-29', '2024-02-29']) assert.equal(model.isValidBirthday(value), true);
    for (const value of ['2023-02-29', '13-01', '1990-4-1', '02-30']) assert.equal(model.isValidBirthday(value), false);
});
test('人物の写真と声の相対パスを作る', () => {
    assert.equal(model.personFolder('p-1'), 'people/p-1');
    assert.equal(model.photoPath('p-1', 'a.jpg'), 'people/p-1/photos/a.jpg');
    assert.equal(model.voiceSamplePath('p-1', 'a.wav'), 'people/p-1/voice/a.wav');
});
test('ファイル名からパスと危険な文字を取り除く', () => {
    assert.equal(model.voiceSamplePath('p-1', '../x.wav'), 'people/p-1/voice/x.wav');
    assert.equal(model.voiceSamplePath('p-1', 'a..wav'), 'people/p-1/voice/a.wav');
    assert.equal(model.photoPath('p-1', 'C:\\bad\\face?.jpg'), 'people/p-1/photos/face.jpg');
});
test('同名のファイルには連番を付ける', () => {
    assert.equal(model.uniqueFileName('a.jpg', ['a.jpg']), 'a-2.jpg');
    assert.equal(model.uniqueFileName('a.jpg', ['a.jpg', 'a-2.jpg']), 'a-3.jpg');
    assert.equal(model.uniqueFileName('a.jpg', []), 'a.jpg');
});
test('声の拡張子を大文字でも受ける', () => {
    for (const name of ['a.wav', 'a.M4A', 'a.MP3']) assert.equal(model.isVoiceSampleFile(name), true);
    assert.equal(model.isVoiceSampleFile('a.txt'), false);
});
test('声のサンプルにはファイルと同意が両方要る', () => {
    assert.equal(model.canAddVoiceSample(undefined, 'a.wav'), false);
    assert.equal(model.canAddVoiceSample('self', undefined), false);
    assert.equal(model.canAddVoiceSample('subject', 'a.mp3'), true);
    assert.equal(model.canAddVoiceSample('self', 'a.txt'), false);
});
test('更新時に人物欄を入れ、edited を付ける', () => {
    const file = { version: 0, entries: [entry] };
    const updated = model.updatePerson(file, entry.id, { profile: { birthday: '04-01' }, photos: ['a.jpg'],
        voice: { profile: 'owner', samples: [] } }).entries[0];
    assert.equal(updated.edited, true);
    assert.equal(updated.profile.birthday, '04-01');
    assert.deepEqual(updated.photos, ['a.jpg']);
    assert.equal(updated.voice.profile, 'owner');
});
test('詳細の空欄を保存しても profile・voice と空の links は JSON に出さない', () => {
    const form = { kind: 'person', name: ' 中島 ', reading: '', aliases: '', role: '', scene: '', caps: [],
        birthday: '', personality: '', background: '', notes: '', links: ' \n ', photos: [],
        voiceProfile: '', voiceAvatar: '', samples: [] };
    const saved = JSON.parse(JSON.stringify(model.updatePerson({ version: 0, entries: [entry] }, entry.id,
        model.personPatchFromForm(entry, form)))).entries[0];
    assert.equal(saved.name, '中島');
    assert.equal(Object.hasOwn(saved, 'profile'), false);
    assert.equal(Object.hasOwn(saved, 'voice'), false);
    const withBirthday = JSON.parse(JSON.stringify(model.personPatchFromForm(entry, { ...form, birthday: ' 04-01 ' })));
    assert.deepEqual(withBirthday.profile, { birthday: '04-01' });
    assert.equal(Object.hasOwn(withBirthday.profile, 'links'), false);
    const withUnknown = JSON.parse(JSON.stringify(model.personPatchFromForm({ ...entry, profile: { custom: 1 } }, form)));
    assert.deepEqual(withUnknown.profile, { custom: 1 });
});
test('写真は photos の先頭を優先し、声の有無を判定する', () => {
    assert.equal(model.personPhoto({ ...entry, image: 'old.jpg', photos: ['new.jpg'] }), 'new.jpg');
    assert.equal(model.hasVoice({ ...entry, voice: { samples: [] } }), false);
    assert.equal(model.hasVoice({ ...entry, voice: { samples: [{ file: 'a.wav', consent: 'self' }] } }), true);
});
test('詳細に同意と保存導線、ローカル保存の注記がある', () => {
    const source = readFileSync(new URL('../src/browser/channel/channel-person-detail.tsx', import.meta.url), 'utf8');
    for (const text of ['写真と声はこの機械の中だけに置きます。クラウドや記憶パックには入りません。',
        '本人の声です', '本人の同意を得た声です', 'data-akari-person-voice-add', 'canAddVoiceSample', "'narration'"]) {
        assert.ok(source.includes(text), text);
    }
});
