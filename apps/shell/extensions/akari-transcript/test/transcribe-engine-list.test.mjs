import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const steps = require('../lib/common/transcribe-steps.js');
const { transcribeEngineList, transcribeEngineAvailability, initialEngineSelection } = steps;
const dialogExports = {};
new Function('require', 'exports', readFileSync(new URL('../lib/browser/daihon/akari-transcribe-dialog.js', import.meta.url), 'utf8'))(
  id => ({
    '@theia/core/lib/browser': {}, '@theia/core/lib/browser/dialogs': { AbstractDialog: class {} },
    '@theia/core/lib/common/buffer': {}, '@theia/core/lib/common/preferences': {},
    '@theia/core/lib/common/uri': {}, '../../common/transcribe-steps': steps,
    '../akari-transcript-commands': {}, '../../common/captions-button': {}
  })[id], dialogExports);
const dialogCards = dialogExports.TRANSCRIBE_ENGINE_CARDS;
const tools = [{ id: 'speech-analyzer', available: false, unsupported: true, needs: ['OS'] },
  { id: 'whisper', available: true }];
const connections = [{ id: 'elevenlabs', configured: false, doctor: { status: 'unconfigured', detail: '' } },
  { id: 'groq', configured: true, doctor: { status: 'ok', detail: '' } }];

test('コマンドのエンジン札はダイアログと同じ順・文言・判定・料金', () => {
  assert.equal(dialogExports.transcribeEngineList, transcribeEngineList);
  const list = transcribeEngineList(dialogCards, tools, connections, 'whisper-cpp');
  assert.deepEqual(list.map(row => row.id), ['auto', ...dialogCards.map(card => card.id)]);
  assert.deepEqual(list[0], { id: 'auto', label: 'おまかせ（ローカル優先）', place: 'ローカル優先',
    price: '無料', hourlyUsd: 0, availability: { state: 'available', label: '使える' } });
  for (const card of dialogCards) {
    const row = list.find(item => item.id === card.id);
    const availability = transcribeEngineAvailability(card.id, tools, connections);
    assert.equal(row.label, card.label);
    assert.equal(row.place, card.place);
    assert.equal(row.hourlyUsd, card.hourlyUsd);
    assert.equal(row.price, card.hourlyUsd ? `$${card.hourlyUsd.toFixed(2)} / 時` : '無料');
    assert.equal(row.availability.label, availability.label);
    assert.equal(row.availability.state, availability.state === 'available' ? 'available'
      : availability.state === 'needs' ? 'needs' : 'unavailable');
  }
  for (const preferred of ['auto', 'cloud:groq', 'missing']) {
    const rows = transcribeEngineList(dialogCards, tools, connections, preferred);
    const expected = initialEngineSelection(preferred, []).backend;
    assert.deepEqual(rows.filter(row => row.default).map(row => row.id),
      [rows.some(row => row.id === expected) ? expected : 'auto']);
  }
});

