import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const { rewritePreviewFragmentAssets } = createRequire(import.meta.url)('../lib/node/fragment-assets.js');

test('shell fragment assets use shared resolution and registered stream URLs', async t => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'shell-fragment-assets-'));
    t.after(() => rm(projectRoot, { recursive: true, force: true }));
    await mkdir(join(projectRoot, 'assets'));
    await writeFile(join(projectRoot, 'assets/logo.png'), 'image');
    const html = `<div><img src="../../assets/logo.png" srcset="../../assets/logo.png 2x"><style>.x{background:url(../../assets/logo.png)}</style><img src="../assets/logo.png"><img src="../../../outside.png"><!-- <img src="missing.png"> --><script type="application/json">{"html":"<img src='missing.png'>"}</script></div>`;
    const uris = [];
    const url = 'http://127.0.0.1:4567/asset/logo.png';
    const result = await rewritePreviewFragmentAssets(html, {
        projectRoot, htmlPath: 'overlays/lower-third/fragment.html', overlayId: 'logo'
    }, async uri => {
        uris.push(uri);
        return { id: 'logo', url };
    });
    assert.deepEqual(uris.map(fileURLToPath), [join(projectRoot, 'assets/logo.png')]);
    assert.equal(result.streams.length, 1);
    assert.equal(result.html, html.replaceAll('../../assets/logo.png', url)
        .replace('../assets/logo.png', 'about:invalid#overlays%2Fassets%2Flogo.png')
        .replace('../../../outside.png', 'about:invalid#..%2Foutside.png'));
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings[0].includes('overlay:logo fragment overlays/lower-third/fragment.html の参照 "../assets/logo.png"'));
    const again = await rewritePreviewFragmentAssets(result.html, {
        projectRoot, htmlPath: 'overlays/lower-third/fragment.html', overlayId: 'logo'
    }, async () => { throw new Error('already rewritten'); });
    assert.equal(again.html, result.html);
    assert.deepEqual(again.streams, []);
});
