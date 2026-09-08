import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { guardInitLayout } from '../../akari-theme/lib/browser/init-layout-guard.js';

const require = createRequire(import.meta.url);
const { DisposableCollection } = require('@theia/core/lib/common/disposable');
const URI = require('@theia/core/lib/common/uri').default;
const view = require('../lib/common/cuts-view.js');
const decorator = () => () => {};
const element = (_tag, text = '') => ({
    textContent: text, style: {}, dataset: {}, children: [],
    setAttribute() {}, addEventListener() {}, classList: { add() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }
});
class BaseWidget {
    node = element();
    title = {};
    toDispose = new DisposableCollection();
    isDisposed = false;
}
function load(path, modules) {
    const exports = {};
    new Function('require', 'exports', 'document', 'window', readFileSync(new URL(path, import.meta.url), 'utf8'))(id => {
        assert.ok(id in modules, `unexpected dependency: ${id}`);
        return modules[id];
    }, exports, { createElement: element, getElementById: () => true, addEventListener() {} }, { addEventListener() {} });
    return exports;
}
const inversify = { inject: decorator, injectable: decorator, postConstruct: decorator };
const { AkariCutsWidget } = load('../lib/browser/daihon/akari-cuts-widget.js', {
    '@theia/core/lib/browser': { BaseWidget },
    '@theia/core/lib/common': { DisposableCollection },
    '@theia/core/lib/common/uri': { default: URI },
    '@theia/core/shared/inversify': inversify,
    '@theia/filesystem/lib/browser/file-service': {},
    '@theia/workspace/lib/browser/workspace-service': {},
    'akari-project/lib/common/akari-project-protocol': {},
    '../../common/cuts-view': view,
    './akari-transcribe-dialog': { transcribeElement: element, transcribeButton: () => element('button') }
});
const daihonPath = '../lib/browser/daihon/akari-daihon-widget.js';
const daihonRequire = createRequire(new URL(daihonPath, import.meta.url));
const daihonModules = Object.fromEntries(
    [...readFileSync(new URL(daihonPath, import.meta.url), 'utf8').matchAll(/require\("([^"]+)"\)/g)]
        .map(([, id]) => [id, id.startsWith('../../common/') || id === '../caption-store' ? daihonRequire(id) : {}])
);
daihonModules['@theia/core/lib/browser'] = { BaseWidget };
daihonModules['@theia/core/shared/inversify'] = inversify;
const { AkariDaihonWidget } = load(daihonPath, daihonModules);
const daihonId = AkariDaihonWidget.FACTORY_ID;
const { AkariDaihonContribution, OPEN_AKARI_CUTS } = load('../lib/browser/daihon/akari-daihon-contribution.js', {
    'akari-theme/lib/browser/init-layout-guard': { guardInitLayout },
    '@theia/core/lib/common': {}, '@theia/core/lib/browser': {},
    '@theia/core/shared/inversify': inversify,
    '../akari-transcript-commands': { OPEN_AKARI_DAIHON: { id: 'akari.daihon.open' } },
    './akari-cuts-widget': { AkariCutsWidget },
    './akari-daihon-widget': { AkariDaihonWidget }
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
function contribution(configure, daihonConfigure = async () => {}) {
    const cuts = new AkariCutsWidget();
    cuts.id = AkariCutsWidget.FACTORY_ID;
    cuts.configure = configure.bind(cuts);
    const daihon = new AkariDaihonWidget();
    daihon.id = daihonId;
    daihon.configure = daihonConfigure.bind(daihon);
    const attached = [], activated = [];
    const instance = new AkariDaihonContribution();
    instance.widgetManager = { async getOrCreateWidget(id) { return id === cuts.id ? cuts : daihon; } };
    instance.shell = {
        addWidget(widget, options) { widget.isAttached = true; attached.push([widget.id, options]); },
        async activateWidget(id) { activated.push(id); }
    };
    return { instance, cuts, daihon, attached, activated };
}

test('root search result determines notice, and errors retain their reason', () => {
    assert.equal(view.cutsViewNotice(false), 'edit.json のあるプロジェクトを開いてください');
    assert.equal(view.cutsViewNotice(true), '');
    assert.match(view.cutsViewNotice(true, new Error('ENOENT missing.mp4')), /ENOENT missing.mp4/);
});

test('configure rejection resolves layout with the cuts tab already attached and a notice', async () => {
    const { instance, cuts, attached } = contribution(async function () {
        assert.equal(this.isAttached, true, 'attach must precede configure');
        throw new Error('ENOENT missing.mp4');
    });
    await assert.doesNotReject(instance.onDidInitializeLayout());
    await tick();
    assert.equal(cuts.isAttached, true);
    assert.deepEqual(attached.find(([id]) => id === cuts.id), [cuts.id, { area: 'right', rank: 191 }]);
    assert.match(cuts.notice.textContent, /ENOENT missing.mp4/);
});

test('pending cuts and daihon configuration do not hold layout open', async () => {
    const pending = deferred();
    const { instance, cuts, daihon } = contribution(() => pending.promise, () => pending.promise);
    let initialized = false;
    const layout = instance.onDidInitializeLayout().then(() => { initialized = true; });
    try {
        await tick();
        assert.equal(initialized, true);
        assert.equal(cuts.isAttached, true);
        assert.equal(daihon.isAttached, true);
    } finally { pending.resolve(); await layout; }
});

test('synchronous cuts throw and daihon rejection cannot reject layout', async t => {
    t.mock.method(console, 'warn', () => {});
    const { instance, cuts } = contribution(function () { throw new Error('sync failure'); },
        async () => { throw new Error('daihon failed'); });
    await assert.doesNotReject(instance.onDidInitializeLayout());
    await tick();
    assert.match(cuts.notice.textContent, /sync failure/);
    assert.equal(cuts.isAttached, true);
});

test('widget factory failure cannot reject layout', async t => {
    t.mock.method(console, 'warn', () => {});
    const { instance } = contribution(async () => {});
    instance.widgetManager.getOrCreateWidget = async () => { throw new Error('factory failed'); };
    await assert.doesNotReject(instance.onDidInitializeLayout());
});

test('open command attaches, activates and can reattach the cuts tab', async () => {
    const { instance, cuts, attached, activated } = contribution(async () => {});
    const commands = new Map();
    instance.registerCommands({ registerCommand(command, handler) { commands.set(command.id, handler); } });
    assert.deepEqual(OPEN_AKARI_CUTS, { id: 'akari.cuts.open', label: 'カット候補を開く' });
    await commands.get('akari.cuts.open').execute();
    await commands.get('akari.cuts.open').execute();
    assert.equal(attached.length, 1);
    cuts.isAttached = false;
    await commands.get('akari.cuts.open').execute();
    assert.equal(attached.length, 2);
    assert.deepEqual(activated, [cuts.id, cuts.id, cuts.id]);
});

test('opening cuts twice adds no configuration calls, attaches once and activates twice', async () => {
    for (const initializeLayout of [false, true]) {
        let configurations = 0;
        const { instance, cuts, attached, activated } = contribution(async () => { configurations++; });
        if (initializeLayout) await instance.onDidInitializeLayout();
        const expectedConfigurations = initializeLayout ? 1 : 0;
        assert.equal(configurations, expectedConfigurations);
        const commands = new Map();
        instance.registerCommands({ registerCommand(command, handler) { commands.set(command.id, handler); } });
        await commands.get('akari.cuts.open').execute();
        await commands.get('akari.cuts.open').execute();
        assert.equal(configurations, expectedConfigurations);
        assert.equal(attached.filter(([id]) => id === cuts.id).length, 1);
        assert.deepEqual(activated, [cuts.id, cuts.id]);
    }
});

function widgetHarness() {
    const widget = new AkariCutsWidget();
    let workspaceListener, fileListener;
    const watches = [], projects = new Map(), reads = [];
    widget.workspace = {
        roots: Promise.resolve([]),
        onWorkspaceChanged(listener) { workspaceListener = listener; return { dispose() {} }; }
    };
    widget.files = {
        onDidFilesChange(listener) { fileListener = listener; return { dispose() {} }; },
        async watch(resource) {
            const watch = { resource: resource.toString(), disposed: false, dispose() { this.disposed = true; } };
            watches.push(watch); return watch;
        },
        async exists(resource) { return projects.has(resource.parent.toString()); },
        async resolve() { return { children: [] }; },
        async readFile(resource) { return { value: projects.get(resource.parent.toString()) }; }
    };
    widget.service = { async readTranscribeArtifacts(request) { reads.push(request); return { cuts: null }; } };
    return {
        widget, watches, projects, reads,
        async workspace(path) {
            widget.workspace.roots = Promise.resolve(path ? [{ resource: new URI(path) }] : []);
            workspaceListener(); await tick();
        },
        async change(path) { fileListener({ changes: [{ resource: new URI(path) }] }); await tick(); }
    };
}
const edit = JSON.stringify({ sources: [{ id: 'clip', path: 'assets/clip.mp4' }] });

test('no workspace → empty folder → edit created → project switch follows roots and replaces watches', async () => {
    const h = widgetHarness();
    await h.widget.configure();
    assert.equal(h.widget.notice.textContent, view.cutsViewNotice(false));
    await h.workspace('file:///empty');
    assert.equal(h.watches[0].resource, 'file:///empty');
    assert.equal(h.widget.notice.textContent, view.cutsViewNotice(false));
    h.projects.set('file:///empty', edit);
    await h.change('file:///empty/edit.json');
    assert.equal(h.widget.root.toString(), 'file:///empty');
    assert.equal(h.widget.notice.textContent, '');
    assert.equal(h.widget.list.children[0].textContent, '文字起こし後にカット候補がここに並びます');
    h.projects.set('file:///next', edit);
    await h.workspace('file:///next');
    assert.equal(h.widget.root.toString(), 'file:///next');
    assert.ok(h.watches.slice(0, -1).every(watch => watch.disposed));
    assert.equal(h.reads.at(-1).projectRoot, 'file:///next');
    await h.workspace(undefined);
    assert.equal(h.widget.root, undefined);
    assert.equal(h.widget.source, '');
    assert.equal(h.widget.list.children.length, 0);
    assert.ok(h.watches.every(watch => watch.disposed));
});

test('malformed edit and missing media produce notices, and corrected files recover', async () => {
    const h = widgetHarness();
    await h.widget.configure();
    h.projects.set('file:///project', '{');
    await h.workspace('file:///project');
    assert.match(h.widget.notice.textContent, /SyntaxError/);
    h.projects.set('file:///project', edit);
    h.widget.service.readTranscribeArtifacts = async () => { throw new Error('ENOENT missing.mp4'); };
    await h.change('file:///project/edit.json');
    assert.match(h.widget.notice.textContent, /ENOENT missing.mp4/);
    assert.equal(h.widget.picker.children[0].value, 'assets/clip.mp4');
    h.widget.service.readTranscribeArtifacts = async () => ({ cuts: null });
    await h.change('file:///project/cuts.json');
    assert.equal(h.widget.notice.textContent, '');
});

test('edit.json changes under the current root preserve the second source selection', async () => {
    const h = widgetHarness();
    h.widget.init();
    await h.widget.configure();
    const sources = [{ id: 'first', path: 'assets/first.mp4' }, { id: 'second', path: 'assets/second.mp4' }];
    h.projects.set('file:///project', JSON.stringify({ sources }));
    await h.workspace('file:///project');
    h.widget.picker.value = sources[1].path;
    h.widget.picker.onchange();
    await h.widget.tail;
    assert.equal(h.widget.source, sources[1].path);
    const watchesBefore = h.watches.length, readsBefore = h.reads.length;

    h.projects.set('file:///project', JSON.stringify({ sources, cuts: [] }));
    await h.change('file:///project/edit.json');
    await h.widget.tail;
    assert.equal(h.widget.source, sources[1].path);
    assert.equal(h.widget.picker.value, sources[1].path);
    assert.equal(h.reads.length, readsBefore + 1);
    assert.equal(h.reads.at(-1).relativePath, sources[1].path);
    assert.equal(h.watches.length, watchesBefore);
    assert.equal(h.watches.at(-1).disposed, false);
});

test('file watching failure still loads the project', async t => {
    const warn = t.mock.method(console, 'warn', () => {});
    const h = widgetHarness();
    await h.widget.configure();
    h.projects.set('file:///project', edit);
    h.widget.files.watch = async () => { throw new Error('watch unavailable'); };
    await h.workspace('file:///project');
    assert.equal(h.reads.length, 1);
    assert.equal(warn.mock.calls[0].arguments[0], '[akari-cuts] file watching is unavailable');
});

test('disposing the widget releases watches after repeated configuration', async () => {
    const h = widgetHarness();
    await h.widget.configure();
    await h.workspace('file:///first');
    await h.workspace('file:///second');
    assert.equal(h.watches.at(-1).disposed, false);
    h.widget.toDispose.dispose();
    assert.ok(h.watches.every(watch => watch.disposed));
});

test('search skips exists/resolve failures and stops descending at depth six', async () => {
    const h = widgetHarness();
    const visited = [];
    h.widget.files.exists = async uri => {
        const path = uri.parent.path.toString(); visited.push(path);
        if (path === '/root/denied-exists') throw new Error('EACCES');
        return path === '/root/good';
    };
    h.widget.files.resolve = async uri => {
        if (uri.path.base === 'denied-resolve') throw new Error('EACCES');
        const names = uri.path.toString() === '/root'
            ? ['denied-exists', 'denied-resolve', 'deep', 'good'] : ['deep'];
        return { children: names.map(name => ({ isDirectory: true, resource: uri.resolve(name) })) };
    };
    assert.equal((await h.widget.find(new URI('file:///root'))).toString(), 'file:///root/good');
    assert.ok(visited.includes('/root/denied-exists'));
    assert.ok(visited.includes('/root/denied-resolve'));
    assert.ok(visited.includes('/root/deep/deep/deep/deep/deep/deep'));
    assert.ok(!visited.includes('/root/deep/deep/deep/deep/deep/deep/deep'));
});

test('old project RPC completion cannot overwrite the new project', async () => {
    const h = widgetHarness();
    const old = deferred();
    await h.widget.configure();
    h.projects.set('file:///old', edit);
    h.projects.set('file:///new', edit);
    h.widget.service.readTranscribeArtifacts = request => request.projectRoot === 'file:///old'
        ? old.promise : Promise.resolve({ cuts: null });
    await h.workspace('file:///old');
    await h.workspace('file:///new');
    old.resolve({ cuts: { basis: 'old', candidates: [] } });
    await tick();
    assert.equal(h.widget.root.toString(), 'file:///new');
    assert.equal(h.widget.cuts, null);
    assert.equal(h.widget.notice.textContent, '');
});


test('daihon and cuts remain unclosable right-dock tabs', () => {
    const { daihon, cuts } = contribution(async () => {});
    daihon.init();
    cuts.init();
    assert.equal(daihon.title.closable, false);
    assert.equal(cuts.title.closable, false);
    assert.ok(daihon.title.iconClass?.trim(), 'daihon must have a visible tab icon');
    assert.ok(cuts.title.iconClass?.trim(), 'cuts must have a visible tab icon');
});

for (const failed of ['daihon', 'cuts']) {
    for (const failure of ['reject', 'throw']) {
        test(`${failed} configure ${failure}: both ranked tabs attach before reads and layout resolves`, async () => {
            const calls = [];
            const configure = name => function () {
                assert.deepEqual(h.attached, [
                    [daihonId, { area: 'right', rank: 190 }],
                    [AkariCutsWidget.FACTORY_ID, { area: 'right', rank: 191 }]
                ]);
                calls.push(name);
                if (name !== failed) return Promise.resolve();
                const error = new Error(`${failed} unreadable`);
                if (failure === 'throw') throw error;
                return Promise.reject(error);
            };
            const h = contribution(configure('cuts'), configure('daihon'));
            await assert.doesNotReject(h.instance.onDidInitializeLayout());
            await tick();
            assert.deepEqual(calls, ['daihon', 'cuts']);
            if (failed === 'daihon') {
                assert.equal(h.daihon.footer.textContent, '台本を読み取れません: daihon unreadable');
            } else {
                assert.match(h.cuts.notice.textContent, /cuts unreadable/);
            }
        });
    }
    for (const failure of ['reject', 'throw']) {
        test(`${failed} factory ${failure} does not prevent the other tab attaching`, async t => {
            t.mock.method(console, 'warn', () => {});
            const h = contribution(async () => {});
            h.instance.widgetManager.getOrCreateWidget = id => {
                if (id === h[failed].id) {
                    const error = new Error('factory unavailable');
                    if (failure === 'throw') throw error;
                    return Promise.reject(error);
                }
                return Promise.resolve(id === daihonId ? h.daihon : h.cuts);
            };
            await assert.doesNotReject(h.instance.onDidInitializeLayout());
            assert.equal(h[failed === 'daihon' ? 'cuts' : 'daihon'].isAttached, true);
        });
    }
}

test('restored tabs are not attached twice and opening daihon never restarts configuration', async () => {
    for (const initializeLayout of [false, true]) {
        let configurations = 0;
        const h = contribution(async () => {}, async () => { configurations++; });
        h.daihon.isAttached = true;
        h.cuts.isAttached = true;
        if (initializeLayout) await h.instance.onDidInitializeLayout();
        const commands = new Map();
        h.instance.registerCommands({ registerCommand(command, handler) { commands.set(command.id, handler); } });
        await commands.get('akari.daihon.open').execute();
        await commands.get('akari.daihon.open').execute();
        assert.equal(configurations, initializeLayout ? 1 : 0);
        assert.deepEqual(h.attached, []);
        h.daihon.isAttached = false;
        await commands.get('akari.daihon.open').execute();
        assert.deepEqual(h.attached, [[daihonId, { area: 'right', rank: 190 }]]);
        assert.equal(configurations, initializeLayout ? 1 : 0);
    }
});
