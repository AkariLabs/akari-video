import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyMigration,
  detectEditVersion,
  migrateEditToV2,
  planMigration,
  revertMigration,
} from '../lib/migrate/index.js';
import { readEditV2 } from '../lib/edit-v2.js';

function base(version = 0) {
  return {
    version,
    output: { width: 1920, height: 1080, fps: 30 },
    ...(version === 0
      ? { source: { path: 'main.mp4', proxy: null } }
      : { sources: [{ id: 'main', path: 'main.mp4', proxy: null }] }),
    cuts: [{ ...(version === 1 ? { src: 'main' } : {}), in: 0, out: 1 }, { ...(version === 1 ? { src: 'main' } : {}), in: 2, out: 3 }],
    overlays: [],
  };
}

function wavBuffer(durationSeconds, sampleRate = 8000) {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test('v0/v1 -> v2: 暗黙 at を絶対フレームに焼き、v2 reader を通す', () => {
  for (const version of [0, 1]) {
    const result = migrateEditToV2(base(version));
    assert.equal(result.ok, true);
    assert.deepEqual(result.doc.tracks[0].items.map(item => [item.at, item.duration]), [[0, 30], [30, 30]]);
    assert.doesNotThrow(() => readEditV2(result.doc));
  }
});

test('レイヤー動画の素材表追加・baked telop・audio を音声先頭の縦順へ移す', () => {
  const doc = base(1);
  doc.audio = { sfx: [{ path: 'hit.wav', t: 0.25, track: 2 }] };
  doc.layers = [
    { id: 'pip', t: 0, duration: 1, kind: 'video', src: 'pip.mp4', perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
    { id: 'title', t: 0, duration: 1, kind: 'baked', src: 'title.mov', preset: 'title', params: { text: 'A' }, track: 1 },
  ];
  doc.timeline = { tracks: [
    { id: 'main-row', kind: 'cuts', ref: 0 },
    { id: 'pip-row', kind: 'layers', ref: 0 },
    { id: 'title-row', kind: 'layers', ref: 1 },
    { id: 'audio-row', kind: 'audio', ref: 2 },
  ] };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.tracks.map(track => track.id), ['audio-row', 'main-row', 'pip-row', 'title-row']);
  assert.equal(result.doc.sources.find(source => source.path === 'pip.mp4').id, 'l-1');
  assert.equal(result.doc.tracks[2].items[0].source.kind, 'media');
  assert.deepEqual(result.doc.tracks[3].items[0].source, { kind: 'telop', preset: 'title', params: { text: 'A' }, baked: 'title.mov' });
  assert.equal(result.doc.audio, undefined);
  assert.equal(result.doc.tracks[0].role, 'sfx');
  assert.equal(result.doc.tracks[0].items[0].duration, 1);
  assert.equal(result.unresolvedAudioDurations[0].trackIndex, 0);
  assert.equal(result.unresolvedAudioDurations[0].itemIndex, 0);
  assert.equal(result.unresolvedAudioDurations.length, 1);
});

test('明示 out の SE は ffprobe 不要で frameRange と source fields へ移る', () => {
  const doc = base(1);
  doc.audio = { sfx: [{ id: 'hit', t: 0.25, path: 'hit.wav', in: 0.1, out: 0.6, gain_db: -8 }] };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unresolvedAudioDurations, []);
  const track = result.doc.tracks[0];
  assert.equal(track.role, 'sfx');
  assert.deepEqual({ at: track.items[0].at, duration: track.items[0].duration }, { at: 8, duration: 15 });
  assert.deepEqual(track.items[0].source, {
    kind: 'media', src: result.doc.sources.find(source => source.path === 'hit.wav').id,
    in: 0.1, out: 0.6, gain_db: -8,
  });
});

