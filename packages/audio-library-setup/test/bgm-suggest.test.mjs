import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FAMILY_TONE_RULES,
  TEMPO_VOCABULARY,
  TONE_VOCABULARY,
  feltBpm,
  suggestBgm,
  tempoClassOf,
  toneRuleFor,
} from '../shared/bgm-suggest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, '..', 'bin', 'suggest-bgm.mjs');

// akari-sounds Release v0 の全 BGM 系統の代表 id（実カタログから抽出）。
// 新しい系統が Release に増えたら、この一覧と FAMILY_TONE_RULES の両方へ足す。
const REPRESENTATIVE_IDS = [
  'bgm-beatslide-124-001', 'bgm-bossa-094', 'bgm-breakbeat-134', 'bgm-chillhop-kalimba-096',
  'bgm-chillhop-trumpet-094', 'bgm-cinematic-adventure-110', 'bgm-cinematic-ambient-085',
  'bgm-cinematic-drama-090', 'bgm-cinematic-epic-105', 'bgm-cinematic-hopeful-092',
  'bgm-cinematic-minimal-098', 'bgm-cinematic-piano-095', 'bgm-cinematic-space-080',
  'bgm-cinematic-tech-102', 'bgm-cinematic-wonder-100', 'bgm-darksynth-110',
  'bgm-deepgroove-108', 'bgm-deephouse-pads-108', 'bgm-dnb-liquid-172', 'bgm-drumgroove-100-001',
  'bgm-dubtechno-106', 'bgm-edm-bigroom-128', 'bgm-electropop-120-001', 'bgm-electropop-anthem-123',
  'bgm-electropop-soft-118', 'bgm-electropop-sparkle-120', 'bgm-electropop-tropical-118',
  'bgm-futurebass-140-001', 'bgm-futurebass-chill-136', 'bgm-futurebass-emotive-138',
  'bgm-futurebass-kawaii-142', 'bgm-glitchpop-135', 'bgm-harddance-145', 'bgm-house-128-001',
  'bgm-indiafolk-jp-170', 'bgm-jazzhop-sax-090', 'bgm-lofi-085-001', 'bgm-lofi-musicbox-087',
  'bgm-lofi-rain-090', 'bgm-loungehouse-104', 'bgm-melodicdub-140', 'bgm-melodichouse-112',
  'bgm-neosoul-078', 'bgm-organichouse-110', 'bgm-outrun-125', 'bgm-proghouse-116',
  'bgm-swing-120', 'bgm-synthpop-116', 'bgm-synthwave-drive-120', 'bgm-synthwave-dreamy-112',
  'bgm-synthwave-neon-115', 'bgm-techhouse-110-001', 'bgm-tension-noir-082', 'bgm-trap-hype-140',
  'bgm-vaporwave-090',
];

function track(id, { bpmTag = null, title = id } = {}) {
  const tags = ['bgm'];
  if (bpmTag) tags.push(`bpm-${bpmTag}`);
  return {
    id, title, kind: 'bgm', tags,
    files: [{ file: `${id}.wav`, mp3: `${id}.mp3`, duration_sec: 30 }],
  };
}

test('FAMILY_TONE_RULES は tone 語彙 8 語の範囲内で、重みは 1 か 2 のみ', () => {
  for (const [family, tones] of Object.entries(FAMILY_TONE_RULES)) {
    for (const [tone, weight] of Object.entries(tones)) {
      assert.ok(TONE_VOCABULARY.includes(tone), `${family}: 語彙外の tone ${tone}`);
      assert.ok(weight === 1 || weight === 2, `${family}/${tone}: 重み ${weight}`);
    }
  }
});

test('8 tone すべてに主用途（重み 2）の系統が 2 件以上ある（提案が痩せない）', () => {
  for (const tone of TONE_VOCABULARY) {
    const primaries = Object.entries(FAMILY_TONE_RULES).filter(([, tones]) => tones[tone] === 2);
    assert.ok(primaries.length >= 2, `${tone} の主用途系統が ${primaries.length} 件`);
  }
});

test('Release v0 の全系統代表 id が対応表に最長一致でマッピングされる（unmapped ゼロ）', () => {
  for (const id of REPRESENTATIVE_IDS) {
    assert.ok(toneRuleFor(id), `未対応の系統: ${id}`);
  }
});

test('最長一致: サブ系統ルールがファミリールールより優先され、未知サブはファミリーへフォールバックする', () => {
  assert.equal(toneRuleFor('bgm-electropop-sparkle-120').family, 'electropop-sparkle');
  assert.equal(toneRuleFor('bgm-electropop-guitar-122').family, 'electropop');
  assert.equal(toneRuleFor('bgm-cinematic-brandnew-100').family, 'cinematic');
  assert.equal(toneRuleFor('sfx-pop-cork'), null);
});

