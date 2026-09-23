import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceCanNext, voiceCheckReason, voiceCheckRows, voiceCopyDefaults, voiceDefaultAvatar,
  voiceId, voiceNextStep, voiceShouldDiscardProfileForRecording, voiceStorageDisplay } from '../lib/common/voice-clone-model.js';

test('保存先は実ホーム配下だけ ~ にし、外部 AKARI_HOME と Windows を保持する', () => {
  assert.equal(voiceStorageDisplay('/tmp/home/.akari', '/tmp/home', 'me', 'voice'), '~/.akari/avatars/me/voice/voice/');
  assert.equal(voiceStorageDisplay('/tmp/akari-home', '/tmp/home', 'me', 'voice'), '/tmp/akari-home/avatars/me/voice/voice/');
  assert.equal(voiceStorageDisplay('C:\\Users\\Me\\.akari', 'C:\\Users\\Me', 'me', 'voice'), '~\\.akari\\avatars\\me\\voice\\voice\\');
  assert.equal(voiceStorageDisplay('D:\\Akari', 'C:\\Users\\Me', 'me', 'voice'), 'D:\\Akari\\avatars\\me\\voice\\voice\\');
});

const check = { pass: true, reasons: [], checks: {
  duration: { value_s: 21, ok: true }, level: { peak_db: -3, mean_db: -19, ok: true },
  noise: { floor_db: -52, ok: true, warn: false }, script: { ok: true, score: 0.94, backend: 'speech-analyzer' }
} };

test('同意・録音・照合・保存名が次への条件になる', () => {
  const base = { consentSelf: false, audioPath: undefined, check: undefined, label: '' };
  assert.equal(voiceCanNext('consent', base), false);
  assert.equal(voiceCanNext('consent', { ...base, consentSelf: true }), true);
  assert.equal(voiceCanNext('record', base), false);
  assert.equal(voiceCanNext('record', { ...base, audioPath: '/tmp/a.wav' }), true);
  assert.equal(voiceCanNext('check', { ...base, check: { ...check, pass: false } }), false);
  assert.equal(voiceCanNext('check', { ...base, check }), true);
  assert.equal(voiceCanNext('save', base), false);
  assert.equal(voiceCanNext('save', { ...base, label: '名前' }), true);
  assert.equal(voiceCanNext('copy', { ...base, busy: true }), false);
});

test('不合格の理由と 4 行の表示を返す', () => {
  const bad = { ...check, pass: false, reasons: ['録音の長さが範囲外です'], checks: {
    ...check.checks, duration: { value_s: 3, ok: false }, noise: { floor_db: -30, ok: false, warn: true },
    script: { ok: false, score: 0.2, backend: 'speech-analyzer' }
  } };
  assert.equal(voiceCheckReason(bad), '録音の長さが範囲外です');
  assert.deepEqual(voiceCheckRows(bad).map(row => row.mark), ['✗', '✓', '!', '✗']);
});

test('使える写しは全選択、unavailable と未同意はクラウド除外', () => {
  const base = { irodoriAvailable: true, falAvailable: true, consentCloud: true, scriptOk: true };
  assert.deepEqual(voiceCopyDefaults(base), ['irodori', 'fal-qwen3']);
  assert.deepEqual(voiceCopyDefaults({ ...base, scriptOk: 'unavailable' }), ['irodori']);
  assert.deepEqual(voiceCopyDefaults({ ...base, consentCloud: false }), ['irodori']);
  assert.deepEqual(voiceCopyDefaults({ ...base, falAvailable: false }), ['irodori']);
  assert.deepEqual(voiceCopyDefaults({ ...base, irodoriAvailable: false }), ['fal-qwen3']);
  assert.deepEqual(voiceCopyDefaults({ ...base, irodoriAvailable: false, scriptOk: 'unavailable' }), []);
});

test('ID は英数ハイフン、衝突時に連番を付ける', () => {
  assert.equal(voiceId('My Voice 01', []), 'my-voice-01');
  assert.equal(voiceId('My Voice', ['my-voice', 'my-voice-2']), 'my-voice-3');
  assert.equal(voiceId('りょうま（ナレーション）', [], 'ryoma-narration'), 'ryoma-narration');
  assert.equal(voiceId('me（ナレーション）', []), 'me-narration');
});

test('状態遷移は六段階の範囲に収まる', () => {
  assert.equal(voiceNextStep('consent', -1), 'consent');
  assert.equal(voiceNextStep('check', 1), 'copy');
  assert.equal(voiceNextStep('save', 1), 'save');
});

test('既定アバターは登録済み avatar.json の件数と id で決める', () => {
  assert.equal(voiceDefaultAvatar([], 'requested'), 'requested');
  assert.equal(voiceDefaultAvatar([]), 'me');
  assert.equal(voiceDefaultAvatar([{ id: 'sample', displayName: 'サンプル' }]), 'sample');
  assert.equal(voiceDefaultAvatar([{ id: 'z' }, { id: 'ryoma' }, { id: 'a' }]), 'ryoma');
  assert.equal(voiceDefaultAvatar([{ id: 'z' }, { id: 'a' }]), 'a');
});

test('延長以外の新録音は作成済み正本を捨てる', () => {
  assert.equal(voiceShouldDiscardProfileForRecording(undefined, false), false);
  assert.equal(voiceShouldDiscardProfileForRecording('voice', false), true);
  assert.equal(voiceShouldDiscardProfileForRecording('voice', true), false);
});

test('写し 0 件は聞き比べを飛ばし、保存から戻ると写し選択へ戻る', () => {
  assert.equal(voiceNextStep('copy', 1, 0), 'save');
  assert.equal(voiceNextStep('save', -1, 0), 'copy');
  assert.equal(voiceNextStep('copy', 1, 1), 'compare');
  assert.equal(voiceNextStep('save', -1, 1), 'compare');
});
