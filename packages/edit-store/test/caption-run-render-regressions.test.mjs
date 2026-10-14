import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyCaptionRunsToHtml, captionRenderInputFromV1, planCaptionLookMigration,
  resolveCaptionRunLook, validateCaptionsSemantics, TEXTSTYLE_CATALOG,
  captionRichTextShadowValue, captionTextShadowValue } from '../lib/index.js';
import { renderCaptionFragment, renderResolvedSingleLineCaption } from '../../render-cut/src/captions.mjs';

const frame = content => `<div class="akari-caption"><style></style><div class="akari-caption__plate"><p class="akari-caption__line">${content}</p></div></div>`;
const background = { color: '#ffd948', opacity: .98, padding_px: 12, radius_px: 3 };
const rich = { background, color: '#202020' };
const render = (text, runs, content = text) => applyCaptionRunsToHtml(frame(content), text, runs);
const renderRoute = (policy, text, runs) => applyCaptionRunsToHtml(
  frame(text).replace('class="akari-caption"',
    `class="akari-caption${policy ? ' akari-caption--single-line' : ''}"`), text, runs);
const plain = html => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, '');
const characterTags = html => [...html.matchAll(/<span class="akari-caption__run"([^>]*)>/gu)]
  .map(match => match[1]);
const balanced = html => {
  const stack = [];
  for (const [tag] of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/gu)) {
    const name = /^<\/?([a-z]+)/u.exec(tag)[1];
    if (tag.startsWith('</')) assert.equal(stack.pop(), name);
    else stack.push(name);
  }
  assert.deepEqual(stack, []);
};

