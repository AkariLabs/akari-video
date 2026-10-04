import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { materializedFragmentPlan, replaceFragmentReference, withoutFragmentRootTiming } from '../src/fragment-source-write.mjs';

const require = createRequire(import.meta.url);
const { serializeEdit } = require('../../edit-store/lib/canonical.js');

test('library fragment gets an item-specific project path and only that v2 item changes', () => {
  const plan = materializedFragmentPlan('assets/overlay/title/fragment.html', 'first', 'a1');
  assert.equal(plan.sourceDirectory, 'assets/overlay/title');
  assert.equal(plan.targetPath, 'assets/overlay/title-edit-first-a1/fragment.html');
  const edit = JSON.stringify({ version: 2, tracks: [{ items: [
    { id: 'first', source: { kind: 'html', path: 'assets/overlay/title/fragment.html' } },
    { id: 'second', source: { kind: 'html', path: 'assets/overlay/title/fragment.html' } },
  ] }] });
  const next = JSON.parse(replaceFragmentReference(edit, 'first', 'assets/overlay/title/fragment.html', plan.targetPath, serializeEdit));
  assert.equal(next.tracks[0].items[0].source.path, plan.targetPath);
  assert.equal(next.tracks[0].items[1].source.path, 'assets/overlay/title/fragment.html');
});

test('legacy overlay reference changes only for the selected id', () => {
  const edit = JSON.stringify({ overlays: [
    { id: 1, html: 'assets/overlay/title/fragment.html' },
    { id: 'second', html: 'assets/overlay/title/fragment.html' },
  ] });
  const next = JSON.parse(replaceFragmentReference(edit, '1', 'assets/overlay/title/fragment.html', 'assets/overlay/copy/fragment.html', serializeEdit));
  assert.equal(next.overlays[0].html, 'assets/overlay/copy/fragment.html');
  assert.equal(next.overlays[1].html, 'assets/overlay/title/fragment.html');
});

test('実体化した断片はルートの時刻属性だけを外す', () => {
  const source = '<!-- data-duration="6" -->\n<div title="keep data-duration=6" data-start="0"\n data-duration="6"><span data-duration="2">文字</span></div>';
  const result = withoutFragmentRootTiming(source);
  assert.match(result, /title="keep data-duration=6"/u);
  assert.match(result, /<span data-duration="2">文字<\/span>/u);
  assert.doesNotMatch((result.match(/<div[^>]*>/u)?.[0] ?? '').replace(/title="[^"]*"/u, ''),
    /\bdata-(?:start|duration)=/u);
});

test('edit-store 書式の edit.json では対象 item の source.path の行だけが変わる', () => {
  const original = serializeEdit({ version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [], tracks: [{ id: 'visual', lane: 'visual', items: [
      { id: 'first', at: 0, duration: 300, source: { kind: 'html', path: 'assets/overlay/title/fragment.html' } },
      { id: 'second', at: 300, duration: 300, source: { kind: 'html', path: 'assets/overlay/title/fragment.html' } },
    ] }] });
  const result = replaceFragmentReference(original, 'second', 'assets/overlay/title/fragment.html',
    'assets/overlay/title-edit-second/fragment.html', serializeEdit);
  const before = original.split('\n');
  const after = result.split('\n');
  assert.equal(after.length, before.length);
  const changed = before.flatMap((line, index) => line === after[index] ? [] : [index]);
  assert.equal(changed.length, 1);
  assert.match(before[changed[0]], /"id": "second"/u);
  assert.equal(after[changed[0]], before[changed[0]].replace('assets/overlay/title/fragment.html',
    'assets/overlay/title-edit-second/fragment.html'));
});
