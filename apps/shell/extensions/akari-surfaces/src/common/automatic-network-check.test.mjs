import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runAutomaticNetworkCheck, saveAutomaticCheck, showPrivacyNoticeOnce } from '../../lib/common/automatic-network-check.js';

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

test('privacy explanation is shown once and its switch saves both persistent settings and preference', async () => {
    let seen = false;
    let shown = 0;
    const actions = {
        markerExists: async () => seen,
        show: async () => { shown++; },
        markSeen: async () => { seen = true; }
    };
    assert.equal(await showPrivacyNoticeOnce(actions), true);
    assert.equal(await showPrivacyNoticeOnce(actions), false);
    assert.equal(shown, 1);
    const writes = [];
    await saveAutomaticCheck(false, {
        writeSettings: async value => { writes.push(['update-preferences.json', value]); },
        writePreference: async value => { writes.push(['akari.update.autoCheck', value]); }
    });
    assert.deepEqual(writes, [['update-preferences.json', false], ['akari.update.autoCheck', false]]);
});

test('failed privacy explanation leaves the marker absent for the next launch', async () => {
    let marked = false;
    const actions = {
        markerExists: async () => marked,
        show: async () => { throw new Error('dialog unavailable'); },
        markSeen: async () => { marked = true; }
    };
    await assert.rejects(showPrivacyNoticeOnce(actions), /dialog unavailable/);
    assert.equal(marked, false);
    await assert.rejects(showPrivacyNoticeOnce(actions), /dialog unavailable/);
    assert.equal(marked, false);
});

test('home initialization continues when the privacy dialog cannot open', async t => {
    const source = ts.createSourceFile('akari-home-widget.tsx', readFileSync(new URL('../browser/akari-home-widget.tsx', import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariHomeWidget');
    const member = owner.members.find(node => node.name?.getText(source) === 'showPrivacyNotice');
    const compiled = ts.transpileModule(`class Home { ${member.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const showPrivacyNotice = new Function('AkariPrivacyNoticeDialog', `${compiled}\nreturn Home.prototype.showPrivacyNotice;`)(
        class { async openNotice() { throw new Error('dialog unavailable'); } }
    );
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    await assert.doesNotReject(showPrivacyNotice.call({}));
    assert.equal(warnings.length, 1);
});

test('late settings response does not undo a switch the user already changed', () => {
    const source = ts.createSourceFile('akari-privacy-notice-dialog.ts', readFileSync(new URL('../browser/akari-privacy-notice-dialog.ts', import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPrivacyNoticeDialog');
    const member = owner.members.find(node => node.name?.getText(source) === 'applyInitialAutoCheck');
    const compiled = ts.transpileModule(`class Notice { ${member.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const apply = new Function(`${compiled}\nreturn Notice.prototype.applyInitialAutoCheck;`)();
    const attributes = new Map();
    const notice = { switchTouched: true, autoCheck: false,
        autoCheckSwitch: { setAttribute: (name, value) => attributes.set(name, value) } };
    apply.call(notice, true);
    assert.equal(notice.autoCheck, false);
    assert.equal(attributes.size, 0);
    notice.switchTouched = false;
    apply.call(notice, true);
    assert.equal(notice.autoCheck, true);
    assert.equal(attributes.get('aria-checked'), 'true');
});
