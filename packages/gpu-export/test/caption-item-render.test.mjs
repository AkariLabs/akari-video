import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadAndBuildGpuPage } from "../src/page-builder.mjs";

const require = createRequire(import.meta.url);
const { planCaptionLookMigration, TEXTSTYLE_CATALOG } = require('../../edit-store/lib/index.js');

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../render-cut/test/fixtures/caption-item-render");

test("GPU page classifies the detached caption item without dropping it", async () => {
  const result = await loadAndBuildGpuPage({
    projectRoot: fixtureRoot,
    editPath: join(fixtureRoot, "edit.json"),
    fps: 30,
    width: 640,
    height: 360,
    duration: 5,
  });

  const overlay = result.edit.overlays.find(candidate => candidate.id === "c2-out");
  assert.equal(overlay.start, 61 / 30);
  assert.equal(overlay.duration, 1);
  assert.equal(overlay.z, 2);
  assert.deepEqual(result.spriteManifest.statics.map(({ id, z }) => ({ id, z })), [
    { id: "order-html", z: 3 },
  ]);
  const classification = result.eligibility.entries.find(entry =>
    entry.kind === "overlay" && entry.id === "c2-out");
  assert.ok(classification);
  // 字幕断片の @font-face の file URL と animation-timing は HTML overlay 判定に当たり、same / dom にはならない。
  // gpu-export 側を変えない限り degraded のままで、GPU は fail-closed に OSR へフォールバックする。
  assert.equal(classification.classification, "degraded");
  assert.equal(result.eligibility.eligible, false);
  assert.match(classification.reason, /font-face-external-resource/u);
});

test('GPU project load preserves eligibility through caption migration', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'gpu-caption-migration-'));
  try {
    await cp(fixtureRoot, projectRoot, { recursive: true });
    const root = JSON.parse(await readFile(join(projectRoot, 'captions.json'), 'utf8'));
    const row = root.captions[0];
    Object.assign(row, { src: 'main', start: 0.25, end: 0.75, text: '赤青',
      style_preset: 'neon', words: [{ text: '赤', start: 0.25, end: 0.5 },
        { text: '青', start: 0.5, end: 0.75 }],
      runs: [{ from: 0, to: 1, style: { color: '#ff0000', scale: 1.4 } }] });
    root.emphasis_words = [
      { id: 'e-0001', src: 'main', word: '赤', t_start: 0.25, t_end: 0.5,
        emotion: 'surprise', style_hint: 'one-char-bang' },
      { id: 'e-0002', src: 'main', word: '青', t_start: 0.5, t_end: 0.75,
        emotion: 'emphasis', style_hint: 'color-only' },
    ];
    const evaluate = async captions => {
      await writeFile(join(projectRoot, 'captions.json'), `${JSON.stringify(captions)}\n`);
      const { eligibility } = await loadAndBuildGpuPage({ projectRoot, duration: 5 });
      return { entries: eligibility.entries, summary: eligibility.summary };
    };
    const before = await evaluate(root);
    const after = await evaluate(planCaptionLookMigration(root, TEXTSTYLE_CATALOG).next);
    assert.deepEqual(after, before);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
