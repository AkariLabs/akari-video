import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import uriModule from '@theia/core/lib/common/uri.js';
import * as mirror from '../lib/common/generation-pick-mirror.js';
import { generationFields } from '../lib/browser/inspector/generation-fields.js';

// Exercise the compiled widget methods without loading Electron's BaseWidget/DOM.
// As in inspector-generation-service, retain production method bodies in the harness.
const source = await readFile(new URL('../lib/browser/akari-inspector-widget.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let widgetClass;
function visit(node) {
  if (ts.isClassExpression(node) && node.name?.text === 'AkariInspectorWidget') widgetClass = node;
  ts.forEachChild(node, visit);
}
visit(ast);
const names = ['appendRow', 'generationIdentity', 'generationFramePickDisabled', 'paintGenerationFramePick',
  'cancelGenerationFramePick', 'syncGenerationFramePick', 'pickGenerationFrame', 'pickGenerationFrameFile',
  'updateGenerationDraft', 'validateGenerationDraft', 'scheduleGenerationDraftWrite', 'persistGenerationDraft', 'dispose'];
const bodies = widgetClass.members.filter(node => names.includes(node.name?.getText(ast))).map(node => node.getText(ast));
assert.equal(bodies.length, names.length);
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  querySelector() { return undefined; }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.attributes.has('data-akari-generation-pick-slot')); }
}
const Harness = new Function('generation_pick_mirror_1', 'generation_fields_1', 'document', 'window',
  `return class Harness extends class { dispose() { this.isDisposed = true; } } { ${bodies.join('\n')} }`)(
  mirror, { generationFields }, { createElement: tag => new Element(tag) }, globalThis);
const URI = uriModule.default ?? uriModule;
const identity = { key: 'a', itemId: 'a', sourcePath: 'assets/a.png', duration: 6 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup({ registered = true, cancelRegistered = registered, selected, state } = {}) {
  const w = new Harness();
  for (const name of ['generationDrafts', 'generationTabDrafts', 'generationTabMeta', 'generationStates',
    'generationValidations', 'generationDraftTimers', 'generationWrites']) w[name] = new Map();
  for (const key of ['a', 'b']) w.generationDrafts.set(key, { modelId: 'fal:h3-i2v', inputs: { first_frame: null }, output: { duration_s: 6 } });
  w.currentTab = 'generation';
  w.model = { snapshot: { kind: 'cut', itemId: 'a', sourcePath: identity.sourcePath, outputStart: 0, outputEnd: 6 } };
  w.body = new Element('div'); w.render = () => w.syncGenerationFramePick();
  w.syncAdjustCompare = () => {}; w.lutGeneration = 0;
  w.generationStates.set('a', state);
  const result = deferred(), calls = [], writes = [], dialogs = [];
  w.commandRegistry = { getCommand: id => (id === mirror.GENERATION_CANCEL_PICK_COMMAND_ID ? cancelRegistered : registered) ? {} : undefined,
    executeCommand: (...args) => {
      calls.push(args);
      return args[0] === mirror.GENERATION_CANCEL_PICK_COMMAND_ID ? Promise.resolve() : result.promise;
    } };
  w.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: new URI('file:///project') }] };
  w.fileService = { resolve: async resource => ({ resource }) };
  w.fileDialogService = { showOpenDialog: async (...args) => { dialogs.push(args); return selected ? new URI(selected) : undefined; } };
  w.layerAudioService = { validateGenerationInputs: async () => ({ ok: true }), writeGenerationDraft: async request => { writes.push(request); } };
  const frameField = generationFields({ snapshot: w.model.snapshot,
    catalogRow: { id: 'fal:h3-i2v', kind: 'video', inputs: { first_frame: 'optional', last_frame: 'optional' } },
    draft: w.generationDrafts.get('a'), defaults: { catalog: [], state },
    actions: { update: () => {}, generate: () => {}, copyAdjacent: () => {} } }).find(field => field.name === 'first-frame');
  w.appendRow(w.body, frameField, w.model.snapshot, 'cut');
  const frame = w.body.querySelectorAll()[0];
  return { w, frame, result, calls, writes, dialogs };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
async function saved(w) {
  await new Promise(resolve => setTimeout(resolve, 340)); // production 300ms debounce
  await Promise.all(w.generationWrites.values());
}

test('frame click invokes pickInto once with the mirrored request and exposes pending state', async () => {
  const { frame, result, calls } = setup();
  assert.equal(frame.getAttribute('role'), 'button'); assert.equal(frame.tabIndex, 0);
  frame.listeners.get('click')();
  assert.deepEqual(calls, [[mirror.GENERATION_PICK_INTO_COMMAND_ID, { slot: 'first_frame', label: '最初の絵', accepts: ['image'], multi: false }]]);
  assert.equal(frame.getAttribute('aria-pressed'), 'true');
  result.resolve({ status: 'cancelled' }); await settle();
  assert.equal(frame.getAttribute('aria-pressed'), 'false');
});

