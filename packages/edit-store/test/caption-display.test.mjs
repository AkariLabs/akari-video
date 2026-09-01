import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captionAnchorPositionVars,
  measureCaptionUnits,
  mergeCaptionDisplayStyles,
  resolveCaptionDisplay,
  resolveCaptionReferenceScale,
  resolveCaptionStyleForOutput,
  scaleCaptionPx,
  validateCaptionTextStyle,
} from '../lib/caption-display.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
const styleParity = JSON.parse(await readFile(join(testRoot, 'fixtures/caption-style-validation-parity.json'), 'utf8'));

const policy = {
  mode: 'single_line_sequential',
  algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1',
  max_line_units: 8,
  minimum_fragment_duration_seconds: 0.72,
  locale: 'ja',
  break_hints: {
    preferred_second_starts: ['設定'],
    preferred_first_ends: ['です'],
    protected_terms: ['Claude Code'],
  },
};

function caption(id, start, end, text, extra = {}) {
  return { id, start, end, text, speaker: null, sourceRef: null, edited: true, ...extra };
}

test('ASCII counts as half units and other code points as one', () => {
  assert.equal(measureCaptionUnits('AIです'), 3);
});

test('projects repeated/crossing/speed/multi-source occurrences before splitting', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 1, 5, '前半です設定後半', {
      src: 'a',
      display_fragments: ['前半です', '設定後半'],
    })],
  };
  const result = resolveCaptionDisplay(root, {
    version: 1,
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [
      { src: 'a', in: 0, out: 3 },
      { src: 'b', in: 0, out: 1 },
      { src: 'a', in: 2, out: 6, speed: 2 },
    ],
  });
  assert.equal(result.occurrence_count, 2);
  assert.equal(result.display_cue_count, 4);
  assert.deepEqual(result.display_cues.map(cue => cue.occurrence_index), [1, 1, 2, 2]);
  assert.deepEqual(result.display_cues.map(cue => cue.cut_index), [0, 0, 2, 2]);
  assert.equal(result.display_cues[0].id, 'c-0001-occ-0001-part-1');
  assert.equal(result.display_cues.at(-1).end, 5.5);
});

test('output-domain cue bypasses src cut filtering and keeps one continuous output interval', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 0.5, 3.5, 'C2まで表示', {
      src: 'a', time_domain: 'output',
    })],
  };
  const result = resolveCaptionDisplay(root, {
    version: 1,
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [
      { src: 'a', in: 0, out: 2 },
      { src: 'b', in: 0, out: 2 },
    ],
  });
  assert.equal(result.occurrence_count, 1);
  assert.equal(result.display_cue_count, 1);
  assert.equal(result.display_cues[0].start, 0.5);
  assert.equal(result.display_cues[0].end, 3.5);
  assert.equal(result.display_cues[0].src, 'a');
  assert.equal(result.display_cues[0].cut_index, -1);
});

test('output-domain cue may omit provenance src in a multi-source edit', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 0.5, 3.5, '出力字幕', { time_domain: 'output' })],
  };
  assert.doesNotThrow(() => resolveCaptionDisplay(root, {
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }, { src: 'b', in: 0, out: 2 }],
  }));
});

test('output-domain cue is clamped to the linear cuts duration', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 3, 7, '字幕です', { time_domain: 'output' })],
  };
  const result = resolveCaptionDisplay(root, {
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }, { src: 'b', in: 0, out: 2 }],
  });
  assert.equal(result.occurrence_count, 1);
  assert.equal(result.display_cues[0].start, 3);
  assert.equal(result.display_cues[0].end, 4);
});

test('output-domain cue at or beyond the linear cuts end produces no occurrence', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 4, 7, '字幕です', { time_domain: 'output' })],
  };
  const result = resolveCaptionDisplay(root, {
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 2 }, { src: 'b', in: 0, out: 2 }],
  });
  assert.equal(result.occurrence_count, 0);
  assert.deepEqual(result.display_cues, []);
});

test('source reference validation is driven by normalized sources, not edit.version', () => {
  const root = {
    display_policy: policy,
    captions: [caption('c-0001', 0, 1, '正常です', { src: 'a' })],
  };
  const normalized = {
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }],
    cuts: [{ src: 'a', in: 0, out: 1 }],
  };
  assert.equal(resolveCaptionDisplay(root, normalized).occurrence_count, 1);
  assert.throws(
    () => resolveCaptionDisplay(root, { ...normalized, sources: [] }),
    /non-empty sources/u
  );
});

