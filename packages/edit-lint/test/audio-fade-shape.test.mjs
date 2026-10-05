import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lintProject } from '../src/edit-lint.mjs';
import { prepareCutAudioFixtures } from './helpers/cut-audio-fixtures.mjs';

test('v2 audio fade shapes pass lint for four values and reject exp without changing edit.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audio-fade-shape-lint-'));
  try {
    await prepareCutAudioFixtures(root);
    const project = join(root, 'edit-v2-cut-audio-split-valid');
    const path = join(project, 'edit.json');
    const base = JSON.parse(await readFile(path, 'utf8'));
    const lint = async doc => {
      const text = JSON.stringify(doc) + '\n';
      await writeFile(path, text);
      const result = await lintProject(project, { writeReports: false });
      assert.equal(await readFile(path, 'utf8'), text);
      return result;
    };
    assert.equal((await lint(base)).verdict, 'pass');
    for (const shape of ['linear', 'equal_power', 's_curve', 'slow']) {
      const doc = structuredClone(base);
      const item = doc.tracks.find(track => track.lane === 'audio').items[0];
      item.fade_in_shape = shape;
      item.fade_out_shape = shape;
      const result = await lint(doc);
      assert.equal(result.verdict, 'pass', `${shape}: ${JSON.stringify(result.findings)}`);
    }
    for (const field of ['fade_in_shape', 'fade_out_shape']) {
      const doc = structuredClone(base);
      doc.tracks.find(track => track.lane === 'audio').items[0][field] = 'exp';
      const result = await lint(doc);
      assert.equal(result.verdict, 'fail');
      assert.ok(result.findings.some(finding => finding.check === 'audio.fade-shape'
        && finding.path.endsWith(`.${field}`) && finding.severity === 'error'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
