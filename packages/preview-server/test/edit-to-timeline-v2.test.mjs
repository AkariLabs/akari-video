import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { editToTimeline } from '../src/edit-to-timeline.mjs';
import { projectPreviewEdit } from '../src/preview-edit.mjs';

const require = createRequire(import.meta.url);
const { readInternalEdit, projectLegacyEdit } = require('../../edit-store/lib/index.js');

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SERVER = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'src', 'server.mjs');

function rawV2Fixture() {
  return {
    version: 2,
    output: { width: 1080, height: 1920, fps: 30 },
    sources: [
      { id: 'poster', path: 'assets/source/poster.PNG', proxy: 'assets/source/proxy/poster.mp4' },
      { id: 'take-b', path: 'assets/source/take-b.mov' },
      {
        id: 'mask-source',
        path: 'assets/source/person.webm',
        chroma_key: { color: '#00ff00', similarity: 0.25, blend: 0.08 },
      },
      { id: 'music', path: 'assets/audio/music.wav' },
      { id: 'hit', path: 'assets/audio/hit.wav' },
      { id: 'voice', path: 'assets/audio/voice.wav' },
    ],
    tracks: [
      {
        id: 'a-bgm', lane: 'audio', items: [{
          id: 'music-1', at: 0, duration: 150, role: 'bgm', ducking: true,
          source: { kind: 'media', src: 'music', in: 0, out: 5 },
        }],
      },
      {
        id: 'a-sfx', lane: 'audio', items: [{
          id: 'hit-1', at: 30, duration: 15,
          source: { kind: 'media', src: 'hit', in: 0, out: 0.5 },
        }],
      },
      {
        id: 'a-narration', lane: 'audio', items: [{
          id: 'voice-1', at: 60, duration: 60, role: 'narration', gain_db: 1,
          source: { kind: 'media', src: 'voice', in: 0, out: 2 },
        }],
      },
      {
        id: 'v-base', lane: 'visual', items: [{
          id: 'poster-1', at: 0, duration: 60,
          source: { kind: 'media', src: 'poster', in: 0, out: 2 },
        }],
      },
      {
        id: 'v-mixed', lane: 'visual', items: [
          {
            id: 'take-b-1', at: 60, duration: 90,
            source: { kind: 'media', src: 'take-b', in: 4, out: 7 },
          },
          {
            id: 'panel-1', at: 15, duration: 30,
            source: { kind: 'html', path: 'overlays/panel.html' },
          },
        ],
      },
    ],
  };
}

function expectedClipCoordinates(legacy, fps) {
  return legacy.cuts.map((cut) => {
    const speed = cut.speed ?? 1;
    const durationFrames = Math.round(((cut.out - cut.in) / speed) * fps);
    const startFrame = Math.round(cut.at * fps);
    return {
      startFrame,
      endFrame: startFrame + durationFrames,
      track: cut.track ?? 0,
    };
  });
}

test('raw v2 projects through edit-store with proxy playback and source-path media type', () => {
  const edit = rawV2Fixture();
  const timeline = editToTimeline(edit, '/project');
  const legacy = projectLegacyEdit(readInternalEdit(edit));

  assert.equal(timeline.clips.length, 2);
  assert.equal(Math.max(...timeline.clips.map(clip => clip.endFrame)), 150);
  assert.deepEqual(
    timeline.clips.map(({ startFrame, endFrame, track }) => ({ startFrame, endFrame, track })),
    expectedClipCoordinates(legacy, legacy.fps),
  );

  assert.equal(timeline.clips[0].src, '/assets/source/proxy/poster.mp4');
  assert.equal(timeline.clips[0].mediaType, 'image');
  assert.equal(timeline.clips[1].src, '/assets/source/take-b.mov');
  assert.equal(timeline.clips[1].mediaType, 'video');
  assert.deepEqual(timeline.clips.map(clip => clip.track), [0, 1]);
  assert.deepEqual(timeline.audio, {
    narration: [{ id: 'voice-1', src: '/assets/audio/voice.wav', t: 2, gainDb: undefined }],
    bgm: { ducking: true },
  });
  assert.equal(legacy.overlays.length, 1);
  assert.equal(legacy.audioSfx.length, 1);
  assert.equal(legacy.audioNarration.length, 1);
  assert.equal(legacy.audioBgm.id, 'bgm');
});

