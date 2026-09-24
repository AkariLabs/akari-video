import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFalImageAiConnection } from '../../lib/node/image-ai-connection.js';

test('empty key does not call fal and is unconfigured', async () => {
    const result = await checkFalImageAiConnection('', async () => { throw Error('must not call'); });
    assert.equal(result.status, 'unconfigured');
});

test('only a real successful fal response counts as connected', async () => {
    const requests = [];
    const fetchMock = async (url, init) => { requests.push([url, init]); return new Response('{}', { status: 200 }); };
    const result = await checkFalImageAiConnection('test-key', fetchMock);
    assert.equal(result.status, 'ok');
    assert.equal(requests.length, 1);
    assert.equal(requests[0][1].method, 'GET');
    assert.equal(requests[0][1].headers.Authorization, 'Key test-key');
});

test('unauthorized and transport failure are never reported as success', async () => {
    const unauthorized = await checkFalImageAiConnection('wrong', async () => new Response('{}', { status: 401 }));
    const offline = await checkFalImageAiConnection('key', async () => { throw Error('offline'); });
    assert.equal(unauthorized.status, 'unauthorized');
    assert.equal(offline.status, 'unchecked');
    assert.doesNotMatch(JSON.stringify([unauthorized, offline]), /wrong/);
});
