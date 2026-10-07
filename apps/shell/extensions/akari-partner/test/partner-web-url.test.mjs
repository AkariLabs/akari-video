import test from 'node:test';
import assert from 'node:assert/strict';
import { allowPartnerWebRequest, localWebOrigin, externalUrl, guardPartnerWebview,
    PARTNER_WEB_PARTITION } from '../lib/electron-common/partner-web-url.js';

test('document requests stay on literal loopback while subresources remain available', () => {
    for (const [url, resourceType, allowed] of [
        ['http://127.0.0.1:42317/', 'mainFrame', true],
        ['http://127.0.0.1:42317/frame', 'subFrame', true],
        ['https://example.com/', 'mainFrame', false],
        ['https://example.com/frame', 'subFrame', false],
        ['file:///tmp/escape.html', 'mainFrame', false],
        ['http://localhost:42317/', 'mainFrame', false],
        ['http://127.0.0.2:42317/', 'mainFrame', false],
        ['devtools://devtools/bundled/inspector.html', 'mainFrame', false],
        ['chrome-error://chromewebdata/', 'mainFrame', false],
        ['about:blank', 'mainFrame', false],
        ['data:text/html,escape', 'mainFrame', false],
        ['https://example.com/app.js', 'script', true],
        ['https://example.com/image.png', 'image', true],
        ['https://example.com/api', 'xhr', true],
        ['data:text/javascript,ok', 'script', true]
    ]) assert.equal(allowPartnerWebRequest({ url, resourceType }), allowed, `${resourceType}: ${url}`);
});

test('webview attach guard accepts only local dsh URL and the dedicated partition', () => {
    for (const src of ['http://localhost:42317/', 'https://example.com/', 'http://127.0.0.2:42317/']) {
        let prevented = false;
        assert.equal(guardPartnerWebview({ preventDefault() { prevented = true; } },
            { partition: PARTNER_WEB_PARTITION }, { src }), undefined);
        assert.equal(prevented, true);
    }
    let prevented = false;
    assert.equal(guardPartnerWebview({ preventDefault() { prevented = true; } },
        { partition: 'persist:other' }, { src: 'http://127.0.0.1:42317/' }), undefined);
    assert.equal(prevented, true);
    const preferences = { partition: PARTNER_WEB_PARTITION, preload: 'file:///bad.js',
        preloadURL: 'file:///bad.js', nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false,
        plugins: true, enableBlinkFeatures: 'UnsafeFeature', allowRunningInsecureContent: true, experimentalFeatures: true };
    const params = { src: 'http://127.0.0.1:42317/', preload: 'file:///bad.js', allowpopups: 'true', allowPopups: 'true' };
    assert.equal(guardPartnerWebview({ preventDefault() { assert.fail('valid attach rejected'); } },
        preferences, params), 'http://127.0.0.1:42317');
    assert.deepEqual(preferences, {
        partition: PARTNER_WEB_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true,
        webviewTag: false, disablePopups: true, backgroundThrottling: false, webSecurity: true
    });
    assert.equal(params.preload, undefined);
    assert.equal(params.allowpopups, undefined);
    assert.equal(params.allowPopups, undefined);
});

test('local web origin accepts only literal 127.0.0.1 with a nonzero port', () => {
    assert.equal(localWebOrigin('http://127.0.0.1:42317/?token=abc'), 'http://127.0.0.1:42317');
    for (const url of [
        'http://localhost:42317/', 'http://[::1]:42317/', 'http://127.0.0.1:0/',
        'http://127.0.0.1:42317@host.example/', 'http://user@127.0.0.1:42317/',
        'http://127.0.0.1:42318@127.0.0.1:42317/', 'http://127.1:42317/',
        'https://127.0.0.1:42317/'
    ]) assert.equal(localWebOrigin(url), undefined, url);
});

test('external navigation requires HTTPS, consent eligibility and no userinfo or loopback', () => {
    assert.equal(externalUrl('https://example.com/path'), 'https://example.com/path');
    for (const url of [
        'http://example.com/', 'https://user@example.com/', 'https://user:pass@example.com/',
        'https://localhost/', 'https://[::1]/', 'https://127.0.0.1:42318/',
        'https://127.0.0.2/', 'https://foo.localhost/', 'https://0.0.0.0/', 'https://[::]/',
        'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/',
        'https://[::ffff:192.168.1.1]/', 'file:///tmp/test', 'javascript:alert(1)'
    ]) assert.equal(externalUrl(url), undefined, url);
});
