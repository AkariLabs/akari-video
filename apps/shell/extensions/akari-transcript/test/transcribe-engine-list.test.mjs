import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const steps = require('../lib/common/transcribe-steps.js');
const cards = [
    { id: 'speech-analyzer', label: 'SpeechAnalyzer', place: 'このパソコン', hourlyUsd: 0 },
    { id: 'whisper-cpp', label: 'Whisper · large-v3-turbo', place: 'このパソコン', hourlyUsd: 0 },
    { id: 'cloud:scribe', label: 'ElevenLabs Scribe', place: 'クラウド', hourlyUsd: .40 },
    { id: 'cloud:groq', label: 'Groq Whisper', place: 'クラウド', hourlyUsd: .04 }
];

test('engine list keeps auto first and includes availability and rates', () => {
    const tools = [{ id: 'speech-analyzer', available: false, unsupported: true }, { id: 'whisper', available: true }];
    const connections = [{ id: 'elevenlabs', configured: false, doctor: { status: 'unconfigured', detail: '' } },
        { id: 'groq', configured: true, doctor: { status: 'ok', detail: '' } }];
    const list = steps.transcribeEngineList(cards, tools, connections, 'whisper-cpp');
    assert.deepEqual(list.map(row => row.id), ['auto', ...cards.map(card => card.id)]);
    assert.equal(list.find(row => row.id === 'cloud:scribe').availability.label, '鍵が未登録');
    assert.equal(list.find(row => row.id === 'cloud:groq').price, '$0.04 / 時');
    assert.equal(list.find(row => row.id === 'whisper-cpp').default, true);
});

test('all command entrances open the same popup without starting transcription', async () => {
    const registrations = new Map(), dialogs = [];
    class URI {
        constructor(value) { this.value = value; }
        toString() { return this.value; }
        resolve(path) { return new URI(`${this.value}/${path}`); }
        normalizePath() { return this; }
    }
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
        'akari-annotations/lib/common/akari-annotations-protocol': {},
        '@theia/core/shared/inversify': { inject: () => () => {}, injectable: () => value => value },
        '../akari-transcript-commands': { OPEN_AKARI_DAIHON: { id: 'akari.daihon.open' } },
        './akari-cuts-widget': {}, './akari-daihon-widget': {},
        './akari-transcribe-dialog': { AkariTranscribeDialog: Dialog, listenTranscribeRange() {} },
        'akari-annotations/lib/browser/akari-edit-history-service': {},
        '../../common/captions-button': { setDaihonHistoryService() {} }
    };
    const exported = {};
    new Function('require', 'exports', readFileSync(new URL('../lib/browser/daihon/akari-daihon-contribution.js', import.meta.url), 'utf8'))(
        id => { assert.ok(id in modules, `unexpected dependency: ${id}`); return modules[id]; }, exported);
    const contribution = new exported.AkariDaihonContribution();
    contribution.history = {}; contribution.messages = {};
    contribution.preferences = { get: () => 'whisper-cpp' };
    contribution.projectService = { transcriptStates: async () => ({}) };
    const commands = { registerCommand(command, handler) { registrations.set(command.id, handler.execute); } };
    contribution.registerCommands(commands);
    assert.equal(registrations.has('akari.transcribe.engines'), false);
    await registrations.get('akari.transcribe.openDialog')({ projectRoot: 'file:///project', relativePath: 'clip.mp4' });
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0][1], 'clip.mp4');
    assert.equal(dialogs[0].at(-2), contribution.messages);
    assert.equal(typeof dialogs[0].at(-1), 'function');
});