test('BGM・narration・複数 SE ref は役割別に分離し bgm→narration→sfx 昇順で並ぶ', () => {
  const doc = base(1);
  doc.audio = {
    master: { loudnorm: true },
    bgm: { path: 'music.wav', fadeIn: 1.25, fadeOut: 2.5, gain_db: -18, ducking: true },
    narration: [{ id: 'n-1', t: 0.2, path: 'voice.wav', gain_db: -3, script: 'hello' }],
    sfx: [
      { id: 's2', t: 0, path: 'two.wav', track: 2, out: 0.5 },
      { id: 's0', t: 0, path: 'zero.wav', out: 0.5 },
    ],
  };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.tracks.slice(0, 4).map(track => [track.role, track.items[0].id]), [
    ['bgm', 'bgm'], ['narration', 'n-1'], ['sfx', 's0'], ['sfx', 's2'],
  ]);
  assert.deepEqual(result.doc.tracks[0].items[0].source, {
    kind: 'media', src: result.doc.sources.find(source => source.path === 'music.wav').id,
    in: 0, out: 2, fade_in: 1.25, fade_out: 2.5, gain_db: -18, ducking: true,
  });
  assert.equal(result.doc.tracks[1].items[0].script, 'hello');
  assert.deepEqual(result.doc.audio, { master: { loudnorm: true } });
  assert.deepEqual(result.unresolvedAudioDurations.map(value => value.path), ['voice.wav']);
});

test('planMigration は実 WAV を ffprobe し SE/narration の duration と source.out を確定する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-audio-'));
  try {
    await writeFile(join(root, 'hit.wav'), wavBuffer(0.4));
    await writeFile(join(root, 'voice.wav'), wavBuffer(0.75));
    const doc = base(1);
    doc.audio = {
      sfx: [{ id: 'hit', t: 0.1, path: 'hit.wav' }],
      narration: [{ id: 'voice', t: 0.2, path: 'voice.wav' }],
    };
    const text = `${JSON.stringify(doc)}\n`;
    const proposal = planMigration(root, join(root, 'edit.json'), text);
    assert.equal('blockers' in proposal, false, proposal.blockers?.join('\n'));
    const migrated = JSON.parse(proposal.nextText);
    const [narrationTrack, sfxTrack] = migrated.tracks.slice(0, 2);
    assert.equal(narrationTrack.role, 'narration');
    assert.equal(sfxTrack.role, 'sfx');
    assert.deepEqual([sfxTrack.items[0].duration, narrationTrack.items[0].duration], [12, 23]);
    assert.deepEqual([sfxTrack.items[0].source.out, narrationTrack.items[0].source.out], [0.4, 0.75]);
    assert.doesNotThrow(() => readEditV2(migrated));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planMigration は ffprobe failure を blocker にして placeholder を出力しない', () => {
  const doc = base(1);
  doc.audio = { narration: [{ id: 'voice', t: 0, path: 'missing.wav' }] };
  const result = planMigration('/tmp', '/tmp/edit.json', JSON.stringify(doc), {
    ffprobeCommand: '/definitely/missing/ffprobe',
  });
  assert.equal(result.ok, false);
  assert.match(result.blockers.join('\n'), /ffprobe.*missing\.wav/);
});

test('legacy audio entry の未知キーは category ごとの allow-list で拒否する', () => {
  for (const audio of [
    { sfx: [{ t: 0, path: 'hit.wav', volume: 1 }] },
    { narration: [{ t: 0, path: 'voice.wav', text: 'x' }] },
    { bgm: { path: 'music.wav', fade_in: 1 } },
  ]) {
    const doc = base(1);
    doc.audio = audio;
    const result = migrateEditToV2(doc);
    assert.equal(result.ok, false);
    assert.match(result.blockers.join('\n'), /未知フィールド/);
  }
});

test('明示 timeline に captions 行が無い場合は字幕の黙示的な損失を blocker で止める', () => {
  const doc = base(1);
  doc.timeline = { tracks: [{ id: 'main-row', kind: 'cuts', ref: 0 }] };
  const result = migrateEditToV2(doc, { hasCaptions: true });
  assert.equal(result.ok, false);
  assert.match(result.blockers.join('\n'), /captions/);
});