test('inline plate uses cloned padding without changing spaces or adding visible text', () => {
  const text = 'This is a label test';
  const runs = captionRenderInputFromV1({ captions: [{ text, runs: [
    { id: 'r-0001', from: 9, to: 16, look: rich }
  ] }] }).captions[0].runs;
  const html = render(text, runs);
  assert.match(html, /display:inline;line-height:1;background:rgba\(/u);
  assert.match(html, /padding:12px;margin:-12px;-webkit-box-decoration-break:clone;box-decoration-break:clone;pointer-events:none/u);
  assert.doesNotMatch(html, /z-index:/u);
  assert.match(html, /white-space:pre/u);
  assert.match(html, /data-akari-flow-plain-line="true"/u);
  assert.doesNotMatch(html, /run-frag\[data-akari-plate\]::before/u);
  assert.equal(plain(html), text);
});

test('emphasis character wrappers retain valid nesting over every selected range', () => {
  const text = 'ABCDEFGHIJ';
  const wrappers = [...text].map((char, index) =>
    `<span class="akari-caption__emphasis-char" data-step="${index}">${char}</span>`).join('');
  for (let from = 0; from < text.length; from++) for (let to = from + 1; to <= text.length; to++) {
    const html = render(text, [{ from, to, style: { color: '#202020' },
      resolved_look: { plate: background } }], `<span class="akari-caption__tok">${wrappers}</span>`);
    balanced(html);
    assert.equal(plain(html), text);
    assert.equal((html.match(/class="akari-caption__emphasis-char"/gu) ?? []).length, text.length);
    assert.equal((html.match(/data-step="\d+"/gu) ?? []).length, text.length);
  }
});

test('nested word, character, and emphasis spans remain balanced in 1440 combinations', () => {
  const text = 'ABCDEFGHIJ';
  const ranges = [[0, 10], [0, 3], [2, 5], [4, 9], [5, 6], [6, 10], [1, 8], [8, 10]];
  const partitions = [[10], [5, 5], [3, 4, 3], [2, 2, 2, 2, 2], [1, 2, 3, 4]];
  let checked = 0;
  for (const [from, to] of ranges) for (const lengths of partitions)
    for (let wrapper = 0; wrapper < 6; wrapper++) for (const effect of [0, 1])
      for (const overlap of [0, 1, 2]) {
        let cursor = 0;
        const content = lengths.map(length => {
          const part = [...text.slice(cursor, cursor + length)].map((char, local) => {
            const index = cursor + local;
            const emphasis = wrapper === 1 || wrapper === 4 || wrapper === 5 && index < 6;
            const measured = wrapper === 2 || wrapper === 3 || wrapper === 4 || wrapper === 5;
            let value = char;
            if (measured) value = `<span class="akari-caption__char" data-c="${index}">${value}</span>`;
            if (emphasis) value = `<span class="akari-caption__emphasis-char" data-e="${index}">${value}</span>`;
            return value;
          }).join('');
          cursor += length;
          return `<span class="akari-caption__tok">${part}</span>`;
        }).join('');
        const decoration = effect ? { text_shadow: '0px 0px 2px #000000' }
          : { plate: background };
        const runs = [{ from, to, style: { color: '#202020' }, resolved_look: decoration }];
        if (overlap) runs.push({ from: overlap === 1 ? from : Math.max(0, from - 1),
          to: overlap === 1 ? Math.max(from + 1, to - 1) : Math.min(10, to + 1),
          style: { color: '#202020' }, resolved_look: decoration });
        const html = render(text, runs, content);
        balanced(html);
        assert.equal(plain(html), text);
        assert.equal((html.match(/data-e="\d+"/gu) ?? []).length,
          (content.match(/data-e="\d+"/gu) ?? []).length);
        assert.equal((html.match(/data-c="\d+"/gu) ?? []).length,
          (content.match(/data-c="\d+"/gu) ?? []).length);
        checked++;
      }
  assert.equal(checked, 1440);
});

test('layout output scale applies to plate, stroke, and shadow', () => {
  const layout = { mode: 'reference-pixel', reference_width_px: 1920,
    reference_height_px: 1080, left_px: 160, width_px: 1600, bottom_px: 120,
    text_align: 'center', max_lines: 1 };
  const look = { background, stroke: { color: '#000000', width_px: 6 },
    shadow: { color: '#000000', opacity: 1, blur_px: 6, distance_px: 0 } };
  for (const [height, factor] of [[1080, 1], [720, 2 / 3], [2160, 2]]) {
    const input = captionRenderInputFromV1({ captions: [{ text: 'AB', text_style: { size_px: 64, layout },
      runs: [{ id: 'r-0001', from: 0, to: 2, look }] }] },
    { output: { width: height * 16 / 9, height } });
    const resolved = input.captions[0].runs[0];
    assert.ok(Math.abs(resolved.resolved_look.plate.padding_px - 12 * factor) < 1e-5);
    assert.ok(Math.abs(resolved.style.stroke.width_px - 6 * factor) < 1e-5);
    assert.match(resolved.resolved_look.text_shadow, new RegExp(`${Number((6 * factor).toFixed(6))}px`));
  }
  const old = { captions: [{ text: 'AB', text_style: { layout }, runs: [
    { from: 0, to: 2, style: { stroke: { color: '#000000', width_px: 6 } } }
  ] }] };
  const first = planCaptionLookMigration(old, TEXTSTYLE_CATALOG);
  assert.equal(first.next.captions[0].runs[0].look, undefined);
  assert.deepEqual(planCaptionLookMigration(first.next, TEXTSTYLE_CATALOG).diff, []);
});

test('explicit zero components replace inherited effects while glow alone keeps them', () => {
  const style = { stroke_inner: { color: '#ff0000', width_px: 2 },
    extrude: { color: '#000000', depth_px: 3, angle_deg: 45 },
    shadow: { color: '#000000', opacity: .8, blur_px: 4, distance_px: 4 },
    glow: { color: '#00e5ff', density: 80, spread: 20 } };
  const zero = resolveCaptionRunLook({ ...rich, stroke: { width_px: 0 },
    shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } }, style);
  assert.equal(zero.resolved_look.text_shadow, 'none');
  assert.equal(zero.resolved_look.ink_outset_px, 12);
  const html = render('AB', [{ from: 0, to: 2, ...zero }]);
  assert.match(html, /data-akari-no-stroke="true"/u);
  assert.match(html, /data-akari-no-shadow="true"/u);
  assert.match(html, /-webkit-text-stroke:0px currentColor/u);
  const glow = resolveCaptionRunLook({ glow: { color: '#00e5ff', density: 80, spread: 10 } }, {});
  assert.match(glow.resolved_look.text_shadow, /rgba\(0,0,0,.35\)/u);
});