test('picked updates inputs.first_frame and the existing debounced writeGenerationDraft', async () => {
  const { w, result, writes } = setup();
  const picking = w.pickGenerationFrame(identity, 'first_frame', 'assets/old.png');
  result.resolve({ status: 'picked', paths: ['assets/new.png'] }); await picking; await saved(w);
  assert.deepEqual(w.generationDrafts.get('a').inputs.first_frame, { path: 'assets/new.png' });
  assert.equal(writes.length, 1); assert.equal(writes[0].itemId, 'a');
  assert.deepEqual(writes[0].inputs.first_frame, { path: 'assets/new.png' });
});

test('last frame carries selected as an array and writes the last slot', async () => {
  const { w, result, calls } = setup();
  const picking = w.pickGenerationFrame(identity, 'last_frame', 'assets/old.png');
  assert.deepEqual(calls[0][1], { slot: 'last_frame', label: '最後の絵', accepts: ['image'], multi: false, selected: ['assets/old.png'] });
  result.resolve({ status: 'picked', paths: ['assets/last.png'] }); await picking; await saved(w);
  assert.deepEqual(w.generationDrafts.get('a').inputs.last_frame, { path: 'assets/last.png' });
});

test('cancelled leaves both drafts unchanged and performs no write', async () => {
  const { w, result, writes } = setup(); const before = structuredClone([...w.generationDrafts]);
  const picking = w.pickGenerationFrame(identity, 'first_frame', '');
  result.resolve({ status: 'cancelled' }); await picking;
  assert.deepEqual([...w.generationDrafts], before); assert.equal(writes.length, 0); assert.equal(w.generationDraftTimers.size, 0);
});

for (const trigger of ['other clip', 'away and back', 'tab', 'dispose', 'same frame']) {
  test(`${trigger} clears the ring and discards a late picked result`, async () => {
    const { w, frame, result, calls, writes } = setup(); const before = structuredClone([...w.generationDrafts]);
    const picking = w.pickGenerationFrame(identity, 'first_frame', '');
    if (trigger === 'other clip' || trigger === 'away and back') {
      w.model.snapshot = { ...w.model.snapshot, itemId: 'b' }; w.syncGenerationFramePick();
      if (trigger === 'away and back') { w.model.snapshot.itemId = 'a'; w.syncGenerationFramePick(); }
    } else if (trigger === 'tab') { w.currentTab = 'info'; w.syncGenerationFramePick(); }
    else if (trigger === 'dispose') w.dispose();
    else await w.pickGenerationFrame(identity, 'first_frame', '');
    assert.equal(frame.getAttribute('aria-pressed'), 'false');
    result.resolve({ status: 'picked', paths: ['assets/late.png'] }); await picking;
    assert.deepEqual([...w.generationDrafts], before); assert.equal(writes.length, 0);
    assert.equal(w.generationDraftTimers.size, 0);
    assert.equal(calls.filter(([id]) => id === mirror.GENERATION_PICK_INTO_COMMAND_ID).length, 1);
    assert.equal(calls.filter(([id]) => id === mirror.GENERATION_CANCEL_PICK_COMMAND_ID).length,
      ['tab', 'dispose', 'same frame'].includes(trigger) ? 1 : 0);
  });
}

test('result-time identity check also drops a result before the selection render', async () => {
  const { w, result } = setup(); const before = structuredClone([...w.generationDrafts]);
  const picking = w.pickGenerationFrame(identity, 'first_frame', '');
  w.model.snapshot.itemId = 'b'; result.resolve({ status: 'picked', paths: ['assets/late.png'] }); await picking;
  assert.deepEqual([...w.generationDrafts], before);
});

test('unregistered command opens single image dialog and writes a project-relative path', async () => {
  const { w, calls, dialogs, writes } = setup({ registered: false, selected: 'file:///project/assets/chosen.png' });
  await w.pickGenerationFrame(identity, 'first_frame', ''); await saved(w);
  assert.equal(calls.length, 0); assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0][0].canSelectMany, false); assert.equal(dialogs[0][0].canSelectFolders, false);
  assert.ok(dialogs[0][0].filters['画像'].includes('png'));
  assert.deepEqual(writes[0].inputs.first_frame, { path: 'assets/chosen.png' });
});

for (const selected of ['file:///outside.png', 'file:///project-other/a.png', 'file:///project/assets/a.mp4', undefined]) {
  test(`dialog rejection/cancellation (${selected}) leaves draft unchanged`, async () => {
    const { w, writes } = setup({ registered: false, selected }); const before = structuredClone([...w.generationDrafts]);
    await w.pickGenerationFrame(identity, 'first_frame', '');
    assert.deepEqual([...w.generationDrafts], before); assert.equal(writes.length, 0);
    if (selected) assert.match(w.generationFramePickMessage.text, /画像/);
    else assert.equal(w.generationFramePickMessage, undefined);
  });
}

