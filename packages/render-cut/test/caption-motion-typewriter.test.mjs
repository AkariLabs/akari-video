import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCaptionOverlays, generateResolvedCaptionOverlays } from '../src/captions.mjs';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';

const animation = { in: { id: 'typewriter', duration_sec: 1.4 } };
const cue = { id: 'c-1', start: 0, end: 3, time_domain: 'output', text: 'あ👩‍👩‍👧‍👦いう', text_style: { animation } };
const edit = { version: 1, output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: 'a', path: 'base.mp4' }], cuts: [{ id: 'cut-1', src: 'a', in: 0, out: 3, at: 0, track: 0 }] };

test('legacy OSR typewriter emits a timed span per grapheme', () => {
  const [overlay] = generateCaptionOverlays([cue], edit.cuts, { output: edit.output });
  assert.ok(overlay);
  assert.match(overlay.html, /animation: none;/u);
  assert.equal((overlay.html.match(/class="akari-caption__type-char"/gu) || []).length, 4);
  assert.match(overlay.html, /👩‍👩‍👧‍👦<\/span>/u);
  assert.match(overlay.html, /akari-typewriter-char-in/u);
});

test('display policy OSR keeps text_style.animation on the plate', () => {
  const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1', max_line_units: 20, minimum_fragment_duration_seconds: .72, locale: 'ja', lines: 1, wrap: 'multi' };
  const plan = resolveCaptionPlan({ captionsRoot: { display_policy: policy, captions: [cue] }, edit });
  const [overlay] = generateResolvedCaptionOverlays(plan.layout, undefined, edit.output);
  assert.ok(overlay);
  assert.match(overlay.html, /data-akari-textanim style="animation:none;"/u);
  assert.equal((overlay.html.match(/class="akari-caption__type-char"/gu) || []).length, 4);
  assert.equal(overlay.vars['--caption-text-shadow'], undefined);
  assert.equal(overlay.vars['--caption-paint-order'], undefined);
});

test('legacy OSR decorates the final runs markup without moving run boundaries', () => {
  const withRuns = { ...cue, runs: [{ from: 1, to: 2, role: 'emphasis', style: { color: '#ff0000' } }] };
  const [overlay] = generateCaptionOverlays([withRuns], edit.cuts, { output: edit.output });
  assert.match(overlay.html, /akari-caption__run/u);
  assert.equal((overlay.html.match(/class="akari-caption__type-char"/gu) || []).length, 4);
  assert.match(overlay.html, /akari-caption__run[^>]*>[\s\S]*?akari-caption__type-char/u);
});

test('typewriter with an exit fade leaves only the exit motion on the plate', () => {
  const combo = { ...cue, text_style: { animation: { ...animation,
    out: { id: 'fade-in-out', duration_sec: .6 } } } };
  const [overlay] = generateCaptionOverlays([combo], edit.cuts, { output: edit.output });
  assert.match(overlay.html, /akari-anim-fade-in-out/u);
  assert.doesNotMatch(overlay.html, /akari-anim-typewriter/u);
  assert.equal((overlay.html.match(/class="akari-caption__type-char"/gu) || []).length, 4);
});

test('gradient fill and two strokes stay inside each timed grapheme in both caption routes', () => {
  const text = '字幕を一文字ずつ表示します';
  const style = { fill: { type: 'gradient', angle_deg: 180, stops: [
    { at: 0, color: '#ffed8a' }, { at: 100, color: '#75d6ff' }
  ] }, strokes: [{ color: '#101827', width_px: 3 }, { color: '#ffffff', width_px: 1.5 }], animation };
  const richCue = { ...cue, text, text_style: style };
  const legacy = generateCaptionOverlays([richCue], edit.cuts, { output: edit.output })[0].html;
  const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1', max_line_units: 20,
    minimum_fragment_duration_seconds: .72, locale: 'ja', lines: 1, wrap: 'multi' };
  const layout = resolveCaptionPlan({ captionsRoot: { display_policy: policy, captions: [richCue] }, edit }).layout;
  const resolved = generateResolvedCaptionOverlays(layout, undefined, edit.output)[0].html;
  for (const html of [legacy, resolved]) {
    const parts = html.split(/<span class="akari-caption__type-char"[^>]*>/u).slice(1);
    assert.equal(parts.length, 13);
    for (const part of parts) {
      assert.equal((part.match(/class="akari-caption__rich-shadow"/gu) || []).length, 1);
      assert.equal((part.match(/class="akari-caption__rich-stroke"/gu) || []).length, 2);
      assert.equal((part.match(/class="akari-caption__rich-fill"/gu) || []).length, 1);
    }
    const delays = [...html.matchAll(/akari-typewriter-char-in \.01s ([0-9.]+)s linear/gu)].map(match => Number(match[1]));
    assert.equal(delays.length, 13);
    delays.forEach((delay, index) => assert.ok(Math.abs(delay - 1.4 * (index + 1) / 13) < .00001));
  }
});
