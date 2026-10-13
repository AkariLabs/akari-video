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
  assert.match(html, /data-akari-shadow-text="犬"/);
  assert.doesNotMatch(html, /z-index:-999999/);
  assert.equal(plan.captions[0].runs.length, 1);
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
  assert.doesNotMatch(overlay.html, /akari-caption__rich-shadow[^>]*>\s*<span class="akari-caption__run-frag"[^>]*data-akari-plate/);
});
