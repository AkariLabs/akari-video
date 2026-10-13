import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { captionRenderInputFromV1, resolveCaptionRunLook,
  applyCaptionRunsToHtml, validateCaptionsSemantics, sliceCaptionRuns,
  planCaptionLookMigration, TEXTSTYLE_CATALOG } from '../lib/index.js';

const line = text => `<div><style></style><p class="akari-caption__line">${text}</p></div>`;
const plate = { color: '#ffd948', opacity: 0.8, padding_px: 8, radius_px: 3 };
const look = { scale: 1.5, stroke: { color: '#ffffff', width_px: 2 },
  shadow: { color: '#000000', distance_px: 4, blur_px: 6, opacity: 0.5 },
  background: plate };

test('run px values use the line reference height and run scale exactly once', () => {
  for (const [reference, expected] of [[1080, 1.5], [1920, 0.84375]]) {
    const resolved = resolveCaptionRunLook(look, { reference_height_px: reference },
      { width: 1920, height: 1080 });
    assert.equal(resolved.style.stroke.width_px, 2 * expected);
    assert.equal(resolved.resolved_look.plate.padding_px, 8 * expected);
    assert.match(resolved.resolved_look.text_shadow,
      new RegExp(`${Number((6 * expected).toFixed(6))}px rgba\\(0,0,0,0.5\\)`));
  }
  const layout = { mode: 'reference-pixel', reference_width_px: 1920,
    reference_height_px: 1080, left_px: 0, width_px: 1920, bottom_px: 0,
    text_align: 'center', max_lines: 1 };
  assert.equal(resolveCaptionRunLook(look, { layout }, { width: 3840, height: 2160 })
    .resolved_look.plate.padding_px, 24);
});

test('document errors are removed before rendering, and resolved values survive slicing', () => {
  const row = { id: 'c', text: 'ABCDE', runs: [
    { id: 'good', from: 0, to: 3, look: { background: plate } },
    { id: 'outside', from: 4, to: 8, look: { background: plate } },
    { id: 'duplicate', from: 1, to: 2, look: { background: plate } },
    { id: 'duplicate', from: 2, to: 3, look: { background: plate } },
    { id: 'spoken', from: 3, to: 4, fire: 'spoken', look: { background: plate } }
  ] };
  const [resolved] = captionRenderInputFromV1({ captions: [row] }).captions;
  assert.deepEqual(resolved.runs.map(run => run.id), ['good']);
  const sliced = sliceCaptionRuns(row.text, resolved.runs, 1, 3);
  assert.deepEqual(sliced[0].resolved_look, resolved.runs[0].resolved_look);
});

test('one plate is drawn per line fragment and the injected renderer is self-contained', () => {
  const runs = captionRenderInputFromV1({ captions: [{ text: 'ABCD', runs: [
    { id: 'one', from: 1, to: 3, look: { background: plate,
      shadow: { color: '#000000', distance_px: 2 } } }
  ] }] }).captions[0].runs;
  const html = applyCaptionRunsToHtml(line('ABCD'), 'ABCD', runs);
  assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1);
  assert.equal((html.match(/class="akari-caption__run-frag"/g) ?? []).length, 1);
  assert.match(html, /class="akari-caption__run"[^>]*text-shadow:[^;"']+/);
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/g, ''), /data-akari-shadow-text=/);
  assert.doesNotMatch(html, /akari-caption__run-plate|aria-hidden="true"/);
  assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), 'ABCD');
  const isolated = runInNewContext(`(${applyCaptionRunsToHtml.toString()})`);
  assert.equal(isolated(line('ABCD'), 'ABCD', runs), html);
  const twoLines = line('AB') + line('CD');
  assert.equal((applyCaptionRunsToHtml(twoLines, 'ABCD', runs)
    .match(/data-akari-plate="true"/g) ?? []).length, 2);
});

