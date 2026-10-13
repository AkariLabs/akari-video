import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';

const edit = { version: 1, output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 's1', path: 'assets/s1.mp4' }],
  cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 24,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' };
const background = { color: '#ffd948', opacity: .98, padding_px: 12, radius_px: 3 };
const shadow = { color: '#000000', opacity: .8, blur_px: 4, distance_px: 4 };
const glow = { color: '#00e5ff', density: 80, spread: 20 };
const lineStyles = [
  { name: 'default', style: undefined, edgeCount: route => route ? 4 : 0 },
  { name: 'stroke and shadow', style: { stroke: { color: '#000000', width_px: 6 }, shadow },
    edgeCount: () => 0 },
  { name: 'stroke, inner stroke, extrusion, and shadow', style: {
    stroke: { color: '#000000', width_px: 6 },
    stroke_inner: { color: '#ff3355', width_px: 2 },
    extrude: { color: '#553300', depth_px: 6, angle_deg: 45 }, shadow },
    edgeCount: () => 22 },
  { name: 'fill, layered stroke, and shadow', style: {
    fill: { type: 'solid', color: '#ffffff' },
    strokes: [{ color: '#000000', width_px: 4 }], shadow }, edgeCount: () => 0 },
  { name: 'stroke and glow', style: { stroke: { color: '#000000', width_px: 4 }, glow },
    edgeCount: () => 0 },
];
const choices = [
  { name: 'glow zero', look: { glow: { color: '#000000', density: 0 } },
    applies: name => name !== 'stroke and glow', expected: (parts, edgeCount) => parts },
  { name: 'shadow zero', look: { shadow: { color: '#000000', opacity: 0 } },
    applies: name => name === 'stroke and glow', expected: parts => parts },
  { name: 'stroke zero', look: { stroke: { width_px: 0 } },
    applies: () => true, expected: (parts, edgeCount) => parts.slice(edgeCount) },
  { name: 'all zero', look: { stroke: { width_px: 0 },
    shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } },
    applies: () => true, expected: () => [] },
];

function splitShadows(value) {
  if (value === 'none') return [];
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++;
    else if (value[index] === ')') depth--;
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function overlayFor(route, style, look, outputTime = false) {
  const captionsRoot = { ...(route ? { display_policy: policy } : {}), captions: [{
    id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬',
    ...(outputTime ? { time_domain: 'output' } : {}),
    ...(style ? { text_style: style } : {}),
    ...(look ? { runs: [{ id: 'r-0001', from: 0, to: 2,
      look: { background, color: '#202020', ...look } }] } : {})
  }] };
  return resolveCaptionPlan({ captionsRoot, edit }).overlays[0];
}

function lineShadow(overlay) {
  if (overlay.vars['--caption-rounded-stroke']
      && /\.akari-caption__line,\.akari-caption__block\{[^}]*text-shadow:var\(--caption-rounded-stroke\)/u.test(overlay.html)) {
    return overlay.vars['--caption-rounded-stroke'];
  }
  return overlay.vars['--caption-text-shadow']
    ?? /text-shadow:\s*var\(--caption-text-shadow,\s*([^;]+)\);/u.exec(overlay.html)?.[1].trim();
}

function runShadow(overlay) {
  const tags = [...overlay.html.matchAll(/<span class="akari-caption__run"[^>]*style="([^"]+)"/gu)];
  assert.ok(tags.length > 0);
  const values = tags.map(tag => /(?:^|;)--akari-run-shadow:([^;]+)/u.exec(tag[1])?.[1]
    ?? /(?:^|;)text-shadow:([^;]+)/u.exec(tag[1])?.[1]);
  assert.ok(values.every(Boolean));
  assert.ok(values.every(value => value === values[0]));
  return values[0];
}

for (const route of [false, true]) for (const { name, style, edgeCount } of lineStyles) {
  test(`${route ? 'display_policy' : 'legacy'} ${name} inherits only the line's shadow components`, () => {
    const line = overlayFor(route, style);
    const source = lineShadow(line);
    assert.ok(source, 'the line exposes a text-shadow value or a CSS fallback');
    const parts = splitShadows(source);
    for (const choice of choices.filter(item => item.applies(name))) {
      const rendered = overlayFor(route, style, choice.look);
      const expected = choice.expected(parts, edgeCount(route)).join(', ');
      assert.deepEqual(splitShadows(runShadow(rendered)), splitShadows(expected || 'none'), choice.name);
      if (choice.name === 'all zero') assert.equal(runShadow(rendered), 'none');
      if (choice.name === 'stroke zero' || choice.name === 'all zero') {
        assert.match(rendered.html, /-webkit-text-stroke:0px currentColor/u);
      }
    }
  });
}

for (const route of [false, true]) test(`${route ? 'display_policy' : 'legacy'} rounded line stroke is inherited only when the line draws it as text-shadow`, () => {
  const style = lineStyles[1].style;
  const line = overlayFor(route, style, undefined, true);
  assert.ok(line.vars['--caption-rounded-stroke']);
  const source = splitShadows(lineShadow(line));
  assert.equal(source.length, 33);
  const glowZero = overlayFor(route, style, choices[0].look, true);
  assert.deepEqual(splitShadows(runShadow(glowZero)), source);
  const strokeZero = overlayFor(route, style, choices[2].look, true);
  assert.deepEqual(splitShadows(runShadow(strokeZero)), source.slice(32));
});

test('legacy rounded stroke without a line shadow has only its actual circle shadows', () => {
  const style = { stroke: { color: '#000000', width_px: 6 } };
  const line = overlayFor(false, style, undefined, true);
  assert.equal(splitShadows(lineShadow(line)).length, 32);
  const glowZero = overlayFor(false, style, choices[0].look, true);
  assert.deepEqual(splitShadows(runShadow(glowZero)), splitShadows(lineShadow(line)));
  assert.equal(runShadow(overlayFor(false, style, choices[2].look, true)), 'none');
});

test('legacy stroke without a line shadow inherits the CSS drop shadow', () => {
  const style = { stroke: { color: '#000000', width_px: 6 } };
  const line = overlayFor(false, style);
  assert.equal(line.vars['--caption-text-shadow'], undefined);
  assert.deepEqual(splitShadows(runShadow(overlayFor(false, style, choices[0].look))),
    splitShadows(lineShadow(line)));
});

test('display_policy line style with no shadow keeps its explicit none value', () => {
  const style = { size_px: 48 };
  const line = overlayFor(true, style);
  assert.equal(line.vars['--caption-text-shadow'], 'none');
  for (const choice of choices) {
    assert.equal(runShadow(overlayFor(true, style, choice.look)), 'none');
  }
});
