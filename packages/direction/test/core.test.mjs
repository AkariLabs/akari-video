import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDirectionPatch, scaleFramingKeyframes, CATEGORY_EMOTION } from '../src/core.mjs';

const NEG_MONO_POPOUT = {
  id: 'neg-mono-popout',
  label: '白黒＋飛び出し',
  category: 'negative',
  layers: {
    look: { lut: 'mono', intensity: 1 },
    text: { style_hint: 'one-char-bang', anim_in: 'zoom-pop' },
    audio: { se_meaning: '強調・登場', se_default: 'sfx-pop-ding', se_loop: null, bgm_change: null },
  },
  use_when: { beats: ['emotion', 'punchline'], tone: ['真面目', 'エモい'], strength_min: 0.6 },
};

const NEG_DISSOLVE = {
  id: 'neg-dissolve',
  label: 'クロスディゾルブ',
  category: 'negative',
  layers: {
    transition_in: { type: 'dissolve', duration: 0.5 },
    text: {},
    audio: { se_meaning: null, se_default: null, se_loop: null, bgm_change: null },
  },
  use_when: { beats: ['turn'], tone: ['無機質'], strength_min: 0.3 },
};

const NEG_SHRINK_SHRINK = {
  id: 'neg-shrink-shrink',
  label: '縮小⇨縮小',
  category: 'negative',
  layers: {
    framing: { keyframes: [{ t: 0, scale: 1.0 }, { t: 1.6, scale: 1.15 }, { t: 3.2, scale: 1.3 }] },
    text: {},
    audio: { se_meaning: null, se_default: null, se_loop: null, bgm_change: null },
  },
  use_when: { beats: ['emotion'], tone: ['真面目'], strength_min: 0.55 },
};

const REQUIRES_ONLY = {
  id: 'neg-color-invert',
  label: '色調反転',
  category: 'negative',
  layers: { text: {}, audio: { se_meaning: null, se_default: null, se_loop: null, bgm_change: null } },
  use_when: { beats: [], tone: [], strength_min: 0.5 },
  requires: ['fx:invert — not implemented'],
};

const NEG_PERSON_CUTOUT = {
  id: 'neg-person-cutout',
  label: '演者切り抜き',
  category: 'negative',
  layers: {
    person_matte: { quality: 'accurate', decode_width: 1280 },
    text: { style_hint: 'color-accent' },
    audio: { se_meaning: '場面転換', se_default: null, se_loop: null, bgm_change: null },
  },
  use_when: { beats: ['turn'], tone: ['真面目'], strength_min: 0.4 },
};