test('nested plates retain run order, and whole karaoke token has one plate', () => {
  for (const ranges of [[[0, 4], [1, 3]], [[1, 3], [0, 4]],
    [[0, 3], [0, 4]], [[1, 4], [0, 4]]]) {
    const runs = ranges.map(([from, to], index) => ({ from, to,
      style: { color: '#ffffff' }, resolved_look: { plate: { ...plate } }, id: `r${index}` }));
    const html = applyCaptionRunsToHtml(line('ABCD'), 'ABCD', runs);
    assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 2);
    assert.match(html, /z-index:-1000000/);
    assert.match(html, /z-index:-999999/);
  }
  const runs = [{ from: 1, to: 3, style: { color: '#ffffff' },
    resolved_look: { plate } }];
  const html = applyCaptionRunsToHtml(line('A<span class="akari-caption__tok">BC</span>D'), 'ABCD', runs);
  assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1);
  const crossing = applyCaptionRunsToHtml(line('ABCDE'), 'ABCDE', [
    { from: 0, to: 3, style: { color: '#fff' }, resolved_look: { plate } },
    { from: 2, to: 5, style: { color: '#fff' }, resolved_look: { plate } }
  ]);
  assert.match(crossing, /data-akari-plate-split="true"/);
  assert.equal((crossing.match(/data-akari-plate="true"/g) ?? []).length, 3);
});

test('migration leaves unscaled legacy stroke runs alone and never creates style plus look', () => {
  const original = { default_text_style: { reference_height_px: 1080 }, captions: [
    { id: 'a', text: 'AB', runs: [
      { from: 0, to: 1, style: { stroke: { width_px: 2, color: '#ffffff' } } },
      { from: 1, to: 2, style: { color: '#ff0000' } }
    ] }
  ] };
  const result = planCaptionLookMigration(original, TEXTSTYLE_CATALOG);
  const [legacy, migrated] = result.next.captions[0].runs;
  assert.equal(legacy.style.stroke.width_px, 2);
  assert.equal(legacy.look, undefined);
  assert.equal(migrated.style, undefined);
  assert.equal(migrated.look.color, '#ff0000');
  assert.equal(result.notices.filter(item => item.includes('自動で移せません')).length, 1);
});

test('run shadow inherits line extras and keeps the stroke width', () => {
  const style = { stroke: { color: '#ffffff', width_px: 2 },
    stroke_inner: { color: '#ff0000', width_px: 1 },
    extrude: { color: '#000000', angle_deg: 0, depth_px: 2 },
    shadow: { color: '#000000', distance_px: 3 } };
  const inherited = resolveCaptionRunLook({ glow: {} }, style);
  const explicit = resolveCaptionRunLook({ shadow: { ...style.shadow }, glow: {} }, style);
  assert.equal(inherited.resolved_look.text_shadow, explicit.resolved_look.text_shadow);
  assert.match(inherited.resolved_look.text_shadow, /#ff0000/u);
  const html = applyCaptionRunsToHtml(line('AB'), 'AB', [{ from: 0, to: 2,
    ...inherited }]);
  assert.match(html, /-webkit-text-stroke-color:transparent/u);
  assert.match(html, /data-akari-shadow-text="A"/u);
});

test('GPU path diagnoses word tiles with rich runs and split plates', () => {
  const row = { text: 'ABCD', style: 'reveal',
    words: [{ text: 'AB' }, { text: 'CD' }], runs: [
      { from: 1, to: 3, look: { background: plate } }
    ] };
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row] }, path: 'gpu' });
  assert.ok(diagnostics.some(item => item.code === 'captions.style.unsupported-path'));
  assert.ok(diagnostics.some(item => item.code === 'captions.run.plate-split'));
});

test('GPU path diagnoses emphasis word tiles on the same source and time', () => {
  const caption = { text: 'AB', src: 'main', start: 1, end: 2,
    words: [{ text: 'AB', start: 1, end: 2 }],
    runs: [{ from: 0, to: 2, look: { background: plate } }] };
  const emphasis = { id: 'e-0001', word: 'AB', emotion: 'emphasis',
    src: 'main', t_start: 1.2, t_end: 1.8 };
  const diagnose = item => validateCaptionsSemantics({ captions: { captions: [caption],
    emphasis_words: [item] }, path: 'gpu' }).filter(entry => entry.code === 'captions.style.unsupported-path');
  assert.equal(diagnose(emphasis).length, 1);
  assert.equal(diagnose({ ...emphasis, src: 'other' }).length, 0);
  assert.equal(diagnose({ ...emphasis, t_start: 3, t_end: 4 }).length, 0);
});

