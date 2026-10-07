import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAndBuildOsrPage } from '../src/page-builder.mjs';
import { loadAndBuildGpuPage } from '../../gpu-export/src/page-builder.mjs';

test('inline element override keeps fragment-relative image and CSS asset in OSR and GPU sprite', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-elements-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'overlays'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(root, 'overlays', 'x.png'), png);
  await writeFile(join(root, 'overlays', 'y.png'), png);
  await writeFile(join(root, 'overlays', 'font.woff2'), 'font');
  const fragment = '<style>@font-face{font-family:probe;src:url(./font.woff2)}.tile{background-image:url(./y.png)}</style><img class="tile" src="./x.png">';
  const path = join(root, 'overlays', 'fragment.html');
  await writeFile(path, fragment);
  await writeFile(join(root, 'edit.json'), JSON.stringify({
    version: 2, output: { width: 64, height: 36, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'tile', at: 0, duration: 30,
      source: { kind: 'html', path: 'overlays/fragment.html',
        elements: { '.tile[0]': { style: { width: '20px' } } } } }] }],
  }));
  const before = await readFile(path);
  const osr = await loadAndBuildOsrPage({ projectRoot: root, duration: 1 });
  const gpu = await loadAndBuildGpuPage({ projectRoot: root, duration: 1 });
  for (const value of [osr, gpu]) {
    assert.equal(value.edit.overlays[0].htmlPath, 'overlays/fragment.html');
  }
  assert.match(osr.overlaySheetHtml, /data:image\/png;base64,/u);
  assert.doesNotMatch(osr.overlaySheetHtml, /\.\/(?:x|y)\.png|\.\/font\.woff2/u);
  assert.match(osr.overlaySheetHtml, /data:font\/woff2;base64,/u);
  assert.match(osr.overlaySheetHtml, /style="width:20px"/u);
  assert.match(gpu.spriteManifest.statics[0].html, /data:image\/png;base64,/u);
  assert.doesNotMatch(gpu.spriteManifest.statics[0].html, /\.\/(?:x|y)\.png|\.\/font\.woff2/u);
  assert.match(gpu.spriteManifest.statics[0].html, /data:font\/woff2;base64,/u);
  assert.match(gpu.spriteManifest.statics[0].html, /style="width:20px"/u);
  assert.deepEqual(await readFile(path), before);
});
