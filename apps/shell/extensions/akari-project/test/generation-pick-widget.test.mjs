import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { GenerationPickController, generationPickSelectionChanged } from '../lib/common/generation-pick.js';
import { canPlaceLibraryAsset } from '../lib/common/library-asset-placement.js';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;

const sourceText = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('widget.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const member = name => widget.members.find(item => item.name?.getText(source) === name).getText(source);
const names = ['generationTimelineSelections', 'generationPickSelectionsAtStart', 'handleGenerationPrimarySelected', 'pickInto', 'handleGenerationPickKey', 'onBeforeDetach', 'onCloseRequest', 'onAfterHide',
    'generationCatalogCandidate', 'generationPickCardProps', 'renderGenerationPickBadge', 'renderGenerationPickBand'];
const code = ts.transpileModule(`class Handler extends Base { ${names.map(member).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
}).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
const Base = class { onBeforeDetach() {} onCloseRequest() {} onAfterHide() {} };
const Handler = new Function('React', 'canPlaceLibraryAsset', 'Base', 'URI', 'generationPickSelectionChanged',
    `${code}; return Handler;`)(React, canPlaceLibraryAsset, Base, URI, generationPickSelectionChanged);
const request = multi => ({ slot: 'reference_images', label: '参照', multi, accepts: ['image'] });
const candidate = { path: 'assets/a.png', kind: 'image' };
function fixture() {
    const handler = new Handler();
    handler.generationPick = new GenerationPickController(async () => ({ relativePath: 'assets/library.png', kind: 'image' }));
    handler.node = { focus() {} };
    handler.workflow = { workspaceRoot: { toString: () => 'file:///project' } };
    handler.stopCatalogAudio = () => {};
    return handler;
}
function event(key) {
    const calls = [];
    return { key, calls, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop'),
        stopImmediatePropagation: () => calls.push('stopImmediate') };
}
const descendants = element => element && typeof element === 'object' ? [element, ...element.children.flatMap(descendants)] : [];

test('actual card capture click selects once instead of running nested open actions', async () => {
    const handler = fixture();
    const result = handler.pickInto(request(false));
    const e = event();
    handler.generationPickCardProps(candidate).onClickCapture(e);
    assert.deepEqual(e.calls, ['prevent', 'stop']);
    assert.deepEqual(await result, { status: 'picked', paths: ['assets/a.png'] });
    assert.equal(handler.renderGenerationPickBand(), null);
    assert.deepEqual(handler.generationPickCardProps(candidate), {});
});

test('actual band buttons cancel and complete; badges and count use controller state', async () => {
    const handler = fixture();
    let result = handler.pickInto(request(true));
    let band = descendants(handler.renderGenerationPickBand());
    band.find(el => el.props.className === 'akari-gen-pick-cancel').props.onClick();
    assert.deepEqual(await result, { status: 'cancelled' });
    result = handler.pickInto(request(true));
    handler.generationPickCardProps(candidate).onClickCapture(event());
    assert.deepEqual(handler.renderGenerationPickBadge(candidate).children, ['@画像1']);
    band = descendants(handler.renderGenerationPickBand());
    const complete = band.find(el => el.props.className === 'akari-gen-pick-complete');
    assert.ok(complete.children.includes(1));
    complete.props.onClick();
    assert.deepEqual(await result, { status: 'picked', paths: ['assets/a.png'] });
});

for (const method of ['handleGenerationPickKey', 'onBeforeDetach', 'onCloseRequest', 'onAfterHide']) {
    test(`actual ${method} cancels pending selection`, async () => {
        const handler = fixture();
        const result = handler.pickInto(request(false));
        const e = event('Escape');
        handler[method](e);
        assert.deepEqual(await result, { status: 'cancelled' });
        if (method === 'handleGenerationPickKey') assert.deepEqual(e.calls, ['prevent', 'stopImmediate']);
    });
}

test('actual props disable incompatible media and suppress drag/context menu', async () => {
    const handler = fixture();
    const result = handler.pickInto(request(false));
    const props = handler.generationPickCardProps({ path: 'assets/clip.mp4', kind: 'video' });
    assert.equal(props['aria-disabled'], true);
    props.onClickCapture(event());
    assert.ok(handler.generationPick.request);
    for (const name of ['onDragStartCapture', 'onContextMenuCapture']) {
        const e = event(); props[name](e); assert.deepEqual(e.calls, ['prevent', 'stop']);
    }
    handler.generationPick.cancel();
    await result;
});

test('library unplaceable reasons become titles and aria-disabled', async () => {
    const handler = fixture();
    const result = handler.pickInto(request(false));
    for (const item of [{ origin: 'local', category: 'still' }, { origin: 'resolver', state: 'locked', category: 'still' },
        { origin: 'resolver', category: 'overlay' }]) {
        const props = handler.generationPickCardProps(handler.generationCatalogCandidate({ key: 'sample', ...item }));
        assert.equal(props['aria-disabled'], true);
        assert.ok(props.title);
    }
    handler.generationPick.cancel(); await result;
});

test('all three renderers wire mode props/badges, preserve normal actions and disable native drag', () => {
    for (const name of ['renderMaterialCard', 'renderCatalogCard', 'renderCatalogListRow']) {
        const text = member(name);
        assert.match(text, /generationPickCardProps\(pickCandidate\)/);
        assert.match(text, /renderGenerationPickBadge\(pickCandidate\)/);
        assert.match(text, /!this\.generationPick\.request/);
    }
    assert.match(member('renderMaterialCard'), /onClick=\{\(\) => void this\.openFile\(entry\.uri\)\}/);
    assert.match(member('renderMaterialCard'), /onContextMenu=\{event => this\.openMaterialContextMenu\(event, entry\)\}/);
    assert.match(member('generationPick'), /key => this\.resolveCatalogMaterial\(key\)/);
    assert.match(member('init'), /removeEventListener\('keydown', this\.handleGenerationPickKey, true\)/);
    assert.match(member('init'), /this\.generationPick\.cancel\(\)/);
    assert.match(member('renderMaterialsPane'), /renderGenerationPickBand\(\)/);
});

test('contribution registers the shared ID and activates the widget before calling pickInto', async () => {
    const text = readFileSync(new URL('../src/browser/akari-generation-pick-command-contribution.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('command.ts', text, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(ts.isClassDeclaration);
    const method = cls.members.find(node => node.name?.getText(ast) === 'registerCommands').getText(ast);
    const compiled = ts.transpileModule(`class Contribution { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Contribution = new Function('GENERATION_PICK_INTO_COMMAND_ID', 'AkariRoleBucketsWidget', `${compiled};return Contribution;`)(
        'akari.generation.pickInto', { ID: 'akari-role-buckets-widget' });
    for (const developerMode of [false, true]) {
        const contribution = new Contribution(), calls = [];
        const widget = { id: 'akari-role-buckets-widget', title: {}, isAttached: false,
            pickInto: async req => { calls.push('pick'); assert.equal(req.label, '参照'); return { status: 'cancelled' }; } };
        contribution.widgetManager = { getOrCreateWidget: async id => { assert.equal(id, widget.id); return widget; } };
        contribution.modeService = { developerMode };
        contribution.shell = { addWidget: (_widget, options) => { assert.equal(options.area, developerMode ? 'main' : 'left'); },
            activateWidget: async () => { calls.push('activate'); } };
        let handler;
        contribution.registerCommands({ registerCommand: (command, value) => { assert.equal(command.id, 'akari.generation.pickInto'); handler = value; } });
        assert.deepEqual(await handler.execute(request(false)), { status: 'cancelled' });
        assert.deepEqual(calls, ['activate', 'pick']);
    }
    const module = readFileSync(new URL('../src/browser/akari-project-frontend-module.ts', import.meta.url), 'utf8');
    assert.match(module, /bind\(CommandContribution\)\.toService\(AkariGenerationPickCommandContribution\)/);
});


function primarySelected(handler, selection, editUri = 'file:///project/edit.json') {
    handler.handleGenerationPrimarySelected({ detail: { editUri, selection } });
}

for (const next of [{ kind: 'cut', id: 'b' }, { kind: 'caption', id: 'a' }, null]) {
    test(`primarySelected: same selection replay stays active; change to ${JSON.stringify(next)} cancels`, async () => {
        const handler = fixture();
        primarySelected(handler, { kind: 'cut', id: 'a' });
        const result = handler.pickInto(request(false));
        primarySelected(handler, { kind: 'cut', id: 'a' });
        primarySelected(handler, { kind: 'cut', id: 'a' });
        assert.ok(handler.generationPick.request);
        primarySelected(handler, next);
        assert.deepEqual(await result, { status: 'cancelled' });
        assert.equal(handler.renderGenerationPickBand(), null);
    });
}

test('primarySelected: null replays stay active; selecting from null cancels', async () => {
    const handler = fixture();
    primarySelected(handler, null);
    const result = handler.pickInto(request(false));
    primarySelected(handler, null);
    assert.ok(handler.generationPick.request);
    primarySelected(handler, { kind: 'cut', id: 'a' });
    assert.deepEqual(await result, { status: 'cancelled' });
});

test('primarySelected: compare against the start snapshot for each normalized editUri', async () => {
    const handler = fixture();
    const a = 'file:///project/edit.json', b = 'file:///project/other.json';
    primarySelected(handler, { kind: 'cut', id: 'a' }, a);
    primarySelected(handler, { kind: 'cut', id: 'b' }, b);
    const result = handler.pickInto(request(false));
    primarySelected(handler, { kind: 'cut', id: 'a' }, a);
    primarySelected(handler, { kind: 'cut', id: 'b' }, 'file:///project/sub/../other.json');
    assert.ok(handler.generationPick.request);
    primarySelected(handler, { kind: 'cut', id: 'b' }, a);
    assert.deepEqual(await result, { status: 'cancelled' });
    // The cancellation-causing event is remembered for the next mode, independently of edit B.
    const next = handler.pickInto(request(false));
    primarySelected(handler, { kind: 'cut', id: 'b' }, a);
    assert.ok(handler.generationPick.request);
    handler.generationPick.cancel();
    await next;
});

test('primarySelected: snapshot copies payloads and ignores malformed events', async () => {
    const handler = fixture();
    const payload = { kind: 'cut', id: 'a' };
    primarySelected(handler, payload);
    const result = handler.pickInto(request(false));
    payload.id = 'mutated';
    primarySelected(handler, { kind: 'cut', id: 'a' });
    for (const detail of [undefined, {}, { selection: null }, { editUri: '', selection: null },
        { editUri: 'file:///project/edit.json' }, { editUri: 'file:///project/edit.json', selection: { kind: 'layer', id: 'a' } }]) {
        handler.handleGenerationPrimarySelected({ detail });
    }
    assert.ok(handler.generationPick.request);
    primarySelected(handler, { kind: 'cut', id: 'mutated' });
    assert.deepEqual(await result, { status: 'cancelled' });
});

test('selection listener is registered and removed with the widget; CSS require tolerates node', () => {
    const init = member('init');
    assert.match(init, /window\.addEventListener\(GENERATION_PICK_PRIMARY_SELECTED_EVENT, this\.handleGenerationPrimarySelected\)/);
    assert.match(init, /window\.removeEventListener\(GENERATION_PICK_PRIMARY_SELECTED_EVENT, this\.handleGenerationPrimarySelected\)/);
    const cssLoad = source.statements.find(node => ts.isTryStatement(node)
        && node.getText(source).includes("require('../../src/browser/style/generation-pick.css')"));
    assert.ok(cssLoad);
    let attempts = 0;
    new Function('require', cssLoad.getText(source))(() => { attempts++; throw new Error('node cannot load CSS'); });
    assert.equal(attempts, 1);
    assert.doesNotMatch(sourceText, /import ['"].*generation-pick\.css['"]/);
});