test('明示 timeline に captions 行があれば字幕ありでも変換できる', () => {
  const doc = base(1);
  doc.timeline = { tracks: [
    { id: 'main-row', kind: 'cuts', ref: 0 },
    { id: 'captions-row', kind: 'captions' },
  ] };
  const result = migrateEditToV2(doc, { hasCaptions: true });
  assert.equal(result.ok, true);
});

test('字幕が存在しない場合は明示 timeline に captions 行が無くても変換できる', () => {
  const doc = base(1);
  doc.timeline = { tracks: [{ id: 'main-row', kind: 'cuts', ref: 0 }] };
  const result = migrateEditToV2(doc, { hasCaptions: false });
  assert.equal(result.ok, true);
});

test('timeline 省略時は字幕ありなら captions 行を自動導出して変換できる', () => {
  const result = migrateEditToV2(base(1), { hasCaptions: true });
  assert.equal(result.ok, true);
  assert.equal(result.doc.tracks.some(track => track.content?.from === 'captions.json'), true);
});

test('transition_out・thumbnail・preset なし baked を損失なく v2 へ写す', () => {
  const doc = base();
  doc.cuts[0].transition_out = { type: 'dissolve', duration: 0.25 };
  doc.thumbnail = { path: 'assets/thumb.png' };
  doc.layers = [{ id: 'baked', t: 0, duration: 1, kind: 'baked', src: 'baked.mov' }];
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.thumbnail, doc.thumbnail);
  assert.deepEqual(result.doc.tracks[0].items[0].source.transition_out, doc.cuts[0].transition_out);
  const layer = result.doc.tracks.find(track => track.items?.some(item => item.id === 'baked'));
  assert.equal(layer.items[0].source.kind, 'media');
  assert.equal(result.doc.sources.find(source => source.path === 'baked.mov').id, layer.items[0].source.src);
});

test('凍結方針: 未知フィールド・非整数 fps・未知 layer は blocker で止まる', () => {
  const unknown = { ...base(), direction: {} };
  assert.match(migrateEditToV2(unknown).blockers.join('\n'), /direction/);
  const fractional = base();
  fractional.output.fps = 29.97;
  assert.match(migrateEditToV2(fractional).blockers.join('\n'), /整数/);
  const layer = { ...base(), layers: [{ id: 'x', t: 0, duration: 1, kind: 'filter', filter: {} }] };
  assert.match(migrateEditToV2(layer).blockers.join('\n'), /video \/ image \/ baked/);
});