for (const state of ['generating', 'stale']) {
  test(`${state} disables click and keyboard activation`, async () => {
    const { w, frame, calls, dialogs } = setup({ state });
    assert.equal(frame.getAttribute('aria-disabled'), 'true');
    frame.listeners.get('click')();
    for (const key of ['Enter', ' ']) frame.listeners.get('keydown')({ key, preventDefault() {}, stopPropagation() {} });
    await w.pickGenerationFrame(identity, 'first_frame', '');
    assert.equal(calls.length, 0); assert.equal(dialogs.length, 0);
  });
}
for (const key of ['Enter', ' ']) {
  test(`${JSON.stringify(key)} activates once and ignores key repeat`, async () => {
    const { frame, result, calls } = setup();
    let prevented = 0;
    const event = { key, preventDefault() { prevented++; }, stopPropagation() {} };
    frame.listeners.get('keydown')(event);
    frame.listeners.get('keydown')({ ...event, repeat: true });
    assert.equal(calls.length, 1); assert.equal(prevented, 2);
    result.resolve({ status: 'cancelled' }); await settle();
  });
}

for (const cancelRegistered of [true, false]) {
  test(`same frame re-click: cancel registration=${cancelRegistered}, one cancellation at most and no draft write`, async () => {
    const { w, frame, calls, result, writes } = setup({ cancelRegistered });
    const before = JSON.stringify([...w.generationDrafts]);
    frame.listeners.get('click')();
    frame.listeners.get('click')();
    assert.equal(frame.getAttribute('aria-pressed'), 'false');
    assert.equal(w.generationFramePick, undefined);
    assert.deepEqual(calls.map(([id]) => id), [mirror.GENERATION_PICK_INTO_COMMAND_ID,
      ...(cancelRegistered ? [mirror.GENERATION_CANCEL_PICK_COMMAND_ID] : [])]);
    result.resolve({ status: 'picked', paths: ['assets/late.png'] }); await settle();
    w.cancelGenerationFramePick();
    assert.equal(calls.filter(([id]) => id === mirror.GENERATION_CANCEL_PICK_COMMAND_ID).length, Number(cancelRegistered));
    assert.equal(JSON.stringify([...w.generationDrafts]), before);
    assert.equal(writes.length, 0); assert.equal(w.generationDraftTimers.size, 0);
  });

  test(`reference + add re-click: cancel registration=${cancelRegistered}, no second pick or draft write`, async () => {
    const { w, calls, result, writes } = setup({ cancelRegistered });
    w.body = new Element('div');
    w.generationDrafts.get('a').inputs.reference_images = [];
    const before = JSON.stringify([...w.generationDrafts]);
    w.appendRow(w.body, {
      name: 'generation-references', label: '参照', getValue: () => '',
      generationReferences: { entries: [], counter: '画像 0 / 9', notes: [],
        kinds: [{ slot: 'reference_images', kind: 'image', label: '画像', max: 9 }] }
    }, w.model.snapshot, 'cut');
    const all = element => element.children.flatMap(child => [child, ...all(child)]);
    const add = all(w.body).find(element => element.getAttribute('data-akari-generation-reference-add'));
    assert.ok(add);
    add.listeners.get('click')();
    assert.equal(w.generationFramePick.slot, 'reference_images');
    assert.deepEqual(calls[0][1], { slot: 'reference_images', label: '参照画像', accepts: ['image'], multi: true, selected: [], max: 9 });
    add.listeners.get('click')();
    assert.equal(w.generationFramePick, undefined);
    assert.deepEqual(calls.map(([id]) => id), [mirror.GENERATION_PICK_INTO_COMMAND_ID,
      ...(cancelRegistered ? [mirror.GENERATION_CANCEL_PICK_COMMAND_ID] : [])]);
    result.resolve({ status: 'picked', paths: ['assets/late.png'] }); await settle();
    w.cancelGenerationFramePick();
    assert.equal(calls.filter(([id]) => id === mirror.GENERATION_CANCEL_PICK_COMMAND_ID).length, Number(cancelRegistered));
    assert.equal(JSON.stringify([...w.generationDrafts]), before);
    assert.equal(writes.length, 0); assert.equal(w.generationDraftTimers.size, 0);
  });
}

test('settled frame pick does not send a cancellation to a later receiver session', async () => {
  const { w, calls, result } = setup();
  const picking = w.pickGenerationFrame(identity, 'first_frame', '');
  result.resolve({ status: 'cancelled' }); await picking;
  assert.deepEqual(calls.map(([id]) => id), [mirror.GENERATION_PICK_INTO_COMMAND_ID]);
});
