import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { renderOverlaySheet } from '../src/rasterize.mjs';
import { renderProject } from '../src/render-cut.mjs';

const neon = readFileSync(new URL('../../gpu-export/test/fixtures/vgpu-neon.html', import.meta.url), 'utf8');
const edit = { output: { width: 320, height: 180, fps: 30 } };

test('sheet injects vgpu only for declarations and preserves existing static/three sheets byte-for-byte', () => {
  const sheet = html => renderOverlaySheet({ overlays: [{ id: 'v', start: 0, duration: 1, html }], edit, projectRoot: process.cwd(), duration: 1 });
  const gpu = sheet(neon);
  assert.ok(gpu.indexOf('window.AkariVgpu=') < gpu.indexOf('window.akari.vgpuRuntime ='));
  assert.match(gpu, /await window\.akari\.vgpuRuntime\.probe\(\)/);
  assert.match(gpu, /window\.akari\.vgpuRuntime\.render\(vgpuContainer, localSeconds, \{ fps: 30 \}\)/);
  const alternateFps = 24;
  const alternateSheet = renderOverlaySheet({
    overlays: [{ id: 'v', start: 0, duration: 1, html: neon }],
    edit: { ...edit, output: { ...edit.output, fps: alternateFps } }, projectRoot: process.cwd(), duration: 1,
  });
  assert.ok(alternateSheet.includes(`window.akari.vgpuRuntime.render(vgpuContainer, localSeconds, { fps: ${alternateFps} });`));
  assert.match(gpu, /pendingVgpuDraws\.push\(\[vgpuContainer, seconds - start\]\)/);
  for (const [html, hash] of [
    ['<div>static</div>', '5078fecb28be4bf74705d4b87ff01677ff78c67d1fd92cf7ca78f98f66c39d7e'],
    ['<canvas></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"title","text":"Test"}]}</script>', '4158fbb017567853f6d0f9f99ddc637b76a2236fdcb225b697dbd5a3e9aa0692'],
  ]) {
    const actual = sheet(html);
    assert.doesNotMatch(actual, /vgpuRuntime|AkariVgpu|pendingVgpu/);
    assert.equal(createHash('sha256').update(actual).digest('hex'), hash);
  }
});

test('direct legacy API refuses vgpu before starting a render', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vgpu-legacy-'));
  try {
    await mkdir(join(root, '.akari'));
    await writeFile(join(root, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
    await writeFile(join(root, 'overlay.html'), neon);
    await writeFile(join(root, 'source.mp4'), 'fixture');
    await writeFile(join(root, 'edit.json'), JSON.stringify({ version: 2, output: edit.output, sources: [{ id: "unused", path: "source.mp4" }],
      tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'v', at: 0, duration: 30, source: { kind: 'html', path: 'overlay.html' } }] }],
    }));
    await assert.rejects(renderProject(root, { engine: 'legacy', planOnly: true }), /vgpu overlays require --engine gpu/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
