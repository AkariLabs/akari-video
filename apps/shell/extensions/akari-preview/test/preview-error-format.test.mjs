import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { formatPreviewError } from '../lib/common/preview-error-format.js';
import { previewBootstrapScript } from '../lib/browser/preview-script-bootstrap.js';

test('overlay rejection keeps Error details through console forwarding', () => {
    const error = new TypeError('caption font did not load');
    const formatted = formatPreviewError(error);
    assert.match(formatted, /TypeError/);
    assert.match(formatted, /caption font did not load/);
    assert.ok(error.stack && formatted.includes(error.stack));
    assert.equal(formatted, error.stack);
    assert.notEqual(JSON.stringify([formatted]), '[{}]');
});

test('cross-realm and plain error-like values keep their stacks', () => {
    const crossRealm = runInNewContext('new RangeError("x")');
    assert.equal(crossRealm instanceof Error, false);
    const crossRealmText = formatPreviewError(crossRealm);
    assert.match(crossRealmText, /RangeError: x/);
    assert.ok(crossRealmText.includes(crossRealm.stack));

    const plain = { name: 'DOMException', message: 'blocked', stack: 'DOMException: blocked\n    at foreignWindow' };
    assert.equal(formatPreviewError(plain), plain.stack);
    assert.equal(formatPreviewError({ message: 'missing' }), 'Error: missing');
    assert.equal(formatPreviewError({ stack: 'foreign trace' }), 'Error\nforeign trace');
    const namedByConstructor = new class RemoteFault { message = 'broken'; stack = 'foreign trace'; }();
    assert.equal(formatPreviewError(namedByConstructor), 'RemoteFault: broken\nforeign trace');
});

test('non-Error rejections can be formatted safely', () => {
    for (const value of ['failed', { reason: 'missing' }, new Event('error'), null, undefined,
        { get name() { throw new Error('getter failed'); } }]) {
        assert.doesNotThrow(() => formatPreviewError(value));
        assert.equal(typeof formatPreviewError(value), 'string');
    }
    assert.match(formatPreviewError(new Event('error')), /error/);
    assert.match(formatPreviewError({ reason: 'missing' }), /missing/);
});

test('both overlay mount logs embed the self-contained formatter', () => {
    const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
    assert.match(source, /incremental overlay mount failed', formatPreviewErrorFn\(error\)/);
    assert.match(source, /overlay mount failed', formatPreviewErrorFn\(error\)/);
    const script = previewBootstrapScript();
    assert.match(script, /const formatPreviewErrorFn = \(/);
    assert.match(script, /incremental overlay mount failed', formatPreviewErrorFn\(error\)/);
    assert.match(script, /overlay mount failed', formatPreviewErrorFn\(error\)/);
});