test('invalid tracks hybrid falls back to the pre-v2 empty timeline instead of throwing', () => {
  const hybrid = {
    ...rawV2Fixture(),
    overlays: [{ id: 'compat-overlay', html: '<div></div>', start: 0, duration: 1 }],
  };
  assert.deepEqual(editToTimeline(hybrid, '/project'), { fps: 30, clips: [] });
});

test('renderer compatibility view with tracks and cuts stays on the legacy path', () => {
  const compatibilityView = {
    version: 1,
    output: { fps: 24 },
    tracks: [{ id: 'kept-for-v2-writeback', lane: 'visual', items: [] }],
    sources: [{ id: 'main', path: 'assets/main.mp4', proxy: null }],
    cuts: [{ src: 'main', in: 1, out: 2.5, at: 0.5, track: 3 }],
  };
  assert.equal(JSON.stringify(editToTimeline(compatibilityView, '/project')), JSON.stringify({
    fps: 24,
    clips: [{
      id: 'cut-0',
      src: '/assets/main.mp4',
      startFrame: 12,
      endFrame: 48,
      sourceInUs: 1000000,
      track: 3,
      mediaType: 'video',
    }],
  }));
});

test('null, omitted, and empty proxies keep the declared source path', () => {
  for (const proxy of [null, undefined, '']) {
    const source = { id: 'main', path: 'assets/main.mp4' };
    if (proxy !== undefined) source.proxy = proxy;
    const timeline = editToTimeline({
      version: 1,
      output: { fps: 30 },
      sources: [source],
      cuts: [{ src: 'main', in: 0, out: 1 }],
    }, '/project');
    assert.equal(timeline.clips[0].src, '/assets/main.mp4');
  }
});

test('v2 preview projection keeps overlays, all audio roles, and source mask data mountable', () => {
  const summary = projectPreviewEdit(
    rawV2Fixture(),
    '/project/.akari/preview-projection',
    '/project',
  );
  assert.equal(summary.overlays.length, 1);
  assert.equal(summary.audio.sfx.length, 1);
  assert.equal(summary.audio.narration.length, 1);
  assert.equal(summary.audio.bgm.path, 'assets/audio/music.wav');
  assert.deepEqual(summary.videoFx.sources['mask-source'], {
    color: '#00ff00',
    similarity: 0.25,
    blend: 0.08,
    mode: 'source',
    background: { type: 'color', color: '0x000000' },
  });
});

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(project) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, project, '--port', String(port), '--no-lint'], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`preview server timeout: ${stderr}`)), 15_000);
    child.once('exit', code => reject(new Error(`preview server exited ${code}: ${stderr}`)));
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

test('output timeline accepts raw v2 and the fixed 3D text bundle route is served', async (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-output-v2-'));
  const edit = rawV2Fixture();
  fs.writeFileSync(path.join(project, 'edit.output.json'), JSON.stringify(edit));
  let server;
  try {
    server = await startServer(project);
  } catch (error) {
    fs.rmSync(project, { recursive: true, force: true });
    if (error?.code === 'EPERM') return t.skip('local TCP listener is unavailable in this sandbox');
    throw error;
  }
  t.after(async () => {
    await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
  });

  const timelineResponse = await fetch(`${server.base}/api/output/timeline`);
  assert.equal(timelineResponse.status, 200);
  const timeline = await timelineResponse.json();
  assert.equal(timeline.clips.length, 2);
  assert.equal(Math.max(...timeline.clips.map(clip => clip.endFrame)), 150);

  const bundleResponse = await fetch(`${server.base}/vendor-3d-text-bundle.js`);
  assert.equal(bundleResponse.status, 200);
  assert.match(bundleResponse.headers.get('content-type'), /^application\/javascript/);
  assert.ok((await bundleResponse.arrayBuffer()).byteLength > 300_000);
});