test('engines は 2 つの status RPC を読み、openDialog は省略時と指定時を渡す', async () => {
  const registrations = new Map(), rpc = [], dialogs = [];
  class URI { constructor(value) { this.value = value; } toString() { return this.value; } resolve(path) { return new URI(`${this.value}/${path}`); } normalizePath() { return this; } }
  class Dialog {
    constructor(...args) { dialogs.push(args); this.wasCancelled = false; }
    async open() {}
  }
  const modules = {
    'akari-theme/lib/browser/init-layout-guard': { guardInitLayout() {} },
    '@theia/core/lib/common': {}, '@theia/core/lib/browser': {},
    '@theia/core/lib/common/preferences': {}, '@theia/core/lib/common/preferences/preference-schema': {},
    '@theia/filesystem/lib/browser/file-service': {}, 'akari-project/lib/common/akari-project-protocol': {},
    '@theia/core/lib/common/uri': { default: URI },
    '@theia/core/shared/inversify': { inject: () => () => {}, injectable: () => value => value },
    '../akari-transcript-commands': { OPEN_AKARI_DAIHON: { id: 'akari.daihon.open' } },
    './akari-cuts-widget': {}, './akari-daihon-widget': {},
    './akari-transcribe-dialog': { AkariTranscribeDialog: Dialog, listenTranscribeRange() {},
      TRANSCRIBE_ENGINE_CARDS: dialogCards, transcribeEngineList },
    'akari-annotations/lib/browser/akari-edit-history-service': {},
    '../../common/captions-button': { setDaihonHistoryService() {} }
  };
  const exported = {};
  new Function('require', 'exports', readFileSync(new URL('../lib/browser/daihon/akari-daihon-contribution.js', import.meta.url), 'utf8'))(
    id => { assert.ok(id in modules, `unexpected dependency: ${id}`); return modules[id]; }, exported);
  const contribution = new exported.AkariDaihonContribution();
  contribution.history = {};
  contribution.preferences = { get: () => 'whisper-cpp' };
  contribution.projectService = { transcriptStates: async () => ({}) };
  const commands = { registerCommand(command, handler) { registrations.set(command.id, handler.execute); },
    async executeCommand(id, service) { rpc.push([id, service]);
      if (service.endsWith('new-project')) return { tools };
      return { providers: connections }; } };
  contribution.registerCommands(commands);
  const rows = await registrations.get('akari.transcribe.engines')({ projectRoot: 'file:///project' });
  assert.deepEqual(rows, transcribeEngineList(dialogCards, tools, connections, 'whisper-cpp'));
  assert.deepEqual(rpc, [
    ['akari.settings.readStatus', '/services/akari-surfaces-new-project'],
    ['akari.settings.readStatus', '/services/akari-surfaces-connections']
  ]);
  await registrations.get('akari.transcribe.openDialog')({ projectRoot: 'file:///project', relativePath: 'clip.mp4' });
  assert.equal(dialogs[0].at(-2), true);
  assert.equal(dialogs[0].at(-1), undefined);
  await registrations.get('akari.transcribe.openDialog')({ projectRoot: 'file:///project', relativePath: 'clip.mp4', backend: 'cloud:groq', autoStart: false });
  assert.equal(dialogs[1].at(-2), false);
  assert.equal(dialogs[1].at(-1), 'cloud:groq');
});

test('実ダイアログは backend を初期選択し autoStart false で文字起こしを始めない', async () => {
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.parentElement = { style: {} }; }
    append() {}
    setAttribute() {}
  }
  class AbstractDialog {
    constructor() { this.node = new Element(); this.contentNode = new Element(); this.controlPanel = new Element(); this.toDispose = []; }
  }
  const exported = {};
  const modules = {
    '@theia/core/lib/browser': {}, '@theia/core/lib/browser/dialogs': { AbstractDialog },
    '@theia/core/lib/common/buffer': {}, '@theia/core/lib/common/preferences': {},
    '@theia/core/lib/common/uri': {}, '../../common/transcribe-steps': steps,
    '../akari-transcript-commands': {}, '../../common/captions-button': {}
  };
  new Function('require', 'exports', 'document', readFileSync(new URL('../lib/browser/daihon/akari-transcribe-dialog.js', import.meta.url), 'utf8'))(
    id => modules[id], exported, { createElement: () => new Element() });
  const Dialog = exported.AkariTranscribeDialog;
  Dialog.prototype.initialize = async function () {};
  Dialog.prototype.render = function () {};
  Dialog.prototype.refreshAvailability = async function () {};
  Dialog.prototype.start = async function () { await this.service.transcribeMaterial({ backend: this.selection.backend }); };
  const requests = [];
  const service = { transcribeMaterial: async request => { requests.push(request); } };
  const preferences = { get: key => key === 'akari.transcribe.backend' ? 'whisper-cpp' : [] };
  const make = (autoStart, backend) => new Dialog({ toString: () => 'file:///project' }, 'clip.mp4',
    preferences, service, {}, {}, async () => {}, false, autoStart, backend);
  const manual = make(false, 'cloud:groq');
  await manual.ready; await new Promise(resolve => setImmediate(resolve));
  assert.equal(manual.selection.backend, 'cloud:groq');
  assert.deepEqual(requests, []);
  const automatic = make(true);
  await automatic.ready; await new Promise(resolve => setImmediate(resolve));
  assert.equal(automatic.selection.backend, 'whisper-cpp');
  assert.deepEqual(requests, [{ backend: 'whisper-cpp' }]);
});
