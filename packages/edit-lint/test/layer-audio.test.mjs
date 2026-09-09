import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lintProject } from '../src/edit-lint.mjs';
import { prepareCutAudioFixtures } from './helpers/cut-audio-fixtures.mjs';

test('edit-lint accepts PiP audio defaults, mute, detached audio and gain without rewriting the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'layer-audio-lint-'));
  try {
    await prepareCutAudioFixtures(root);
    const project = join(root, 'edit-v2-cut-audio-split-valid'), path = join(project, 'edit.json');
    const original = JSON.parse(await readFile(path, 'utf8'));
    for (const flags of [{}, { gain_db: -60 }, { gain_db: 12, mute: true }]) {
      const doc = structuredClone(original);
      doc.tracks.pop();
      delete doc.tracks[0].items[0].audio;
      const base = doc.tracks[0].items[0];
      doc.tracks.push({ id: 'pip-track', lane: 'visual', items: [
        { ...structuredClone(base), id: 'pip', transform: { scale: 0.5 }, source: { ...base.source, ...flags } },
      ] });
      for (const detached of [false, true]) {
        if (detached) doc.tracks[1].items[0].audio = false;
        const text = JSON.stringify(doc) + '\n';
        await writeFile(path, text);
        const result = await lintProject(project, { writeReports: false });
        assert.equal(result.verdict, 'pass', JSON.stringify(result.findings));
        assert.equal(await readFile(path, 'utf8'), text);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
