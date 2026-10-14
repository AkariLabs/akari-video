import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTION_LOOK_PX_FIELDS, captionEmphasisMatches, captionPresetDerivedParts,
  scaledCaptionLook, TEXTSTYLE_CATALOG, updateCaptionStylePresetInSource,
  updateCaptionTextStyleInSource, resolveCaptionWordStyleVars } from '../lib/index.js';

const ids = Object.keys(TEXTSTYLE_CATALOG);
const source = (style = {}, extra = {}) => JSON.stringify({ captions: [{
  id: 'c-1', start: 0, end: 3, text: '字幕', ...extra, text_style: style
}] });
const cue = value => JSON.parse(value).captions[0];
const apply = (value, preset, options) => updateCaptionStylePresetInSource(value, ['c-1'], preset, options);
const parts = style => Object.fromEntries(Object.keys(CAPTION_LOOK_PX_FIELDS)
  .filter(key => key in style).map(key => [key, style[key]]));
const closeParts = (actual, expected, label = '') => {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= 1e-6 * Math.abs(expected), `${label}: ${actual} ≠ ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, label);
    expected.forEach((item, index) => closeParts(actual[index], item, `${label}[${index}]`));
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label);
    for (const key of Object.keys(expected)) closeParts(actual[key], expected[key], `${label}.${key}`);
  } else assert.equal(actual, expected, label);
};
const scaledPixels = (key, value, scale) => {
  const fields = CAPTION_LOOK_PX_FIELDS[key];
  const visit = (part, path = '') => Array.isArray(part) ? part.map(item => visit(item, path))
    : part && typeof part === 'object' ? Object.fromEntries(Object.entries(part)
      .map(([name, entry]) => [name, visit(entry, path ? `${path}.${name}` : name)]))
      : fields.includes(path) && typeof part === 'number' ? part * scale : part;
  return visit(value);
};

test('36 presets resize captions without a text_style object or visual override', () => {
  for (const id of ids) for (const style of [undefined, {}, { color: '#123456' }]) {
    for (const scale of [0.5, 1.25]) {
      const original = { id: 'c-1', start: 0, end: 3, text: '字幕', style_preset: id,
        ...(style === undefined ? {} : { text_style: style }) };
      const input = JSON.stringify({ captions: [original] });
      const preset = TEXTSTYLE_CATALOG[id].style;
      const result = cue(updateCaptionTextStyleInSource(input, 'c-1', { sizePx: preset.size_px * scale }));
      assert.equal(result.text_style.size_px, preset.size_px * scale, id);
      const effective = { ...preset, ...result.text_style };
      for (const key of Object.keys(CAPTION_LOOK_PX_FIELDS).filter(key => key in preset)) {
        closeParts(effective[key], scaledPixels(key, preset[key], scale), `${id}: ${scale}: ${key}`);
      }
    }
  }
});

test('preset replacement and removal remain safe without text_style', () => {
  const original = JSON.stringify({ captions: [{ id: 'c-1', start: 0, end: 3,
    text: '字幕', style_preset: 'title-impact' }] });
  assert.deepEqual(apply(original, 'title-impact'), { source: original, changed: 0 });
  const changed = apply(original, 'subtitle-standard');
  assert.equal(changed.changed, 1);
  assert.equal(cue(changed.source).text_style.size_px, 168);
  assert.equal(cue(apply(original, null).source).text_style.size_px, 168);
});

test('clearing the individual size restores preset pixels and keeps custom paint', () => {
  const initial = apply(source({ size_px: 56 }), 'title-impact').source;
  const cleared = cue(updateCaptionTextStyleInSource(initial, 'c-1', { sizePx: null }));
  assert.equal(cleared.text_style, undefined);
  const colored = updateCaptionTextStyleInSource(initial, 'c-1', { stroke: { color: '#ff0000' } });
  const custom = cue(updateCaptionTextStyleInSource(colored, 'c-1', { sizePx: null }));
  assert.equal(custom.text_style.size_px, undefined);
  assert.deepEqual(custom.text_style.stroke, { color: '#ff0000', width_px: 10 });
  const noPreset = source({ size_px: 56, stroke: { width_px: 4 } });
  const plain = cue(updateCaptionTextStyleInSource(noPreset, 'c-1', { sizePx: null }));
  assert.deepEqual(plain.text_style, { stroke: { width_px: 4 } });
  const catalog = { custom: { style: { stroke: { color: '#000000', width_px: 8 } } } };
  const withDefault = JSON.stringify({ default_text_style: { size_px: 48 }, captions: [{
    id: 'c-1', start: 0, end: 3, text: '字幕', style_preset: 'custom', text_style: { size_px: 24 }
  }] });
  const fallback = cue(updateCaptionTextStyleInSource(withDefault, 'c-1', { sizePx: null }, { catalog }));
  assert.equal(fallback.text_style.size_px, undefined);
  assert.equal(fallback.text_style.stroke.width_px, 16);
});

test('round trips and every intermediate reapplication keep canonical source bytes', () => {
  let value = apply(source({ size_px: 56 }), 'title-impact').source;
  const original = value;
  let size = 56;
  for (let i = 0; i < 20; i++) {
    size += 2;
    value = updateCaptionTextStyleInSource(value, 'c-1', { sizePx: size });
    assert.deepEqual(apply(value, 'title-impact'), { source: value, changed: 0 });
  }
  for (let i = 0; i < 20; i++) {
    size -= 2;
    value = updateCaptionTextStyleInSource(value, 'c-1', { sizePx: size });
    assert.deepEqual(apply(value, 'title-impact'), { source: value, changed: 0 });
  }
  assert.equal(value, original);
});

test('all 36 looks keep their effective pixel ratios across ordinary size changes', () => {
  for (const id of ids) {
    const preset = TEXTSTYLE_CATALOG[id].style;
    for (const size of [38, 56, 64, 96, preset.size_px]) {
      const initial = apply(source({ size_px: size }), id).source;
      const before = cue(initial).text_style;
      const effective = { ...preset, ...before };
      for (const nextSize of [size + 8, size * 1.5, preset.size_px, size / 2]) {
        const next = cue(updateCaptionTextStyleInSource(initial, 'c-1', { sizePx: nextSize }));
        const resolved = { ...preset, ...next.text_style };
        assert.equal(resolved.size_px, nextSize);
        for (const key of Object.keys(CAPTION_LOOK_PX_FIELDS).filter(key => key in preset)) {
          closeParts(resolved[key], scaledPixels(key, effective[key], nextSize / size),
            `${id}: ${size} → ${nextSize}: ${key}`);
        }
      }
    }
  }
});

test('full copied parts retain individual paint while their pixels scale', () => {
  const initial = apply(source({ size_px: 56 }), 'title-impact').source;
  const colored = updateCaptionTextStyleInSource(initial, 'c-1', { stroke: { color: '#ff0000' } });
  const before = cue(colored).text_style.stroke;
  closeParts(before.width_px, 10 * 56 / 168);
  assert.equal(before.color, '#ff0000');
  const after = cue(updateCaptionTextStyleInSource(colored, 'c-1', { sizePx: 84 }));
  closeParts(after.text_style.stroke, { color: '#ff0000', width_px: before.width_px * 1.5 });
  const plate = apply(source({ size_px: 56 }), 'plate-coral').source;
  const dimmed = updateCaptionTextStyleInSource(plate, 'c-1', { background: { opacity: 0.5 } });
  const original = cue(plate).text_style.background;
  const kept = cue(dimmed).text_style.background;
  assert.equal(kept.opacity, 0.5);
  assert.equal(kept.padding_px, original.padding_px);
  assert.equal(kept.radius_px, original.radius_px);
  const resized = cue(updateCaptionTextStyleInSource(dimmed, 'c-1', { sizePx: 84 })).text_style.background;
  closeParts(resized, { ...kept, padding_px: kept.padding_px * 1.5, radius_px: kept.radius_px * 1.5 });
});

test('partial overrides add only missing preset pixels on size change', () => {
  const colorOnly = source({ size_px: 168, stroke: { color: '#ff0000' } }, { style_preset: 'title-impact' });
  closeParts(cue(updateCaptionTextStyleInSource(colorOnly, 'c-1', { sizePx: 56 })).text_style.stroke,
    { color: '#ff0000', width_px: 10 / 3 });
  const widthOnly = source({ size_px: 168, stroke: { width_px: 4 } }, { style_preset: 'title-impact' });
  assert.deepEqual(cue(updateCaptionTextStyleInSource(widthOnly, 'c-1', { sizePx: 56 })).text_style.stroke,
    { width_px: 4 });
  const background = source({ size_px: 62, background: { opacity: 0.5 } }, { style_preset: 'plate-coral' });
  const p = TEXTSTYLE_CATALOG['plate-coral'].style;
  const after = cue(updateCaptionTextStyleInSource(background, 'c-1', { sizePx: 31 })).text_style.background;
  assert.equal(after.opacity, 0.5);
  assert.equal(after.padding_px, p.background.padding_px / 2);
  assert.equal(after.radius_px, p.background.radius_px / 2);
  const again = cue(updateCaptionTextStyleInSource(
    updateCaptionTextStyleInSource(background, 'c-1', { sizePx: 31 }), 'c-1', { sizePx: 62 })).text_style.background;
  assert.equal(again.opacity, 0.5);
  assert.equal(again.padding_px, p.background.padding_px);
  assert.equal(again.radius_px, p.background.radius_px);
});

test('array and pattern overrides scale only as complete proportional components', () => {
  const catalog = { custom: { style: { size_px: 100,
    strokes: [{ color: '#000000', width_px: 8, offset_x: 2 }],
    fill: { type: 'pattern', pattern: { id: 'dot', scale: 2, fg: '#ffffff', bg: '#000000' } } } } };
  const initial = source({ size_px: 100,
    strokes: [{ color: '#000000', width_px: 4, offset_x: 1 }],
    fill: { type: 'pattern', pattern: { id: 'dot', scale: 1, fg: '#ffffff', bg: '#000000' } } },
  { style_preset: 'custom' });
  const changed = cue(updateCaptionTextStyleInSource(initial, 'c-1', { sizePx: 50 }, { catalog }));
  assert.equal(changed.text_style.strokes[0].width_px, 2);
  assert.equal(changed.text_style.fill.pattern.scale, 0.5);
  const individual = source({ size_px: 100,
    strokes: [{ color: '#000000', width_px: 4, offset_x: 0.75 }],
    fill: { type: 'pattern', pattern: { id: 'dot', scale: 1, fg: '#ff0000', bg: '#000000' } } },
  { style_preset: 'custom' });
  const untouched = cue(updateCaptionTextStyleInSource(individual, 'c-1', { sizePx: 50 }, { catalog }));
  assert.equal(untouched.text_style.strokes[0].width_px, 4);
  assert.equal(untouched.text_style.fill.pattern.scale, 0.5);
  const differentFill = source({ size_px: 100, fill: { type: 'solid', color: '#ff0000' } },
    { style_preset: 'custom' });
  assert.deepEqual(cue(updateCaptionTextStyleInSource(differentFill, 'c-1', { sizePx: 50 }, { catalog })).text_style.fill,
    { type: 'solid', color: '#ff0000' });
});

test('all catalog looks follow the retained size on application', () => {
  assert.equal(ids.length, 36);
  for (const id of ids) for (const size of [38, 56, 64, 96]) {
    const applied = cue(apply(source({ size_px: size }), id).source);
    assert.equal(applied.text_style.size_px, size, id);
    const expected = scaledCaptionLook(TEXTSTYLE_CATALOG[id].style, size);
    const resolved = { ...TEXTSTYLE_CATALOG[id].style, ...applied.text_style };
    assert.deepEqual(parts(resolved), parts(expected), `${id} at ${size}`);
  }
});

test('every catalog source and target removes old copied parts after a size change', () => {
  for (const from of ids) for (const to of ids) for (const route of ['store', 'direct']) {
    let value = apply(source({ size_px: 64 }), from).source;
    value = route === 'store' ? updateCaptionTextStyleInSource(value, 'c-1', { sizePx: 96 })
      : source({ ...cue(value).text_style, size_px: 96 }, { style_preset: from });
    value = apply(value, to).source;
    const current = cue(value);
    assert.equal(current.text_style.size_px, 96);
    const expected = scaledCaptionLook(TEXTSTYLE_CATALOG[to].style, 96);
    const resolved = { ...TEXTSTYLE_CATALOG[to].style, ...current.text_style };
    closeParts(parts(resolved), parts(expected), `${from} → ${to} via ${route}`);
    const removed = cue(apply(value, null).source);
    assert.equal(removed.text_style.size_px, 96);
    assert.deepEqual(parts(removed.text_style), {});
  }
});

test('reference height does not gate copies; default visual parts remain independent', () => {
  const catalog = { large: { style: { size_px: 120, reference_height_px: 1080,
    stroke: { color: '#000000', width_px: 12 } } } };
  const rooted = JSON.stringify({ default_text_style: { shadow: { color: '#111111', blur_px: 5 } },
    captions: [{ id: 'c-1', start: 0, end: 3, text: '字幕', text_style: { size_px: 60,
      reference_height_px: 1080 } }] });
  const applied = cue(apply(rooted, 'large', { catalog }).source);
  assert.equal(applied.text_style.stroke.width_px, 6);
  assert.equal(applied.text_style.shadow, undefined);
  const resized = cue(updateCaptionTextStyleInSource(apply(rooted, 'large', { catalog }).source,
    'c-1', { sizePx: 90 }, { catalog }));
  assert.equal(resized.text_style.shadow, undefined);
  assert.equal(resized.text_style.stroke.width_px, 9);
  const mismatch = source({ size_px: 60 }, { style_preset: undefined });
  const mismatched = cue(apply(mismatch, 'large', { catalog }).source);
  assert.equal(mismatched.text_style.stroke.width_px, 6);
  const withOutput = cue(apply(mismatch, 'large', { catalog,
    output: { width: 1920, height: 1080 } }).source);
  assert.equal(withOutput.text_style.stroke.width_px, 6);
});

test('preset and caption reference heights preserve pixel to size ratio with or without output', () => {
  const catalog = { referenced: { style: { size_px: 120, reference_height_px: 1080,
    stroke: { color: '#000000', width_px: 12 } } } };
  for (const textStyle of [{ size_px: 60 }, { size_px: 60, reference_height_px: 720 },
    { size_px: 60, reference_height_px: 1080 }]) {
    for (const output of [undefined, { width: 1920, height: 1080 }]) {
      const result = cue(apply(source(textStyle), 'referenced', { catalog, output }).source);
      const effective = { ...catalog.referenced.style, ...result.text_style };
      assert.ok(Math.abs(effective.stroke.width_px / effective.size_px - 12 / 120) < 1e-9,
        JSON.stringify({ textStyle, output, effective }));
    }
  }
  const builtin = cue(apply(source({ size_px: 84, reference_height_px: 1080 }), 'title-impact').source);
  assert.equal(builtin.text_style.stroke.width_px, 5);
  assert.equal(builtin.text_style.size_px, 84);
});

test('size changes can resolve a caller-provided library preset', () => {
  const catalog = { library: { style: { size_px: 80, stroke: { color: '#123456', width_px: 8 } } } };
  const value = source({ size_px: 80 }, { style_preset: 'library' });
  assert.equal(cue(updateCaptionTextStyleInSource(value, 'c-1', { sizePx: 40 })).text_style.stroke, undefined);
  const changed = cue(updateCaptionTextStyleInSource(value, 'c-1', { sizePx: 40 }, { catalog }));
  assert.deepEqual(changed.text_style.stroke, { color: '#123456', width_px: 4 });
});

test('size changes follow the current effective look, including old data', () => {
  const initial = apply(source({ size_px: 64 }), 'title-impact').source;
  assert.equal(updateCaptionTextStyleInSource(initial, 'c-1', { sizePx: 64 }), initial);
  const enlarged = cue(updateCaptionTextStyleInSource(initial, 'c-1', { sizePx: 96 }));
  assert.deepEqual(enlarged.text_style.stroke, scaledCaptionLook(TEXTSTYLE_CATALOG['title-impact'].style, 96).stroke);
  const natural = cue(updateCaptionTextStyleInSource(initial, 'c-1', { sizePx: 168 }));
  assert.equal(natural.text_style.stroke, undefined);
  const legacy = cue(updateCaptionTextStyleInSource(source({ size_px: 64 },
    { style_preset: 'title-impact' }), 'c-1', { sizePx: 96 }));
  assert.deepEqual(legacy.text_style.stroke, { color: '#000000', width_px: 15 });
  const individual = cue(updateCaptionTextStyleInSource(source({ size_px: 64, stroke: { width_px: 4 } },
    { style_preset: 'title-impact' }), 'c-1', { sizePx: 96 }));
  assert.deepEqual(individual.text_style.stroke, { width_px: 4 });
  const editedCopy = updateCaptionTextStyleInSource(initial, 'c-1', { stroke: { widthPx: 4 } });
  assert.deepEqual(cue(editedCopy).text_style.stroke, { color: '#000000', width_px: 4 });
  assert.deepEqual(cue(updateCaptionTextStyleInSource(editedCopy, 'c-1', { sizePx: 96 })).text_style.stroke,
    { color: '#000000', width_px: 6 });
  const stale = source({ ...cue(initial).text_style, size_px: 80 }, { style_preset: 'title-impact' });
  const staleChanged = cue(updateCaptionTextStyleInSource(stale, 'c-1', { sizePx: 96 }));
  closeParts(staleChanged.text_style.stroke,
    { ...cue(initial).text_style.stroke, width_px: cue(initial).text_style.stroke.width_px * 1.2 });
  assert.ok(captionPresetDerivedParts(TEXTSTYLE_CATALOG['title-impact'].style, staleChanged.text_style).has('stroke'));
});

test('reapply is byte stable when copies agree and repairs old or stale copies', () => {
  const first = apply(source({ size_px: 64 }), 'neon').source;
  assert.deepEqual(apply(first, 'neon'), { source: first, changed: 0 });
  const old = source({ size_px: 64 }, { style_preset: 'neon' });
  assert.equal(apply(old, 'neon').changed, 1);
  const stale = source({ ...cue(first).text_style, size_px: 96 }, { style_preset: 'neon' });
  assert.equal(apply(stale, 'neon').changed, 1);
  assert.deepEqual(cue(apply(stale, 'neon').source).text_style.glow,
    scaledCaptionLook(TEXTSTYLE_CATALOG.neon.style, 96).glow);
  assert.deepEqual(parts(cue(apply(stale, null).source).text_style), {});
});

test('individual stroke width survives a preset without stroke and yields to one with stroke', () => {
  const original = source({ size_px: 64, stroke: { width_px: 4 } });
  const plate = cue(apply(original, 'plate-coral').source);
  assert.deepEqual(plate.text_style.stroke, { width_px: 4 });
  const subtitle = cue(apply(original, 'subtitle-standard').source);
  assert.notDeepEqual(subtitle.text_style.stroke, { width_px: 4 });
  assert.deepEqual(subtitle.text_style.stroke,
    scaledCaptionLook(TEXTSTYLE_CATALOG['subtitle-standard'].style, 64).stroke);
});

test('untimed matching keeps source, overlap, repeated words and line boundaries', () => {
  const words = [{ id: 'e-0001', t_start: 1, t_end: 2, word: '同じ', src: 'a' }];
  assert.deepEqual(captionEmphasisMatches('同じ 同じ', 0, 3, words, 'a').map(x => [x.from, x.to]),
    [[0, 2], [3, 5]]);
  assert.deepEqual(captionEmphasisMatches('同じ', 2, 3, words, 'a'), []);
  assert.deepEqual(captionEmphasisMatches('同じ', 0, 3, words, 'b'), []);
  assert.deepEqual(['別の行', '同じ行'].map(line => captionEmphasisMatches(line, 0, 3, words, 'a').length), [0, 1]);
});

test('marked word visuals use em while legacy words keep their px values', () => {
  const style = TEXTSTYLE_CATALOG['emphasis-red'].style;
  const legacy = resolveCaptionWordStyleVars(style, { width: 1280, height: 720 });
  const marked = resolveCaptionWordStyleVars(style, { width: 1280, height: 720 }, true);
  assert.equal(legacy['--caption-tok-font-size'], '92px');
  assert.equal(legacy['--caption-tok-webkit-text-stroke'], '6px #ffffff');
  assert.equal(marked['--caption-tok-font-size'], undefined);
  assert.equal(marked['--caption-tok-webkit-text-stroke'], '0.065217em #ffffff');
});
