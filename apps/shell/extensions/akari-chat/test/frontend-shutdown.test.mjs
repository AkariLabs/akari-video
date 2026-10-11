import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AkariChatShutdownContribution } = require('../lib/browser/chat-shutdown-contribution.js');

test('frontend onStop sends closeAll without waiting for the RPC', async () => {
    const contribution = new AkariChatShutdownContribution();
    let calls = 0;
    let finish;
    contribution.chat = { closeAll: () => {
        calls++;
        return new Promise(resolve => { finish = resolve; });
    } };
    assert.equal(contribution.onStop(), undefined);
    assert.equal(calls, 1);
    finish();
    await new Promise(resolve => setImmediate(resolve));
    contribution.chat = { closeAll: () => Promise.reject(new Error('disconnected')) };
    contribution.onStop();
    await new Promise(resolve => setImmediate(resolve));
    contribution.chat = { closeAll: () => { throw new Error('disconnected'); } };
    assert.doesNotThrow(() => contribution.onStop());
});

test('frontend module binds the shutdown contribution', async () => {
    const source = await readFile(new URL('../src/browser/akari-chat-frontend-module.ts', import.meta.url), 'utf8');
    assert.match(source, /bind\(FrontendApplicationContribution\)\.toService\(AkariChatShutdownContribution\)/);
});