test('fails closed for timeline overrides, normalization, style, overlap, and impossible split', () => {
  const base = { display_policy: policy, captions: [caption('c-0001', 0, 1, '正常です')] };
  assert.throws(() => resolveCaptionDisplay(base, { cuts: [{ in: 0, out: 1, at: 0 }] }), /does not support/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, ' é')] }, { cuts: [] }), /NFC/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, '正常です', { style: 'pop' })] }, { cuts: [] }), /cannot be combined/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, '正常'), caption('c-0001', 1, 2, '重複')] }, { cuts: [] }), /duplicated/);
  assert.throws(() => resolveCaptionDisplay(base, { cuts: [], emphasis_words: [{ t_start: 0.2, t_end: 0.4 }] }), /emphasis_words cannot act/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', -1, 1, '範囲不正')] }, { cuts: [] }), /0 <= start < end/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 2, '重なり'), caption('c-0002', 1, 3, '重なる')] }, { cuts: [] }), /overlap/);
  assert.throws(() => resolveCaptionDisplay({ ...base, captions: [caption('c-0001', 0, 1, 'abcdefghijklmnopq')] }, { cuts: [] }), /provide display_fragments/);
});

test('display-policy caption styles accept omission, preserve known conflicts, and name unknown values', () => {
  const withStyle = (...style) => ({
    display_policy: styleParity.display_policy,
    captions: [{ ...styleParity.caption, ...(style.length === 0 ? {} : { style: style[0] }) }],
  });
  assert.doesNotThrow(() => resolveCaptionDisplay(withStyle(), styleParity.edit));

  for (const style of ['karaoke', 'pop', 'reveal', 'reveal-word']) {
    assert.throws(() => resolveCaptionDisplay(withStyle(style), styleParity.edit), error => {
      assert.equal(error.code, 'STYLE_CONFLICT');
      assert.equal(error.message, 'captions[0].style cannot be combined with display_policy');
      return true;
    }, style);
  }

  for (const style of [
    styleParity.caption_style_contract.rejected_with_display_policy.style,
    'REVEAL',
    'reveal_word',
    '',
  ]) {
    assert.throws(() => resolveCaptionDisplay(withStyle(style), styleParity.edit), error => {
      assert.equal(error.code, styleParity.caption_style_contract.rejected_with_display_policy.error_code);
      assert.ok(error.message.includes(JSON.stringify(style)));
      assert.match(error.message, /expected one of: karaoke, pop, reveal, reveal-word/u);
      assert.doesNotMatch(error.message, /display_policy/u);
      return true;
    }, JSON.stringify(style));
  }
});

test('fails closed for malformed source cues and every version 1 source reference mismatch', () => {
  const root = { display_policy: policy, captions: [caption('c-0001', 0, 1, '正常です', { src: 'ghost' })] };
  const edit = {
    version: 1,
    output: { width: 1920, height: 1080 },
    sources: [{ id: 'a' }, { id: 'b' }],
    cuts: [{ src: 'a', in: 0, out: 1 }],
  };
  assert.throws(() => resolveCaptionDisplay(root, edit), /captions\[0\]\.src does not reference/u);
  assert.throws(() => resolveCaptionDisplay({ ...root, captions: [caption('c-0001', 0, 1, '正常です')] }, edit), /captions\[0\]\.src is required/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, cuts: [{ in: 0, out: 1 }] }), /cuts\[0\]\.src is required/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, cuts: [{ src: 'ghost', in: 0, out: 1 }] }), /cuts\[0\]\.src does not reference/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, sources: [{ id: 'a' }, { id: 'a' }] }), /sources\[\]\.id is duplicated/u);
  assert.throws(() => resolveCaptionDisplay(root, { ...edit, sources: [{ id: '' }, { id: 'b' }] }), /sources\[0\]\.id must be/u);
  assert.throws(() => resolveCaptionDisplay({ ...root, captions: [
    caption('c-0001', 0, 1, '正常です', { src: 'a' }),
    caption('c-0001', 1, 2, '重複です', { src: 'a' }),
  ] }, edit), /captions\[\]\.id is duplicated/u);
  assert.throws(() => resolveCaptionDisplay({ ...root, captions: [caption('c-0001', 1, 1, '時刻不正', { src: 'a' })] }, edit), /0 <= start < end/u);
});

