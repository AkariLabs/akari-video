// 演出レシピ → edit.json/captions.json 追記パッチの純関数コア。
// ファイル I/O・AKARI Sounds カタログ探索・edit.json/captions.json の読み書きは一切しない。
// 同一引数なら常にバイト等価な patch オブジェクトを返す（決定論。契約書 §3-2）。

/** レシピ category → emphasisWordItem.emotion（契約書 §3-5 の対応表）。 */
export const CATEGORY_EMOTION = {
  negative: 'pain',
  'anger-hype': 'anger',
  'surprise-emergency': 'surprise',
  positive: 'joy',
  normal: 'emphasis',
};

/** framing.keyframes の t が書かれている参考カット尺（秒）。index.jsonl 全レシピ共通の基準。 */
export const REFERENCE_CUT_DURATION_SEC = 3.2;

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * framing.keyframes の t を、レシピ作成時の参考カット尺から実際のカット尺へ線形スケールする。
 * crop のみの framing（keyframes 無し）はそのまま返す。
 */
export function scaleFramingKeyframes(framing, cutDurationSec, referenceDurationSec = REFERENCE_CUT_DURATION_SEC) {
  if (!framing || !Array.isArray(framing.keyframes)) return framing;
  if (!cutDurationSec || !Number.isFinite(cutDurationSec) || cutDurationSec <= 0) return framing;
  const ratio = cutDurationSec / referenceDurationSec;
  return {
    ...framing,
    keyframes: framing.keyframes.map((kf) => ({ ...kf, t: round3(kf.t * ratio) })),
  };
}

/**
 * レシピ 1 本を、対象カット・任意の文言・任意の解決済み SFX から決定論で patch へ組み立てる。
 *
 * @param {object} params
 * @param {object} params.recipe - presets/direction/index.jsonl の 1 レシピ
 * @param {number} params.cutIndex - 対象カット index（edit.json cuts[cutIndex]）
 * @param {number} [params.cutInSec] - 対象カットの source in 秒（v0 edit の cuts[].in）
 * @param {number} [params.cutOutSec] - 対象カットの source out 秒（v0 edit の cuts[].out）
 * @param {number} [params.cutTimelineStartSec] - 対象カットの出力タイムライン開始秒（既定 0）
 * @param {number|null} [params.leadCutIndex] - transition_in の展開先カット index
 *   （省略時 cutIndex-1・null を明示すると「無い」として扱う）
 * @param {string} [params.text] - 画面に出す文言（省略時は文字レイヤーを展開しない）
 * @param {{path:string}|null} [params.resolvedSfx] - 事前解決済みの SFX ファイル参照（無ければ null/undefined）
 * @returns {object} patch
 */
export function buildDirectionPatch({
  recipe,
  cutIndex,
  cutInSec,
  cutOutSec,
  cutTimelineStartSec = 0,
  leadCutIndex,
  text,
  resolvedSfx,
}) {
  if (!recipe || typeof recipe !== 'object') throw new Error('recipe is required');
  if (recipe.requires && recipe.requires.length > 0) {
    throw new Error(
      `recipe "${recipe.id}" is registration-only (requires: ${recipe.requires.join('; ')}) — expand-direction refuses to expand it (silent drop はしない契約)`,
    );
  }
  if (!Number.isInteger(cutIndex) || cutIndex < 0) throw new Error('cutIndex must be a non-negative integer');

  const notes = [];
  const layers = recipe.layers ?? {};
  const cutDurationSec = Number.isFinite(cutInSec) && Number.isFinite(cutOutSec)
    ? round3(cutOutSec - cutInSec)
    : undefined;

  const cutPatch = {};
  if (Array.isArray(layers.fx) && layers.fx.length > 0) cutPatch.fx = layers.fx;
  if (layers.framing) cutPatch.framing = scaleFramingKeyframes(layers.framing, cutDurationSec);
  if (layers.freeze) cutPatch.freeze = layers.freeze;

  let leadCutPatch = null;
  if (layers.transition_in) {
    const resolvedLead = leadCutIndex !== undefined ? leadCutIndex : cutIndex - 1;
    if (resolvedLead === null || resolvedLead < 0) {
      notes.push(
        `transition_in (${layers.transition_in.type}) skipped: no lead cut available before cut ${cutIndex} `
        + '(pass --lead-cut, or use a cut index > 0)',
      );
    } else {
      leadCutPatch = {
        cut_index: resolvedLead,
        transition_out: { type: layers.transition_in.type, duration: layers.transition_in.duration },
      };
    }
  }

  const outputPatch = layers.look ? { look: layers.look } : null;

  let audioSfxPatch = null;
  if (layers.audio?.se_default) {
    if (resolvedSfx) {
      audioSfxPatch = {
        path: resolvedSfx.path,
        t: round3(cutTimelineStartSec + 0.15),
        gain_db: 0,
      };
    } else {
      notes.push(
        `se_meaning="${layers.audio.se_meaning}" se_default="${layers.audio.se_default}" not resolved locally `
        + '(AKARI Sounds not installed under --audio-root) — audio.sfx skipped (fallback per オーナー裁定)',
      );
    }
  } else if (layers.audio?.se_meaning) {
    notes.push(`se_meaning="${layers.audio.se_meaning}" has no se_default in this recipe — audio.sfx skipped`);
  }

  let captionPatch = null;
  let emphasisWordPatch = null;
  if (text !== undefined && text !== null && text !== '') {
    if (!Number.isFinite(cutInSec) || !Number.isFinite(cutOutSec)) {
      notes.push('--text was given but cutInSec/cutOutSec are unknown — caption/emphasis_words skipped');
    } else {
      const captionId = `c-${cutIndex.toString().padStart(4, '0')}`;
      const emphasisId = `e-${cutIndex.toString().padStart(4, '0')}`;
      captionPatch = {
        id: captionId,
        start: cutInSec,
        end: cutOutSec,
        text,
        speaker: null,
        sourceRef: null,
        edited: false,
        words: [{ start: cutInSec, end: cutOutSec, text }],
      };
      emphasisWordPatch = {
        id: emphasisId,
        t_start: cutInSec,
        t_end: cutOutSec,
        word: text,
        emotion: CATEGORY_EMOTION[recipe.category] ?? 'emphasis',
        ...(layers.text?.style_hint ? { style_hint: layers.text.style_hint } : {}),
      };
      if (!layers.text?.style_hint) {
        notes.push(
          'recipe has no text.style_hint — emphasis_words omits style_hint and falls back to '
          + 'captions.mjs emotion-based default mapping (単純字幕フォールバック)',
        );
      }
    }
  }

  if (layers.text?.telop_preset) {
    notes.push(`text.telop_preset="${layers.text.telop_preset}" is not expanded in v0 (bake pipeline out of scope — 契約書 §2-3/§6）`);
  }
  if (layers.text?.anim_in || layers.text?.anim_loop) {
    notes.push(
      'text.anim_in/anim_out/anim_loop (textanim, default_text_style.animation) is recorded on the recipe '
      + 'but not expanded in v0 — captions レール（emphasis_words.style_hint）を優先経路として採用したため'
      + '（契約書 §5-2 の実レンダ確認結果）',
    );
  }

  return {
    recipe_id: recipe.id,
    cut_index: cutIndex,
    cut_patch: cutPatch,
    lead_cut_patch: leadCutPatch,
    output_patch: outputPatch,
    audio_sfx_patch: audioSfxPatch,
    caption_patch: captionPatch,
    emphasis_word_patch: emphasisWordPatch,
    notes,
  };
}