test('feltBpm は id の設計テンポと tags の実測 BPM の小さい方（ジャズ系の倍取り対策）', () => {
  assert.equal(feltBpm(track('bgm-jazzhop-sax-090', { bpmTag: 185 })), 90);
  assert.equal(feltBpm(track('bgm-beatslide-124-001', { bpmTag: 123 })), 123);
  assert.equal(feltBpm(track('bgm-indiafolk-jp-170', { bpmTag: 89 })), 89);
  assert.equal(feltBpm({ id: 'bgm-unknown', tags: [] }), null);
});

test('tempoClassOf の境界: <95 ゆったり / 95-124 標準 / >=125 高速', () => {
  assert.equal(tempoClassOf(94), 'ゆったり');
  assert.equal(tempoClassOf(95), '標準');
  assert.equal(tempoClassOf(124), '標準');
  assert.equal(tempoClassOf(125), '高速');
  assert.equal(tempoClassOf(null), null);
});

const FIXTURE = {
  library: 'AKARI Sounds', version: 'v0',
  tracks: [
    track('bgm-lofi-piano-084', { bpmTag: 84 }),
    track('bgm-jazzhop-piano-086', { bpmTag: 86 }),
    track('bgm-harddance-145', { bpmTag: 145 }),
    track('bgm-electropop-sparkle-120', { bpmTag: 118 }),
    track('bgm-newgenre-100', { bpmTag: 100 }), // 対応表に無い系統
    { id: 'sfx-pop-cork', kind: 'sfx', tags: ['sfx'], files: [] },
  ],
};

test('suggestBgm: tone 一致で絞り、スコア降順 → id 昇順の決定論で返す。unmapped は報告される', () => {
  const result = suggestBgm(FIXTURE, { tones: ['親しみ'] });
  // 親しみ◎ = lofi が先頭。親しみ○の 2 件（sparkle / jazzhop）は同点で id 昇順
  assert.deepEqual(
    result.suggestions.map((s) => s.id),
    ['bgm-lofi-piano-084', 'bgm-electropop-sparkle-120', 'bgm-jazzhop-piano-086'],
  );
  assert.equal(result.suggestions[0].toneScore, 2);
  assert.equal(result.suggestions[1].toneScore, 1);
  assert.deepEqual(result.unmappedIds, ['bgm-newgenre-100']);

  const again = suggestBgm(FIXTURE, { tones: ['親しみ'] });
  assert.deepEqual(again.suggestions.map((s) => s.id), result.suggestions.map((s) => s.id), '決定論');
});

test('suggestBgm: 複数 tone は重みを合算し、tempo 指定は体感テンポ一致にボーナスを与える', () => {
  // 親しみ + 高級感 → jazzhop（○ + ◎ = 3）が lofi（◎ = 2）を上回る
  const withoutTempo = suggestBgm(FIXTURE, { tones: ['親しみ', '高級感'] });
  assert.equal(withoutTempo.suggestions[0].id, 'bgm-jazzhop-piano-086');
  assert.equal(withoutTempo.suggestions[0].toneScore, 3);

  const both = suggestBgm(FIXTURE, { tones: ['親しみ', '高級感'], tempo: 'ゆったり' });
  assert.equal(both.suggestions[0].id, 'bgm-jazzhop-piano-086');
  assert.equal(both.suggestions[0].tempoScore, 2, 'bpm86 = ゆったり一致');

  const fast = suggestBgm(FIXTURE, { tones: ['勢い'], tempo: '高速' });
  assert.equal(fast.suggestions[0].id, 'bgm-harddance-145');
  assert.equal(fast.suggestions[0].score, 4);
});

test('suggestBgm: 宣言データ合流 — 実測 BPM 置換・耳検証ボーナスで順位が上がる・サビ頭出しが付く', () => {
  const declarations = {
    // jazzhop（親しみ○）に宣言 → 無宣言の lofi（親しみ◎）と同点(2)になり、id 順で lofi が先頭のまま。
    // sparkle（親しみ○）は無宣言なので jazzhop が上に出る = ボーナスの順位効果
    'bgm-jazzhop-piano-086': {
      bpm: 86, beat_offset_s: 0.5, time_signature: '4/4',
      sections: [
        { label: 'intro', start_sec: 0, end_sec: 11.2 },
        { label: 'drop', start_sec: 11.2, end_sec: 44.8 },
      ],
      hit_points: [11.2, 33.6],
      note: '', verified_at: 'x', source: 'test',
    },
  };
  const result = suggestBgm(FIXTURE, { tones: ['親しみ'], declarations });
  assert.deepEqual(
    result.suggestions.map((s) => s.id),
    ['bgm-lofi-piano-084', 'bgm-jazzhop-piano-086', 'bgm-electropop-sparkle-120'],
    '宣言ボーナスで jazzhop が sparkle を追い越す',
  );
  const declared = result.suggestions[1];
  assert.equal(declared.declaredScore, 1);
  assert.equal(declared.bpm, 86, '実測 BPM に置換');
  assert.equal(declared.declaration.drop_in_sec, 11.2, '最初のサビ区間の頭が audio.bgm.in の推奨値');
  assert.equal(declared.declaration.hit_points.length, 2);
  assert.equal(result.suggestions[0].declaration, null, '無宣言トラックは null');
});

