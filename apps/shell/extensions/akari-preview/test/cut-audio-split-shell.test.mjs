import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPreviewAudioHost } from './helpers/preview-audio-host.mjs';
import { resolveSfxTrimWindow } from '../lib/common/audio-schedule.js';
import { buildWebAudioSchedule, isAudioItemAudible, isCutAudioAudible, projectSpeechDeclarations } from '../../../../../packages/edit-store/lib/index.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
// Use the same checked-in bundle as the shell; package dist may belong to an older build.
const createPreviewAudioSupply = vm.runInNewContext(readFileSync(
    new URL('../generated/frame-engine.js', import.meta.url), 'utf8') + '\nAkariFrameEngine.createPreviewAudioSupply;', {
    console, performance, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    URL, Headers, TextDecoder
});
const plain = value => JSON.parse(JSON.stringify(value));
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
}
// Simulate production renaming inside the host's function bodies before toString().
// These bindings render the template only; the webview VM receives none of them.
const mangledAudibility = vm.runInNewContext(`(() => {
    const a = (${isAudioItemAudible.toString().replace(/\bisAudioItemAudible\b/gu, 'a')});
    const b = (${isCutAudioAudible.toString()
        .replace(/\bisCutAudioAudible\b/gu, 'b').replace(/\bisAudioItemAudible\b/gu, 'a')});
    return { isAudioItemAudible: a, isCutAudioAudible: b };
})()`);
function embeddedAudibility(bindings = mangledAudibility) {
    return section('            const isAudioItemAudible', '            const clampPreviewPlaybackRate')
        .replace(/\$\{([^}]+)\}/gu, (_, expression) => vm.runInNewContext(expression, bindings));
}
const audibilityCases = [
    { name: 'detached cut', cut: { audio: false }, track: {}, audible: false },
    { name: 'muted item', cut: { mute: true }, track: {}, audible: false },
    { name: 'muted track', cut: {}, track: { muted: true }, audible: false },
    { name: 'ordinary cut', cut: {}, track: {}, audible: true }
];

for (const [name, bindings] of Object.entries({
    original: { isAudioItemAudible, isCutAudioAudible }, mangled: mangledAudibility
})) test(`webview audibility is self-contained with ${name} host function names`, () => {
    const context = vm.createContext({});
    assert.equal(vm.runInContext('typeof isAudioItemAudible', context), 'undefined');
    const audible = vm.runInContext(`${embeddedAudibility(bindings)}\n isCutAudioAudibleFn;`, context);
    for (const { name: caseName, cut, track, audible: expected } of audibilityCases) {
        assert.equal(audible(cut, track), expected, caseName);
        assert.equal(audible(cut, track), isCutAudioAudible(cut, track), caseName);
    }
});
const normalize = vm.runInNewContext(`(() => {
    ${section('            const normalizeSummaryCuts =', '            let normalizedCuts =')}
    return normalizeSummaryCuts;
})()`, { resolveSummaryItemAdjust: item => item });
const declarationsFor = vm.runInNewContext(`(() => {
    ${section('                const audioDeclarationsForSummary =', '                const normalizedMutedTracks =')}
    return audioDeclarationsForSummary;
})()`, { fps: 30, engine: { projectSpeechDeclarations }, sourceUrls: new Map([['main', 'stream://main']]) });

function fixture(split = true) {
    const edit = JSON.parse(readFileSync(new URL(
        '../../../../../packages/schemas/examples/edit-v2-cut-audio-split-valid/edit.json', import.meta.url), 'utf8'));
    for (const track of edit.tracks) for (const item of track.items) {
        item.duration = 480;
        item.source.out = 16;
    }
    if (!split) {
        delete edit.tracks[0].items[0].audio;
        edit.tracks[1].items = [];
    }
    return edit;
}

