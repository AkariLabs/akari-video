import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { readRenderEdit } from '../src/internal-render.mjs';
import { resolveCaptionPlan } from '../src/caption-resolve.mjs';
import { buildGpuPage } from '../../gpu-export/src/page-builder.mjs';
import { evaluateGpuEligibility } from '../../gpu-export/src/eligibility.mjs';

const require = createRequire(import.meta.url);
const { planCaptionLookMigration, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');
const fixture = new URL('./fixtures/caption-item-render/', import.meta.url);
const signature = overlays => overlays.map(({ html, vars }) => ({ html, vars }));

test('migration keeps main and detached caption drawing and GPU decisions', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-entry-'));
  try {
    await cp(fixture, projectRoot, { recursive: true });
    const edit = JSON.parse(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
    edit.tracks[2].items[0].at = 30;
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    root.captions[0].style_preset = 'neon';
    const row = root.captions[1];
    Object.assign(row, { src: 'main', start: 1, end: 2, text: '赤青黄',
      words: [{ text: '赤', start: 1, end: 1.3 }, { text: '青', start: 1.3, end: 1.6 },
        { text: '黄', start: 1.6, end: 2 }],
      runs: [{ from: 1, to: 2, style: { color: '#ff0000', scale: 1.4 } }] });
    root.emphasis_words = [
      { id: 'e-0001', src: 'main', word: '赤', t_start: 1, t_end: 1.3,
        emotion: 'surprise', style_hint: 'one-char-bang' },
      { id: 'e-0002', src: 'main', word: '黄', t_start: 1.6, t_end: 2,
        emotion: 'emphasis', style_hint: 'color-only' },
    ];
    const migrated = planCaptionLookMigration(root, TEXTSTYLE_CATALOG).next;
    const snapshot = async captions => {
      await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(captions)}\n`);
      const rendered = readRenderEdit(edit, undefined, { projectRoot });
      const plan = resolveCaptionPlan({ captionsRoot: captions, edit: rendered.edit,
        projectRoot });
      const gpu = buildGpuPage({ edit: rendered.edit, captions, overlays: rendered.edit.overlays,
        projectRoot, duration: 5 });
      return { item: signature(rendered.edit.overlays.filter(item => item.captionId === 'c2')),
        main: signature(plan.overlays), entries: gpu.eligibility.entries,
        summary: gpu.eligibility.summary };
    };
    const before = await snapshot(root);
    const after = await snapshot(migrated);
    assert.deepEqual(after.item, before.item);
    assert.deepEqual(after.main, before.main);
    assert.deepEqual(after.entries, before.entries);
    assert.deepEqual(after.summary, before.summary);
    assert.match(before.item[0].html, /data-emphasis-id="e-0001"/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('unmigrated detached captions resolve their preset and scaled-run output', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-legacy-item-'));
  try {
    await cp(fixture, projectRoot, { recursive: true });
    const edit = JSON.parse(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    root.captions[1].style_preset = 'neon';
    root.captions[1].runs = [{ from: 0, to: 2, style: { color: '#ff0000', scale: 1.4 } }];
    await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(root)}\n`);
    const overlay = readRenderEdit(edit, undefined, { projectRoot }).edit.overlays
      .find(item => item.id === 'c2-out');
    assert.equal(overlay.vars['--caption-color'], '#ffcc00');
    assert.equal(overlay.vars['--caption-font-size'], '46px');
    assert.equal(overlay.vars['--caption-stroke'], '4px #000000');
    assert.equal(overlay.vars['--caption-rounded-stroke'], undefined);
    assert.match(overlay.html, /max-width: var\(--caption-line-max-width, none\)/u);
    assert.match(overlay.html, /-webkit-text-stroke:var\(--caption-webkit-text-stroke,var\(--caption-stroke,0\.14em rgba\(0,0,0,\.9\)\)\)/u);
    assert.doesNotMatch(overlay.html, /#aefcff/u);
    const bodyAndVars = { html: overlay.html.replace(/<style>[\s\S]*?<\/style>/u, ''), vars: overlay.vars };
    assert.equal(createHash('sha256').update(JSON.stringify(bodyAndVars)).digest('hex'),
      'dd849a35cd27cc55a7d5481854cffa3ce963703e5d551fbc89481e23ede03f3f');
    const migrated = planCaptionLookMigration(root, TEXTSTYLE_CATALOG).next;
    await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(migrated)}\n`);
    const after = readRenderEdit(edit, undefined, { projectRoot }).edit.overlays
      .find(item => item.id === 'c2-out');
    assert.deepEqual(signature([after]), signature([overlay]));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('detached yellow label has the same markup and variables after migration', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-yellow-item-'));
  try {
    await cp(fixture, projectRoot, { recursive: true });
    const edit = JSON.parse(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    root.captions[1].style_preset = 'news-yellow-label';
    root.captions[1].runs = [{ from: 0, to: 2, style: { scale: 1.3, color: '#ff0000' } }];
    const inspect = async captions => {
      await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(captions)}\n`);
      return readRenderEdit(edit, undefined, { projectRoot }).edit.overlays
        .find(item => item.id === 'c2-out');
    };
    const before = await inspect(root);
    const after = await inspect(planCaptionLookMigration(root, TEXTSTYLE_CATALOG).next);
    assert.deepEqual(signature([after]), signature([before]));
    assert.match(before.vars['--plate-bg'], /rgba\(255,217,72,0\.98\)/u);
    assert.match(before.html, /font-size:1\.3em/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('detached caption resolves v1 plate, shadow, and glow', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-rich-item-'));
  try {
    await cp(fixture, projectRoot, { recursive: true });
    const edit = JSON.parse(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    root.captions[1].runs = [{ id: 'r-0001', from: 0, to: 2, look: {
      background: { color: '#ffd948', opacity: 0.9, padding_px: 6, radius_px: 2 },
      shadow: { color: '#000000', distance_px: 3 },
      glow: { color: '#00e5ff', spread: 5, density: 80 },
    } }];
    await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(root)}\n`);
    const overlay = readRenderEdit(edit, undefined, { projectRoot }).edit.overlays
      .find(item => item.id === 'c2-out');
    assert.match(overlay.html, /data-akari-plate="true"/u);
    assert.match(overlay.html, /class="akari-caption__run"[^>]*text-shadow:[^;"']+/u);
    assert.match(overlay.html, /data-akari-shadow-text=/u);
    assert.match(overlay.html, /class="akari-caption__run-ink"/u);
    assert.match(overlay.html, /rgba\(0,229,255,1\)/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('detached typewriter caption with run effects retains the OSR eligibility reason', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-typewriter-item-'));
  try {
    await cp(fixture, projectRoot, { recursive: true });
    const edit = JSON.parse(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    root.captions[1].text_style = { animation: { in: { id: 'typewriter' } } };
    root.captions[1].runs = [{ id: 'r-0001', from: 0, to: 1,
      look: { background: { color: '#ffd948', padding_px: 8 } } }];
    await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(root)}\n`);
    const rendered = readRenderEdit(edit, undefined, { projectRoot });
    assert.match(rendered.edit.overlays.find(item => item.id === 'c2-out').html,
      /data-akari-plate="true"/u);
    const page = buildGpuPage({ edit: rendered.edit, captions: root,
      overlays: rendered.edit.overlays, projectRoot, duration: 5 });
    assert.equal(page.eligibility.entries.find(item => item.id === root.captions[1].id)?.reason,
      'caption-run-effects-typewriter');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('main and detached caption entrances agree on zero effects and plates', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-entry-effects-'));
  try {
    await cp(fixture, projectRoot, { recursive: true });
    const edit = JSON.parse(await readFile(join(projectRoot, 'edit.json'), 'utf8'));
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    const row = root.captions[1];
    edit.tracks[2].items[0].at = 31;
    edit.tracks[2].items[0].duration = 30;
    row.style = 'karaoke';
    row.words = [{ text: row.text, start: row.start, end: row.end }];
    const zero = { color: '#ff3355', stroke: { width_px: 0 },
      shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } };
    for (const [look, reason] of [
      [zero, 'words-native'],
      [{ ...zero, background: { color: '#ffffff' } }, 'caption-run-plate-words-native'],
    ]) {
      row.runs = [{ id: 'r-0001', from: 0, to: 1, look }];
      await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(root)}\n`);
      const rendered = readRenderEdit(edit, undefined, { projectRoot });
      const detached = rendered.edit.overlays.find(item => item.id === 'c2-out');
      assert.ok(detached);
      assert.equal(/data-akari-plate="true"/u.test(detached.html), Boolean(look.background));
      const direct = evaluateGpuEligibility({ edit: rendered.edit, captions: root });
      const main = buildGpuPage({ edit: rendered.edit, captions: root, overlays: [],
        projectRoot, duration: 5 });
      const item = buildGpuPage({ edit: rendered.edit, captions: root,
        overlays: rendered.edit.overlays, projectRoot, duration: 5 });
      for (const result of [direct, main.eligibility, item.eligibility]) {
        assert.equal(result.entries.find(entry => entry.id === row.id)?.reason, reason);
      }
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
