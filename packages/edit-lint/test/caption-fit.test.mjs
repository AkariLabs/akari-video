import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { lintProject } from '../src/edit-lint.mjs';

test('background.fit は text/frame を受理し未知値を error にする', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-caption-fit-lint-'));
  try {
    await writeFile(join(root, 'edit.json'), JSON.stringify({
      version: 2,
      output: { width: 640, height: 360, fps: 30 },
      sources: [],
      tracks: []
    }));
    for (const fit of ['text', 'frame', 'foo']) {
      await writeFile(join(root, 'captions.json'), JSON.stringify([{
        id: 'c-0001', start: 0, end: 1, time_domain: 'output', text: '字幕',
        speaker: null, sourceRef: null, edited: true,
        text_style: { background: { color: '#111111', fit } }
      }]));
      const result = await lintProject(root, { writeReports: false });
      const errors = result.findings.filter(finding => finding.check === 'captions.text-style');
      if (fit === 'foo') {
        assert.ok(errors.some(finding => finding.severity === 'error' && /background\.fit/u.test(finding.message)));
      } else {
        assert.equal(errors.length, 0);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
