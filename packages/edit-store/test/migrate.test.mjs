import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyMigration,
  captionsHaveRenderableCues,
  detectEditVersion,
  migrateEditToV2,
  planMigration,
  revertMigration,
} from '../lib/migrate/index.js';
import { readEditV2 } from '../lib/edit-v2.js';
import { projectLegacyEdit, readInternalEdit } from '../lib/internal-model.js';

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
  assert.equal(result.doc.tracks[0].items[0].role, undefined);
  assert.equal(result.doc.tracks[0].items[0].duration, 0);
  assert.equal(result.doc.tracks[0].items[0].source.out, undefined);
});

test('v1 audio は用途別 audio track へ移り、時刻・尺と音声属性を契約どおり変換する', () => {
  const doc = base(1);
  doc.audio = {
    master: { loudnorm: -14 },
    sfx: [
      { id: 'trimmed', t: 0.25, path: 'hit.wav', in: 0.1, out: 0.6, gain_db: -8, fade_in: 0.05, fade_out: 0.1 },
      { id: 'open-ended', t: 1.25, path: 'tail.wav' },
    ],
    narration: [{ id: 'n-0001', t: 0.2, path: 'voice.wav', gain_db: -3, provenance: { provider: 'human' } }],
    bgm: { path: 'music.wav', in: 4, fadeIn: 1.25, fadeOut: 2.5, gain_db: -18, ducking: true },
  };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  const audioTracks = result.doc.tracks.filter(track => track.lane === 'audio');
  assert.equal(audioTracks.length, 3);
  assert.deepEqual(audioTracks.map(track => track.items.map(item => item.role ?? 'sfx')), [
    ['sfx', 'sfx'], ['narration'], ['bgm'],
  ]);

  const [trimmed, openEnded] = audioTracks[0].items;
  assert.deepEqual({ at: trimmed.at, duration: trimmed.duration }, { at: 8, duration: 15 });
  assert.deepEqual(trimmed.source, {
    kind: 'media', src: result.doc.sources.find(source => source.path === 'hit.wav').id, in: 0.1, out: 0.6,
  });
  assert.deepEqual(
    { gain_db: trimmed.gain_db, fade_in: trimmed.fade_in, fade_out: trimmed.fade_out },
    { gain_db: -8, fade_in: 0.05, fade_out: 0.1 },
  );
  assert.equal(openEnded.duration, 0);
  assert.deepEqual(openEnded.source, {
    kind: 'media', src: result.doc.sources.find(source => source.path === 'tail.wav').id, in: 0,
  });

  const narration = audioTracks[1].items[0];
  assert.equal(narration.duration, 0);
  assert.deepEqual(narration.source, {
    kind: 'media', src: result.doc.sources.find(source => source.path === 'voice.wav').id, in: 0,
  });
  const bgm = audioTracks[2].items[0];
  assert.equal(bgm.duration, 0);
  assert.deepEqual(bgm.source, {
    kind: 'media', src: result.doc.sources.find(source => source.path === 'music.wav').id, in: 4,
  });
  assert.deepEqual(
    { gain_db: bgm.gain_db, fade_in: bgm.fade_in, fade_out: bgm.fade_out, ducking: bgm.ducking },
    { gain_db: -18, fade_in: 1.25, fade_out: 2.5, ducking: true },
  );
  assert.deepEqual(result.doc.audio, { master: { loudnorm: -14 } });
  assert.doesNotThrow(() => readEditV2(result.doc));
  assert.doesNotThrow(() => readInternalEdit(result.doc));
});

test('SE が無くても narration と BGM は別々の track ref へ分離される', () => {
  const doc = base(1);
  doc.audio = {
    narration: [{ id: 'n-0001', t: 0, path: 'voice.wav', provenance: { provider: 'human' } }],
    bgm: { path: 'music.wav' },
  };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  const audioTracks = result.doc.tracks.filter(track => track.lane === 'audio');
  assert.equal(audioTracks.length, 2);
  assert.deepEqual(audioTracks.map(track => track.items[0].role), ['narration', 'bgm']);
  const internal = readInternalEdit(result.doc);
  assert.deepEqual(internal.tracks.filter(track => track.lane === 'audio').map(track => track.legacy.ref), [0, 1]);
});

