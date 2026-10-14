import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { buildGpuPage } from '../../gpu-export/src/page-builder.mjs';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';

const require = createRequire(import.meta.url);
const { planCaptionStyleEdit, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');
const output = { width: 1920, height: 1080, fps: 30 };
const edit = { version: 1, output, sources: [{ id: 's', path: 'assets/s.mp4' }],
  cuts: [{ src: 's', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 24,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' };

for (const timed of [false, true]) for (const resolved of [false, true]) {
  test(`${timed ? 'timed' : 'untimed'} selected word inherits caption size in ${resolved ? 'resolved' : 'legacy'} render and GPU`, () => {
    const caption = { id: 'c-0004', src: 's', start: 0, end: 2, text: '動画編集を学ぶ',
      speaker: null, sourceRef: null, edited: false, text_style: { size_px: 56 },
      ...(timed ? { words: ['動画', '編集', 'を', '学ぶ'].map((text, index) => ({
        text, start: index / 2, end: (index + 1) / 2 })) } : {}) };
    const root = { ...(resolved ? { display_policy: policy } : {}), captions: [caption] };
    const applied = planCaptionStyleEdit({ captions: root,
      targets: [{ caption_id: caption.id, range: { from: 2, to: 4 } }],
      parts: { look: TEXTSTYLE_CATALOG.neon.style }, source: { kind: 'builtin', id: 'neon' } });
    const saved = applied.next.captions;
    const run = saved.captions[0].runs[0];
    assert.deepEqual([run.from, run.to], [2, 4]);
    assert.equal(run.look.size_px, undefined);
    assert.equal(run.look.reference_height_px, undefined);
    assert.equal(run.look.shadow.blur_px, 11.2);

    const render = resolveCaptionPlan({ captionsRoot: saved, edit, output }).overlays[0];
    const gpu = buildGpuPage({ edit, captions: saved, projectRoot: process.cwd(), duration: 2,
      frameEngineBundle: '', pageRuntime: '', slotParamsRuntime: '',
      itemKeyframesRuntime: '', itemMotionRuntime: '' }).spriteManifest.captions[0];
    for (const visual of [render, gpu]) {
      assert.equal(visual.vars['--caption-font-size'], '56px');
      assert.match(visual.html, /akari-caption__run/u);
      assert.doesNotMatch(visual.html, /(?:font-size|--caption-tok-font-size):120px/u);
    }
  });
}