test('opt-in kernel accepts every captions.schema-valid text style in the shared parity fixture', () => {
  for (const item of styleParity.valid_style_cases) {
    const root = {
      display_policy: styleParity.display_policy,
      default_text_style: item.style,
      captions: [styleParity.caption],
    };
    assert.doesNotThrow(() => resolveCaptionDisplay(root, styleParity.edit), item.id);
  }
  assert.doesNotThrow(() => resolveCaptionDisplay({
    display_policy: styleParity.display_policy,
    default_text_style: styleParity.valid_default_style,
    captions: [{ ...styleParity.caption, text_style: { color: '#FFF4D6' } }],
  }, styleParity.edit));
});

test('opt-in kernel rejects the complete shared style matrix before merge', () => {
  for (const item of styleParity.invalid_cases) {
    assert.throws(() => resolveCaptionDisplay(styleRootForCase(item), styleParity.edit), undefined, item.id);
  }
  for (const [id, style] of [
    ['size-nan', { size_px: Number.NaN }],
    ['line-height-infinity', { line_height: Number.POSITIVE_INFINITY }],
    ['stroke-width-nan', { stroke: { width_px: Number.NaN } }],
    ['background-opacity-infinity', { background: { opacity: Number.POSITIVE_INFINITY } }],
    ['layout-left-nan', { layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: Number.NaN, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    } }],
  ]) {
    assert.throws(() => resolveCaptionDisplay({
      display_policy: styleParity.display_policy,
      captions: [{ ...styleParity.caption, text_style: style }],
    }, styleParity.edit), undefined, id);
  }
});

test('reference-pixel geometry resolves A4 numeric oracle and scales only pixel fields', () => {
  const resolved = resolveCaptionStyleForOutput({
    size_px: 82,
    font_weight: 600,
    line_height: 1.08,
    stroke: { method: 'webkit-outline', color: '#050505', width_px: 5 },
    background: { radius_px: 18 },
    layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    },
  }, { width: 1920, height: 1080 });
  assert.deepEqual(resolved.layout, {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, right_px: 539, center_x_px: 821,
    bottom_px: 29, text_align: 'center', max_lines: 1, scale: 1,
  });
  assert.equal(resolved.vars['--caption-font-size'], '82px');
  assert.equal(resolved.vars['--caption-font-weight'], '600');
  assert.equal(resolved.vars['--caption-line-height'], '1.08');
  assert.equal(resolved.vars['--caption-webkit-text-stroke'], '5px #050505');
  assert.equal(resolved.vars['--caption-text-shadow'], 'none');
  assert.throws(() => resolveCaptionStyleForOutput({ layout: {
    mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
  } }, { width: 1080, height: 1920 }), /aspect ratio/);
});

