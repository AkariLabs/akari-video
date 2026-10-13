import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';

const { applyCaptionLookMigration } = createRequire(import.meta.url)('../../edit-store/lib/caption-style-write.js');
const edit = { version: 1, output: { width: 1080, height: 1920 },
  sources: [{ id: 's1', path: 'assets/s1.mp4' }],
  cuts: [{ id: 'cut-1', src: 's1', in: 0, out: 2, at: 0, track: 0 }], overlays: [] };
const render = captionsRoot => resolveCaptionPlan({ captionsRoot, edit }).overlays
  .map(overlay => ({ html: overlay.html, vars: overlay.vars }));

for (const [name, scale, stroke] of [
  ['通常の縁', 1, 4], ['割り切れない縁の幅 6・scale 0.7', 0.7, 6],
]) test(`移行を保存した後も render-cut の HTML と CSS 変数が同じ: ${name}`, async () => {
  const root = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬',
    speaker: null, sourceRef: null, edited: false, style_preset: 'neon',
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ from: 1, to: 2, style: { color: '#ff0000', scale,
      stroke: { color: '#ffffff', width_px: stroke } }, animation: { in: { id: 'pop' } } }] }],
    emphasis_words: [{ id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'surprise', style_hint: 'one-char-bang' }] };
  const dir = await mkdtemp(join(tmpdir(), 'akari-render-migration-'));
  try {
    await writeFile(join(dir, 'captions.json'), `${JSON.stringify(root, null, 2)}\n`);
    const before = render(root);
    await applyCaptionLookMigration(dir);
    const saved = JSON.parse(await readFile(join(dir, 'captions.json'), 'utf8'));
    assert.deepEqual(render(saved), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
