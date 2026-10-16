import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validatePlaybook } from '../validate-playbook.mjs';
import sample from '../../project-scaffold/test/fixtures/playbook-sample/playbook.json' with { type: 'json' };

test('depth 3 requires a valid group fragment, matching media and bound slots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'akari-template-'));
  try {
    await mkdir(path.join(dir, 'template', 'media'), { recursive: true });
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    await writeFile(path.join(dir, 'template', 'media', 'image.png'), bytes);
    const wave = Buffer.alloc(44 + 1600);
    wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(1600, 40);
    await writeFile(path.join(dir, 'template', 'media', 'silence.wav'), wave);
    const item = { id: 'group', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
      { id: 'slot', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed', intent: 'video' } }, items: [] },
      { id: 'image', at: 0, duration: 30, source: { kind: 'media', src: 'template/media/image.png', in: 0, out: 1 } }
    ] };
    await writeFile(path.join(dir, 'template', 'item.json'), JSON.stringify(item));
    const book = { ...sample, depth: 3, license: 'CC0-1.0', placeholders: [{ id: 'main', role: 'video', kind: 'video' }],
      template: { item: 'template/item.json', fps: 30, width: 1080, height: 1920, durationSec: 1,
        slots: [{ placeholder: 'main', item: 'slot' }], media: [{ path: 'template/media/image.png',
          sha256: createHash('sha256').update(bytes).digest('hex'), license: 'CC0-1.0', source: 'own' },
          { path: 'template/media/silence.wav', sha256: createHash('sha256').update(wave).digest('hex'),
            license: 'CC0-1.0', source: 'own' }] } };
    assert.equal((await validatePlaybook(book, { baseDir: dir })).ok, true);
    const missing = structuredClone(book); missing.template.media = [];
    assert.equal((await validatePlaybook(missing, { baseDir: dir })).ok, false);
    const site = structuredClone(book); site.template.media[0].source = 'site';
    assert.equal((await validatePlaybook(site, { baseDir: dir })).ok, false);
    const checksum = structuredClone(book); checksum.template.media[0].sha256 = '0'.repeat(64);
    assert.match((await validatePlaybook(checksum, { baseDir: dir })).errors.join(' '), /sha256/);
    const license = structuredClone(book); license.template.media[0].license = 'LicenseRef-AKARI-Assets-v0';
    assert.equal((await validatePlaybook(license, { baseDir: dir })).ok, false);
    const wrong = structuredClone(book); wrong.template.slots[0].item = 'image';
    assert.equal((await validatePlaybook(wrong, { baseDir: dir })).ok, false);
    await writeFile(path.join(dir, 'template', 'item.json'), JSON.stringify({ ...item, unknown: true }));
    assert.match((await validatePlaybook(book, { baseDir: dir })).errors.join(' '), /itemV2/);
    const badMedia = structuredClone(item); badMedia.items[1].source.in = 'zero';
    await writeFile(path.join(dir, 'template', 'item.json'), JSON.stringify(badMedia));
    assert.match((await validatePlaybook(book, { baseDir: dir })).errors.join(' '), /edit.schema/);
    await writeFile(path.join(dir, 'template', 'item.json'), JSON.stringify(item));
    const old = structuredClone(book); old.depth = 2;
    assert.equal((await validatePlaybook(old, { baseDir: dir })).ok, false);
    const absent = structuredClone(book); delete absent.template;
    assert.equal((await validatePlaybook(absent, { baseDir: dir })).ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