test('run effects replace only declared components on both caption routes', () => {
  const fallback = html => /text-shadow:\s*var\(--caption-text-shadow,([^;]+)\);/u.exec(html)[1].trim();
  const legacyCss = renderCaptionFragment('AB');
  const policyCss = renderResolvedSingleLineCaption('AB', ['AB'],
    { text_style: {}, style_vars: {} });
  const legacyShadow = fallback(legacyCss);
  const policyShadow = fallback(policyCss);
  const [policyOutline, policyDrop] = [policyShadow.slice(0, policyShadow.lastIndexOf(',0 0 8px')),
    policyShadow.slice(policyShadow.lastIndexOf(',0 0 8px') + 1)];
  assert.match(legacyCss, /-webkit-text-stroke:\s*var\(--caption-stroke, 0\.14em rgba\(0,0,0,\.9\)\)/u);
  assert.match(policyCss, /-webkit-text-stroke:var\(--caption-webkit-text-stroke,0 transparent\)/u);
  const shadow = { color: '#000000', opacity: .8, blur_px: 4, distance_px: 4 };
  const glow = { color: '#00e5ff', density: 80, spread: 20 };
  const lineStyles = [
    { name: 'default', style: {} },
    { name: 'stroke-shadow', style: { stroke: { color: '#000000', width_px: 6 }, shadow } },
    { name: 'inner-extrude', style: { stroke_inner: { color: '#ff3355', width_px: 2 },
      extrude: { color: '#553300', depth_px: 4, angle_deg: 45 } } },
    { name: 'layers', style: { fill: { type: 'solid', color: '#ffffff' },
      strokes: [{ color: '#000000', width_px: 4 }] } },
    { name: 'glow', style: { glow } },
  ];
  const zero = { color: '#000000', opacity: 0 };
  const choices = [
    { name: 'plate', look: {}, stroke: false, shadow: false, glow: false },
    { name: 'glow0', look: { glow: { color: '#000000', density: 0 } },
      stroke: false, shadow: false, glow: true },
    { name: 'shadow0', look: { shadow: zero }, stroke: false, shadow: true, glow: false },
    { name: 'stroke0', look: { stroke: { width_px: 0 } },
      stroke: true, shadow: false, glow: false },
    { name: 'all0', look: { stroke: { width_px: 0 }, shadow: zero,
      glow: { color: '#000000', density: 0 } }, stroke: true, shadow: true, glow: true }
  ];
  for (const policy of [false, true]) for (const { name, style } of lineStyles) {
    const defaultLine = name === 'default';
    const outline = defaultLine ? policy ? policyOutline : null
      : name === 'inner-extrude' ? captionRichTextShadowValue(style, 1) : null;
    const drop = defaultLine ? policy ? policyDrop : legacyShadow
      : style.shadow ? captionTextShadowValue(style.shadow, undefined)
        : !policy && !captionRichTextShadowValue(style, 1) ? legacyShadow : null;
    const halo = style.glow ? captionTextShadowValue(undefined, style.glow) : null;
    for (const choice of choices) {
      const resolved = resolveCaptionRunLook({ ...rich, ...choice.look }, style,
        undefined, undefined, policy);
      const expected = [choice.stroke ? null : outline, choice.shadow ? null : drop,
        choice.glow ? null : halo].filter(Boolean).join(', ') || 'none';
      assert.equal(resolved.resolved_look.text_shadow,
        choice.name === 'plate' ? undefined : expected, `${policy} ${name} ${choice.name}`);
      const body = renderRoute(policy, 'AB', [{ from: 0, to: 2, ...resolved }])
        .replace(/<style>[\s\S]*?<\/style>/u, '');
      assert.equal(body.includes('data-akari-no-stroke="true"'), choice.stroke,
        `${policy} ${name} ${choice.name} stroke`);
      assert.equal(body.includes('data-akari-no-shadow="true"'), choice.shadow,
        `${policy} ${name} ${choice.name} shadow`);
      assert.equal(body.includes('-webkit-text-stroke:0px currentColor'), choice.stroke,
        `${policy} ${name} ${choice.name} stroke declaration`);
      const tags = characterTags(body);
      assert.equal(tags.length, 2, `${policy} ${name} ${choice.name} characters`);
      for (const tag of tags) {
        assert.equal(tag.includes('data-akari-shadow-text'), choice.name !== 'plate',
          `${policy} ${name} ${choice.name} shadow copy`);
        assert.equal(tag.includes('text-shadow:none'), choice.name !== 'plate',
          `${policy} ${name} ${choice.name} shadow declaration`);
        assert.equal(tag.includes('--akari-run-shadow:'), choice.name !== 'plate',
          `${policy} ${name} ${choice.name} shadow variable`);
      }
    }
  }
  const webview = readFileSync(new URL('../../../apps/shell/extensions/akari-preview/src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
  const contract = JSON.parse(readFileSync(new URL('../src/caption-visual-contract.json', import.meta.url), 'utf8'));
  assert.ok(webview.includes(`text-shadow:var(--caption-text-shadow,${legacyShadow})`));
  assert.ok(webview.includes('JSON.stringify(RESOLVED_SINGLE_LINE_CAPTION_CSS)'));
  assert.equal(fallback(contract.resolved_single_line_caption_css), policyShadow);
});

test('plate effects draw on characters while plate-free effects retain the shadow copy', () => {
  const glowZero = { glow: { color: '#000000', density: 0 } };
  const shadowZero = { shadow: { color: '#000000', opacity: 0 } };
  const strokeZero = { stroke: { width_px: 0 } };
  for (const policy of [false, true]) {
    for (const look of [glowZero, shadowZero, strokeZero,
      { ...glowZero, ...shadowZero, ...strokeZero }]) {
      const run = resolveCaptionRunLook({ ...rich, ...look }, {},
        undefined, undefined, policy);
      const tags = characterTags(renderRoute(policy, 'AB', [{ from: 0, to: 2, ...run }]));
      assert.equal(tags.length, 2);
      for (const tag of tags) {
        assert.ok(tag.includes('text-shadow:none'));
        assert.ok(tag.includes('data-akari-shadow-text'));
        assert.ok(tag.includes(`--akari-run-shadow:${run.resolved_look.text_shadow}`));
      }
    }
  }
  const glow = resolveCaptionRunLook({ glow: { color: '#00e5ff', density: 80 } }, {});
  const tags = characterTags(render('AB', [{ from: 0, to: 2, ...glow }]));
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.ok(tag.includes('data-akari-shadow-text='));
    assert.ok(tag.includes(`--akari-run-shadow:${glow.resolved_look.text_shadow}`));
    assert.ok(tag.includes('text-shadow:none'));
  }
});

test('a surrounding plate keeps nested shadow effects above its background', () => {
  const plateRun = resolveCaptionRunLook({ background }, {});
  const glow = resolveCaptionRunLook({ glow: { color: '#00e5ff', density: 80 } }, {});
  const html = render('ABC', [
    { from: 0, to: 3, ...plateRun },
    { from: 1, to: 2, ...glow }
  ]);
  const tags = characterTags(html);
  assert.equal(tags.length, 3);
  assert.ok(tags[1].includes('text-shadow:none'));
  assert.ok(tags[1].includes('data-akari-shadow-text'));
  assert.ok(tags[1].includes(`--akari-run-shadow:${glow.resolved_look.text_shadow}`));
});

test('transparent plate leaves the run shadow copy and ink extent identical', () => {
  const effect = { color: '#ffffff', shadow: { color: '#ff0033', opacity: 1,
    blur_px: 3, distance_px: 7, angle_deg: 45 } };
  const bare = resolveCaptionRunLook(effect, {});
  const plated = resolveCaptionRunLook({ ...effect,
    background: { ...background, opacity: 0 } }, {});
  const html = value => render('AB', [{ from: 0, to: 2, ...value }]);
  const stripPlate = value => value
    .replace(/ data-akari-plate="true" data-akari-plate-pad="[^"]+"/gu, '')
    .replace(/;background:rgba\([^)]*\);border-radius:[^;]+;padding:[^;]+;margin:[^;]+;-webkit-box-decoration-break:clone;box-decoration-break:clone;pointer-events:none/gu, '');
  assert.equal(stripPlate(html(plated)), html(bare));
  assert.match(html(plated), /data-akari-shadow-flow="true"/u);
  assert.match(html(bare), /class="akari-caption__run-ink"/u);
});

