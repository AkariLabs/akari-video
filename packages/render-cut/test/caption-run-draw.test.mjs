import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
const require = createRequire(import.meta.url);
const { planCaptionLookMigration, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');

const edit = { version: 1, output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 's1', path: 'assets/s1.mp4' }],
  cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 24,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' };
const background = { color: '#ffd948', opacity: 0.9, padding_px: 6, radius_px: 2 };

for (const resolved of [false, true]) test(`${resolved ? 'display_policy' : 'legacy'} render uses resolved run plates and filters document errors`, () => {
  const row = { id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬鳥',
    text_style: { size_px: 38, reference_height_px: 1080 }, runs: [
      { id: 'good', from: 1, to: 2, look: { background,
        shadow: { color: '#000000', distance_px: 3 },
        glow: { color: '#00e5ff', density: 80, spread: 5 } } },
      { id: 'outside', from: 2, to: 8, look: { background } },
      { id: 'repeat', from: 0, to: 1, look: { background } },
      { id: 'repeat', from: 2, to: 3, look: { background } },
      { id: 'spoken', from: 0, to: 1, fire: 'spoken', look: { background } }
    ] };
  const captionsRoot = { ...(resolved ? { display_policy: policy } : {}), captions: [row] };
  const plan = resolveCaptionPlan({ captionsRoot, edit });
  const html = plan.overlays.map(overlay => overlay.html).join('');
  assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1);
  assert.match(html, /class="akari-caption__run"[^>]*text-shadow:[^;"']+/);
  assert.match(html, /data-akari-shadow-text="犬"/);
  assert.match(html, /akari-caption__run-ink/);
  assert.doesNotMatch(html, /z-index:/);
  assert.equal(plan.captions[0].runs.length, 1);
});

for (const resolved of [false, true]) for (const decoration of ['underline', 'strikethrough']) {
  test(`${resolved ? 'display_policy' : 'legacy'} ${decoration} leaves v0 line HTML unchanged`, () => {
    const source = style => ({ ...(resolved ? { display_policy: policy } : {}), captions: [{
      id: 'c-0001', src: 's1', start: 0, end: 2, text: '今日は黄色のラベルを試します',
      text_style: { [decoration]: true }, runs: [{ from: 6, to: 9, style }],
    }] });
    const html = style => resolveCaptionPlan({ captionsRoot: source(style), edit }).overlays[0].html;
    const withoutRun = resolveCaptionPlan({ captionsRoot: { ...(resolved ? { display_policy: policy } : {}),
      captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2,
        text: '今日は黄色のラベルを試します', text_style: { [decoration]: true } }] }, edit }).overlays[0];
    assert.equal(html({ color: '#ff3355' }), withoutRun.html);
    assert.doesNotMatch(html({ scale: 1.5, color: '#ff3355' }), /class="akari-caption__run"/u);
    assert.match(html({ color: '#ff3355' }), /data-decoration-text=/u);
    const v1 = look => resolveCaptionPlan({ captionsRoot: {
      ...(resolved ? { display_policy: policy } : {}), captions: [{
        id: 'c-0001', src: 's1', start: 0, end: 2, text: '今日は黄色のラベルを試します',
        text_style: { [decoration]: true }, runs: [{ from: 6, to: 9, look }],
      }],
    }, edit }).overlays[0].html;
    const stroke = { color: '#ffffff', width_px: 3 };
    assert.match(v1({ scale: 1.5, stroke }), /class="akari-caption__run"/u);
    assert.doesNotMatch(v1({ scale: 1.5, stroke }), /font-size:1\.5em/u);
  });
}

for (const resolved of [false, true]) test(`${resolved ? 'display_policy' : 'legacy'} gradient outline omits run effects`, () => {
  const source = look => ({ ...(resolved ? { display_policy: policy } : {}), captions: [{
    id: 'c-0001', src: 's1', start: 0, end: 2, text: 'ABCDE',
    text_style: { fill_gradient: { colors: ['#ffee00', '#ff2200'], angle_deg: 90 },
      stroke: { color: '#000000', width_px: 4 } },
    runs: [{ from: 1, to: 3, look }],
  }] });
  const html = look => resolveCaptionPlan({ captionsRoot: source(look), edit }).overlays[0].html;
  assert.equal(html({ color: '#ff3355', background,
    shadow: { color: '#000000', distance_px: 3 },
    glow: { color: '#00e5ff', density: 80 } }), html({ color: '#ff3355' }));
});

test('migration preserves legacy stroke pixels on a reference-height line', () => {
  const root = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬',
    text_style: { reference_height_px: 1920 },
    runs: [{ from: 0, to: 1, style: { scale: 1.5,
      stroke: { color: '#ffffff', width_px: 6 } } }] }] };
  const before = resolveCaptionPlan({ captionsRoot: root, edit }).overlays[0].html;
  const migrated = planCaptionLookMigration(root, TEXTSTYLE_CATALOG).next;
  const after = resolveCaptionPlan({ captionsRoot: migrated, edit }).overlays[0].html;
  assert.equal(after, before);
  assert.equal(migrated.captions[0].runs[0].style.stroke.width_px, 6);
});

test('rich line layers leave one run plate outside their text copies', () => {
  const captionsRoot = { captions: [{ id: 'c-rich', src: 's1', start: 0, end: 2,
    text: '猫犬鳥', text_style: { fill: { type: 'solid', color: '#ffffff' },
      strokes: [{ color: '#000000', width_px: 2 }] },
    runs: [{ id: 'r-0001', from: 1, to: 2, look: { background } }] }] };
  const [overlay] = resolveCaptionPlan({ captionsRoot, edit }).overlays;
  assert.equal((overlay.html.match(/data-akari-plate="true"/g) ?? []).length, 1);
  assert.match(overlay.html, /akari-caption__rich-segment/);
  assert.match(overlay.html, /z-index:-1000000/);
  assert.doesNotMatch(overlay.html, /data-akari-run-flow/);
  assert.doesNotMatch(overlay.html, /akari-caption__rich-shadow[^>]*>\s*<span class="akari-caption__run-frag"[^>]*data-akari-plate/);
});

