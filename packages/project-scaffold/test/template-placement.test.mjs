import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { placeTemplateInEdit, depthTwoGroup, importTemplateMedia, undoPlaybookProject } from '../src/template-placement.mjs';

test('one group is placed at a requested frame with unique IDs and converted frames', () => {
  const edit = { version: 2, output: { fps: 60 }, sources: [], tracks: [{ id: 'visual-1', lane: 'visual', items: [] }] };
  const book = { id: 'intro', name: 'Intro', depth: 3, placeholders: [{ id: 'main', role: 'Main', kind: 'video' }],
    template: { fps: 30, durationSec: 1, media: [], slots: [{ placeholder: 'main', item: 'slot' }] } };
  const fragment = { id: 'group', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
    { id: 'slot', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed' } }, items: [] }
  ] };
  const once = placeTemplateInEdit(edit, book, fragment, { at: 12, trackId: 'visual-1' });
  const twice = placeTemplateInEdit(once.edit, book, fragment, { at: 72, trackId: 'visual-1' });
  assert.equal(edit.tracks[0].items.length, 0);
  assert.equal(twice.edit.tracks[0].items.length, 2);
  assert.equal(twice.edit.tracks[0].items[0].duration, 60);
  assert.equal(twice.edit.tracks[0].items[0].at, 12);
  assert.match(twice.edit.tracks[0].items[0].items[0].name, /\[video\]$/);
  assert.notEqual(twice.edit.tracks[0].items[0].id, twice.edit.tracks[0].items[1].id);
  const overlap = placeTemplateInEdit(once.edit, book, fragment, { at: 20, trackId: 'visual-1' });
  assert.equal(overlap.edit.tracks.length, 2);
});

test('depth 2 beats form one group', () => {
  const group = depthTwoGroup({ id: 'plan', name: 'Plan', depth: 2, beats: [{ id: 'a', at: 0, duration: 2, title: 'A' }], placeholders: [] }, 30);
  assert.equal(group.source.kind, 'group');
  assert.equal(group.items[0].source.canvas.origin, 'plan');
  assert.equal(group.duration, 60);
  const overlap = depthTwoGroup({ id: 'plan', name: 'Plan', depth: 2, beats: [
    { id: 'a', at: 0, duration: 2, title: 'A' }, { id: 'b', at: 1, duration: 2, title: 'B' }
  ], placeholders: [] }, 30);
  assert.equal(overlap.items[1].at, 60);
});
test('mask and media paths receive edit source IDs', () => {
  const edit = { version: 2, output: { fps: 30 }, sources: [], tracks: [] };
  const fragment = { id: 'group', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
    { id: 'image', at: 0, duration: 30, mask: 'template/media/mask.png',
      source: { kind: 'media', src: 'template/media/image.png', in: 0, out: 1 } }
  ] };
  const book = { id: 'intro', name: 'Intro', depth: 3, template: { fps: 30, slots: [] } };
  const placed = placeTemplateInEdit(edit, book, fragment, { mediaPaths: {
    'template/media/mask.png': 'assets/templates/intro/mask.png',
    'template/media/image.png': 'assets/templates/intro/image.png' } });
  const child = placed.edit.tracks[0].items[0].items[0];
  assert.equal(placed.edit.sources.find(source => source.id === child.mask).path, 'assets/templates/intro/mask.png');
  assert.equal(placed.edit.sources.find(source => source.id === child.source.src).path, 'assets/templates/intro/image.png');
});

test('undo removes newly imported template media and restores ledgers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-template-undo-'));
  try {
    await mkdir(path.join(root, 'assets', 'templates', 'intro'), { recursive: true });
    await mkdir(path.join(root, '.akari'), { recursive: true });
    await writeFile(path.join(root, 'assets', 'templates', 'intro', 'new.png'), 'pixel');
    await writeFile(path.join(root, '.akari', 'asset-references.json'), '{}');
    await undoPlaybookProject(root, { createdPaths: ['assets/templates/intro/new.png'], ledgerBefore: null, manifestBefore: null });
    await assert.rejects(stat(path.join(root, 'assets', 'templates', 'intro', 'new.png')));
    await assert.rejects(stat(path.join(root, '.akari', 'asset-references.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('media importer reuses identical bytes and suffixes different bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-template-collision-'));
  try {
    const project = path.join(root, 'project'); const bookDir = path.join(root, 'book');
    await mkdir(path.join(bookDir, 'template', 'media'), { recursive: true });
    const file = path.join(bookDir, 'template', 'media', 'clip.png');
    const makeBook = bytes => ({ id: 'intro', template: { media: [{ path: 'template/media/clip.png',
      sha256: createHash('sha256').update(bytes).digest('hex') }] } });
    await writeFile(file, 'a');
    assert.equal((await importTemplateMedia(project, bookDir, makeBook('a')))['template/media/clip.png'], 'assets/templates/intro/clip.png');
    assert.equal((await importTemplateMedia(project, bookDir, makeBook('a')))['template/media/clip.png'], 'assets/templates/intro/clip.png');
    const secondBook = path.join(root, 'book2');
    await mkdir(path.join(secondBook, 'template', 'media'), { recursive: true });
    await writeFile(path.join(secondBook, 'template', 'media', 'clip.png'), 'b');
    assert.equal((await importTemplateMedia(project, secondBook, makeBook('b')))['template/media/clip.png'], 'assets/templates/intro/clip-2.png');
  } finally { await rm(root, { recursive: true, force: true }); }
});
