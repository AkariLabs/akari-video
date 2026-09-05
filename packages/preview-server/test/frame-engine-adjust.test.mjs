import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { projectPreviewEdit } from '../src/preview-edit.mjs';

function editWithAdjust(sections) {
  return {
    version: 2,
    output: { width: 64, height: 36, fps: 30 },
    sources: [{ id: 'main', path: 'source.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [{
      id: 'adjusted-cut', at: 0, duration: 30,
      source: { kind: 'media', src: 'main', in: 0, out: 1 },
      adjust: {
        basic: { exposure: 1, temperature: 0.5 },
        lut: { lut: 'mono', intensity: 0.5 },
        ...(sections ? { sections } : {}),
      },
    }] }],
  };
}

for (const [section, value] of Object.entries({
  curves: { master: [{ in: 0, out: 0 }, { in: 0.25, out: 0.15 }, { in: 1, out: 1 }] },
  hue: { sat: [{ hue: 0, value: 0 }, { hue: 1, value: 0 }] },
})) {
  test('preview projection preserves ' + section + '-only and sections', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'preview-adjust-v1-'));
    try {
      for (const enabled of [true, false]) {
        const document = editWithAdjust();
        const adjust = { [section]: value, sections: { [section]: enabled, basic: false, lut: false } };
        document.tracks[0].items[0].adjust = adjust;
        const projected = projectPreviewEdit(JSON.stringify(document), path.join(projectRoot, '.akari', 'preview-projection'), projectRoot);
        assert.deepEqual(projected.cuts[0].adjust, adjust);
        assert.equal(projected.adjustLutCubeTexts, undefined);
      }
      const client = await readFile(path.resolve(import.meta.dirname, '../src/frame-engine-client.ts'), 'utf8');
      assert.match(client, /adjust: \{\s+\.\.\.adjust,/u);
    } finally { await rm(projectRoot, { recursive: true, force: true }); }
  });
}

test('preview projection resolves per-item LUT text and keeps the adjust declaration', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'preview-item-adjust-'));
  try {
    const source = JSON.stringify(editWithAdjust());
    const projected = projectPreviewEdit(source, path.join(projectRoot, '.akari', 'preview-projection'), projectRoot);
    assert.deepEqual(projected.cuts[0].adjust.basic, { exposure: 1, temperature: 0.5 });
    assert.match(projected.adjustLutCubeTexts['adjusted-cut'], /LUT_3D_SIZE/u);

    const client = await readFile(path.resolve(import.meta.dirname, '../src/frame-engine-client.ts'), 'utf8');
    assert.match(client, /resolvedItemAdjust\(intakeResolved, edit\?\.adjustLutCubeTexts\)/u);
    assert.match(client, /resolvedItemAdjust\(\{[\s\S]+\}, edit\?\.adjustLutCubeTexts\)/u);
    assert.match(client, /lut: parseCube\(cubeText\)/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('preview projection does not resolve a LUT whose adjust section is disabled', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'preview-item-adjust-off-'));
  try {
    const projected = projectPreviewEdit(
      JSON.stringify(editWithAdjust({ lut: false })),
      path.join(projectRoot, '.akari', 'preview-projection'),
      projectRoot,
    );
    assert.equal(projected.adjustLutCubeTexts, undefined);
    assert.equal(projected.cuts[0].adjust.sections.lut, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
