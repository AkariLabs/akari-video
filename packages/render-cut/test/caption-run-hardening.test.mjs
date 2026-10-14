import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
import { decorateTypewriterHtml } from '../src/caption-typewriter.mjs';

const output = { width: 1280, height: 720, fps: 30 };
const edit = { version: 1, output, sources: [{ id: 's1', path: 'a.mp4' }],
  cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
const words = [{ text: 'AB', start: 0, end: 1 }, { text: 'CD', start: 1, end: 2 }];
const emphasis_words = [{ id: 'e-0001', src: 's1', word: 'AB', t_start: 0, t_end: 1,
  emotion: 'surprise', style_hint: 'one-char-bang' }];
const row = extra => ({ id: 'c-0001', src: 's1', start: 0, end: 2, text: 'ABCD', ...extra });

test('malformed words, runs, and look values keep the caption renderable', () => {
  const cases = [
    { captions: [row({ words: [null, ...words] })], emphasis_words },
    { captions: [row({ words: ['x', ...words] })], emphasis_words },
    { captions: [row({ words: [{ start: 0, end: 1 }, ...words] })], emphasis_words },
    { captions: [row({ words: { bad: true } })], emphasis_words },
    { captions: [row({ runs: 'x' })] },
    { captions: [row({ runs: [null, 1, 'x', [], { from: 0, to: 2,
      style: { color: '#ff0000' } }] })] },
    { captions: [row({ runs: [{ from: 0, to: 2, look: 'red' }] })] },
    { captions: [row({ runs: [{ from: 0, to: 2, look: null,
      style: { color: '#ff0000' } }] })] },
    { captions: [row({ runs: [{ id: 'r-0001', from: 0, to: 2,
      look: { background: 'yellow', shadow: 'x', glow: 3 } }] })] },
    { captions: [row({ runs: [{ id: 'r-0001', from: 0, to: 2,
      look: { background: { color: '#ffd948', padding_px: null, radius_px: 'x' } } }] })] },
    { captions: [row()], unresolved_runs: [null, 'x', { run: null }, { run: { id: 'r-0001' } }] },
    { captions: [row({ words })], emphasis_words: [null, 'x', { id: 'e-0001' }, ...emphasis_words] },
    { captions: [row({ words })], emphasis_words: { bad: true } },
    { default_text_style: 'x', captions: [row({ runs: [{ id: 'r-0001', from: 0, to: 2,
      look: { background: { color: '#ffd948' } } }] })] },
  ];
  for (const [index, captionsRoot] of cases.entries()) {
    const result = resolveCaptionPlan({ captionsRoot, edit, output, extraProtectedTerms: [] });
    assert.ok(result.overlays.length > 0, `case ${index}`);
    assert.match(result.overlays[0].html, /akari-caption__line/u, `case ${index}`);
  }
});

test('hostile effect and resolved values cannot add attributes to either render route', () => {
  const hostile = '#fff" onanimationstart="alert(1)" x="';
  const cases = [
    { background: { color: hostile, padding_px: 4 } },
    { shadow: { color: hostile, opacity: 1, blur_px: 2, distance_px: 2 } },
    { glow: { color: hostile, density: 80, spread: 10 } },
    { shadow: { color: '#000000', blur_px: '2px" onclick="alert(1)' } },
  ];
  for (const policy of [false, true]) for (const look of cases) {
    const captionsRoot = { ...(policy ? { display_policy: { mode: 'single_line_sequential',
      algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1',
      max_line_units: 20, minimum_fragment_duration_seconds: .72,
      locale: 'ja', lines: 1, wrap: 'multi' } } : {}), captions: [row({ runs: [
      { id: 'r-0001', from: 0, to: 2, look }
    ] })] };
    const html = resolveCaptionPlan({ captionsRoot, edit, output, extraProtectedTerms: [] })
      .overlays.map(item => item.html).join('');
    assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/gu, ''),
      /onclick|onanimationstart|position:fixed|url\(/u);
  }
});