test('buildDirectionPatch is deterministic: same input -> byte-equal JSON', () => {
  const args = {
    recipe: NEG_MONO_POPOUT,
    cutIndex: 0,
    cutInSec: 3.0,
    cutOutSec: 6.5,
    text: 'もう無理',
    resolvedSfx: { path: 'assets/sfx/sfx-pop-ding.mp3' },
  };
  const first = buildDirectionPatch(args);
  const second = buildDirectionPatch({ ...args, recipe: { ...NEG_MONO_POPOUT } });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('rejects requires-only recipes (no silent drop)', () => {
  assert.throws(
    () => buildDirectionPatch({ recipe: REQUIRES_ONLY, cutIndex: 0 }),
    /registration-only/,
  );
});

test('rejects negative/non-integer cutIndex', () => {
  assert.throws(() => buildDirectionPatch({ recipe: NEG_MONO_POPOUT, cutIndex: -1 }));
  assert.throws(() => buildDirectionPatch({ recipe: NEG_MONO_POPOUT, cutIndex: 1.5 }));
});

test('person_matte emits a timed video layer on a dedicated top track', () => {
  const edit = {
    version: 0,
    cuts: [{ in: 0, out: 2 }],
    overlays: [{ track: 0 }],
    layers: [{ id: 'mask', track: 0 }],
  };
  const patch = buildDirectionPatch({
    recipe: NEG_PERSON_CUTOUT,
    cutIndex: 2,
    cutInSec: 10,
    cutOutSec: 14,
    cutTimelineStartSec: 3.5,
    cutSpeed: 2,
    cutSourcePath: 'assets/source/take.mp4',
    cutTransform: { x: 0, y: 250, scale: 1, rotate: 0 },
    outputFps: 30,
    edit,
  });
  assert.deepEqual(patch.layers_patch, {
    id: 'person-2',
    t: 3.5,
    duration: 2,
    kind: 'video',
    src: 'assets/matte/person-2.mov',
    transform: { x: 0, y: 250, scale: 1, rotate: 0 },
    track: 1,
  });
  assert.deepEqual(patch.timeline_tracks_patch.at(-1), {
    id: 'direction-person-1', kind: 'layers', ref: 1, label: '人物切り抜き',
  });
  assert.ok(
    patch.timeline_tracks_patch.findIndex((track) => track.kind === 'overlays')
      < patch.timeline_tracks_patch.length - 1,
  );
});

test('person_matte prerequisite is ordered and converts VP9 alpha to render-cut-safe ProRes 4444', () => {
  const patch = buildDirectionPatch({
    recipe: NEG_PERSON_CUTOUT,
    cutIndex: 3,
    cutInSec: 5,
    cutOutSec: 8,
    cutSpeed: 1.5,
    cutSourcePath: 'assets/source/take.mp4',
    outputFps: 30,
  });
  const [prepare, generate, convert] = patch.matte_prerequisite.steps;
  assert.equal(prepare.command, 'ffmpeg');
  assert.equal(prepare.args[prepare.args.indexOf('-vf') + 1], 'setpts=PTS/1.5,fps=30');
  assert.equal(prepare.args[prepare.args.indexOf('-t') + 1], '2');
  assert.ok(prepare.args.indexOf('-vf') < prepare.args.length - 1);
  assert.deepEqual(generate.after, ['prepare-speed-adjusted-cut']);
  assert.equal(generate.args[0], 'skills/analyze-footage/bin/person-matte/person-matte.mjs');
  assert.equal(generate.args[generate.args.indexOf('--out') + 1], 'assets/matte/person-3.webm');
  assert.equal(generate.args[generate.args.indexOf('--fps') + 1], '30');
  assert.deepEqual(convert.after, ['generate-person-matte']);
  assert.equal(convert.command, 'ffmpeg');
  assert.ok(convert.args.indexOf('libvpx-vp9') < convert.args.indexOf('-i'));
  assert.equal(convert.args[convert.args.indexOf('-i') + 1], 'assets/matte/person-3.webm');
  assert.equal(convert.args[convert.args.indexOf('-profile:v') + 1], '4444');
  assert.equal(convert.args[convert.args.indexOf('-pix_fmt') + 1], 'yuva444p10le');
  assert.equal(convert.args.at(-1), 'assets/matte/person-3.mov');
  assert.equal(patch.matte_prerequisite.output, 'assets/matte/person-3.mov');
  assert.deepEqual(patch.matte_prerequisite.cleanup, [
    '.person-3-speed-applied.mp4',
    'assets/matte/person-3.webm',
  ]);
});

test('look goes to output_patch, not cut_patch', () => {
  const patch = buildDirectionPatch({ recipe: NEG_MONO_POPOUT, cutIndex: 2 });
  assert.deepEqual(patch.output_patch, { look: { lut: 'mono', intensity: 1 } });
  assert.equal(patch.cut_patch.fx, undefined);
});

test('transition_in maps to lead cut (cutIndex - 1) transition_out by default', () => {
  const patch = buildDirectionPatch({ recipe: NEG_DISSOLVE, cutIndex: 2 });
  assert.deepEqual(patch.lead_cut_patch, {
    cut_index: 1,
    transition_out: { type: 'dissolve', duration: 0.5 },
  });
});

test('transition_in respects explicit --lead-cut override', () => {
  const patch = buildDirectionPatch({ recipe: NEG_DISSOLVE, cutIndex: 5, leadCutIndex: 0 });
  assert.equal(patch.lead_cut_patch.cut_index, 0);
});

test('transition_in on cutIndex 0 with no lead cut is skipped non-fatally with a note', () => {
  const patch = buildDirectionPatch({ recipe: NEG_DISSOLVE, cutIndex: 0 });
  assert.equal(patch.lead_cut_patch, null);
  assert.ok(patch.notes.some((n) => n.includes('transition_in') && n.includes('skipped')));
});

test('framing keyframes scale linearly from the 3.2s reference duration', () => {
  const scaled = scaleFramingKeyframes(
    { keyframes: [{ t: 0, scale: 1.0 }, { t: 1.6, scale: 1.15 }, { t: 3.2, scale: 1.3 }] },
    6.4, // 2x the reference
  );
  assert.deepEqual(scaled.keyframes.map((k) => k.t), [0, 3.2, 6.4]);
});

test('framing keyframes pass through unscaled when cutDurationSec is unknown', () => {
  const original = { keyframes: [{ t: 0, scale: 1.0 }, { t: 3.2, scale: 1.3 }] };
  const scaled = scaleFramingKeyframes(original, undefined);
  assert.deepEqual(scaled, original);
});

test('multi-cut framing recipe scales end-to-end through buildDirectionPatch', () => {
  const patch = buildDirectionPatch({
    recipe: NEG_SHRINK_SHRINK, cutIndex: 0, cutInSec: 0, cutOutSec: 1.6,
  });
  assert.deepEqual(patch.cut_patch.framing.keyframes.map((k) => k.t), [0, 0.8, 1.6]);
});

test('audio.sfx is skipped with a note when se_default cannot be resolved locally', () => {
  const patch = buildDirectionPatch({ recipe: NEG_MONO_POPOUT, cutIndex: 0, resolvedSfx: null });
  assert.equal(patch.audio_sfx_patch, null);
  assert.ok(patch.notes.some((n) => n.includes('not resolved locally')));
});

test('audio.sfx is populated when resolvedSfx is provided, timed at cutTimelineStartSec + 0.15', () => {
  const patch = buildDirectionPatch({
    recipe: NEG_MONO_POPOUT, cutIndex: 0, cutTimelineStartSec: 10, resolvedSfx: { path: 'assets/sfx/x.mp3' },
  });
  assert.deepEqual(patch.audio_sfx_patch, { path: 'assets/sfx/x.mp3', t: 10.15, gain_db: 0 });
});

test('text emits caption_patch + emphasis_word_patch with style_hint and category-derived emotion', () => {
  const patch = buildDirectionPatch({
    recipe: NEG_MONO_POPOUT, cutIndex: 3, cutInSec: 3.0, cutOutSec: 6.5, text: 'もう無理',
  });
  assert.equal(patch.caption_patch.text, 'もう無理');
  assert.equal(patch.caption_patch.start, 3.0);
  assert.equal(patch.caption_patch.end, 6.5);
  assert.equal(patch.emphasis_word_patch.style_hint, 'one-char-bang');
  assert.equal(patch.emphasis_word_patch.emotion, CATEGORY_EMOTION.negative);
});

test('text without a recipe style_hint omits style_hint and leaves a fallback note', () => {
  const patch = buildDirectionPatch({
    recipe: NEG_DISSOLVE, cutIndex: 3, cutInSec: 0, cutOutSec: 2, text: '場面転換',
  });
  assert.equal('style_hint' in patch.emphasis_word_patch, false);
  assert.ok(patch.notes.some((n) => n.includes('単純字幕フォールバック')));
});

test('no text -> no caption/emphasis patch', () => {
  const patch = buildDirectionPatch({ recipe: NEG_MONO_POPOUT, cutIndex: 0, cutInSec: 0, cutOutSec: 2 });
  assert.equal(patch.caption_patch, null);
  assert.equal(patch.emphasis_word_patch, null);
});

test('text.anim_in and text.telop_preset are recorded but not expanded (v0 scope note)', () => {
  const recipeWithTelop = {
    ...NEG_MONO_POPOUT,
    layers: { ...NEG_MONO_POPOUT.layers, text: { ...NEG_MONO_POPOUT.layers.text, telop_preset: 'ref3_mincho_flash' } },
  };
  const patch = buildDirectionPatch({ recipe: recipeWithTelop, cutIndex: 0 });
  assert.ok(patch.notes.some((n) => n.includes('telop_preset')));
  assert.ok(patch.notes.some((n) => n.includes('anim_in')));
});
