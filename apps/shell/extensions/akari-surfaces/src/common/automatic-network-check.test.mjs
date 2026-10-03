import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runAutomaticNetworkCheck } from '../../lib/common/automatic-network-check.js';

test('home latest.json request is skipped while autoCheck is off and runs while on', async () => {
    const calls = [];
    const fetchImpl = async url => { calls.push(url); return { ok: true }; };
    await runAutomaticNetworkCheck(async () => ({ autoCheck: false }), () => fetchImpl('https://example.test/latest.json'));
    assert.equal(calls.length, 0);
    await runAutomaticNetworkCheck(async () => ({ autoCheck: true }), () => fetchImpl('https://example.test/latest.json'));
    assert.deepEqual(calls, ['https://example.test/latest.json']);
});

test('home widget wires the persisted setting into its actual background fetch', async t => {
    const source = ts.createSourceFile('akari-home-widget.tsx', readFileSync(new URL('../browser/akari-home-widget.tsx', import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariHomeWidget');
    const member = owner.members.find(node => node.name?.getText(source) === 'triggerUpdateBackgroundFetch');
    const compiled = ts.transpileModule(`class Home { ${member.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const trigger = new Function('runAutomaticNetworkCheck', 'DEFAULT_UPDATE_FEED_URL',
        `${compiled}\nreturn Home.prototype.triggerUpdateBackgroundFetch;`)(runAutomaticNetworkCheck, 'https://example.test/latest.json');
    const calls = [];
    t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return { ok: false }; });
    let autoCheck = false;
    const home = { updateSettings: { getUpdateSettings: async () => ({ autoCheck }) },
        envVariables: { getValue: async () => undefined } };
    await trigger.call(home);
    assert.equal(calls.length, 0);
    autoCheck = true;
    await trigger.call(home);
    assert.deepEqual(calls, ['https://example.test/latest.json']);
});