test('planMigration は音声素材を ffprobe せず duration: 0 センチネルのまま提案する', () => {
  const doc = base(1);
  doc.audio = {
    sfx: [{ id: 'hit', t: 0.1, path: 'missing-hit.wav' }],
    narration: [{ id: 'n-0001', t: 0.2, path: 'missing-voice.wav', provenance: { provider: 'human' } }],
    bgm: { path: 'missing-music.wav' },
  };
  const proposal = planMigration('/tmp', '/tmp/edit.json', JSON.stringify(doc));
  assert.equal('blockers' in proposal, false, proposal.blockers?.join('\n'));
  const migrated = JSON.parse(proposal.nextText);
  assert.deepEqual(
    migrated.tracks.filter(track => track.lane === 'audio').flatMap(track => track.items).map(item => item.duration),
    [0, 0, 0],
  );
  assert.doesNotThrow(() => readEditV2(migrated));
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

test('migrate は camelCase transitionOut を旧 Web UI 由来として具体的に案内する', () => {
  const doc = base(1);
  doc.cuts[0].transitionOut = { type: 'dissolve', duration: 0.5 };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, false);
  assert.match(result.blockers.join('\n'), /Web UI 旧版が書いた綴り/);
  assert.match(result.blockers.join('\n'), /transition_out/);
  assert.match(result.blockers.join('\n'), /開き直して保存/);
});

test('narration の script / reading / provenance を credit あり・なしとも損失なく v2 item へ移す', () => {
  const doc = base(1);
  const withCredit = {
    id: 'n-0001', path: 'voicevox.wav', t: 0.25, gain_db: 2,
    script: 'アカリ、紹介PVを作って。',
    reading: 'あかり、しょうかいピーブイをつくって。',
    provenance: {
      provider: 'voicevox', engine: 'voicevox-0.25.2', voice: 'speaker:13(青山龍星)',
      credit: 'VOICEVOX:青山龍星', generated_at: '2026-08-03T08:37:37.627Z',
    },
  };
  const withoutCredit = {
    id: 'n-0002', path: 'human.wav', t: 1.5,
    script: '収録音声です。', reading: 'しゅうろくおんせいです。',
    provenance: {
      provider: 'human', engine: 'studio', voice: 'owner', generated_at: '2026-08-04T00:00:00Z',
    },
  };
  doc.audio = { narration: [withCredit, withoutCredit] };

  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true, result.blockers?.join('\n'));
  const items = result.doc.tracks
    .filter(track => track.lane === 'audio')
    .flatMap(track => track.items);
  assert.deepEqual(
    items.map(({ script, reading, provenance }) => ({ script, reading, provenance })),
    [withCredit, withoutCredit].map(({ script, reading, provenance }) => ({ script, reading, provenance })),
  );
  assert.doesNotThrow(() => readEditV2(result.doc));

  const projected = projectLegacyEdit(readInternalEdit(result.doc)).audioNarration;
  assert.deepEqual(
    projected.map(({ script, reading, provenance }) => ({ script, reading, provenance })),
    [withCredit, withoutCredit].map(({ script, reading, provenance }) => ({ script, reading, provenance })),
  );
});

test('v1 narration は元契約どおり provenance を必須とする', () => {
  const doc = base(1);
  doc.audio = { narration: [{ id: 'n-0001', path: 'voice.wav', t: 0 }] };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, false);
  assert.match(result.blockers.join('\n'), /provenance/);
});

test('描画対象 cue の純粋述語は配列/object ルートと text/display_text を同じ定義で扱う', () => {
  assert.equal(captionsHaveRenderableCues([{ text: '字幕' }]), true);
  assert.equal(captionsHaveRenderableCues({ captions: [{ text: ' ', display_text: '表示字幕' }] }), true);
  for (const value of [undefined, null, 'broken', {}, [], [{ text: '  ' }], { captions: 'invalid' }]) {
    assert.equal(captionsHaveRenderableCues(value), false);
  }
});

test('明示 timeline に captions 行が無く cue がある場合は末尾へ一意な字幕トラックを合成する', () => {
  const doc = base(1);
  doc.timeline = { tracks: [{ id: 'captions', kind: 'cuts', ref: 0 }] };
  const result = migrateEditToV2(doc, { hasCaptions: true });
  assert.equal(result.ok, true, result.blockers?.join('\n'));
  assert.deepEqual(result.doc.tracks.at(-1), {
    id: 'captions-2', lane: 'visual', content: { from: 'captions.json' },
  });
  assert.equal(new Set(result.doc.tracks.map(track => track.id)).size, result.doc.tracks.length);
  assert.equal(result.changes.filter(change => change.path === 'tracks[]').length, 1);
});

