import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ReviewSessionWriter } from '../lib/node/review-session-writer.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function wav() {
  const bytes = Buffer.alloc(44 + 32000);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32000, 40);
  return bytes;
}

async function fixture({ compiled = true, brokenEvents = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'akari-review-bundle-'));
  const directory = join(root, 'review', 'sessions', 's-0001');
  await mkdir(directory, { recursive: true });
  const files = {
    'audio.wav': wav(),
    'events.jsonl': Buffer.from(`${JSON.stringify({ recT: 2, type: 'pause', timelineT: 3 })}\n${brokenEvents ? '{bad\n' : ''}${JSON.stringify({ recT: 0, type: 'start', timelineT: 1, playing: true })}\n`),
    'strokes.json': Buffer.from(JSON.stringify({ version: 1, strokes: [{ id: 'st-0001', tool: 'pen', space: 'content-rect', recTStart: 1, recTEnd: 2, frame: { timelineT: 2, sourceT: 2, cutIndex: null }, points: [[0, 0], [1, 1]] }] })),
    'edit.snapshot.json': Buffer.from('{"version":0,"cuts":[]}'),
    ...(compiled ? {
      'transcript.json': Buffer.from(JSON.stringify({ segments: [{ start: 1, end: 2, text: 'ここを移動' }] })),
      'compile-proposals.json': Buffer.from(JSON.stringify({ sessionId: 's-0001', proposals: [{ transcript: 'ここを移動', recRange: [1, 2], reference: { target: 'cut:2', sourceT: 4.2, timelineT: 8, confidence: 'low', resolutionMethod: 'trajectory' } }] }))
    } : {})
  };
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes);
  const canonical = await realpath(root);
  return { root, directory, files, writer: new ReviewSessionWriter(async () => [canonical]) };
}

test('reads the complete bundle and leaves all original bytes unchanged', async () => {
  const { root, directory, files, writer } = await fixture();
  const before = Object.fromEntries(await Promise.all(Object.keys(files).map(async name => [name, hash(await readFile(join(directory, name)))])));
  const result = await writer.readBundle({ projectRootUri: pathToFileURL(root).toString(), sessionId: 's-0001' });
  assert.deepEqual(result.events.map(event => event.recT), [0, 2]);
  assert.equal(result.strokes.length, 1); assert.equal(result.transcript[0].text, 'ここを移動');
  assert.equal(result.proposals[0].target, 'cut:2'); assert.equal(result.editSnapshotText, files['edit.snapshot.json'].toString());
  assert.match(result.audioUri, /^file:/); assert.equal(result.audioDurationSec, 1);
  const after = Object.fromEntries(await Promise.all(Object.keys(files).map(async name => [name, hash(await readFile(join(directory, name)))])));
  assert.deepEqual(after, before);
});

test('missing derived files are null without warnings', async () => {
  const { root, writer } = await fixture({ compiled: false });
  const result = await writer.readBundle({ projectRootUri: pathToFileURL(root).toString(), sessionId: 's-0001' });
  assert.equal(result.transcript, null); assert.equal(result.proposals, null); assert.deepEqual(result.warnings, []);
});

test('skips broken JSONL lines, rejects traversal, and returns a v0 snapshot as text', async () => {
  const { root, writer } = await fixture({ brokenEvents: true });
  const request = { projectRootUri: pathToFileURL(root).toString(), sessionId: 's-0001' };
  const result = await writer.readBundle(request);
  assert.deepEqual(result.events.map(event => event.recT), [0, 2]);
  assert.match(result.warnings.join('\n'), /events\.jsonl 2 行目/);
  assert.match(result.editSnapshotText, /"version":0/);
  await assert.rejects(() => writer.readBundle({ ...request, sessionId: '../s-0001' }), /Invalid review session id/);
});