class FakeParam {
    value = 1;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
    exponentialRampToValueAtTime(value) { this.value = value; }
}
class FakeContext {
    currentTime = 0;
    state = 'suspended';
    destination = {};
    sources = [];
    createGain() { return { gain: new FakeParam(), connect() {}, disconnect() {} }; }
    createBufferSource() {
        const node = { playbackRate: new FakeParam(), connect() {}, disconnect() {}, stop() {},
            starts: [], start(...args) { this.starts.push(args); } };
        this.sources.push(node);
        return node;
    }
    async decodeAudioData() { return { duration: 16, length: 16000, numberOfChannels: 1, sampleRate: 1000 }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
async function supplyFor(t, edit, muted = {}) {
    const host = createPreviewAudioHost(() => ({ state: 'not-needed' }));
    const { summary } = await host.load(edit);
    const cuts = normalize(summary);
    const declarations = declarationsFor(summary, cuts);
    const context = new FakeContext();
    const inputs = [], plans = [], fetches = [], warnings = [];
    const supply = createPreviewAudioSupply({ timelineDurationSec: 16, ...declarations,
        contextFactory: () => context,
        fetchImpl: async url => { fetches.push(url); return { ok: true, headers: new Headers({ 'content-length': '1' }), arrayBuffer: async () => new ArrayBuffer(1) }; },
        scheduleBuilder: input => { inputs.push(input); const plan = buildWebAudioSchedule(input); plans.push(plan); return plan; },
        onWarning: message => warnings.push(message)
    });
    t.after(() => supply.dispose());
    supply.setMutedTracks(muted);
    supply.playFrom(0);
    await flush();
    assert.deepEqual(warnings, []);
    return { summary, cuts, declarations, context, supply, inputs, plans, fetches };
}

test('summary wiring preserves cut ownership and uses the shared item audibility rule', () => {
    assert.match(source, /isAudioItemAudible,[\s\S]*from '@akari-video\/edit-store'/u);
    assert.match(source, /interface EditSummaryCut \{\s*audio\?: false;/u);
    assert.match(source, /value\.audio === false \? \{ audio: false \}/u);
    assert.match(source, /timed\(audio\.speech, 'speech'\)/u);
    assert.match(source, /isAudioItemAudible\(undefined, item\)/u);
    assert.match(source, /isAudioItemAudible\(undefined, rawBgm\)/u);
    assert.equal(normalize({ cuts: [{ audio: false, in: 0, out: 16 }] })[0].audio, false);
});

for (const split of [true, false]) test(`${split ? 'split' : 'control'}: host summary reaches the shared supply exactly once`, async t => {
    const f = await supplyFor(t, fixture(split));
    assert.equal(f.summary.cuts[0].audio, split ? false : undefined);
    assert.equal(f.supply.debug().scheduled.speech, split ? 0 : 1);
    assert.equal(f.supply.debug().scheduled.narration, split ? 1 : 0);
    assert.equal(f.context.sources.length, 1);
    assert.equal(f.fetches.length, 1);
    assert.deepEqual(f.context.sources[0].starts, [[0.02, 0, 16]]);
    assert.deepEqual(plain(f.supply.debug().supply.required), [split ? 'narration:voice' : 'speech:cut-speech']);
    if (split) {
        assert.equal(f.declarations.declarations[0].duckKey, true);
        assert.equal(f.inputs.at(-1).audio.narration[0].duckKey, true);
        assert.deepEqual(f.plans.at(-1).duckIntervals, [{ startSec: 0, endSec: 16 }]);
    }
});

test('audio track mute removes independent speech and its duck key; cuts mute leaves it audible', async t => {
    const f = await supplyFor(t, fixture(), { cuts: [0], allCuts: true });
    assert.deepEqual(plain(f.supply.debug().supply.required), ['narration:voice']);
    f.supply.setMutedTracks({ audio: [0] });
    await flush();
    assert.deepEqual(plain(f.supply.debug().supply.required), []);
    assert.deepEqual(f.plans.at(-1).duckIntervals, []);
    f.supply.setMutedTracks({ audio: [] });
    await flush();
    assert.deepEqual(plain(f.supply.debug().supply.required), ['narration:voice']);
    assert.deepEqual(f.plans.at(-1).duckIntervals, [{ startSec: 0, endSec: 16 }]);
});

for (const owner of ['item', 'track']) test(`${owner} mute suppresses speech before stream and sidecar resolution`, async t => {
    const edit = fixture();
    if (owner === 'item') edit.tracks[1].items[0].mute = true;
    else edit.tracks[1].muted = true;
    const f = await supplyFor(t, edit);
    assert.equal(f.summary.audio, undefined);
    assert.equal(f.context.sources.length, 0);
    assert.deepEqual(f.fetches, []);
});

test('item mute suppresses BGM, SFX and narration before requesting sidecars', async t => {
    const edit = fixture();
    edit.tracks[1].items = ['bgm', 'sfx', 'narration', 'speech'].map(role => ({
        id: role, role, mute: true, at: 0, duration: 480, lowcut_hz: 80,
        source: { kind: 'media', src: 'main', in: 0, out: 16 }
    }));
    const f = await supplyFor(t, edit);
    assert.equal(f.summary.audio, undefined);
    assert.deepEqual(f.fetches, []);
    assert.equal(f.context.sources.length, 0);
});

test('speech retains its nonzero owning audio track through normalization and supply', async t => {
    const edit = fixture();
    edit.tracks.splice(1, 0, { id: 'empty-audio', lane: 'audio', items: [] });
    const f = await supplyFor(t, edit, { audio: [0] });
    assert.equal(f.summary.audio.speech[0].track, 1);
    assert.equal(f.declarations.declarations[0].spec.track, 1);
    assert.deepEqual(plain(f.supply.debug().supply.required), ['narration:voice']);
    f.supply.setMutedTracks({ audio: [1] });
    await flush();
    assert.deepEqual(plain(f.supply.debug().supply.required), []);
    assert.deepEqual(f.plans.at(-1).duckIntervals, []);
});

test('explicit and old embedded declarations cannot restore audio disabled on a cut', () => {
    const cuts = [{ id: 'cut', src: 'main', in: 0, out: 16, audio: false }];
    const embedded = projectSpeechDeclarations([{ ...cuts[0], audio: undefined }], { fps: 30 });
    for (const key of ['speech', 'embeddedSpeech']) {
        const result = declarationsFor({ audio: { [key]: embedded } }, cuts);
        assert.deepEqual(plain(result), { declarations: [], speech: [] });
    }
    const mixed = declarationsFor({ audio: { speech: [...embedded,
        { id: 'voice', role: 'speech', src: 'stream://voice', t: 0 }] } }, cuts);
    assert.equal(mixed.declarations.length, 1);
    assert.equal(mixed.declarations[0].duckKey, true);
    assert.equal(mixed.speech.length, 0);
});

test('independent speech uses narration sidecars and polling updates only its own collection', async () => {
    let ready = false;
    const f = createPreviewAudioHost(() => ready ? {
        state: 'ready', key: 'voice-sidecar', stream: { id: 'voice-stream', url: 'stream://voice-sidecar' },
        durationSec: 16, format: 'flac'
    } : { state: 'queued' });
    const edit = fixture();
    edit.tracks[1].items[0].lowcut_hz = 80;
    const model = await f.load(edit);
    const pending = model.previewAudioPendingRequests;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, 'narration');
    assert.equal(pending[0].audioCollection, 'speech');
    assert.equal(pending[0].id, 'voice');
    assert.equal(model.summary.audio.speech[0].sidecarState, 'queued');
    const messages = [];
    const widget = { isDisposed: false, disposed: { connect() {} },
        akariPreviewSummary: model.summary, sendMessage: message => messages.push(message) };
    f.host.startPreviewAudioTracking(widget, model, true);
    ready = true;
    await f.poll();
    assert.equal(model.summary.audio.speech[0].sidecar.path, 'stream://voice-sidecar');
    assert.equal(model.summary.audio.embeddedSpeech.length, 0);
    assert.equal(messages[0].type, 'akari-preview-audio-update');
    assert.equal(widget.akariPreviewAudioPendingRequests.length, 0);
});

test('legacy video and transition apply shared cut audibility, and speech enters narration decode', () => {
    const muteVideo = source.match(/video\.muted = globalMuted \|\| !isCutAudioAudible[^;]+;/u)[0];
    const muteTransition = source.match(/transitionVideo\.muted = globalMuted \|\| !isCutAudioAudible[^;]+;/u)[0];
    for (const { cut, track, audible } of audibilityCases) {
        const context = { segment: cut, window: { incoming: cut }, globalMuted: false,
            cutsTrackMuted: track.muted === true, video: {}, transitionVideo: {} };
        vm.runInNewContext(embeddedAudibility() + muteVideo + muteTransition, context);
        assert.equal(context.video.muted, !audible);
        assert.equal(context.transitionVideo.muted, !audible);
    }
    assert.match(source, /audio: cut \? cut\.audio : undefined/u);
    assert.match(source, /timed\('narration', \[[\s\S]*?config\.speech[\s\S]*?item\.role === 'speech'/u);
});

test('legacy independent speech decodes the same nonzero trim as narration', async () => {
    const decode = vm.runInNewContext(`(() => {
        ${section('                const decodeOne =', '                const load =')}
        return decodeOne;
    })()`, {
        fetchDecodedBuffer: async () => ({ duration: 16 }), resolveSfxTrimWindowFn: resolveSfxTrimWindow,
        context: { state: 'running' }, console, warnUnavailable: () => assert.fail('decode failed')
    });
    const decoded = await decode('narration', { id: 'voice', role: 'speech', src: 'stream://voice', in: 3, out: 8 });
    assert.equal(decoded.durationSec, 5);
    assert.equal(decoded.sourceOffset, 3);
});
