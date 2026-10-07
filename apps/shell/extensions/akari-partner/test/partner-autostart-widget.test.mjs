import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { decideAutoStart } from '../lib/common/partner-autostart.js';
import { rememberPartnerClose } from '../lib/common/partner-last-session.js';

const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-partner-widget.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPartnerWidget');
function method(name, dependencies) {
    const member = owner.members.find(node => node.name?.getText(source) === name);
    const code = ts.transpileModule(`class Widget { ${member.getText(source)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    return new Function(...Object.keys(dependencies), `${code}\nreturn Widget.prototype.${name};`)(...Object.values(dependencies));
}

test('uninstalled automatic partner shows a quiet notice without opening a dialog', async () => {
    const entry = { id: 'cli', agent: 'sample', form: 'cli', name: 'Sample' };
    const notices = [];
    let starts = 0;
    const widget = {
        autoStartAttempted: false,
        workspaceService: { roots: [{ resource: { toString: () => 'file:///project' } }] },
        storageService: { getData: async () => ({ entryId: 'cli' }) },
        widgetManager: { getWidget: async () => undefined },
        preferences: { get: () => true },
        liveTerminals: new Map(),
        partnerServer: { bootstrap: async () => ({ consentRequired: true, disclosure: 'Install?' }) },
        setAutoStartNotice: (_entry, notice) => notices.push(notice),
        beginCli: async () => { starts++; }
    };
    const run = method('autoStartLastPartner', {
        decideAutoStart, PARTNER_LAST_KEY: 'akari.partner.last', PARTNER_REOPEN_PREFERENCE: 'akari.partner.reopenLast',
        PARTNER_CATALOG: [entry], PartnerWebWidget: { ID: 'web' }
    });
    await run.call(widget);
    assert.deepEqual(notices, ['前回のパートナー（Sample）は未導入です']);
    assert.equal(starts, 0);
    await run.call(widget);
    assert.equal(notices.length, 1);
});

test('only a close request before disposal clears the project entry', async () => {
    const writes = [];
    const owner = { storageService: { async setData(_key, value) { writes.push(value); } } };
    const observe = method('observeUserClose', { rememberPartnerClose, console });
    const makeWidget = () => {
        let disposed;
        return {
            widget: {
                onCloseRequest() {},
                disposed: { connect(callback) { disposed = callback; } }
            },
            dispose: () => disposed()
        };
    };
    const cleanup = makeWidget();
    observe.call(owner, cleanup.widget);
    cleanup.dispose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes.length, 0);
    const userClose = makeWidget();
    observe.call(owner, userClose.widget);
    userClose.widget.onCloseRequest({ type: 'close-request' });
    userClose.dispose();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes.map(value => value.entryId), [null]);
});

test('automatic reveal leaves activation to the manual path', async () => {
    const calls = [];
    const show = method('showPartnerWidget', {});
    const widget = { autoStarting: true, shell: {
        revealWidget: async id => { calls.push(['reveal', id]); },
        activateWidget: async id => { calls.push(['activate', id]); }
    } };
    await show.call(widget, 'partner');
    widget.autoStarting = false;
    await show.call(widget, 'partner');
    assert.deepEqual(calls, [['reveal', 'partner'], ['activate', 'partner']]);
});
