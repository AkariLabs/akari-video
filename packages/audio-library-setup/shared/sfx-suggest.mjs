// SFX / ジングル自動提案（v0）— 「場面の意味 → 音」の宣言表。
//
// BGM（bgm-suggest.mjs = tone 駆動・タイムライン級）と違い、効果音とジングルは
// **意味駆動・イベント級**（「ここで場面が変わる」「ここで正解が出る」瞬間に鳴らす）。
// そこで語彙は tone ではなく「場面の意味」で固定し、edit-plan の表現選定
// （skills/edit-plan/expression-selection.md の「意味 → 手段」表）と同じ型の宣言表にする。
//
// - 行の候補順がそのまま優先順（スコアリングしない。並びが宣言）
// - AKARI Sounds に無い意味（拍手・失敗音の日本のお約束・和太鼓）は external で
//   catalog/audio の外部補完エントリを指す（音源カタログ v2 で意図的に残した 13 カードの出番）
// - ここは純粋ロジックのみ。I/O は bin/suggest-sfx.mjs / bin/review-sfx-mapping.mjs 側

/** 場面の意味の語彙（固定・14 語）。行を発明せず、この語彙から引く。 */
export const MEANING_VOCABULARY = [
  'オープニング', 'エンディング', '場面転換', 'カット送り', '達成・正解', '失敗・NG',
  '疑問の提示', '強調・登場', '緊張の高まり', '衝撃の事実', 'キラッと見せる',
  'オチ・コミカル', '拍手・祝福', 'UI操作',
];

/**
 * 意味 → 音の宣言表。
 * first: AKARI Sounds のトラック id（優先順）。external: 外部補完
 * （catalog/audio/<id> の参照エントリ。実体は各自取得 = 音源カタログ v2 の存続分）。
 */
export const MEANING_RULES = {
  'オープニング': {
    first: ['jingle-intro-001', 'jingle-intro-tech-6s', 'jingle-intro-warm-8s', 'jingle-epic-8s'],
    external: [],
  },
  'エンディング': {
    first: ['jingle-outro-calm-7s', 'jingle-outro-upbeat-6s'],
    external: [],
  },
  '場面転換': {
    first: ['jingle-transition-4s', 'sfx-swoosh-stinger', 'sfx-whoosh-long-001', 'jingle-reveal-6s'],
    external: [],
  },
  'カット送り': {
    first: ['sfx-whoosh-air-fast', 'sfx-swoosh-up', 'sfx-swoosh-down', 'sfx-whoosh-punchy', 'sfx-click-camera-shutter'],
    external: [],
  },
  '達成・正解': {
    first: ['jingle-achievement-5s', 'sfx-chime-success', 'sfx-correct-tone', 'sfx-levelup-arp', 'sfx-ding-triple'],
    external: [],
  },
  '失敗・NG': {
    first: ['sfx-powerdown'],
    external: [
      { id: 'pocket-se-fail-pack', note: '呆れ「チーン」・失敗「デデーン」（日本のお約束。要クレジット）' },
      { id: 'maoudamashii-se-onepoint-category', note: 'ダメ出し「ブッブー」・ふざけた失敗音（要クレジット）' },
    ],
  },
  '疑問の提示': {
    first: ['jingle-question-4s'],
    external: [
      { id: 'dova-syndrome-hatena-mark-se', note: '「はてなマーク」ポップアップ音' },
    ],
  },
  '強調・登場': {
    first: ['sfx-pop-ding', 'sfx-pop-click-001', 'sfx-impact-boom-001', 'sfx-snap-dry', 'sfx-pop-cork'],
    external: [],
  },
  '緊張の高まり': {
    first: ['sfx-riser-tension-5s', 'sfx-riser-long-001', 'sfx-riser-sub-3s', 'sfx-riser-noise-2s', 'sfx-heartbeat-single'],
    external: [],
  },
  '衝撃の事実': {
    first: ['sfx-sub-drop-001', 'sfx-impact-boom-big', 'sfx-impact-echo', 'sfx-tape-stop-001'],
    external: [
      { id: 'soundeffect-lab-ambient-life-pack', note: '和太鼓「ドーン」（和風のお約束）' },
    ],
  },
  'キラッと見せる': {
    first: ['sfx-shimmer-sparkle', 'sfx-star-twinkle', 'sfx-harp-gliss', 'sfx-bell-tree'],
    external: [],
  },
  'オチ・コミカル': {
    first: ['sfx-comedy-boing', 'sfx-record-scratch', 'sfx-comedy-slide-up', 'sfx-pop-fizz', 'sfx-slime-squish'],
    external: [
      { id: 'pocket-se-fail-pack', note: '呆れ「チーン」（ズッコケの定番。要クレジット）' },
    ],
  },
  '拍手・祝福': {
    first: [],
    external: [
      { id: 'soundeffect-lab-ambient-life-pack', note: '観客リアクション（拍手・歓声）' },
      { id: 'soundeffect-lab-clapping-hands', note: '大勢で拍手 / ホール拍手（candidates 補完カード #27。未登録なら候補リストから取得）' },
    ],
  },
  'UI操作': {
    first: ['sfx-click-soft-ui', 'sfx-click-mouse-single', 'sfx-click-button-deep', 'sfx-blip-beep', 'sfx-click-thock'],
    external: [],
  },
};

/**
 * 意味 1 語に対する候補を返す。first は catalog.json の実トラックに解決して
 * duration / takes を添える（catalog に無い id は absent: true で正直に返す —
 * 将来 Release からトラックが取り下げられても黙って落とさない）。
 * @param {object} catalog akari-sounds catalog.json（tracks[]）
 * @param {object} query { meaning: string, count?: number }
 */
export function suggestSfx(catalog, { meaning, count = 5 } = {}) {
  if (!catalog || !Array.isArray(catalog.tracks)) {
    throw new Error('catalog.json の形式が想定と違います（tracks 配列がない）');
  }
  if (!MEANING_VOCABULARY.includes(meaning)) {
    throw new Error(`意味の語彙に無い値: ${meaning}（使える値: ${MEANING_VOCABULARY.join(' / ')}）`);
  }
  const rule = MEANING_RULES[meaning];
  const byId = new Map(catalog.tracks.map((track) => [track.id, track]));
  const first = rule.first.slice(0, count).map((id) => {
    const track = byId.get(id);
    if (!track) {
      return { id, absent: true };
    }
    return {
      id,
      title: track.title ?? id,
      kind: track.kind,
      takes: (track.files ?? []).map(({ file, mp3, duration_sec: durationSec }) => ({ file, mp3, duration_sec: durationSec })),
    };
  });
  return { meaning, first, external: rule.external.map((entry) => ({ ...entry })) };
}
