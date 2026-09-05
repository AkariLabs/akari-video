// BGM 自動提案（v0）— intake / 演出の tone 語彙 × AKARI Sounds のトラック系統の突き合わせ。
//
// 設計方針:
// - tone 語彙は表現選定（skills/edit-plan/expression-selection.md）と同じ 8 語に固定する。
//   BGM だけ別の語彙を発明しない
// - 対応表は「系統（トラック id の接頭辞）→ tone 重み」の宣言表。トラック個別の
//   when_to_use（宣言パック = 有償レイヤ）には依存しない — 無料の catalog.json（tags / id）
//   だけで動く
// - 決定論: 同じ入力は常に同じ順序を返す（スコア降順 → id 昇順）。乱数・時刻を使わない
// - ここは純粋ロジックのみ（fs / network に触れない）。I/O は bin/suggest-bgm.mjs 側

/** 表現選定と共通の tone 語彙（8 語・固定）。 */
export const TONE_VOCABULARY = ['真面目', '親しみ', '高級感', '勢い', 'かわいい', '無機質', 'エモい', 'シネマ'];

/** v1 candidates（レガシー）から引き継ぐテンポ 3 区分。 */
export const TEMPO_VOCABULARY = ['ゆったり', '標準', '高速'];

/**
 * 系統 → tone 重みの宣言表。key はトラック id の `bgm-` に続く接頭辞で、
 * **最長一致**で 1 ルールだけ適用する（`electropop-sparkle` は `electropop` より優先）。
 * 重み: 2 = 主用途（この tone ならまずこの系統）/ 1 = 副用途。
 * 新しい Release で系統が増えたら行を足す（未対応系統は suggestBgm が unmapped として報告する）。
 */
export const FAMILY_TONE_RULES = {
  'beatslide': { '勢い': 2, '無機質': 1 },
  'bossa': { '親しみ': 2, '高級感': 1 },
  'breakbeat': { '勢い': 2 },
  'chillhop': { '親しみ': 2, 'かわいい': 1 },
  'chillhop-kalimba': { 'かわいい': 2, '親しみ': 2 },
  'cinematic': { 'シネマ': 2 },
  'cinematic-adventure': { 'シネマ': 2, '勢い': 1 },
  'cinematic-ambient': { 'シネマ': 2, '無機質': 1 },
  'cinematic-drama': { 'シネマ': 2, 'エモい': 2 },
  'cinematic-epic': { 'シネマ': 2, '勢い': 2 },
  'cinematic-hopeful': { 'エモい': 2, 'シネマ': 2, '真面目': 1 },
  'cinematic-minimal': { '真面目': 2, 'シネマ': 1, '無機質': 1 },
  'cinematic-piano': { 'エモい': 2, '高級感': 1, 'シネマ': 1, '真面目': 1 },
  'cinematic-space': { '無機質': 2, 'シネマ': 2 },
  'cinematic-tech': { '真面目': 2, '無機質': 2, 'シネマ': 1 },
  'cinematic-wonder': { 'シネマ': 2, 'エモい': 1, 'かわいい': 1 },
  'darksynth': { '無機質': 2, 'シネマ': 1 },
  'deepgroove': { '高級感': 2, '無機質': 1 },
  'deephouse': { '高級感': 2, '無機質': 1 },
  'dnb': { '勢い': 2, 'エモい': 1 },
  'drumgroove': { '真面目': 1, '勢い': 1 },
  'dubtechno': { '無機質': 2, '真面目': 1 },
  'edm': { '勢い': 2 },
  'electropop': { '親しみ': 2, '勢い': 1 },
  'electropop-anthem': { '勢い': 2, '親しみ': 1 },
  'electropop-soft': { '親しみ': 2, 'かわいい': 1 },
  'electropop-sparkle': { 'かわいい': 2, '親しみ': 1 },
  'electropop-tropical': { 'かわいい': 2, '親しみ': 1 },
  'futurebass': { '勢い': 1, 'エモい': 1 },
  'futurebass-chill': { '親しみ': 1, 'エモい': 1 },
  'futurebass-emotive': { 'エモい': 2, '勢い': 1 },
  'futurebass-kawaii': { 'かわいい': 2, '勢い': 1 },
  'glitchpop': { 'かわいい': 2, '無機質': 1 },
  'harddance': { '勢い': 2 },
  'house': { '勢い': 1, '親しみ': 1 },
  'indiafolk': { 'シネマ': 1, '勢い': 1 },
  'jazzhop': { '高級感': 2, '親しみ': 1 },
  'lofi': { '親しみ': 2 },
  'lofi-musicbox': { 'かわいい': 2, '親しみ': 1 },
  'lofi-rain': { 'エモい': 1, '親しみ': 1 },
  'loungehouse': { '高級感': 2 },
  'melodicdub': { '無機質': 1, 'エモい': 1 },
  'melodichouse': { '高級感': 1, 'エモい': 1 },
  'neosoul': { '高級感': 2, 'エモい': 1 },
  'organichouse': { '高級感': 1, '親しみ': 1 },
  'outrun': { '無機質': 1, '勢い': 1 },
  'proghouse': { '真面目': 1, '勢い': 1 },
  'swing': { '親しみ': 1, '高級感': 1, 'かわいい': 1 },
  'synthpop': { '親しみ': 1, '勢い': 1 },
  'synthwave': { '無機質': 1, 'エモい': 1 },
  'synthwave-chill': { 'エモい': 1, '親しみ': 1 },
  'synthwave-dreamy': { 'エモい': 2 },
  'synthwave-drive': { '勢い': 2, '無機質': 1 },
  'synthwave-hero': { '勢い': 2, 'シネマ': 1 },
  'synthwave-neon': { '無機質': 2 },
  'synthwave-tech': { '無機質': 2, '真面目': 1 },
  'techhouse': { '真面目': 2, '無機質': 1 },
  'tension': { 'シネマ': 2, '無機質': 1 },
  'trap': { '勢い': 2 },
  'vaporwave': { '無機質': 2, 'エモい': 1 },
};

