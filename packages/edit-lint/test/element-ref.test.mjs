import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateV2ObjectTreeFiles } from '../src/lint/edit-v2.mjs';

test('element-ref uses source tokenizer and capability copies agree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-element-lint-'));
  try {
    await writeFile(join(root, 'f.html'), '<!-- <i class=bar> --><script>"<i class=bar>"</script><div class="bar other"></div>');
    const source = { kind: 'html', path: 'f.html', elements: {
      '.bar[0]': { style: { width: '20px' } },
      '.bar[1]': { style: { width: '20px' } },
      '.nope[0]': { style: { width: '20px' } },
    } };
    const findings = [];
    await validateV2ObjectTreeFiles({ tracks: [{ items: [{ id: 'x', source }] }] }, findings,
      { projectRoot: root, captionsPath: join(root, 'captions.json') });
    assert.deepEqual(findings.filter(entry => entry.check === 'v2.element-ref').map(entry => entry.path), [
      'edit.json#tracks[0].items[0].source.elements[".bar[1]"]',
      'edit.json#tracks[0].items[0].source.elements[".nope[0]"]',
    ]);
    assert.ok(findings.filter(entry => entry.check === 'v2.element-ref').every(entry => entry.severity === 'warning'));
    const schemaCopy = await readFile(new URL('../../schemas/engine-capabilities.json', import.meta.url), 'utf8');
    const lintCopy = await readFile(new URL('../src/engine-capabilities.json', import.meta.url), 'utf8');
    assert.equal(lintCopy, schemaCopy);
  } finally { await rm(root, { recursive: true, force: true }); }
});