// 2026-08-26 akari-reel 実機: text_anchor + position の位置変数はこれまで render-cut 側の
// ローカル複製だけが実装し、プレビューは落としていた（明示位置付き字幕がプレビューだけ
// 既定下段 7% に出る出力不一致）。単一定義 captionAnchorPositionVars を正とする。
test('captionAnchorPositionVars maps the nine anchors and 0..1 positions like the render pipeline', () => {
  assert.deepEqual(captionAnchorPositionVars('tc', { y: 0.386458 }, undefined), {
    '--caption-top': '38.65%',
    '--caption-bottom': 'auto',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
  assert.deepEqual(captionAnchorPositionVars('bc', undefined, undefined), {
    '--caption-top': 'auto',
    '--caption-bottom': '7%',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
  assert.deepEqual(captionAnchorPositionVars('mc', undefined, undefined)['--caption-justify-content'], 'center');
  const withX = captionAnchorPositionVars('tl', { x: 0.25, y: 1.5 }, undefined);
  assert.equal(withX['--caption-left'], '25%');
  assert.equal(withX['--caption-align-items'], 'flex-start');
  assert.equal(withX['--caption-top'], '100%', 'position.y is clamped to 0..1');
  assert.deepEqual(captionAnchorPositionVars(undefined, undefined, 'middle')['--caption-top'], '0');
  assert.deepEqual(captionAnchorPositionVars('zz', undefined, undefined), {}, 'invalid anchor is ignored');
  assert.deepEqual(captionAnchorPositionVars(undefined, undefined, undefined), {});
});

test('captionAnchorPositionVars places bc position.y at the plate bottom edge', () => {
  assert.deepEqual(captionAnchorPositionVars('bc', { y: 0.905 }, undefined), {
    '--caption-top': 'auto',
    '--caption-bottom': '9.5%',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
});

test('captionAnchorPositionVars combines bl bottom-edge y with explicit x', () => {
  assert.deepEqual(captionAnchorPositionVars('bl', { x: 0.1, y: 0.9 }, undefined), {
    '--caption-top': 'auto',
    '--caption-bottom': '10%',
    '--caption-left': '10%',
    '--caption-right': '4%',
    '--caption-align-items': 'flex-start',
    '--caption-line-margin': '0',
  });
});

test('captionAnchorPositionVars uses bottom-edge y for explicit bottom vertical alignment', () => {
  assert.deepEqual(captionAnchorPositionVars(undefined, { y: 0.905 }, 'bottom'), {
    '--caption-top': 'auto',
    '--caption-bottom': '9.5%',
  });
});

test('captionAnchorPositionVars keeps position-only y top-based', () => {
  assert.deepEqual(captionAnchorPositionVars(undefined, { y: 0.38 }, undefined), {
    '--caption-top': '38%',
    '--caption-bottom': 'auto',
  });
});

test('captionAnchorPositionVars centers middle-anchor y and leaves other anchor modes unchanged', () => {
  assert.deepEqual(captionAnchorPositionVars('mc', { y: 0.5 }, undefined), {
    '--caption-top': '50%',
    '--caption-bottom': 'auto',
    '--caption-translate': '0 -50%',
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-align-items': 'center',
    '--caption-text-align': 'center',
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
  });
  assert.equal(captionAnchorPositionVars('mc', undefined, undefined)['--caption-translate'], undefined);
  assert.equal(captionAnchorPositionVars('tc', { y: 0.5 }, undefined)['--caption-translate'], undefined);
  assert.equal(captionAnchorPositionVars('bc', { y: 0.5 }, undefined)['--caption-translate'], undefined);
  assert.deepEqual(captionAnchorPositionVars(undefined, { y: 0.5 }, 'middle'), {
    '--caption-top': '50%',
    '--caption-bottom': 'auto',
    '--caption-translate': '0 -50%',
  });
});

test('captionAnchorPositionVars clamps bottom-anchor y before computing the bottom offset', () => {
  assert.equal(captionAnchorPositionVars('bc', { y: 1.5 }, undefined)['--caption-bottom'], '0%');
});

test('resolveCaptionStyleForOutput emits anchor/position vars unless a reference-pixel layout owns the geometry', () => {
  const anchored = resolveCaptionStyleForOutput({ text_anchor: 'tc', position: { y: 0.5 } }, undefined);
  assert.equal(anchored.vars['--caption-top'], '50%');
  assert.equal(anchored.vars['--caption-bottom'], 'auto');
  const withLayout = resolveCaptionStyleForOutput({
    text_anchor: 'tc',
    position: { y: 0.5 },
    layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    },
  }, { width: 1920, height: 1080 });
  assert.equal(withLayout.vars['--caption-top'], undefined, 'layout keeps exclusive ownership of geometry');
  assert.equal(withLayout.vars['--caption-bottom'], '29px');
});

test('legacy shadow preserves non-integer width bytes while reference-pixel scaling rounds to six places', () => {
  const width = 1.23456789;
  const legacy = resolveCaptionStyleForOutput({ stroke: { color: '#000000', width_px: width } }, undefined);
  assert.equal(legacy.vars['--caption-text-shadow'],
    '-1.23456789px -1.23456789px 0 #000000, 1.23456789px -1.23456789px 0 #000000, '
    + '-1.23456789px 1.23456789px 0 #000000, 1.23456789px 1.23456789px 0 #000000, '
    + '0 0 8px rgba(0,0,0,.6)');
  const scaled = resolveCaptionStyleForOutput({
    stroke: { color: '#000000', width_px: width },
    layout: {
      mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
      left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
    },
  }, { width: 960, height: 540 });
  assert.match(scaled.vars['--caption-text-shadow'], /0\.617284px/u);
});

test('omitting display_policy leaves the legacy path untouched', () => {
  const legacyArray = [caption('c-0001', 0, 1, 'legacy', {
    style: styleParity.caption_style_contract.rejected_with_display_policy.style,
    text_style: { font_weight: '600', stroke: { method: 'invented' } },
  })];
  const legacyObject = { default_text_style: { color: 17, invented: true }, captions: legacyArray };
  const before = JSON.stringify(legacyObject);
  assert.equal(resolveCaptionDisplay(legacyArray, { cuts: [] }), null);
  assert.equal(resolveCaptionDisplay(legacyObject, { cuts: [] }), null);
  assert.equal(JSON.stringify(legacyObject), before);
});

function styleRootForCase(item) {
  const root = {
    display_policy: styleParity.display_policy,
    default_text_style: styleParity.valid_default_style,
    captions: [{ ...styleParity.caption, text_style: { color: '#FFF4D6' } }],
  };
  if (Object.hasOwn(item, 'default_text_style')) root.default_text_style = item.default_text_style;
  if (Object.hasOwn(item, 'caption_text_style')) root.captions[0].text_style = item.caption_text_style;
  return root;
}

// issue #40 §2（2026-09-01）: zone 方式の px 系フィールドは reference_height_px を宣言すると
// output.height / reference_height_px で自動追随する。宣言なしは従来値バイト同一。
const REFERENCE_PIXEL_LAYOUT = {
  mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
  left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1,
};

test('reference_height_px scales zone-style px fields by output height and leaves undeclared styles byte-identical', () => {
  const style = {
    zone: 'bottom', size_px: 36, reference_height_px: 720,
    stroke: { color: '#000000', width_px: 3 }, background: { radius_px: 8 },
  };
  const hd = resolveCaptionStyleForOutput(style, { width: 1280, height: 720 });
  assert.equal(hd.vars['--caption-font-size'], '36px');
  assert.equal(hd.vars['--plate-radius'], '8px');
  assert.match(hd.vars['--caption-text-shadow'], /^-3px -3px 0 #000000, 3px -3px 0 #000000/u);
  const uhd = resolveCaptionStyleForOutput(style, { width: 3840, height: 2160 });
  assert.equal(uhd.vars['--caption-font-size'], '108px');
  assert.equal(uhd.vars['--plate-radius'], '24px');
  assert.equal(uhd.vars['--plate-block-radius'], '24px');
  assert.match(uhd.vars['--caption-text-shadow'], /^-9px -9px 0 #000000, 9px -9px 0 #000000/u);
  assert.equal(uhd.layout, undefined, 'zone 方式なので reference-pixel layout は生まれない');
  const outline = resolveCaptionStyleForOutput(
    { ...style, stroke: { method: 'webkit-outline', color: '#000000', width_px: 3 } },
    { width: 3840, height: 2160 },
  );
  assert.equal(outline.vars['--caption-webkit-text-stroke'], '9px #000000');
  // 基準は高さ: 縦型 1080×1920 でも scale = 1920 / 720
  assert.equal(resolveCaptionStyleForOutput(style, { width: 1080, height: 1920 }).vars['--caption-font-size'], '96px');
  // 宣言なしは 4K でも従来値（720p の vars と同一 = 従来どおり追随しない）
  const { reference_height_px: _omitted, ...plain } = style;
  assert.deepEqual(resolveCaptionStyleForOutput(plain, { width: 3840, height: 2160 }).vars, hd.vars);
  assert.deepEqual(resolveCaptionStyleForOutput(plain, undefined).vars, hd.vars);
});

test('reference_height_px requires output height, an integer >= 1, and no reference-pixel layout', () => {
  const style = { size_px: 36, reference_height_px: 720 };
  assert.throws(() => resolveCaptionStyleForOutput(style, undefined), error => error.code === 'INVALID_OUTPUT_GEOMETRY');
  assert.throws(() => resolveCaptionStyleForOutput(style, { width: 1920 }), error => error.code === 'INVALID_OUTPUT_GEOMETRY');
  assert.equal(resolveCaptionReferenceScale({ size_px: 36 }, undefined), 1);
  assert.equal(resolveCaptionReferenceScale(style, { width: 3840, height: 2160 }), 3);
  assert.equal(resolveCaptionReferenceScale(style, { width: 1280, height: 720 }), 1);
  for (const value of [0, -1, 1.5, '720', Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
    assert.throws(() => validateCaptionTextStyle({ reference_height_px: value }), error => error.code === 'INVALID_TEXT_STYLE', String(value));
    assert.throws(() => resolveCaptionReferenceScale({ reference_height_px: value }, { width: 1920, height: 1080 }), error => error.code === 'INVALID_TEXT_STYLE', String(value));
  }
  assert.deepEqual(validateCaptionTextStyle({ reference_height_px: 1 }), { reference_height_px: 1 });
  // layout（reference-pixel）との併用は kernel の 3 入口（validate / merge / resolve）全てで拒否
  assert.throws(() => validateCaptionTextStyle({ reference_height_px: 720, layout: REFERENCE_PIXEL_LAYOUT }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => mergeCaptionDisplayStyles({ layout: REFERENCE_PIXEL_LAYOUT }, { reference_height_px: 720 }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => mergeCaptionDisplayStyles({ reference_height_px: 720 }, { layout: REFERENCE_PIXEL_LAYOUT }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => resolveCaptionStyleForOutput({ reference_height_px: 720, layout: REFERENCE_PIXEL_LAYOUT }, { width: 1920, height: 1080 }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => resolveCaptionReferenceScale({ reference_height_px: 720, layout: REFERENCE_PIXEL_LAYOUT }, { width: 1920, height: 1080 }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  assert.throws(() => resolveCaptionDisplay({
    display_policy: policy,
    default_text_style: { layout: REFERENCE_PIXEL_LAYOUT },
    captions: [caption('c-0001', 0, 1, '併用です', { text_style: { reference_height_px: 720 } })],
  }, { output: { width: 1920, height: 1080 }, cuts: [] }), error => error.code === 'STYLE_LAYOUT_CONFLICT');
  // layout 経路は従来どおり output.width / reference_width_px
  const layoutOnly = resolveCaptionStyleForOutput({ size_px: 82, layout: REFERENCE_PIXEL_LAYOUT }, { width: 3840, height: 2160 });
  assert.equal(layoutOnly.vars['--caption-font-size'], '164px');
  assert.equal(layoutOnly.layout.scale, 2);
});

test('cue-level reference_height_px overrides default_text_style field by field through the display kernel', () => {
  const result = resolveCaptionDisplay({
    display_policy: policy,
    default_text_style: { size_px: 36, reference_height_px: 720, stroke: { color: '#000000', width_px: 3 } },
    captions: [
      caption('c-0001', 0, 1, '既定です'),
      caption('c-0002', 1, 2, '上書きです', { text_style: { reference_height_px: 1080 } }),
      caption('c-0003', 2, 3, '色だけです', { text_style: { color: '#FFF4D6' } }),
    ],
  }, { output: { width: 3840, height: 2160 }, cuts: [] });
  const [byDefault, overridden, colorOnly] = result.display_cues;
  assert.equal(byDefault.style_vars['--caption-font-size'], '108px');
  assert.match(byDefault.style_vars['--caption-text-shadow'], /^-9px -9px 0 #000000/u);
  assert.equal(overridden.style_vars['--caption-font-size'], '72px');
  assert.match(overridden.style_vars['--caption-text-shadow'], /^-6px -6px 0 #000000/u);
  assert.deepEqual(overridden.text_style, { size_px: 36, reference_height_px: 1080, stroke: { color: '#000000', width_px: 3 } });
  assert.equal(colorOnly.style_vars['--caption-font-size'], '108px', 'cue が reference_height_px を持たなければ default を継承する');
  assert.equal(colorOnly.style_vars['--caption-color'], '#FFF4D6');
});

test('scaleCaptionPx keeps scale 1 values untouched and rounds scaled values to six places', () => {
  assert.equal(scaleCaptionPx(1.23456789, 1), 1.23456789);
  assert.equal(scaleCaptionPx(0.1, 3), 0.3);
  assert.equal(scaleCaptionPx(36, 1.5), 54);
  assert.equal(scaleCaptionPx(1.23456789, 0.5), 0.617284);
});