test('decorated scaled v0 runs retain the ink-sized box and margin variables', () => {
  const base = { id: 'c-0001', src: 's1', start: 0, end: 2,
    text: '今日は黄色のラベルを試します', runs: [{ from: 3, to: 6,
      style: { scale: 1.5 } }] };
  for (const policyMode of [false, true]) for (const extra of [
    { zone: 'top-left' }, { max_width_pct: 50 },
    { background: { color: '#000000', mode: 'block' } },
    { text_anchor: 'bl' },
  ]) {
    const render = underline => resolveCaptionPlan({ captionsRoot: {
      ...(policyMode ? { display_policy: policy } : {}),
      captions: [{ ...base, text_style: { ...extra, ...(underline ? { underline: true } : {}) } }],
    }, edit }).overlays[0];
    const plain = render(false); const decorated = render(true);
    assert.equal(decorated.vars['--caption-plate-margin'], plain.vars['--caption-plate-margin']);
    assert.doesNotMatch(decorated.html, /class="akari-caption__run"/u);
    assert.match(decorated.html, policyMode ? /width:var\(--caption-width,max-content\)/u
      : /max-width: var\(--caption-line-max-width, none\)/u);
    const v1 = resolveCaptionPlan({ captionsRoot: {
      ...(policyMode ? { display_policy: policy } : {}),
      captions: [{ ...base, text_style: { ...extra, underline: true },
        runs: [{ id: 'r-0001', from: 3, to: 6, look: { scale: 1.5 } }] }],
    }, edit }).overlays[0];
    assert.equal(v1.vars['--caption-plate-margin'], plain.vars['--caption-plate-margin']);
    assert.match(v1.html, policyMode ? /width:var\(--caption-width,max-content\)/u
      : /max-width: var\(--caption-line-max-width, none\)/u);
  }
});

test('manual line breaks target v1 plates and text effects in both render paths', () => {
  const text = '今日は黄色の\nラベルを試します';
  const make = (policyMode, runs, textStyle = {}) => resolveCaptionPlan({ captionsRoot: {
    ...(policyMode ? { display_policy: policy } : {}),
    captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2,
      text, text_style: textStyle, runs }],
  }, edit }).overlays[0].html;
  const v1 = { id: 'r-0001', from: 7, to: 10, look: { background,
    color: '#ffd948', stroke: { width_px: 0 },
    shadow: { color: '#000000', opacity: 0 },
    glow: { color: '#000000', density: 0 } } };
  for (const policyMode of [false, true]) {
    const html = make(policyMode, [v1]);
    const fragment = html.match(/data-akari-plate="true"[^>]*>([\s\S]*?)<span class="akari-caption__run-lift"/u)?.[1]
      ?? html.slice(html.indexOf('data-akari-plate="true"'));
    assert.deepEqual([...fragment.matchAll(/data-akari-shadow-text="([^"]+)"/gu)]
      .slice(0, 3).map(match => match[1]), ['ラ', 'ベ', 'ル']);
    assert.match(fragment, /color:#ffd948/u);
    assert.match(html, /data-akari-no-stroke="true"/u);
    assert.match(html, /data-akari-no-shadow="true"/u);
    assert.equal((html.match(/data-akari-plate="true"/gu) ?? []).length, 1);
  }
});

test('decorated display policy keeps v0 HTML and leaves v1 newline unwrapped', () => {
  const text = '今日は黄色の\nラベルを試します';
  const style = { underline: true };
  const make = runs => resolveCaptionPlan({ captionsRoot: { display_policy: policy,
    captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2,
      text, text_style: style, ...(runs ? { runs } : {}) }] }, edit }).overlays[0].html;
  assert.equal(make([{ from: 4, to: 9, style: { color: '#ff0000' } }]), make());
  const html = make([{ from: 4, to: 9, look: { color: '#ffd948' } }]);
  assert.match(html, /color:#ffd948/u);
  assert.doesNotMatch(html, /class="akari-caption__run"[^>]*>\s+<\/span>/u);
});

test('layer crossings suppress only the later plate in resolved output', () => {
  const make = (from, to, color) => ({ id: color === '#ff0000' ? 'r-0001' : 'r-0002', from, to,
    look: { background: { ...background, color }, color } });
  const render = runs => resolveCaptionPlan({ captionsRoot: { captions: [{
    id: 'c-0001', src: 's1', start: 0, end: 2, text: 'ABCDEFG',
    text_style: { fill: { type: 'solid', color: '#ffffff' },
      strokes: [{ color: '#000000', width_px: 2 }] }, runs }] }, edit });
  const crossed = render([make(1, 4, '#ff0000'), make(3, 6, '#0000ff')]);
  assert.equal((crossed.overlays[0].html.match(/data-akari-plate="true"/gu) ?? []).length, 1);
  assert.match(crossed.overlays[0].html, /color:#0000ff/u);
  assert.doesNotMatch(crossed.overlays[0].html, /background:rgba\(0,0,255/u);
  const nested = render([make(1, 6, '#ff0000'), make(3, 4, '#0000ff')]);
  assert.equal((nested.overlays[0].html.match(/data-akari-plate="true"/gu) ?? []).length, 2);
});