test('untrusted resolved declarations cannot enter attributes or CSS declarations', () => {
  const evil = 'red;position:fixed;background:url(https://example.invalid/x)';
  const direct = render('AB', [{ from: 0, to: 2, style: { color: '#ff0000' },
    resolved_look: { plate: { color: evil, opacity: 1, padding_px: '4" onclick="x', radius_px: 0 },
      text_shadow: '0 0 0 red" onanimationstart="x' } }]);
  assert.doesNotMatch(direct, /onclick|onanimationstart|position:fixed|url\(/u);
  const input = captionRenderInputFromV1({ captions: [{ text: 'AB', runs: [{ from: 0, to: 2,
    style: { color: '#ff0000' }, resolved_look: { text_shadow: evil } }] }] });
  assert.equal(input.captions[0].runs[0].resolved_look, undefined);
  for (const field of ['background', 'shadow', 'glow']) {
    const look = field === 'background' ? { background: { color: evil } }
      : { [field]: { color: evil, blur_px: '2" onclick="x' } };
    const resolved = captionRenderInputFromV1({ captions: [{ text: 'AB', runs: [
      { id: 'r-0001', from: 0, to: 2, look }
    ] }] }).captions[0].runs;
    assert.doesNotMatch(render('AB', resolved), /onclick|onanimationstart|position:fixed|url\(/u);
  }
});

test('semantic validation tolerates malformed word and run entries', () => {
  const emphasis_words = [{ id: 'e-0001', word: 'AB', emotion: 'joy', t_start: 0, t_end: 1 }];
  for (const words of [[null, { text: 'AB' }], ['x'], [{ start: 0, end: 1 }], { a: 1 }]) {
    const root = { captions: [{ text: 'AB', start: 0, end: 1, words,
      runs: [null, 'x', { from: 0, to: 2, look: { background } }] }], emphasis_words };
    assert.doesNotThrow(() => validateCaptionsSemantics({ captions: root }));
    assert.doesNotThrow(() => captionRenderInputFromV1(root));
  }
});

test('wrapping rotation is diagnosed and gradient uses the parent stacking root', () => {
  const row = { text: 'ABCD', text_style: { wrap_width_pct: 30,
    fill_gradient: { colors: ['#ffee00', '#ff5500'], angle_deg: 90 } }, runs: [
    { id: 'r-0001', from: 0, to: 4, look: { ...rich, rotate_deg: 8 } }
  ] };
  const input = captionRenderInputFromV1({ captions: [row] });
  const html = render('ABCD', input.captions[0].runs);
  assert.match(html, /data-akari-gradient-run="true"/u);
  assert.match(html, /\.akari-caption__plate:has\(\.akari-caption__line\[data-akari-gradient-run\]\)\{isolation:isolate\}/u);
  assert.doesNotMatch(html, /transform:rotate\(8deg\)/u);
  assert.equal(validateCaptionsSemantics({ captions: { captions: [row] } })
    .filter(item => item.code === 'captions.run.rotation-wrap').length, 1);
});

test('a plate crossing part of an emphasis span receives one split warning', () => {
  const root = { captions: [{ id: 'c-0001', text: 'ABCD', src: 's1', start: 0, end: 2,
    runs: [{ id: 'r-0001', from: 0, to: 2, look: { background } }] }],
  emphasis_words: [{ id: 'e-0001', src: 's1', word: 'BC', t_start: .5,
    t_end: 1.5, emotion: 'surprise' }] };
  const diagnostics = validateCaptionsSemantics({ captions: root });
  assert.equal(diagnostics.filter(item => item.code === 'captions.run.plate-split').length, 1);
});

test('gradient run color and line filter each produce one warning', () => {
  const row = { text: 'AB', text_style: { fill_gradient: {
    colors: ['#ffee00', '#ff5500'], angle_deg: 90 },
  stroke: { color: '#000000', width_px: 2 } }, runs: [
    { id: 'r-0001', from: 0, to: 2, look: { color: '#202020', background } }
  ] };
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row] } });
  for (const code of ['captions.run.gradient-color', 'captions.run.gradient-filter']) {
    assert.equal(diagnostics.filter(item => item.code === code && item.severity === 'warning').length, 1);
  }
});