test('提案は書かず、承認適用で backup -> atomic write、1 手 undo で戻る', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-'));
  try {
    const editPath = join(root, 'edit.json');
    const before = `${JSON.stringify(base(), null, 2)}\n`;
    await writeFile(editPath, before);
    const proposal = planMigration(root, editPath, before, { now: new Date('2026-08-19T01:02:03.000Z') });
    assert.equal(await readFile(editPath, 'utf8'), before, '提案だけでは 1 バイトも変えない');
    await applyMigration(proposal);
    assert.equal(JSON.parse(await readFile(editPath, 'utf8')).version, 2);
    assert.equal(await readFile(proposal.backupPath, 'utf8'), before);
    await revertMigration(proposal);
    assert.equal(await readFile(editPath, 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('planMigration は projectRoot の captions.json 実在をオプション省略時に補完する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-captions-'));
  try {
    const editPath = join(root, 'edit.json');
    const captionsPath = join(root, 'captions.json');
    const doc = base(1);
    doc.timeline = { tracks: [{ id: 'main-row', kind: 'cuts', ref: 0 }] };
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    await writeFile(editPath, text);
    await writeFile(captionsPath, '[]\n');

    // 本番の prepareLegacyEdit / resolveCaptionDisplay と同じく hasCaptions を渡さない。
    const withCaptions = planMigration(root, editPath, text);
    assert.equal('blockers' in withCaptions, true);
    assert.match(withCaptions.blockers.join('\n'), /captions/);

    await rm(captionsPath);
    const withoutCaptions = planMigration(root, editPath, text);
    assert.equal('blockers' in withoutCaptions, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('v2 は再変換せず、reader 往復も差分ゼロ', () => {
  const migrated = migrateEditToV2(base());
  const text = `${JSON.stringify(migrated.doc, null, 2)}\n`;
  assert.equal(detectEditVersion(JSON.parse(text)), 2);
  assert.equal(migrateEditToV2(JSON.parse(text)).ok, false);
  assert.deepEqual(readEditV2(text), readEditV2(`${JSON.stringify(JSON.parse(text), null, 2)}\n`));
});

// task/2026-08-20-migrate-crop-schema: v0/v1 は「未設定」を明示 `null`（例: `crop: null`）で
// 書くことがあるが、v2 の対応する任意フィールドは「未設定」をキー省略で表し `null` を許容しない。
// 実測（内部リポ fieldtest/2026-07-14）: 修正前は `crop: null` を持つ v0 プロジェクトの変換が
// `ok: true` を返しながら `tracks[0].items[0].crop` が `readEditV2` の検証に落ちる不正な v2 を
// 吐いていた（凍結方針が禁じる「未知の取りこぼしに対応を足す」ではなく、既知フィールド crop の
// 転写ミスの是正 = バグ修正であることを task.md 裁定どおり確認済み）。

test('crop: null（cuts）は v2 で crop キーごと省略され、readEditV2 を通る', () => {
  const doc = base();
  doc.cuts[0].crop = null;
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.equal('crop' in result.doc.tracks[0].items[0], false);
  assert.doesNotThrow(() => readEditV2(result.doc));
});

test('crop: null（layers）も同様に省略され、readEditV2 を通る', () => {
  const doc = base(1);
  doc.layers = [{ id: 'pip', t: 0, duration: 1, kind: 'video', src: 'pip.mp4', crop: null }];
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  const layerTrack = result.doc.tracks.find(track => track.items?.some(item => item.id === 'pip'));
  assert.equal('crop' in layerTrack.items[0], false);
  assert.doesNotThrow(() => readEditV2(result.doc));
});

test('transform / opacity / perspective / blend の明示 null も同じ理由で省略される（copyPresent の一括是正）', () => {
  const doc = base(1);
  doc.cuts[0].transform = null;
  doc.cuts[0].opacity = null;
  doc.layers = [{
    id: 'pip', t: 0, duration: 1, kind: 'video', src: 'pip.mp4',
    perspective: null, blend: null
  }];
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  const cutItem = result.doc.tracks[0].items[0];
  assert.equal('transform' in cutItem, false);
  assert.equal('opacity' in cutItem, false);
  const layerTrack = result.doc.tracks.find(track => track.items?.some(item => item.id === 'pip'));
  assert.equal('perspective' in layerTrack.items[0], false);
  assert.equal('blend' in layerTrack.items[0], false);
  assert.doesNotThrow(() => readEditV2(result.doc));
});

test('proxy / chroma_key の明示 null は copyPresent を経由しないため、従来どおり null のまま v2 へ残る（回帰確認）', () => {
  const doc = base(1);
  doc.sources[0].proxy = null;
  doc.sources[0].chroma_key = null;
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.equal(result.doc.sources[0].proxy, null);
  assert.equal(result.doc.sources[0].chroma_key, null);
  assert.doesNotThrow(() => readEditV2(result.doc));
});

test('planMigration の最終自己検証の根拠: readEditV2 は item.crop: null 単体を独立に拒否する', () => {
  // copyPresent の null 除去とは独立に、「crop: null を含む v2 は readEditV2 で必ず落ちる」こと
  // 自体を確認する。planMigration は ffprobe patch 後の doc をこの同じ readEditV2 に必ず通すため、
  // 万一 copyPresent 以外の経路で不正な v2 が組み立てられても提案にはならない根拠になる。
  const migrated = migrateEditToV2(base());
  const brokenDoc = {
    ...migrated.doc,
    tracks: migrated.doc.tracks.map((track, index) => index === 0
      ? { ...track, items: track.items.map((item, itemIndex) => itemIndex === 0 ? { ...item, crop: null } : item) }
      : track)
  };
  assert.throws(() => readEditV2(brokenDoc), /crop.*object である必要があります/s);
});
