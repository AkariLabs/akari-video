import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BUNDLED_FONT_ROOT } from '../../render-cut/src/caption-font-faces.mjs';
import { startStaticServer } from '../src/static-server.mjs';

test('OSR serves only registered bundled and library font URLs', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'osr-font-serving-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const home = join(temp, 'home');
  const dir = join(home, 'assets/font/probe-hand');
  await mkdir(dir, { recursive: true });
  await copyFile(join(BUNDLED_FONT_ROOT, 'dela-gothic-one/DelaGothicOne-Regular.ttf'), join(dir, 'ProbeHand-Regular.ttf'));
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: 'probe-hand', category: 'font', title: 'Probe Hand（検証）', tags: [], license: {} }));
  const server = await startStaticServer({ pageHtml: '', overlaySheetHtml: '', projectRoot: temp,
    captionFontPath: join(BUNDLED_FONT_ROOT, 'noto-sans-jp/NotoSansJP-Variable.ttf'),
    env: { AKARI_HOME: home } });
  t.after(() => server.close());
  for (const url of ['/caption-fonts/noto-serif-jp/NotoSerifJP-Variable.ttf',
    '/caption-fonts/noto-sans-jp-alias/NotoSansJP-Variable.ttf', '/caption-fonts/library-probe-hand']) {
    const response = await fetch(new URL(url, server.url));
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('content-type'), 'font/ttf');
    assert.ok((await response.arrayBuffer()).byteLength > 1024);
  }
  assert.equal((await fetch(new URL('/caption-fonts/library-unknown', server.url))).status, 404);
  assert.equal((await fetch(`${server.url}caption-fonts/%2e%2e/unknown.ttf`)).status, 404);
});