const RULE_KEYS_BY_LENGTH = Object.keys(FAMILY_TONE_RULES).sort((a, b) => b.length - a.length);

/** トラック id に最長一致するルールを返す（無ければ null）。 */
export function toneRuleFor(trackId) {
  if (typeof trackId !== 'string' || !trackId.startsWith('bgm-')) {
    return null;
  }
  const rest = trackId.slice('bgm-'.length);
  for (const key of RULE_KEYS_BY_LENGTH) {
    if (rest === key || rest.startsWith(`${key}-`)) {
      return { family: key, tones: FAMILY_TONE_RULES[key] };
    }
  }
  return null;
}

/**
 * 体感テンポの推定（v0 ヒューリスティック）:
 * id 末尾の 3 桁（設計テンポ。例 bgm-jazzhop-sax-090 → 90）と tags の `bpm-N`（実測）の
 * **小さい方**を採る。実測はジャズ系等で倍取り（90 → 185）になることがあり、
 * 「体感はゆったりなのに高速に分類される」誤りを避けるため。
 */
export function feltBpm(track) {
  const values = [];
  const idMatch = /-(\d{2,3})(?:-\d+)?$/.exec(track?.id ?? '');
  if (idMatch) {
    values.push(Number(idMatch[1]));
  }
  for (const tag of track?.tags ?? []) {
    const tagMatch = /^bpm-(\d{2,3})$/.exec(tag);
    if (tagMatch) {
      values.push(Number(tagMatch[1]));
    }
  }
  if (values.length === 0) {
    return null;
  }
  return Math.min(...values);
}

/** ゆったり < 95 ≤ 標準 < 125 ≤ 高速（v1 candidates の 3 区分を BPM 閾値へ固定）。 */
export function tempoClassOf(bpm) {
  if (typeof bpm !== 'number' || Number.isNaN(bpm)) {
    return null;
  }
  if (bpm < 95) return 'ゆったり';
  if (bpm < 125) return '標準';
  return '高速';
}

function tempoBonus(requested, actual) {
  if (!requested || !actual) {
    return 0;
  }
  if (requested === actual) {
    return 2;
  }
  const order = TEMPO_VOCABULARY;
  const distance = Math.abs(order.indexOf(requested) - order.indexOf(actual));
  return distance === 1 ? 1 : 0;
}

function assertVocabulary(values, vocabulary, label) {
  for (const value of values) {
    if (!vocabulary.includes(value)) {
      throw new Error(`${label} の語彙に無い値: ${value}（使える値: ${vocabulary.join(' / ')}）`);
    }
  }
}