test('all token boundaries preserve nesting and visible text', () => {
  const text = 'ABCDEFGHIJ';
  const tokens = [text, 'ABC|DEFG|HIJ', 'AB|CD|EF|GH|IJ'];
  for (const value of tokens) {
    const source = value.split('|').map(word => `<span class="akari-caption__tok">${word}</span>`).join('');
    for (let from = 0; from < text.length; from++) for (let to = from + 1; to <= text.length; to++) {
      const html = applyCaptionRunsToHtml(line(source), text,
        [{ from, to, style: { color: '#ffffff' }, resolved_look: { plate } }]);
      const stack = [];
      for (const match of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/g)) {
        const tag = /^<\/?([a-z]+)/.exec(match[0])[1];
        if (match[0].startsWith('</')) assert.equal(stack.pop(), tag, `${value}: ${from}-${to}`);
        else stack.push(tag);
      }
      assert.deepEqual(stack, [], `${value}: ${from}-${to}`);
      assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), text);
      const boundaries = [0];
      for (const word of value.split('|')) boundaries.push(boundaries[boundaries.length - 1] + word.length);
      const oneToken = boundaries.some((start, i) => i + 1 < boundaries.length
        && start <= from && to <= boundaries[i + 1]);
      const wholeTokens = boundaries.includes(from) && boundaries.includes(to);
      if (oneToken || wholeTokens) assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1,
        `${value}: ${from}-${to}`);
    }
  }
});

test('overlapping runs keep valid nesting at shared and crossing edges', () => {
  const text = 'ABCDEF';
  for (const words of ['ABCDEF', 'AB|CD|EF', 'ABC|DEF']) {
    const source = words.split('|').map(word => `<span class="akari-caption__tok">${word}</span>`).join('');
    for (let a = 0; a < 6; a++) for (let b = a + 1; b <= 6; b++)
      for (let c = 0; c < 6; c++) for (let d = c + 1; d <= 6; d++) {
        const html = applyCaptionRunsToHtml(line(source), text, [[a, b], [c, d]].map(([from, to]) =>
          ({ from, to, style: { color: '#ffffff' }, resolved_look: { plate } })));
        const stack = [];
        for (const match of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/g)) {
          const tag = /^<\/?([a-z]+)/.exec(match[0])[1];
          if (match[0].startsWith('</')) assert.equal(stack.pop(), tag, `${words} ${a}-${b},${c}-${d}`);
          else stack.push(tag);
        }
        assert.deepEqual(stack, [], `${words} ${a}-${b},${c}-${d}`);
        assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), text);
      }
  }
});

test('GPU char wrappers stay outside run decoration with every range', () => {
  const text = 'ABCDEF';
  const wrap = part => [...part].map(char => `<span class="akari-caption__char">${char}</span>`).join('');
  for (const source of [wrap(text), ['AB', 'CD', 'EF'].map(word =>
    `<span class="akari-caption__tok">${wrap(word)}</span>`).join('')]) {
    for (let from = 0; from < 6; from++) for (let to = from + 1; to <= 6; to++) {
      const html = applyCaptionRunsToHtml(line(source), text,
        [{ from, to, style: { color: '#ffffff' }, resolved_look: { plate } }]);
      const stack = [];
      for (const match of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/g)) {
        const tag = /^<\/?([a-z]+)/.exec(match[0])[1];
        if (match[0].startsWith('</')) assert.equal(stack.pop(), tag);
        else stack.push(tag);
      }
      assert.deepEqual(stack, []);
      assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), text);
      assert.doesNotMatch(html, /akari-caption__char[^>]*>\s*<span class="akari-caption__run-frag"/u);
    }
  }
});

test('nine-field look and v0 style keep identical HTML, including scale and rotation', () => {
  const style = { color: '#ff0000', font_weight: 700, italic: true, underline: true,
    letter_spacing_em: 0.05, scale: 1.5, baseline_shift_em: -0.1, rotate_deg: 8,
    stroke: { color: '#ffffff', width_px: 3 } };
  const old = applyCaptionRunsToHtml(line('AB'), 'AB', [{ from: 0, to: 2, style }]);
  const look = { ...style, stroke: { ...style.stroke, width_px: 2 } };
  const runs = captionRenderInputFromV1({ captions: [{ text: 'AB', runs: [
    { id: 'r-0001', from: 0, to: 2, look }
  ] }] }).captions[0].runs;
  assert.equal(applyCaptionRunsToHtml(line('AB'), 'AB', runs), old);
});

test('unused run background geometry produces one warning', () => {
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [{ text: 'A', runs: [
    { id: 'r', from: 0, to: 1, look: { background: { color: '#fff', width_pct: 20,
      height_pct: 30, fit: 'frame', offset_x: 3, offset_y: 4, mode: 'block' } } }
  ] }] } });
  assert.equal(diagnostics.filter(item => item.code === 'captions.run.background-unused').length, 1);
});
