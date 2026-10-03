import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { inspectorSource, photoMaskFields, timelineMethod } from './helpers/perspective-transition-fixture.mjs';
import { cutoutAvailabilityFor, photoToolAvailabilityFor } from '../lib/browser/inspector/ai-tiles.js';

const prepareSelectedPhoto = timelineMethod('prepareSelectedPhoto');
const tick = () => new Promise(resolve => setImmediate(resolve));
const inspectorAst = ts.createSourceFile('inspector.ts', inspectorSource, ts.ScriptTarget.Latest, true);
const panelNode = inspectorAst.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'PHOTO_PANEL_FIELDS');
assert.ok(panelNode);
const panelCode = ts.transpileModule(panelNode.getText(inspectorAst),
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const opened = [];
const photoPanelFields = new Function('isInspectorStillImage', 'openPhotoEditPanel',
  `${panelCode}\nreturn PHOTO_PANEL_FIELDS;`)(() => false, options => opened.push(options));
const sectionsNode = inspectorAst.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'photoMaskSectionsForAvailability');
assert.ok(sectionsNode);
const sectionsCode = ts.transpileModule(sectionsNode.getText(inspectorAst),
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const photoMaskSectionsForAvailability = new Function(`${sectionsCode}\nreturn photoMaskSectionsForAvailability;`)();
const inspectorClass = inspectorAst.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'AkariInspectorWidget');
const rowNode = inspectorClass?.members.find(node => node.name?.getText(inspectorAst) === 'appendRow');
assert.ok(rowNode);

class RowNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.style = {}; this.className = ''; }
  classList = { add: name => { this.className += ` ${name}`; } };
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener() {}
}
const rowCode = ts.transpileModule(`class RowHarness { ${rowNode.getText(inspectorAst)} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const RowHarness = new Function('document', `${rowCode}\nreturn RowHarness;`)(
  { createElement: tag => new RowNode(tag) });
const serviceSource = readFileSync(new URL('../src/node/akari-annotations-service.ts', import.meta.url), 'utf8');
const serviceAst = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true);
const serviceClass = serviceAst.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'AkariAnnotationsServiceImpl');
const availabilityNode = serviceClass?.members.find(node => node.name?.getText(serviceAst) === 'photoMaskAvailability');
assert.ok(availabilityNode);
const availabilityCode = ts.transpileModule(`class Service { ${availabilityNode.getText(serviceAst)} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const availabilityMethod = (platform, helper, isFile = true) => new Function('process', 'fs', 'helper', 'isFile',
  `${availabilityCode}\nreturn new Service().photoMaskAvailability.call({ findGenerationAsset: async () => helper });`)(
  { platform }, { stat: async () => ({ isFile: () => isFile }) }, helper, isFile);

function selection(available) {
  const notices = [];
  const calls = [];
  let checks = 0;
  const context = {
    sourceMap: new Map([
      ['first', { path: 'first.jpg', videoUri: 'file:///first.jpg' }],
      ['second', { path: 'second.png', videoUri: 'file:///second.png' }]
    ]),
    preparingPhotoSources: new Set(),
    annotationsService: {
      photoMaskAvailability: async () => { checks += 1; return { available }; },
      photoPrepare: async request => { calls.push(request); return { ok: true }; }
    },
    showNotice: message => notices.push(message),
    hideNotice: () => notices.push('hidden')
  };
  return { context, notices, calls, checks: () => checks };
}

test('unavailable photo helper leaves selection silent and never prepares', async () => {
  const state = selection(false);
  prepareSelectedPhoto.call(state.context, 'first');
  prepareSelectedPhoto.call(state.context, 'second');
  await tick();
  assert.equal(state.checks(), 1);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.notices, []);
});

test('availability RPC requires macOS and an existing helper', async () => {
  assert.deepEqual(await availabilityMethod('win32', 'helper'), { available: false });
  assert.deepEqual(await availabilityMethod('darwin', undefined), { available: false });
  assert.deepEqual(await availabilityMethod('darwin', 'helper', false), { available: false });
  assert.deepEqual(await availabilityMethod('darwin', 'helper'), { available: true });
});

test('available photo helper keeps selection preparation and notices', async () => {
  const state = selection(true);
  prepareSelectedPhoto.call(state.context, 'first');
  prepareSelectedPhoto.call(state.context, 'second');
  await tick();
  assert.equal(state.checks(), 1);
  assert.deepEqual(state.calls, [
    { sourceUri: 'file:///first.jpg' }, { sourceUri: 'file:///second.png' }
  ]);
  assert.equal(state.notices.filter(message => message.startsWith('写真の準備をしています')).length, 2);
  assert.equal(state.notices.filter(message => message === 'hidden').length, 2);
});

test('cutout is disabled with its reason while eraser remains available', () => {
  const photo = photoToolAvailabilityFor({ photo: true, emptyFrame: false });
  assert.deepEqual(cutoutAvailabilityFor(photo, false),
    { enabled: false, reason: '背景透過は Mac でだけ使えます' });
  assert.deepEqual(cutoutAvailabilityFor(photo, true), { enabled: true });
  assert.deepEqual(photo, { enabled: true });
});

test('photo inspector entrances follow helper availability', async () => {
  const snapshot = { kind: 'item', id: 'photo', photo: true, src: 'photo.jpg' };
  const write = async () => ({ ok: true });
  const unavailable = photoPanelFields(snapshot, write, false);
  assert.deepEqual(unavailable.map(field => [field.name, field.disabled, field.title]), [
    ['photo-cutout-panel', true, '背景透過は Mac でだけ使えます'],
    ['photo-region-panel', true, '背景透過は Mac でだけ使えます']
  ]);
  const available = photoPanelFields(snapshot, write, true);
  assert.ok(available.every(field => !field.disabled));
  await available[0].action(snapshot);
  assert.equal(opened.at(-1).available, true);
});

test('mask generation row is disabled with adjacent reason while manual tools remain enabled', () => {
  const snapshot = { kind: 'item', id: 'photo', photo: true,
    maskSourceOptions: [{ id: 'manual', label: 'manual.png' }] };
  const fields = photoMaskFields(snapshot, async () => ({ ok: true }));
  const sections = [{ id: 'mask', label: 'マスク', fields }];
  const unavailable = photoMaskSectionsForAvailability(sections, false)[0].fields;
  const generate = unavailable.find(field => field.name === 'photo-mask-generate');
  assert.equal(generate.actionLabel, '背景を消す（このパソコンで）');
  assert.equal(generate.disabled, true);
  assert.equal(generate.title, '背景透過は Mac でだけ使えます');
  assert.equal(unavailable.find(field => field.name === 'mask').disabled, false);
  assert.notEqual(unavailable.find(field => field.name === 'photo-brush-start').disabled, true);
  const parent = new RowNode('div');
  new RowHarness().appendRow(parent, generate, snapshot, 'item');
  const row = parent.children[0];
  assert.equal(row.children.find(child => child.tag === 'button').disabled, true);
  assert.equal(row.children.find(child => child.className === 'akari-inspector-ai-reason').textContent,
    '背景透過は Mac でだけ使えます');

  const available = photoMaskSectionsForAvailability(sections, true)[0].fields
    .find(field => field.name === 'photo-mask-generate');
  const enabledParent = new RowNode('div');
  new RowHarness().appendRow(enabledParent, available, snapshot, 'item');
  assert.equal(enabledParent.children[0].children.find(child => child.tag === 'button').disabled, false);
  assert.equal(enabledParent.children[0].children.some(child => child.className === 'akari-inspector-ai-reason'), false);
});
