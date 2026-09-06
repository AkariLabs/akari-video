import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lintProject } from '../src/edit-lint.mjs';
import { prepareCutAudioFixtures } from './helpers/cut-audio-fixtures.mjs';

async function check(mutator, inspect) {
  const root = await mkdtemp(join(tmpdir(), 'cut-audio-lint-'));
  try {
    await prepareCutAudioFixtures(root);
    const project = join(root, 'edit-v2-cut-audio-split-valid');
    const path = join(project, 'edit.json');
    const doc = JSON.parse(await readFile(path, 'utf8'));
    mutator(doc);
    await writeFile(path, JSON.stringify(doc) + '\n');
    const before = await readFile(path);
    const result = await lintProject(project, { writeReports: false });
    const findings = result.findings.filter(finding => finding.check.startsWith('v2.audio-'));
    inspect(findings, result);
    assert.deepEqual(await readFile(path), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const passes = (findings, result) => {
  assert.deepEqual(findings, []);
  assert.equal(result.verdict, 'pass', JSON.stringify(result.findings));
};

test('cut audio link requires audio:false on its target', async () => {
  await check(doc => { delete doc.tracks[0].items[0].audio; }, (findings, result) => {
    assert.equal(result.verdict, 'fail');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, 'v2.audio-link-target');
    assert.equal(findings[0].severity, 'error');
    assert.match(findings[0].message, /audio: false/u);
    assert.equal(findings[0].path, 'edit.json#tracks[1].items[0].link');
  });
});

test('cut audio links reject self/audio targets and track/source IDs', async () => {
  for (const [link, expected] of [['voice', 'v2.audio-link-target-kind'], ['speech', 'v2.audio-link-target'], ['main', 'v2.audio-link-target']]) {
    await check(doc => { doc.tracks[1].items[0].link = link; }, findings => {
      assert.deepEqual(findings.map(({ check, severity }) => ({ check, severity })), [{ check: expected, severity: 'error' }]);
    });
  }
});

test('cut audio detached states and unchanged embedded audio need no split findings', async () => {
  for (const mutate of [
    doc => { doc.tracks.pop(); },
    doc => { delete doc.tracks[1].items[0].link; },
    doc => { delete doc.tracks[1].items[0].link; delete doc.tracks[0].items[0].audio; },
    doc => { doc.tracks.pop(); delete doc.tracks[0].items[0].audio; doc.tracks[0].items[0].source.mute = false; },
  ]) await check(mutate, passes);
});

test('cut audio links use declared item IDs across track order and nested visual groups', async () => {
  await check(doc => {
    const cut = doc.tracks[0].items[0];
    doc.tracks[0].items = [{ id: 'group', at: 0, duration: 90, source: { kind: 'group' }, items: [cut] }];
    doc.tracks.reverse();
  }, passes);
});

test('cut audio duplicate links remain errors across muted tracks and roles', async () => {
  await check(doc => {
    doc.tracks.push({ id: 'other', lane: 'audio', muted: true,
      items: [{ ...structuredClone(doc.tracks[1].items[0]), id: 'other-voice', role: 'sfx' }] });
  }, findings => {
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, 'v2.audio-link-duplicate');
    assert.equal(findings[0].severity, 'error');
    assert.equal(findings[0].path, 'edit.json#tracks[2].items[0].link');
  });
});

test('cut audio warns about unused embedded controls by presence, including zero and false', async () => {
  for (const fields of [{ gain_db: 0 }, { mute: false }, { gain_db: -6, mute: true }]) {
    await check(doc => {
      Object.assign(doc.tracks[0].items[0].source, fields);
    }, (findings, result) => {
      assert.equal(result.verdict, 'pass', JSON.stringify(result.findings));
      assert.equal(findings.length, 1);
      assert.equal(findings[0].check, 'v2.audio-embedded-unused');
      assert.equal(findings[0].severity, 'warning');
      assert.equal(findings[0].path, 'edit.json#tracks[0].items[0].source');
    });
  }
  await check(doc => {
    const cut = doc.tracks[0].items[0];
    cut.source.mute = false;
    doc.tracks[0].items = [{ id: 'group', at: 0, duration: 90, source: { kind: 'group' }, items: [cut] }];
  }, findings => {
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, 'v2.audio-embedded-unused');
    assert.equal(findings[0].path, 'edit.json#tracks[0].items[0].items[0].source');
  });
});
