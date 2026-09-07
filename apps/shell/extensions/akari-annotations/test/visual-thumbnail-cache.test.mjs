import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualThumbnailCache } from '../lib/browser/visual-thumbnail-cache.js';
import { visualDeclarationChain, visualThumbnailSnapshot } from '../lib/browser/visual-thumbnail-key.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const job = (key, capture, priority = 0) => ({ key, priority, wanted: () => true, capture });

test('leaf identity follows parent changes and implicit part overrides, not unrelated siblings', () => {
  const doc = { tracks: [{ items: [{ id: 'group', transform: { scale: 1 }, items: [
    { id: 'leaf', source: { path: 'title.html' } }, { id: 'sibling', name: 'before' }
  ] }] }] };
  const before = JSON.stringify(visualDeclarationChain(doc, 'leaf'));
  doc.tracks[0].items[0].items[1].name = 'after';
  assert.equal(JSON.stringify(visualDeclarationChain(doc, 'leaf')), before);
  doc.tracks[0].items[0].transform.scale = 2;
  assert.notEqual(JSON.stringify(visualDeclarationChain(doc, 'leaf')), before);
  assert.equal(visualDeclarationChain(doc, 'leaf#title').length, 2);
  const snapshot = visualThumbnailSnapshot(doc, 'leaf');
  doc.tracks[0].items[0].items[1].name = 'another unrelated change';
  assert.equal(visualThumbnailSnapshot(doc, 'leaf'), snapshot);
  doc.tracks[0].items[0].opacity = 0.5;
  assert.notEqual(visualThumbnailSnapshot(doc, 'leaf'), snapshot);
});

const until = async (predicate, timeout = 7000) => {
  const end = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < end, 'deadline'); await wait(20); }
};

test('transient failures retry without file changes, honor pause, and stop after three attempts', async () => {
  const cache = new VisualThumbnailCache(() => {});
  let attempts = 0;
  const recover = job('recover', async () => { if (++attempts === 1) throw Error('transient busy'); return 'image'; });
  cache.request(recover);
  await until(() => cache.stats.failures === 1);
  cache.setPaused(true); await wait(1200);
  assert.equal(attempts, 1);
  cache.setPaused(false);
  await until(() => cache.request(recover) === 'image');
  assert.equal(attempts, 2);
  const permanent = job('timeout', async () => { throw Error('capture timed out'); });
  cache.request(permanent);
  await until(() => cache.stats.failures === 4);
  for (let i = 0; i < 30; i++) cache.request(permanent);
  await wait(1200);
  assert.equal(cache.stats.failures, 4, 'redraw must not reset retry allowance');
  assert.equal(cache.request(permanent), null);
  cache.dispose();
});

test('generation invalidation discards an asynchronous result instead of poisoning the old key', async () => {
  let release; let generation = 1;
  const cache = new VisualThumbnailCache(() => {});
  cache.request({ ...job('A', () => new Promise(resolve => { release = resolve; })), valid: () => generation === 1 });
  await until(() => release);
  generation = 2; release('newer pixels');
  await until(() => cache.stats.discarded === 1);
  assert.equal(cache.size, 0);
  const undo = job('A', async () => 'A pixels');
  assert.equal(cache.request(undo), undefined);
  await until(() => cache.request(undo) === 'A pixels');
  cache.dispose();
});

test('the retry deadline expires even if a visible failed key is requested again', async t => {
  const realNow = Date.now; let offset = 0;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const cache = new VisualThumbnailCache(() => {});
  t.after(() => cache.dispose());
  let attempts = 0;
  const failed = job('expired', async () => { attempts++; throw Error('temporary busy'); });
  cache.request(failed); await until(() => cache.stats.failures === 1);
  offset = 31000;
  cache.request(failed); await wait(1200);
  assert.equal(attempts, 1);
  assert.equal(cache.request(failed), null);
  assert.equal(cache.queued, 0);
});

test('pauses playback/drag work, resumes visible-first, deduplicates queued and cached inputs', async () => {
  const calls = [];
  const cache = new VisualThumbnailCache(() => {});
  cache.setPaused(true);
  const a = job('project-A:title-v1', async () => { calls.push('a'); return 'image-a'; }, 20);
  const b = job('project-A:html-v1', async () => { calls.push('b'); return 'image-b'; }, 0);
  cache.request(a); cache.request(a); cache.request(b);
  await wait(140);
  assert.deepEqual(calls, []);
  assert.equal(cache.queued, 2);
  cache.setPaused(false);
  await wait(260);
  assert.deepEqual(calls, ['b', 'a']);
  for (let i = 0; i < 100; i++) assert.equal(cache.request(a), 'image-a');
  await wait(140);
  assert.equal(calls.length, 2, 'redraw/pan/zoom cache hits must not capture');
  cache.request(job('project-B:title-v1', async () => 'other-project'));
  cache.request(job('project-A:title-v2', async () => 'edited-title'));
  await wait(260);
  assert.equal(cache.stats.captures, 4, 'project namespace and input revision are distinct');
  cache.dispose();
});

test('queue, entries, decoded memory and failures are bounded; unmounted work is dropped', async () => {
  const cache = new VisualThumbnailCache(() => {}, 2, 700000, 3);
  let active = 0; let peak = 0;
  let visible = true;
  const capture = async () => { peak = Math.max(peak, ++active); await wait(10); active--; return 'image'; };
  cache.setPaused(true);
  for (let i = 0; i < 20; i++) cache.request({ ...job(String(i), capture, i), wanted: () => visible });
  assert.equal(cache.queued, 3);
  cache.setPaused(false);
  await wait(390);
  assert.equal(peak, 1);
  assert.ok(cache.size <= 2 && cache.memoryBytes <= 700000);
  visible = false;
  const failed = job('failed', async () => { throw Error('bad HTML'); });
  cache.request(failed); await wait(140);
  assert.equal(cache.request(failed), null);
  assert.equal(cache.stats.failures, 1);
  cache.request({ ...job('gone', capture), wanted: () => false });
  await wait(140);
  assert.equal(cache.queued, 0);
  cache.dispose();
});

test('pausing while an existing capture finishes prevents the next capture starting', async () => {
  let release; const calls = [];
  const cache = new VisualThumbnailCache(() => {});
  cache.request(job('first', () => { calls.push('first'); return new Promise(resolve => { release = resolve; }); }));
  cache.request(job('second', async () => { calls.push('second'); return 'second'; }));
  await wait(140);
  cache.setPaused(true); release('first');
  await wait(160);
  assert.deepEqual(calls, ['first']);
  cache.setPaused(false); await wait(140);
  assert.deepEqual(calls, ['first', 'second']);
  cache.dispose();
});

test('a dense visible viewport cannot thrash the bounded cache; leaving the viewport permits new work', async () => {
  let firstVisible = true;
  const cache = new VisualThumbnailCache(() => {}, 1);
  const first = { ...job('first', async () => 'first'), wanted: () => firstVisible };
  const second = job('second', async () => 'second');
  cache.request(first); await wait(140);
  for (let i = 0; i < 10; i++) { cache.request(first); cache.request(second); }
  await wait(250);
  assert.equal(cache.stats.captures, 1);
  assert.equal(cache.size, 1);
  firstVisible = false;
  cache.request(second); await wait(140);
  assert.equal(cache.stats.captures, 2);
  assert.equal(cache.request(second), 'second');
  cache.dispose();
});