test('suggestBgm: 語彙外の tone / tempo・tone 未指定は明示エラー', () => {
  assert.throws(() => suggestBgm(FIXTURE, { tones: ['楽しい'] }), /語彙に無い値/);
  assert.throws(() => suggestBgm(FIXTURE, { tones: [] }), /tone を 1 つ以上/);
  assert.throws(() => suggestBgm(FIXTURE, { tones: ['勢い'], tempo: '爆速' }), /語彙に無い値/);
});

test('CLI: --catalog + --json で機械可読出力、path は AKARI_HOME のライブラリを指す', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-bgm-suggest-'));
  try {
    const catalogPath = path.join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(FIXTURE));
    const result = spawnSync(process.execPath, [
      cliPath, '--tone', '親しみ', '--count', '2', '--catalog', catalogPath, '--json',
    ], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(root, '.akari') } });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.suggestions.length, 2);
    assert.equal(parsed.suggestions[0].id, 'bgm-lofi-piano-084');
    assert.ok(parsed.suggestions[0].takes[0].path.startsWith(path.join(root, '.akari', 'assets', 'audio', 'akari-sounds-bgm')));
    assert.equal(parsed.suggestions[0].takes[0].exists, false, 'フィクスチャでは実体未取得');
    assert.deepEqual(parsed.tempo_vocabulary, TEMPO_VOCABULARY);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: --declarations で宣言合流の出力（宣言行 + JSON フィールド）が出る', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-bgm-suggest-decl-'));
  try {
    const catalogPath = path.join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(FIXTURE));
    const declPath = path.join(root, 'declarations.json');
    await writeFile(declPath, JSON.stringify({
      'bgm-lofi-piano-084': { bpm: 84, sections: [{ label: 'drop', start_sec: 20.5, end_sec: 40 }], hit_points: [20.5] },
    }));
    const result = spawnSync(process.execPath, [
      cliPath, '--tone', '親しみ', '--catalog', catalogPath, '--declarations', declPath, '--json',
    ], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(root, '.akari') } });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.declarations_source, declPath);
    assert.equal(parsed.suggestions[0].id, 'bgm-lofi-piano-084');
    assert.equal(parsed.suggestions[0].declaration.drop_in_sec, 20.5);

    const human = spawnSync(process.execPath, [
      cliPath, '--tone', '親しみ', '--catalog', catalogPath, '--declarations', declPath,
    ], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(root, '.akari') } });
    assert.match(human.stdout, /サビ頭 20\.5s/);
    assert.match(human.stdout, /耳検証済み \+1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: 既定パス <ライブラリ>/declarations.json を自動検出する（宣言パック購入者の導入先）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-bgm-suggest-defdecl-'));
  try {
    const catalogPath = path.join(root, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify(FIXTURE));
    const libRoot = path.join(root, '.akari', 'assets', 'audio');
    await mkdir(libRoot, { recursive: true });
    await writeFile(path.join(libRoot, 'declarations.json'), JSON.stringify({
      'bgm-lofi-piano-084': { bpm: 84, sections: [{ label: 'drop', start_sec: 12.3, end_sec: 30 }], hit_points: [] },
    }));
    const env = { ...process.env, AKARI_HOME: path.join(root, '.akari') };
    delete env.AKARI_SOUNDS_DECLARATIONS;
    const result = spawnSync(process.execPath, [
      cliPath, '--tone', '親しみ', '--catalog', catalogPath, '--json',
    ], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.declarations_source, path.join(libRoot, 'declarations.json'));
    assert.equal(parsed.suggestions[0].declaration.drop_in_sec, 12.3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI: 未導入（スナップショットなし・--catalog なし）は akari sounds を案内して exit 1', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-bgm-suggest-empty-'));
  try {
    const result = spawnSync(process.execPath, [cliPath, '--tone', '親しみ'], {
      encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(root, '.akari') },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /akari sounds/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
