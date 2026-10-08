import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { decideAutoStart } from '../lib/common/partner-autostart.js';
import { rememberPartnerClose } from '../lib/common/partner-last-session.js';
import { normalizePartnerPermissionMode } from '../lib/common/partner-permissions.js';

const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-partner-widget.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPartnerWidget');
function method(name, dependencies) {
    const member = owner.members.find(node => node.name?.getText(source) === name);
    const code = ts.transpileModule(`class Widget { ${member.getText(source)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    return new Function(...Object.keys(dependencies), `${code}\nreturn Widget.prototype.${name};`)(...Object.values(dependencies));
}

function topLevelFunction(name) {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const code = ts.transpileModule(declaration.getText(source),
        { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    return new Function(`${code}\nreturn ${name};`)();
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function autoStartMethod(catalog) {
    return method('autoStartLastPartner', {
        decideAutoStart, PARTNER_LAST_KEY: 'akari.partner.last', PARTNER_REOPEN_PREFERENCE: 'akari.partner.reopenLast',
        PARTNER_CATALOG: catalog, PartnerWebWidget: { ID: 'web' }
    });
}

test('権限モードの読取は User 値だけを採用する', () => {
    const read = method('partnerPermissionMode', {
        normalizePartnerPermissionMode, PARTNER_PERMISSION_PREFERENCE: 'akari.partner.permissionMode'
    });
    const widget = { preferences: {
        get: () => assert.fail('merged preference must not be read'),
        inspect: () => ({ globalValue: undefined, workspaceValue: 'bypass', workspaceFolderValue: 'bypass' })
    } };
    assert.equal(read.call(widget), 'auto');
    widget.preferences.inspect = () => ({ globalValue: 'ask', workspaceValue: 'bypass' });
    assert.equal(read.call(widget), 'ask');
});

test('ワークスペースの bypass 指定があっても CLI は User 既定の auto で起動する', async () => {
    const entry = { id: 'codex-cli', agent: 'codex', form: 'cli', name: 'Codex CLI' };
    const terminal = { start: async () => {} };
    let requestedMode;
    const widget = {
        shell: { addWidget: async () => {} }, workspaceService: { roots: [] },
        preferences: { inspect: () => ({ globalValue: undefined, workspaceValue: 'bypass', workspaceFolderValue: 'bypass' }) },
        partnerServer: { async prepareLaunch(_agent, _path, mode) {
            requestedMode = mode;
            return { args: ['--approve-for-me'], env: {}, appliedPermissionMode: 'auto' };
        } },
        terminalService: { async newTerminal(options) { assert.deepEqual(options.shellArgs, ['--approve-for-me']); return terminal; } },
        setProgress() {}, setComplete() {}, setFailure: (_entry, _status, detail) => assert.fail(detail),
        ensureCliProvisioned: async () => {}, attachTerminal: async () => {}, rememberPartnerStart: async () => {}
    };
    widget.partnerPermissionMode = method('partnerPermissionMode', {
        normalizePartnerPermissionMode, PARTNER_PERMISSION_PREFERENCE: 'akari.partner.permissionMode'
    }).bind(widget);
    const beginCli = method('beginCli', {
        appliedPartnerPermissionMode: () => 'auto', partnerPermissionEnv: () => ({}),
        permissionModeLabel: topLevelFunction('permissionModeLabel'),
        PARTNER_CLI_ICON_CLASSES: { codex: 'codex-icon' }, PartnerTerminal: { KIND: 'partner' },
        AkariPartnerInstallDialog: class {}
    });
    await beginCli.call(widget, entry, { executablePath: 'fake-codex', reused: true, runtimeMode: 'node', runtimePath: 'fake-node', log: [] }, true);
    assert.equal(requestedMode, 'auto');
});

test('ツールの既定で起動したタブ名は復元時にも再利用される', async () => {
    const entry = { id: 'cli', agent: 'claude', form: 'cli', name: 'Claude Code CLI' };
    const terminal = { kind: 'partner', title: { label: 'Claude Code CLI（ツールの既定で起動）' }, isDisposed: false };
    const widget = {
        terminalService: { all: [terminal] }, liveTerminals: new Map(),
        isTerminalAlive: async (_terminal, waitForRestore) => { assert.equal(waitForRestore, true); return true; },
        observeTerminalLifecycle(found, foundEntry) { assert.equal(found, terminal); assert.equal(foundEntry, entry); }
    };
    const findExisting = method('findExistingCliTerminal', {
        LEGACY_CLI_LABELS: { claude: [] }, PartnerTerminal: { KIND: 'partner' },
        permissionModeLabel: topLevelFunction('permissionModeLabel')
    });
    assert.equal(await findExisting.call(widget, entry, true), terminal);
    assert.equal(widget.liveTerminals.get(entry.id), terminal);
    assert.equal(terminal.title.label, 'Claude Code CLI（ツールの既定で起動）');
});

test('working auto-start blocks the same manual begin and later reuses one CLI terminal', async () => {
    const entry = { id: 'cli', agent: 'sample', form: 'cli', name: 'Sample' };
    const bootstrap = deferred();
    const entered = deferred();
    const calls = [];
    const terminal = { id: 'terminal' };
    const widget = {
        autoStartAttempted: false,
        preferences: { ready: Promise.resolve(), get: () => true },
        workspaceService: { roots: [{ resource: { toString: () => 'file:///project' } }] },
        storageService: { getData: async () => ({ entryId: entry.id }) },
        widgetManager: { getWidget: async () => undefined },
        partnerServer: { bootstrap: () => { entered.resolve(); return bootstrap.promise; } },
        liveTerminals: new Map(), entryFlows: new Map(),
        entryFlow(candidate) { return this.entryFlows.get(candidate.id) ?? { state: 'idle' }; },
        setProgress(candidate, status) { this.entryFlows.set(candidate.id, { state: 'working', status }); calls.push(status); },
        findExistingCliTerminal: async () => widget.liveTerminals.get(entry.id),
        terminalService: { newTerminal: async () => { calls.push('newTerminal'); return terminal; } },
        async beginCli(candidate, _prepared, automatic) {
            assert.equal(automatic, true);
            const created = await this.terminalService.newTerminal();
            this.liveTerminals.set(candidate.id, created);
            this.entryFlows.set(candidate.id, { state: 'complete' });
        },
        async attachTerminal(existing) { assert.equal(existing, terminal); calls.push('reuse'); },
        cleanupWebPartners: async () => {}, update: () => {}
    };
    widget.autoStartLastPartner = autoStartMethod([entry]).bind(widget);
    const restore = method('restorePartnerTerminals', { PARTNER_CATALOG: [entry], console });
    const begin = method('begin', {});
    await restore.call(widget);
    await entered.promise;
    assert.equal(widget.entryFlow(entry).state, 'working');
    assert.match(calls[0], /前回のパートナー（Sample）を開いています/);
    const manual = begin.call(widget, entry);
    await manual;
    assert.equal(calls.includes('newTerminal'), false);
    const pending = widget.autoStartPromise;
    bootstrap.resolve({ executablePath: 'sample' });
    await pending;
    await begin.call(widget, entry);
    assert.equal(calls.filter(call => call === 'newTerminal').length, 1);
    assert.equal(calls.filter(call => call === 'reuse').length, 1);
});

test('manual begin waits for pending auto-start before checking existing terminals', async () => {
    const entry = { id: 'manual', form: 'cli' };
    const pending = deferred();
    const calls = [];
    const widget = {
        autoStartPromise: pending.promise,
        entryFlows: new Map(),
        entryFlow: () => ({ state: 'idle' }),
        findExistingCliTerminal: async () => { calls.push('lookup'); return undefined; },
        beginCli: async () => { calls.push('start'); }
    };
    const begin = method('begin', {});
    const manual = begin.call(widget, entry);
    await Promise.resolve();
    assert.deepEqual(calls, []);
    pending.resolve();
    await manual;
    assert.deepEqual(calls, ['lookup', 'start']);
});

test('auto-start backs off when another manually started entry is working', async () => {
    const entry = { id: 'auto', agent: 'sample', form: 'cli', name: 'Sample' };
    const other = { id: 'manual', agent: 'other', form: 'cli', name: 'Other' };
    const bootstrap = deferred();
    const entered = deferred();
    const finishManual = deferred();
    const widget = {
        autoStartAttempted: false,
        preferences: { ready: Promise.resolve(), get: () => true },
        workspaceService: { roots: [{ resource: { toString: () => 'file:///project' } }] },
        storageService: { getData: async () => ({ entryId: entry.id }) },
        widgetManager: { getWidget: async () => undefined },
        partnerServer: { bootstrap: () => { entered.resolve(); return bootstrap.promise; } },
        liveTerminals: new Map(), entryFlows: new Map(),
        entryFlow(candidate) { return this.entryFlows.get(candidate.id) ?? { state: 'idle' }; },
        setProgress(candidate, status) { this.entryFlows.set(candidate.id, { state: 'working', status }); this.selected = candidate; },
        findExistingCliTerminal: async () => undefined,
        beginCli: async candidate => {
            if (candidate.id === entry.id) assert.fail('auto-start must back off');
            widget.setProgress(candidate, 'manual setup');
            await finishManual.promise;
        },
        update: () => {}
    };
    widget.clearAutoStartProgress = method('clearAutoStartProgress', {}).bind(widget);
    const auto = autoStartMethod([entry, other]).call(widget);
    await entered.promise;
    const manual = method('begin', {}).call(widget, other);
    await Promise.resolve();
    assert.equal(widget.entryFlow(other).state, 'working');
    bootstrap.resolve({ executablePath: 'sample' });
    await auto;
    assert.equal(widget.entryFlow(entry).state, 'idle');
    assert.equal(widget.selected, other);
    finishManual.resolve();
    await manual;
});

test('auto-start waits for preferences before reading the switch', async () => {
    const ready = deferred();
    let reads = 0;
    const widget = {
        autoStartAttempted: false,
        preferences: { ready: ready.promise, get: () => { reads++; return false; } },
        workspaceService: { roots: [] },
        storageService: { getData: async () => undefined },
        readAppMarkerRaw: async () => undefined,
        widgetManager: { getWidget: async () => undefined },
        liveTerminals: new Map()
    };
    const auto = autoStartMethod([]).call(widget);
    await Promise.resolve();
    assert.equal(reads, 0);
    ready.resolve();
    await auto;
    assert.equal(reads, 1);
});

test('restorePartnerTerminals resolves while autoStartLastPartner is still pending', async () => {
    let finishAutoStart;
    const pendingAutoStart = new Promise(resolve => { finishAutoStart = resolve; });
    const calls = [];
    const widget = {
        cleanupWebPartners: async () => { calls.push('cleanup'); },
        update: () => { calls.push('update'); },
        autoStartLastPartner: () => { calls.push('auto-start'); return pendingAutoStart; }
    };
    const restore = method('restorePartnerTerminals', { PARTNER_CATALOG: [], console });
    try {
        const result = await Promise.race([
            restore.call(widget).then(() => 'resolved'),
            new Promise(resolve => setTimeout(() => resolve('still pending'), 100))
        ]);
        assert.equal(result, 'resolved');
        assert.deepEqual(calls, ['cleanup', 'update', 'auto-start']);
    } finally {
        finishAutoStart();
    }
});

test('uninstalled automatic partner shows a quiet notice without opening a dialog', async () => {
    const entry = { id: 'cli', agent: 'sample', form: 'cli', name: 'Sample' };
    const notices = [];
    let starts = 0;
    const widget = {
        autoStartAttempted: false,
        workspaceService: { roots: [{ resource: { toString: () => 'file:///project' } }] },
        storageService: { getData: async () => ({ entryId: 'cli' }) },
        widgetManager: { getWidget: async () => undefined },
        preferences: { ready: Promise.resolve(), get: () => true },
        liveTerminals: new Map(),
        entryFlows: new Map(),
        setProgress: () => {},
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
    const owner = {
        storageService: { async setData(_key, value) { writes.push(value); } },
        remainingPartnerEntryId: () => undefined
    };
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

test('closing a CLI tab keeps the other live partner as project history', async () => {
    const writes = [];
    let disposed;
    const closed = { onCloseRequest() {}, disposed: { connect(callback) { disposed = callback; } } };
    const live = { isDisposed: false, exitStatus: undefined, terminalId: 2 };
    const owner = {
        liveTerminals: new Map([['closed', closed], ['remaining', live]]),
        storageService: { async setData(_key, value) { writes.push(value); } }
    };
    owner.remainingPartnerEntryId = method('remainingPartnerEntryId', {}).bind(owner);
    method('observeUserClose', { rememberPartnerClose, console }).call(owner, closed);
    closed.onCloseRequest({ type: 'close-request' });
    disposed();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes.map(value => value.entryId), ['remaining']);
});

test('a running web partner remains in project history when a CLI tab closes', () => {
    const closed = { isDisposed: true, exitStatus: undefined, terminalId: 1 };
    const owner = {
        liveTerminals: new Map([['closed', closed]]),
        webWidget: { isRunning: () => true },
        webEntryId: 'deepseek/dsh-web'
    };
    assert.equal(method('remainingPartnerEntryId', {}).call(owner, closed), 'deepseek/dsh-web');
});

test('automatic reveal leaves activation to the manual path', async () => {
    const calls = [];
    const show = method('showPartnerWidget', {});
    const widget = { shell: {
        revealWidget: async id => { calls.push(['reveal', id]); },
        activateWidget: async id => { calls.push(['activate', id]); }
    } };
    await show.call(widget, 'partner', true);
    await show.call(widget, 'partner');
    assert.deepEqual(calls, [['reveal', 'partner'], ['activate', 'partner']]);
});
