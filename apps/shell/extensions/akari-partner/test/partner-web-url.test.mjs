import test from 'node:test';
import assert from 'node:assert/strict';
import { localWebOrigin, externalUrl, guardPartnerWebview,
    PARTNER_WEB_PARTITION } from '../lib/electron-common/partner-web-url.js';

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
        preloadURL: 'file:///bad.js', nodeIntegration: true, contextIsolation: false, sandbox: false, webSecurity: false };
    const params = { src: 'http://127.0.0.1:42317/', preload: 'file:///bad.js', allowpopups: 'true' };
    assert.equal(guardPartnerWebview({ preventDefault() { assert.fail('valid attach rejected'); } },
        preferences, params), 'http://127.0.0.1:42317');
    assert.equal(preferences.preload, undefined);
    assert.equal(preferences.preloadURL, undefined);
    assert.equal(preferences.webSecurity, undefined);
    assert.equal(params.preload, undefined);
    assert.equal(params.allowpopups, undefined);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
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