/**
 * 宣言データ（耳検証済みの構造）1 トラック分を提案向けに要約する。
 * 宣言の出どころは 2 系統で中身は同じ形:
 * 内部 dogfood = 工房 declarations.json（harness/audio-declare）/
 * 公開ユーザー = 宣言パック購入時に展開される meta.json の宣言フィールド。
 */
function summarizeDeclaration(decl) {
  const sections = (decl.sections ?? []).map(({ label, start_sec: startSec, end_sec: endSec }) => ({ label, start_sec: startSec, end_sec: endSec }));
  const firstDrop = sections.find((s) => s.label === 'drop') ?? null;
  return {
    bpm: decl.bpm ?? null,
    beat_offset_s: decl.beat_offset_s ?? null,
    sections,
    hit_points: (decl.hit_points ?? []).slice(),
    // audio.bgm.in にこの値を指定するとサビ頭から敷ける（サビ宣言が無ければ null）
    drop_in_sec: firstDrop ? firstDrop.start_sec : null,
  };
}

/** 耳検証済みトラックをランキングで優先する固定ボーナス。 */
export const DECLARED_BONUS = 1;

/**
 * BGM 候補の決定論ランキング。
 * @param {object} catalog akari-sounds catalog.json（tracks[]）
 * @param {object} query { tones: string[](1〜複数・必須), tempo?: string, count?: number,
 *   declarations?: {id: 宣言} — 耳検証済みデータ。bpm を実測置換・DECLARED_BONUS を加点・
 *   declaration 要約（drop_in_sec / sections / hit_points）を候補に添える }
 * @returns {object} { suggestions: [...], unmappedIds: string[] }
 *   suggestion = { id, title, bpm, tempoClass, score, toneScore, tempoScore, declaredScore,
 *                  family, matchedTones: {tone: weight}, declaration: 要約|null,
 *                  takes: [{ file, mp3, duration_sec }] }
 */
export function suggestBgm(catalog, { tones, tempo = null, count = 5, declarations = null } = {}) {
  if (!catalog || !Array.isArray(catalog.tracks)) {
    throw new Error('catalog.json の形式が想定と違います（tracks 配列がない）');
  }
  if (!Array.isArray(tones) || tones.length === 0) {
    throw new Error(`tone を 1 つ以上指定してください（使える値: ${TONE_VOCABULARY.join(' / ')}）`);
  }
  assertVocabulary(tones, TONE_VOCABULARY, 'tone');
  if (tempo !== null) {
    assertVocabulary([tempo], TEMPO_VOCABULARY, 'tempo');
  }

  const unmappedIds = [];
  const scored = [];
  for (const track of catalog.tracks) {
    if (track.kind !== 'bgm') {
      continue;
    }
    const rule = toneRuleFor(track.id);
    if (!rule) {
      unmappedIds.push(track.id);
      continue;
    }
    const matchedTones = {};
    let toneScore = 0;
    for (const tone of tones) {
      const weight = rule.tones[tone] ?? 0;
      if (weight > 0) {
        matchedTones[tone] = weight;
        toneScore += weight;
      }
    }
    if (toneScore === 0) {
      continue; // どの指定 tone にも合わない系統は候補にしない
    }
    const declaration = declarations?.[track.id] ? summarizeDeclaration(declarations[track.id]) : null;
    // 耳検証済みの実測 BPM があれば推定（felt BPM）より優先する
    const bpm = declaration?.bpm ?? feltBpm(track);
    const tempoClass = tempoClassOf(bpm);
    const tempoScore = tempoBonus(tempo, tempoClass);
    const declaredScore = declaration ? DECLARED_BONUS : 0;
    scored.push({
      id: track.id,
      title: track.title ?? track.id,
      bpm,
      tempoClass,
      score: toneScore + tempoScore + declaredScore,
      toneScore,
      tempoScore,
      declaredScore,
      family: rule.family,
      matchedTones,
      declaration,
      takes: (track.files ?? []).map(({ file, mp3, duration_sec: durationSec }) => ({ file, mp3, duration_sec: durationSec })),
    });
  }

  scored.sort((a, b) => b.score - a.score || b.toneScore - a.toneScore || a.id.localeCompare(b.id));
  return { suggestions: scored.slice(0, count), unmappedIds };
}
