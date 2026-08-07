// 演出レシピ → edit.json/captions.json 追記パッチの純関数コア。
// ファイル I/O・AKARI Sounds カタログ探索・edit.json/captions.json の読み書きは一切しない。
// 同一引数なら常にバイト等価な patch オブジェクトを返す（決定論。契約書 §3-2）。

import { deriveTracks } from '../../edit-lint/src/derive-tracks.mjs';

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

function cutValue(value, placeholder) {
  return Number.isFinite(value) ? String(value) : placeholder;
}

function nextLayerTrack(edit) {
  const tracks = (Array.isArray(edit?.layers) ? edit.layers : [])
    .map((layer) => (Number.isInteger(layer?.track) && layer.track >= 0 ? layer.track : 0));
  return tracks.length > 0 ? Math.max(...tracks) + 1 : 0;
}

function uniqueTrackId(tracks, base) {
  const ids = new Set(tracks.map((track) => track?.id).filter(Boolean));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * edit の既存宣言を保ったまま、人物専用 layer track を最上位（配列末尾）へ追加する。
 * timeline.tracks は下→上。人物を既存 layer と別 track にすることで、同じ layers[] 内の
 * マスク等より上に来ることも宣言として固定する。
 */
function personMatteTrackOrder(edit, personLayer) {
  const prospective = {
    ...(edit ?? {}),
    cuts: Array.isArray(edit?.cuts) && edit.cuts.length > 0 ? edit.cuts : [{ track: 0 }],
    overlays: Array.isArray(edit?.overlays) ? edit.overlays : [{ track: 0 }],
    layers: [...(Array.isArray(edit?.layers) ? edit.layers : []), personLayer],
  };
  const existing = Array.isArray(edit?.timeline?.tracks)
    ? structuredClone(edit.timeline.tracks)
    : deriveTracks(prospective);
  const withoutPersonTrack = existing.filter(
    (track) => !(track?.kind === 'layers' && (track.ref ?? 0) === personLayer.track),
  );
  return [
    ...withoutPersonTrack,
    {
      id: uniqueTrackId(withoutPersonTrack, `direction-person-${personLayer.track}`),
      kind: 'layers',
      ref: personLayer.track,
      label: '人物切り抜き',
    },
  ];
}

function buildPersonMattePrerequisite({
  cutIndex,
  cutInSec,
  cutOutSec,
  cutSpeed,
  cutSourcePath,
  outputFps,
  personMatte,
}) {
  const source = cutSourcePath || '<cut-source-path>';
  const intermediateMattePath = `assets/matte/person-${cutIndex}.webm`;
  const mattePath = `assets/matte/person-${cutIndex}.mov`;
  const preparedPath = `.person-${cutIndex}-speed-applied.mp4`;
  const speed = Number.isFinite(cutSpeed) && cutSpeed > 0 ? cutSpeed : 1;
  const fps = Number.isFinite(outputFps) && outputFps > 0 ? outputFps : 24;
  const duration = Number.isFinite(cutInSec) && Number.isFinite(cutOutSec)
    ? round3((cutOutSec - cutInSec) / speed)
    : null;
  return {
    kind: 'person_matte',
    execution: 'prerequisite_only',
    path_base: 'project',
    source: {
      path: source,
      in: Number.isFinite(cutInSec) ? cutInSec : null,
      out: Number.isFinite(cutOutSec) ? cutOutSec : null,
      speed,
    },
    output: mattePath,
    steps: [
      {
        id: 'prepare-speed-adjusted-cut',
        command: 'ffmpeg',
        args: [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-ss', cutValue(cutInSec, '<cut-in-sec>'),
          '-to', cutValue(cutOutSec, '<cut-out-sec>'),
          '-i', source,
          '-map', '0:v:0', '-an',
          '-vf', `setpts=PTS/${speed},fps=${fps}`,
          '-t', duration === null ? '<cut-duration-after-speed-sec>' : String(duration),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          preparedPath,
        ],
      },
      {
        id: 'generate-person-matte',
        after: ['prepare-speed-adjusted-cut'],
        command: 'node',
        entrypoint_base: 'akari_video_repo',
        args: [
          'skills/analyze-footage/bin/person-matte/person-matte.mjs',
          '--input', preparedPath,
          '--out', intermediateMattePath,
          '--quality', personMatte.quality ?? 'accurate',
          '--fps', String(fps),
          '--decode-width', String(personMatte.decode_width ?? 1280),
        ],
      },
      {
        id: 'convert-person-matte-for-render-cut',
        after: ['generate-person-matte'],
        command: 'ffmpeg',
        args: [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-c:v', 'libvpx-vp9',
          '-i', intermediateMattePath,
          '-map', '0:v:0', '-an',
          '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le',
          mattePath,
        ],
      },
    ],
    cleanup: [preparedPath, intermediateMattePath],
  };
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
 * @param {number} [params.cutSpeed] - cuts[].speed（既定 1）
 * @param {string} [params.cutSourcePath] - 対象 cut のソースパス（プロジェクト相対）
 * @param {object} [params.cutTransform] - 対象 cut の transform（人物レイヤーへ継承）
 * @param {number} [params.outputFps] - edit.output.fps（マット生成 fps）
 * @param {object} [params.edit] - 適用前 edit。人物専用 track 番号と明示 z 順の導出に使う
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
  cutSpeed = 1,
  cutSourcePath,
  cutTransform,
  outputFps,
  edit,
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

  let layersPatch = null;
  let timelineTracksPatch = null;
  let mattePrerequisite = null;
  if (layers.person_matte) {
    const speed = Number.isFinite(cutSpeed) && cutSpeed > 0 ? cutSpeed : 1;
    const sourceDuration = Number.isFinite(cutInSec) && Number.isFinite(cutOutSec)
      ? cutOutSec - cutInSec
      : null;
    const track = nextLayerTrack(edit);
    layersPatch = {
      id: `person-${cutIndex}`,
      t: round3(cutTimelineStartSec),
      duration: sourceDuration === null ? null : round3(sourceDuration / speed),
      kind: 'video',
      src: `assets/matte/person-${cutIndex}.mov`,
      ...(cutTransform ? { transform: structuredClone(cutTransform) } : {}),
      track,
    };
    timelineTracksPatch = personMatteTrackOrder(edit, layersPatch);
    mattePrerequisite = buildPersonMattePrerequisite({
      cutIndex,
      cutInSec,
      cutOutSec,
      cutSpeed: speed,
      cutSourcePath,
      outputFps,
      personMatte: layers.person_matte,
    });
    notes.push(
      'person_matte is not generated by expand-direction; run matte_prerequisite.steps in order before render-cut',
    );
  }

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
    layers_patch: layersPatch,
    timeline_tracks_patch: timelineTracksPatch,
    matte_prerequisite: mattePrerequisite,
    audio_sfx_patch: audioSfxPatch,
    caption_patch: captionPatch,
    emphasis_word_patch: emphasisWordPatch,
    notes,
  };
}
