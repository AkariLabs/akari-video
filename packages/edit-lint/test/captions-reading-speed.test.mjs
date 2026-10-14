import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { validateCaptions } from '../src/lint/captions.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = locale => ({ mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 20,
  minimum_fragment_duration_seconds: 1, locale });

test('English reading speed warns above the limit; Japanese findings stay unchanged', () => {
  const cue = { id: 'c-0001', start: 0, end: 1, text: 'A long caption of more than seventeen chars',
    speaker: null, sourceRef: null, edited: true, time_domain: 'output' };
  const checks = locale => {
    const findings = [];
    validateCaptions({ display_policy: policy(locale), captions: [cue] },
      { cuts: [], sources: [], output: { width: 1920, height: 1080 } }, null, findings,
      { projectRoot: root, captionsPath: join(root, 'captions.json') }, 10);
    return findings.filter(finding => finding.check === 'captions.reading-speed');
  };
  assert.equal(checks('en-US').length, 1);
  assert.equal(checks('fr-FR').length, 1);
  assert.equal(checks('ja-JP').length, 0);
});

test('reading speed resolves English from intake or transcript without display_policy', async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'caption-speed-locale-'));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const cue = { id: 'c-0001', start: 0, end: 1, text: 'A long caption of more than seventeen chars',
    speaker: null, sourceRef: null, edited: true, time_domain: 'output' };
  const checks = () => {
    const findings = [];
    validateCaptions({ captions: [cue] }, { cuts: [], sources: [] }, null, findings,
      { projectRoot, captionsPath: join(projectRoot, 'captions.json') }, 10);
    return findings.filter(finding => finding.check === 'captions.reading-speed');
  };
  await writeFile(join(projectRoot, 'analysis.json'), JSON.stringify({ transcript_language: 'en-US' }));
  assert.equal(checks().length, 1);
  await mkdir(join(projectRoot, '.akari'));
  await writeFile(join(projectRoot, '.akari', 'intake.json'), JSON.stringify({ language: 'ja-JP' }));
  assert.equal(checks().length, 0);
  await writeFile(join(projectRoot, '.akari', 'intake.json'), JSON.stringify({ language: 'en-US' }));
  assert.equal(checks().length, 1);
});
