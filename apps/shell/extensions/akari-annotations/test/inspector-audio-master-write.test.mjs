import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUDIO_MASTER_DEFAULT_LOUDNORM,
  AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP,
  readAudioMasterSnapshot,
  updateAudioMasterDocument
} from '../lib/browser/inspector/audio-master.js';

const inspectorSource = readFileSync(
  new URL('../src/browser/akari-inspector-widget.ts', import.meta.url),
  'utf8'
);
const timelineSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url),
  'utf8'
);

test('マスター 4 行を 4 kind の文書レベル write へ対応付ける', () => {
  for (const [name, kind] of [
    ['audio-master-enabled', 'audio-master-enabled'],
    ['audio-master-denoise', 'audio-master-denoise'],
    ['audio-master-loudnorm', 'audio-master-loudnorm'],
    ['audio-master-true-peak', 'audio-master-true-peak']
  ]) {
    assert.match(inspectorSource, new RegExp(`name: '${name}'[\\s\\S]{0,700}kind: '${kind}'`, 'u'));
  }
  assert.match(timelineSource, /return this\.handleAudioMasterWrite\(request\)/u);
  assert.match(timelineSource, /updateAudioMasterDocument\(document, request\)/u);
});

test('オンは v1 / v2 とも audio.master={} を生成し、オフは master だけを除去する', () => {
  for (const version of [1, 2]) {
    const enabled = updateAudioMasterDocument(
      { version, title: 'keep', audio: { duck_keys: ['speech'] } },
      { kind: 'audio-master-enabled', value: true }
    );
    assert.deepEqual(enabled, {
      version,
      title: 'keep',
      audio: { duck_keys: ['speech'], master: {} }
    });
    const disabled = updateAudioMasterDocument(
      { ...enabled, audio: { ...enabled.audio, master: { future: 42 } } },
      { kind: 'audio-master-enabled', value: false }
    );
    assert.deepEqual(disabled, { version, title: 'keep', audio: { duck_keys: ['speech'] } });
  }
  assert.deepEqual(updateAudioMasterDocument(
    { version: 1, title: 'audio 無し' },
    { kind: 'audio-master-enabled', value: false }
  ), { version: 1, title: 'audio 無し' });
});

test('マスタリングをオンにしてラウドネス -16 を書き、オフにする通しシーケンス', () => {
  let document = { version: 2, audio: {} };

  document = updateAudioMasterDocument(
    document,
    { kind: 'audio-master-enabled', value: true }
  );
  assert.deepEqual(document.audio.master, {});

  document = updateAudioMasterDocument(
    document,
    { kind: 'audio-master-loudnorm', value: -16 }
  );
  assert.deepEqual(document.audio.master, { loudnorm: -16 });

  document = updateAudioMasterDocument(
    document,
    { kind: 'audio-master-enabled', value: false }
  );
  assert.equal(Object.hasOwn(document.audio, 'master'), false);
});

test('部分更新とリセットは master の未知キーを保持する', () => {
  const original = {
    version: 2,
    audio: { futureAudio: true, master: { future: { mode: 'keep' }, denoise: 'strong', loudnorm: -16 } }
  };
  const denoised = updateAudioMasterDocument(original, { kind: 'audio-master-denoise', value: 'std' });
  assert.deepEqual(denoised.audio.master, {
    future: { mode: 'keep' }, denoise: 'std', loudnorm: -16
  });
  const resetDenoise = updateAudioMasterDocument(denoised, { kind: 'audio-master-denoise', value: 'off' });
  assert.deepEqual(resetDenoise.audio.master, { future: { mode: 'keep' }, loudnorm: -16 });
  const resetLoudnorm = updateAudioMasterDocument(
    resetDenoise,
    { kind: 'audio-master-loudnorm', value: null }
  );
  assert.deepEqual(resetLoudnorm.audio, {
    futureAudio: true,
    master: { future: { mode: 'keep' } }
  });
});

test('数値境界は受理し、範囲外・非有限値・オフ中の下位更新は拒否する', () => {
  const base = { audio: { master: { future: true } } };
  assert.equal(updateAudioMasterDocument(base, {
    kind: 'audio-master-loudnorm', value: -70
  }).audio.master.loudnorm, -70);
  assert.equal(updateAudioMasterDocument(base, {
    kind: 'audio-master-true-peak', value: 0
  }).audio.master.true_peak_dbtp, 0);
  assert.throws(() => updateAudioMasterDocument(base, {
    kind: 'audio-master-loudnorm', value: -70.1
  }), /-70〜0/u);
  assert.throws(() => updateAudioMasterDocument(base, {
    kind: 'audio-master-true-peak', value: Number.NaN
  }), /-9〜0/u);
  assert.throws(() => updateAudioMasterDocument({ audio: {} }, {
    kind: 'audio-master-denoise', value: 'strong'
  }), /マスタリングがオフ/u);
  assert.match(inspectorSource, /scrubStep: 0\.5, min: -70, max: 0/u);
  assert.match(inspectorSource, /scrubStep: 0\.1, min: -9, max: 0/u);
});

test('未設定 master は書き出し既定 -14 LUFS / -1.5 dBTP で表示する', () => {
  assert.equal(AUDIO_MASTER_DEFAULT_LOUDNORM, -14);
  assert.equal(AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP, -1.5);
  assert.deepEqual(readAudioMasterSnapshot({ audio: { master: {} } }), { enabled: true });
  assert.match(inspectorSource, /snapshot\.loudnorm \?\? AUDIO_MASTER_DEFAULT_LOUDNORM/u);
  assert.match(inspectorSource, /snapshot\.truePeakDbtp \?\? AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP/u);
});

test('文書レベル snapshot は現在値を運び、edit.json 再読込の更新経路へ乗る', () => {
  assert.deepEqual(readAudioMasterSnapshot({
    audio: { master: { denoise: 'strong', loudnorm: -16, true_peak_dbtp: -2, future: true } }
  }), {
    enabled: true, denoise: 'strong', loudnorm: -16, truePeakDbtp: -2
  });
  assert.match(
    timelineSource,
    /selectionModel\.audioMaster = readAudioMasterSnapshot\(this\.editDocument\)[\s\S]{0,120}pushSelectionSnapshot\(\)/u
  );
});