test('typewriter delays the plate until its first character appears', () => {
  const html = '<style></style><p class="akari-caption__line">A'
    + '<span class="akari-caption__run-frag" data-akari-plate="true" style="display:inline;background:#ffd948">BC</span>D</p>';
  const rendered = decorateTypewriterHtml(html, { in: { id: 'typewriter', duration_sec: 1 } }, 2);
  assert.match(rendered, /run-frag"[^>]*animation:akari-run-plate-in \.01s 0\.500000s/u);
  assert.match(rendered, /--akari-run-plate-color:#ffd948/u);
  assert.match(rendered, /@keyframes akari-run-plate-in\{from\{background-color:transparent;background-image:none\}to\{background-color:var\(--akari-run-plate-color\)\}\}/u);
  assert.doesNotMatch(rendered, /visibility/u);
  assert.equal((rendered.match(/akari-typewriter-char-in \.01s/gu) ?? []).length, 4);
});

test('typewriter hides a covering plate image until the fragment appears', () => {
  const html = '<style></style><p class="akari-caption__line">'
    + '<span class="akari-caption__run-frag" data-akari-plate="true"'
    + ' style="display:inline;background:rgba(255,0,0,1);background-image:linear-gradient(rgba(255,255,0,1),rgba(255,255,0,1))">AB</span></p>';
  const rendered = decorateTypewriterHtml(html, { in: { id: 'typewriter' } }, 2);
  assert.match(rendered, /background-image:linear-gradient\(rgba\(255,255,0,1\),rgba\(255,255,0,1\)\)/u);
  assert.match(rendered, /--akari-run-plate-color:rgba\(255,0,0,1\)/u);
  assert.match(rendered, /from\{background-color:transparent;background-image:none\}to\{/u);
});

test('typewriter without a plate keeps the original HTML bytes', () => {
  const animation = { in: { id: 'typewriter', duration_sec: 1 } };
  const css = '.akari-caption__type-char{display:inline}'
    + '@keyframes akari-typewriter-char-in{from{opacity:0}to{opacity:1}}'
    + '@keyframes akari-typewriter-char-out{from{opacity:1}to{opacity:0}}';
  for (const [content, expectedContent] of [
    ['AB', '<span class="akari-caption__type-char" style="animation:akari-typewriter-char-in .01s 0.500000s linear both paused">A</span>'
      + '<span class="akari-caption__type-char" style="animation:akari-typewriter-char-in .01s 1.000000s linear both paused">B</span>'],
    ['<span class="akari-caption__run" style="color:#ff0000">A</span>B',
      '<span class="akari-caption__run" style="color:#ff0000"><span class="akari-caption__type-char" style="animation:akari-typewriter-char-in .01s 0.500000s linear both paused">A</span></span>'
      + '<span class="akari-caption__type-char" style="animation:akari-typewriter-char-in .01s 1.000000s linear both paused">B</span>']
  ]) {
    const html = `<style></style><p class="akari-caption__line">${content}</p>`;
    assert.equal(decorateTypewriterHtml(html, animation, 2),
      `<style>${css}</style><p class="akari-caption__line">${expectedContent}</p>`);
  }
  const shadowOnly = '<style></style><p class="akari-caption__line">'
    + '<span class="akari-caption__run-frag" style="display:inline">AB</span></p>';
  assert.doesNotMatch(decorateTypewriterHtml(shadowOnly, animation, 2), /akari-run-plate-in/u);
});

test('typewriter keeps run shadow copies hidden until their character step', () => {
  const html = '<style></style><p class="akari-caption__line">A'
    + '<span class="akari-caption__run" data-akari-shadow-text="B" data-akari-shadow-flow="true"'
    + ' style="text-shadow:none;--akari-run-shadow:0 0 2px #fff">'
    + '<span class="akari-caption__run-ink" style="position:relative">B</span></span>C</p>';
  const rendered = decorateTypewriterHtml(html, {
    in: { id: 'typewriter', duration_sec: 1 }, out: { id: 'typewriter', duration_sec: .5 },
  }, 2);
  assert.match(rendered, /data-akari-shadow-step="both"/u);
  assert.match(rendered, /--akari-shadow-in-delay:0\.666667s/u);
  assert.match(rendered, /--akari-shadow-out-delay:1\.666667s/u);
  assert.match(rendered, /akari-shadow-out/u);
  assert.equal((rendered.match(/class="akari-caption__type-char"/gu) ?? []).length, 6);
});
