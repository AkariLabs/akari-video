// task/2026-09-02-preview-perf: オーバーレイ実行系・字幕フォント・frame-engine を webview へ
// URL で配る（getOverlayRuntimeAssetUrls）。従来は本文（フォントは base64 data: URI）を
// prepareHtml() の HTML に埋めていたため、開くたびに約 15 MB の setHTML になっていた。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');

const URL_KEYS = [
    'threeJavaScriptUrl',
    'threeTextJavaScriptUrl',
    'threeRuntimeJavaScriptUrl',
    'videoFxJavaScriptUrl',
    'runtimeJavaScriptUrl',
    'interactionJavaScriptUrl',
    'webviewKernelJavaScriptUrl',
    'frameEngineJavaScriptUrl',
    'captionFontUrl'
];

test('overlay runtime assets are served by content-hashed URL with immutable caching', async () => {
    const service = new AkariPreviewServiceImpl();
    try {
        const urls = await service.getOverlayRuntimeAssetUrls({ includeFrameEngine: true });
        assert.match(urls.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
        for (const key of URL_KEYS) {
            assert.equal(typeof urls[key], 'string', key);
            assert.ok(urls[key].startsWith(`${urls.origin}/static/`), `${key}: ${urls[key]}`);
            assert.match(urls[key].slice(urls.origin.length), /^\/static\/[a-f0-9]{16}\/[a-z0-9.-]+$/, key);
        }
        assert.equal(typeof urls.interactionCss, 'string');
        assert.ok(urls.interactionCss.length > 0);

        // 同じ内容 → 同じ URL（webview の immutable キャッシュを setHTML をまたいで有効に保つ）
        const again = await service.getOverlayRuntimeAssetUrls({ includeFrameEngine: true });
        assert.deepEqual(again, urls);
        // frame-engine を要求しない呼び出しでは URL が無い（legacy 明示時と同じ形）
        const withoutEngine = await service.getOverlayRuntimeAssetUrls();
        assert.equal(withoutEngine.frameEngineJavaScriptUrl, undefined);
        assert.equal(withoutEngine.captionFontUrl, urls.captionFontUrl);

        // 配信内容は文字列形（getOverlayRuntimeAssets）と 1 バイトも違わない
        const assets = await service.getOverlayRuntimeAssets({ includeFrameEngine: true });
        const font = await fetch(urls.captionFontUrl);
        assert.equal(font.status, 200);
        assert.equal(font.headers.get('content-type'), 'font/ttf');
        assert.equal(font.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        assert.equal(font.headers.get('access-control-allow-origin'), '*');
        const fontBytes = Buffer.from(await font.arrayBuffer());
        assert.equal(`data:font/ttf;base64,${fontBytes.toString('base64')}`, assets.captionFontDataUri);
        assert.ok(fontBytes.byteLength > 1024 * 1024, 'variable font is several MB');

        const runtime = await fetch(urls.runtimeJavaScriptUrl);
        assert.equal(runtime.headers.get('content-type'), 'text/javascript; charset=utf-8');
        assert.equal(await runtime.text(), assets.runtimeJavaScript);
        assert.equal(await (await fetch(urls.frameEngineJavaScriptUrl)).text(), assets.frameEngineJavaScript);
        assert.equal(await (await fetch(urls.webviewKernelJavaScriptUrl)).text(), assets.webviewKernelJavaScript);
        assert.equal(await (await fetch(urls.threeJavaScriptUrl)).text(), assets.threeJavaScript);

        // HEAD は本文なしで長さだけ、未知のハッシュは 404、GET / HEAD 以外は 405
        const head = await fetch(urls.captionFontUrl, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(Number(head.headers.get('content-length')), fontBytes.byteLength);
        assert.equal((await fetch(`${urls.origin}/static/0000000000000000/three-bundle.js`)).status, 404);
        assert.equal((await fetch(`${urls.origin}/static/`)).status, 404);
        assert.equal((await fetch(urls.threeJavaScriptUrl, { method: 'POST' })).status, 405);
    } finally {
        service.server?.close();
    }
});

test('prepareHtml references the runtime by URL and never inlines the font or the bundles', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    // 本文の埋め込みは残っていない
    assert.ok(!source.includes('captionFontDataUri'), 'handler must not touch the data: URI form');
    assert.ok(!/inlineScript\(assets\./.test(source), 'handler must not inline asset bundles');
    // URL 参照と CSP の許可
    assert.match(source, /captionFontFaceCss\(assets\.captionFontUrl\)/);
    for (const key of URL_KEYS.filter(k => k !== 'captionFontUrl')) {
        assert.match(source, new RegExp(`externalScriptTag\\(assets\\.${key}\\)`), key);
    }
    assert.match(source, /script-src 'unsafe-inline' \$\{assetOrigin\}/);
    assert.match(source, /font-src \$\{assetOrigin\} data:/);
    // 変更検知は URL（内容ハッシュ付き）で行う
    assert.match(source, /overlayRuntimeAssets: \[\s*assets\.threeJavaScriptUrl,/);
});
