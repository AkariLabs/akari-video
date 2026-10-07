import test from 'node:test';
import assert from 'node:assert/strict';
import { localWebOrigin, externalUrl, isHostMainFrameReload } from '../lib/electron-common/partner-web-url.js';

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
        'https://127.0.0.2/', 'https://foo.localhost/', 'file:///tmp/test', 'javascript:alert(1)'
    ]) assert.equal(externalUrl(url), undefined, url);
});

test('host reload detection supports detail properties and legacy navigation arguments', () => {
    assert.equal(isHostMainFrameReload({ isMainFrame: true, isSameDocument: false }), true);
    assert.equal(isHostMainFrameReload({ isMainFrame: true, isSameDocument: true }), false);
    assert.equal(isHostMainFrameReload({ isMainFrame: false, isSameDocument: false }), false);
    assert.equal(isHostMainFrameReload({}, false, true), true);
    assert.equal(isHostMainFrameReload({}, true, true), false);
    assert.equal(isHostMainFrameReload({}, false, false), false);
});
