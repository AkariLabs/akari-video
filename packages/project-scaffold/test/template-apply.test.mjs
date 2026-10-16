import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPlaybookToExisting } from '../src/index.mjs';
import bookSample from './fixtures/playbook-sample/playbook.json' with { type: 'json' };

test('depth 3 applies twice without IDs colliding and copies referenced media', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-template-apply-'));
  try {
    const project = path.join(root, 'project'); const playbook = path.join(root, 'playbook');
    await fs.mkdir(path.join(project, '.akari', 'reports'), { recursive: true });
    await fs.mkdir(path.join(playbook, 'template', 'media'), { recursive: true });
    await fs.mkdir(path.join(project, 'planning'), { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    await fs.writeFile(path.join(playbook, 'template', 'media', 'pixel.png'), png);
    const fragment = { id: 'group', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
      { id: 'image', at: 0, duration: 30, source: { kind: 'media', src: 'template/media/pixel.png', in: 0, out: 1 } }
    ] };
    const book = { ...bookSample, id: 'pixel', name: 'Pixel', depth: 3, placeholders: [], license: 'CC0-1.0',
      template: { item: 'template/item.json', fps: 30, width: 1080, height: 1920, durationSec: 1, slots: [],
        media: [{ path: 'template/media/pixel.png', sha256: createHash('sha256').update(png).digest('hex'), license: 'CC0-1.0', source: 'own' }] } };
    await fs.writeFile(path.join(playbook, 'playbook.json'), JSON.stringify(book));
    await fs.writeFile(path.join(playbook, 'playbook.md'), (await fs.readFile(new URL('./fixtures/playbook-sample/playbook.md', import.meta.url), 'utf8'))
      .replace(/^# .+$/m, '# Pixel'));
    await fs.writeFile(path.join(playbook, 'template', 'item.json'), JSON.stringify(fragment));
    await fs.writeFile(path.join(project, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30, width: 1080, height: 1920 }, sources: [], tracks: [] }));
    await fs.writeFile(path.join(project, '.akari', 'intake.json'), JSON.stringify({ target: { duration_s: null } }));
    await fs.writeFile(path.join(project, '.akari', 'manifest.json'), JSON.stringify({ version: 0, kind: 'akari-project-manifest', nodes: [], edges: [] }));
    await applyPlaybookToExisting({ projectDir: project, playbookDir: playbook });
    await applyPlaybookToExisting({ projectDir: project, playbookDir: playbook });
    const edit = JSON.parse(await fs.readFile(path.join(project, 'edit.json')));
    assert.equal(edit.tracks[0].items.length, 2);
    assert.notEqual(edit.tracks[0].items[0].id, edit.tracks[0].items[1].id);
    assert.equal(edit.sources[0].path, 'assets/templates/pixel/pixel.png');
    assert.ok((await fs.stat(path.join(project, edit.sources[0].path))).isFile());
    const manifest = JSON.parse(await fs.readFile(path.join(project, '.akari', 'manifest.json')));
    assert.deepEqual(manifest.edges.map(edge => edge.uses), ['asset:templates/pixel']);
    const ledger = JSON.parse(await fs.readFile(path.join(project, '.akari', 'asset-references.json')));
    assert.deepEqual(ledger.references.map(ref => `${ref.category}/${ref.id}`), ['templates/pixel']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