test('明示 timeline に captions 行があれば字幕ありでも二重合成しない', () => {
  const doc = base(1);
  doc.timeline = { tracks: [
    { id: 'main-row', kind: 'cuts', ref: 0 },
    { id: 'captions-row', kind: 'captions' },
  ] };
  const result = migrateEditToV2(doc, { hasCaptions: true });
  assert.equal(result.ok, true);
  assert.equal(result.doc.tracks.filter(track => track.content?.from === 'captions.json').length, 1);
  assert.equal(result.changes.some(change => change.path === 'tracks[]'), false);
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
  assert.equal(result.changes.filter(change => change.path === 'tracks[]').length, 1);
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

test('凍結方針: 未知フィールド・非整数 fps・不正な filter は blocker で止まる', () => {
  const unknown = { ...base(), direction: {} };
  assert.match(migrateEditToV2(unknown).blockers.join('\n'), /direction/);
  const fractional = base();
  fractional.output.fps = 29.97;
  assert.match(migrateEditToV2(fractional).blockers.join('\n'), /整数/);
  const layer = { ...base(), layers: [{ id: 'x', t: 0, duration: 1, kind: 'filter', filter: {} }] };
  assert.match(migrateEditToV2(layer).blockers.join('\n'), /filter\.type.*invert\/lut\/saturation/s);
});

test('filter layer は src の無い独立 source として閉じた FilterV2 をそのまま転写する', () => {
  for (const filter of [
    { type: 'invert' },
    { type: 'lut', id: 'cinematic', intensity: 0.5 },
    { type: 'saturation', value: 1.4 },
  ]) {
    const doc = base(1);
    doc.layers = [{
      id: `filter-${filter.type}`, t: 0, duration: 1, kind: 'filter', filter,
      perspective: { corners: [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] },
    }];
    const result = migrateEditToV2(doc);
    assert.equal(result.ok, true, result.blockers?.join('\n'));
    const item = result.doc.tracks.find(track => track.items?.some(entry => entry.id === doc.layers[0].id)).items[0];
    assert.deepEqual(item.source, { kind: 'filter', filter });
    assert.equal('src' in item.source, false);
    assert.doesNotThrow(() => readEditV2(result.doc));
  }
});

test('kind filter に src が在る legacy layer は理由付き blocker で止まる', () => {
  const doc = base(1);
  doc.layers = [{ id: 'filter', t: 0, duration: 1, kind: 'filter', src: 'main.mp4', filter: { type: 'invert' } }];
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, false);
  assert.match(result.blockers.join('\n'), /kind filter は src を持てません/);
});

test('media 系 layer に直付けされた filter は等価表現が無いため理由付き blocker で止まる', () => {
  for (const kind of ['video', 'image', 'baked']) {
    const doc = base(1);
    doc.layers = [{
      id: `media-filter-${kind}`, t: 0, duration: 1, kind, src: `${kind}.mov`,
      filter: { type: 'lut', id: 'cinematic', intensity: 0.5 },
    }];
    const result = migrateEditToV2(doc);
    assert.equal(result.ok, false);
    assert.match(result.blockers.join('\n'), /layers\[0\]\.filter（映像レイヤー直付きの filter）は v2 に等価表現が無いため変換できません/);
  }
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

test('リール同形 fixture の映像レイヤー直付き filter は silent loss せず blocker で止まる', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-reel-'));
  try {
    const editPath = join(root, 'edit.json');
    const captionsPath = join(root, 'captions.json');
    const fixtureRoot = new URL('./fixtures/reel-v1-filter-emphasis/', import.meta.url);
    const beforeEdit = await readFile(new URL('edit.json', fixtureRoot), 'utf8');
    const beforeCaptions = await readFile(new URL('captions.json', fixtureRoot), 'utf8');
    await writeFile(editPath, beforeEdit);
    await writeFile(captionsPath, beforeCaptions);

    const migrated = migrateEditToV2(JSON.parse(beforeEdit));
    assert.equal(migrated.ok, false);
    assert.match(migrated.blockers.join('\n'), /layers\[0\]\.filter（映像レイヤー直付きの filter）は v2 に等価表現が無いため変換できません/);

    const proposal = planMigration(root, editPath, beforeEdit, { now: new Date('2026-08-23T01:02:03.000Z') });
    assert.equal('blockers' in proposal, true);
    assert.match(proposal.blockers.join('\n'), /layers\[0\]\.filter（映像レイヤー直付きの filter）は v2 に等価表現が無いため変換できません/);
    assert.equal(await readFile(editPath, 'utf8'), beforeEdit, '提案時点では edit.json を変更しない');
    assert.equal(await readFile(captionsPath, 'utf8'), beforeCaptions, '提案時点では captions.json を変更しない');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('filter 直付けの無い emphasis_words は captions.json へ移り、両原文を backup / revert する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-emphasis-'));
  try {
    const editPath = join(root, 'edit.json');
    const captionsPath = join(root, 'captions.json');
    const doc = base(1);
    doc.emphasis_words = [
      { id: 'e-0001', src: 'main', t_start: 0.1, t_end: 0.2, word: '最高', emotion: 'joy' },
      { id: 'e-0002', src: 'main', t_start: 0.3, t_end: 0.5, word: '注目', emotion: 'emphasis' },
    ];
    const beforeEdit = `${JSON.stringify(doc, null, 2)}\n`;
    const beforeCaptions = `${JSON.stringify({ captions: [] }, null, 2)}\n`;
    await writeFile(editPath, beforeEdit);
    await writeFile(captionsPath, beforeCaptions);

    const proposal = planMigration(root, editPath, beforeEdit, { now: new Date('2026-08-23T01:02:03.000Z') });
    assert.equal('blockers' in proposal, false, proposal.blockers?.join('\n'));
    assert.ok(proposal.captions);
    assert.equal(proposal.changes.some(change => change.path === 'emphasis_words'), true);
    const migrated = JSON.parse(proposal.nextText);
    assert.equal('emphasis_words' in migrated, false);
    assert.doesNotThrow(() => readEditV2(migrated));
    assert.equal(await readFile(editPath, 'utf8'), beforeEdit, '提案時点では edit.json を変更しない');
    assert.equal(await readFile(captionsPath, 'utf8'), beforeCaptions, '提案時点では captions.json を変更しない');

    await applyMigration(proposal);
    const movedCaptions = JSON.parse(await readFile(captionsPath, 'utf8'));
    assert.deepEqual(movedCaptions.emphasis_words, doc.emphasis_words);
    assert.equal(await readFile(proposal.backupPath, 'utf8'), beforeEdit);
    assert.equal(await readFile(proposal.captions.backupPath, 'utf8'), beforeCaptions);

    await revertMigration(proposal);
    assert.equal(await readFile(editPath, 'utf8'), beforeEdit);
    assert.equal(await readFile(captionsPath, 'utf8'), beforeCaptions);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('emphasis_words は captions.json 不在・配列ルート・既存席を理由付きでブロックする', async () => {
  const doc = base(1);
  doc.emphasis_words = [{ id: 'e-0001', t_start: 0.1, t_end: 0.2, word: '最高', emotion: 'joy' }];
  const beforeEdit = `${JSON.stringify(doc, null, 2)}\n`;
  const cases = [
    { captions: undefined, reason: /移送先 captions\.json がありません/ },
    { captions: '[]\n', reason: /captions\.json が配列ルート/ },
    { captions: '{"captions":[],"emphasis_words":[]}\n', reason: /emphasis_words が既に存在/ },
  ];
  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), 'akari-migrate-emphasis-block-'));
    try {
      const editPath = join(root, 'edit.json');
      await writeFile(editPath, beforeEdit);
      if (item.captions !== undefined) await writeFile(join(root, 'captions.json'), item.captions);
      const proposal = planMigration(root, editPath, beforeEdit);
      assert.equal('blockers' in proposal, true);
      assert.match(proposal.blockers.join('\n'), item.reason);
      assert.equal(await readFile(editPath, 'utf8'), beforeEdit);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('planMigration は captions.json の描画対象 cue だけを見て合成し、空・壊れた JSON は cue なしとして続行する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-captions-'));
  try {
    const editPath = join(root, 'edit.json');
    const captionsPath = join(root, 'captions.json');
    const doc = base(1);
    doc.timeline = { tracks: [{ id: 'main-row', kind: 'cuts', ref: 0 }] };
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    await writeFile(editPath, text);
    await writeFile(captionsPath, '{"captions":[{"text":"字幕あり"}]}\n');

    // annotations service と同じく projectRoot だけを渡す経路でも cue 判定が効く。
    const withCaptions = planMigration(root, editPath, text);
    assert.equal('blockers' in withCaptions, false, withCaptions.blockers?.join('\n'));
    const withCaptionsDoc = JSON.parse(withCaptions.nextText);
    assert.equal(withCaptionsDoc.tracks.at(-1).content?.from, 'captions.json');
    assert.equal(withCaptions.changes.filter(change => change.path === 'tracks[]').length, 1);

    await writeFile(captionsPath, '{"captions":[]}\n');
    const withoutCaptions = planMigration(root, editPath, text);
    assert.equal('blockers' in withoutCaptions, false);
    assert.equal(JSON.parse(withoutCaptions.nextText).tracks.some(track => track.content?.from === 'captions.json'), false);

    await writeFile(captionsPath, '{broken json\n');
    const withBrokenCaptions = planMigration(root, editPath, text);
    assert.equal('blockers' in withBrokenCaptions, false, withBrokenCaptions.blockers?.join('\n'));
    assert.equal(JSON.parse(withBrokenCaptions.nextText).tracks.some(track => track.content?.from === 'captions.json'), false);
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

test('migrateEditToV2 の最終自己検証の根拠: readEditV2 は item.crop: null 単体を独立に拒否する', () => {
  // copyPresent の null 除去とは独立に、「crop: null を含む v2 は readEditV2 で必ず落ちる」こと
  // 自体を確認する。migrateEditToV2 は組み立てた doc をこの同じ readEditV2 に必ず通すため、
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
