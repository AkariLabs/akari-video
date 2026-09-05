import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { classifyPreviewModelUpdate } from '../lib/common/preview-model-diff.js';

const source = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const compiled = await readFile(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const section = (text, start, end) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `${start} … ${end}`);
    return text.slice(from, to);
};

test('loading requests carry decoded-size plans and never use heavyWavOnly', () => {
    const load = section(source, '    protected async loadPreviewModel(', '    protected async resolveAudioAssets(');
    const resolve = section(source, '    protected async resolveAudioAssets(', '        const gainDb =');
    for (const text of [load, resolve]) assert.doesNotMatch(text, /heavyWavOnly/u);
    assert.match(load, /format: resolveSpeechSidecarFormat\(declaration\)/u);
    assert.match(resolve, /resolveRegularSidecarPlan\(\{ \.\.\.trim, hasClipFx: false \}\)/u);
    assert.match(resolve, /await ensure\(key, assetUri\);[\s\S]*if \(!plan\.request\) return \{ src: stream\.url \};[\s\S]*const request:/u);
    assert.match(resolve, /format: plan\.format/u);
    assert.match(resolve, /plan\.decodedBytesThreshold !== undefined \? \{ decodedBytesThreshold: plan\.decodedBytesThreshold \} : \{\}/u);
    assert.match(resolve, /const item: PreviewAudioPendingRequest = \{ kind, id, label: label \+ ' sidecar', request \}/u);
});

test('ready fields preserve defined PCM metadata and not-needed returns no declaration fields', () => {
    const fields = section(source, '    protected previewAudioSidecarFields(', '    // Incremental refresh');
    assert.match(fields, /if \(result\.state === 'not-eligible' \|\| result\.state === 'not-needed'\) return \{\}/u);
    const ready = section(fields, "if (result.state === 'ready'", "if (result.state === 'queued'");
    for (const field of ['format', 'sampleRate', 'channels', 'frames', 'bytesPerSample']) {
        assert.match(ready, new RegExp(`result\\.${field} !== undefined \\? \\{ ${field}: result\\.${field} \\} : \\{\\}`, 'u'));
    }
    const poll = section(source, '        const poll = async', '    // Picks the URI');
    assert.match(poll, /requestPreviewAudioSidecar\(item\.request\)/u);
    assert.match(poll, /if \(result\.key\)/u);
    assert.match(poll, /pending\.splice\(pending\.indexOf\(item\), 1\)/u);
    assert.match(poll, /delete target\.sidecar;\s+delete target\.sidecarState;\s+Object\.assign\(target, this\.previewAudioSidecarFields\(item, result\)\)/u);
});

test('webview passes the whole PCM sidecar through regular and speech declarations', () => {
    const declarations = section(compiled, 'const audioDeclarationsForSummary =', 'const createAudioSupplyForSummary =');
    assert.match(declarations, /raw\.sidecar\.path \? raw\.sidecar : undefined/u);
    assert.match(declarations, /spec: \{ \.\.\.raw, sidecar,/u);
    assert.match(declarations, /\? declaration\.sidecar : undefined/u);
    const project = vm.runInNewContext(`(() => { ${declarations} return audioDeclarationsForSummary; })()`, {
        sourceUrls: new Map([['camera', 'source-video']]), fps: 30, engine: {}
    });
    const sidecar = {
        path: 'sidecar.pcm', durationSec: 5310, format: 'pcm-s16le', sampleRate: 24000,
        channels: 1, frames: 127440000, bytesPerSample: 2
    };
    for (const state of ['ready', undefined]) {
        const raw = { src: 'source-audio', sidecar, sidecarState: state };
        const result = project({ audio: {
            bgm: raw, sfx: [raw], narration: [raw],
            speech: [{ id: 'speech', src: 'camera', sidecar, sidecarState: state }]
        } }, []);
        assert.equal(result.declarations.length, 3);
        for (const declaration of result.declarations) assert.equal(declaration.spec.sidecar, sidecar);
        assert.equal(result.speech[0].sidecar, sidecar);
    }
});

test('モデル読み込みと素材解決は即返し RPC を使い、sweep を待たない', () => {
    const load = section(source, '    protected async loadPreviewModel(', '    protected async resolveAudioAssets(');
    const resolve = section(source, '    protected async resolveAudioAssets(', '        const gainDb =');
    for (const text of [load, resolve]) {
        assert.doesNotMatch(text, /await previewAudioService\.preparePreviewAudioSidecar\(/u);
        assert.match(text, /await previewAudioService\.requestPreviewAudioSidecar\(/u);
        assert.doesNotMatch(text, /sweepPreviewAudioSidecars\(/u);
        assert.match(text, /previewAudioKeepProbes\.add\(result\.probe\.fingerprint\)/u);
    }
    const timers = section(source, '    protected startPreviewAudioTracking(', '    // Picks the URI');
    assert.match(timers, /service\.sweepPreviewAudioSidecars\(/u);
    assert.match(timers, /setTimeout\(\(\) => void sweep\(\), 60 \* 1000\)/u);
    assert.match(timers, /setTimeout\(\(\) => void sweep\(\), 10 \* 60 \* 1000\)/u);
    assert.match(timers, /minAgeMs: 60 \* 60 \* 1000/u);
    assert.match(timers, /if \(!frameEngineEnabled\) return/u);
    assert.match(timers, /setTimeout\(\(\) => void poll\(\), 1000\)/u);
    assert.match(timers, /widget\.disposed\.connect/u);
    assert.doesNotMatch(timers, /akari-preview-model-update/u);
});

test('audio-update は専用受信で updateAudio に届き bootstrap 前は保留する', () => {
    assert.match(source, /widget\.sendMessage\(\{ type: 'akari-preview-audio-update', audio: summary\.audio \}\)/u);
    const receiver = section(source, "if (message && message.type === 'akari-preview-audio-update')", "if (message && message.type === 'akari-preview-model-update')");
    assert.match(receiver, /frameEngineUpdateAudio\(message\)/u);
    assert.match(receiver, /frameEnginePendingAudio = \{ audio: message\.audio \}/u);
    assert.doesNotMatch(receiver, /updateModel|applyIncrementalModel/u);
    assert.match(source, /engineSummary\.audio = message\.audio/u);
    assert.match(source, /audioSupply\.updateAudio\(audioDeclarationsForSummary\(\{ audio: message\.audio \}, normalizedCuts\)\)/u);
    assert.match(source, /delete window\.akari\.frameEnginePendingAudio;\s+updateAudio\(pendingAudio\)/u);
});

test('transport の状態表示は 250ms と play / seek / audio-update で更新する', () => {
    assert.match(source, /id="audio-status" class="audio-status" role="status" aria-live="polite" hidden/u);
    assert.match(source, /音声を準備中/u);
    assert.match(source, /一部の音声を再生できません/u);
    assert.match(source, /supply\.ready\.filter\(key => supply\.required\.includes\(key\)\)/u);
    assert.match(source, /setInterval\(updateAudioStatus, 250\)/u);
    assert.match(source, /clearInterval\(audioStatusTimer\)/u);
    assert.match(source, /audioSupply\.playFrom\(position\);\s+updateAudioStatus\(\)/u);
    assert.match(source, /audioSupply\.seek\(position, continuePlaying\);\s+updateAudioStatus\(\)/u);
    assert.match(source, /audioStatus\.hidden = !message/u);
});

test('音声宣言は pending の sidecar を除外し ready と旧宣言だけを使う', () => {
    const declarations = section(compiled, 'const audioDeclarationsForSummary =', 'const createAudioSupplyForSummary =');
    assert.match(declarations, /sidecarState/u);
    const project = vm.runInNewContext(`(() => { ${declarations} return audioDeclarationsForSummary; })()`, {
        sourceUrls: new Map([['camera', 'source-video']]), fps: 30, engine: {}
    });
    for (const state of ['queued', 'generating', 'no-audio', 'unavailable', 'ready', undefined]) {
        const sidecar = { path: 'sidecar-flac', durationSec: 1 };
        const audio = {
            bgm: { src: 'source-audio', sidecar, sidecarState: state },
            speech: [{ id: 'speech-1', src: 'camera', sidecar, sidecarState: state }]
        };
        const result = project({ audio }, []);
        const usable = state === 'ready' || state === undefined;
        assert.equal(result.declarations[0].url, usable ? sidecar.path : 'source-audio');
        assert.equal(result.declarations[0].spec.sidecarState, state);
        assert.equal(result.declarations[0].spec.sidecar?.path, usable ? sidecar.path : undefined);
        assert.equal(result.speech[0].sidecar?.path, usable ? sidecar.path : undefined);
        assert.equal(result.speech[0].sidecarState, state);
    }
});

test('sidecar の状態だけではモデル差分を起こさず gain 編集は incremental にする', () => {
    const previous = {
        sourceUris: [], assetUris: [], overlayUris: [], output: { width: 1280, height: 720 },
        overlayRuntimeAssets: [], summary: { audio: {
            bgm: { src: 'bgm', gainDb: 0, sidecarState: 'queued' },
            speech: [{ id: 'speech', sidecarState: 'queued' }]
        } }
    };
    const next = structuredClone(previous);
    Object.assign(next.summary.audio.bgm, { sidecarState: 'ready', sidecar: { path: 'flac' } });
    Object.assign(next.summary.audio.speech[0], { sidecarState: 'unavailable', sidecarWarningEmitted: true });
    assert.equal(classifyPreviewModelUpdate(previous, next), 'none');
    next.summary.audio.bgm.gainDb = -6;
    assert.equal(classifyPreviewModelUpdate(previous, next), 'incremental');
});

function lifecycle(requestSidecar = async () => ({ state: 'no-audio' })) {
    const methods = ['previewAudioSidecarFields', 'retainPreviewAudioStreams', 'stopPreviewAudioPolling', 'startPreviewAudioTracking'];
    const body = methods.map(name => {
        const start = compiled.indexOf(`    ${name}(`);
        assert.ok(start >= 0);
        const end = compiled.indexOf('\n    }', start) + '\n    }'.length;
        return compiled.slice(start, end);
    }).join('\n');
    const timers = new Map();
    let sequence = 0;
    const callbacks = [];
    const messages = [];
    const sweeps = [];
    const released = [];
    const warnings = [];
    const Host = vm.runInNewContext(`(class { ${body} })`, {
        setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        console: { warn: (...args) => warnings.push(args) }
    });
    const host = new Host();
    host.previewService = {
        requestPreviewAudioSidecar: requestSidecar,
        sweepPreviewAudioSidecars: async request => { sweeps.push(request); }
    };
    host.disposeAssetStreams = async ids => released.push(...ids);
    const widget = {
        isDisposed: false, disposed: { connect: callback => callbacks.push(callback) },
        sendMessage: message => messages.push(structuredClone(message)),
        akariPreviewSummary: { audio: { bgm: { src: 'bgm', sidecarState: 'queued' }, sfx: [], narration: [] } }
    };
    const model = {
        editUri: { parent: { toString: () => 'file:///project' } },
        previewAudioKeepKeys: new Set(['initial-key']), previewAudioKeepProbes: new Set(['initial-probe']),
        previewAudioPendingRequests: [{ kind: 'bgm', id: 'bgm', label: 'audio.bgm sidecar', request: { inSec: 0 } }]
    };
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const run = async delay => {
        const entry = [...timers].find(([, timer]) => timer.delay === delay);
        assert.ok(entry, `timer ${delay} exists`);
        timers.delete(entry[0]);
        entry[1].fn();
        await flush();
    };
    const dispose = () => { widget.isDisposed = true; callbacks.forEach(callback => callback()); };
    return { host, widget, model, timers, messages, sweeps, released, warnings, run, flush, dispose };
}

test('poll keeps PCM request options and settles not-needed without sidecar state or retained keys', async () => {
    const calls = [];
    const f = lifecycle(async request => {
        calls.push(request);
        return { state: calls.length === 1 ? 'generating' : 'not-needed' };
    });
    const request = { inSec: 0, format: 'pcm-s16le', decodedBytesThreshold: 64 * 1024 * 1024 };
    f.model.previewAudioPendingRequests[0].request = request;
    f.widget.akariPreviewSummary.audio.bgm.sidecar = { path: 'stale-sidecar' };
    f.host.startPreviewAudioTracking(f.widget, f.model, true);
    await f.run(1000);
    await f.run(1000);
    assert.deepEqual(calls, [request, request]);
    assert.equal(calls[0], request);
    assert.equal(calls[1], request);
    assert.equal(f.widget.akariPreviewAudioPendingRequests.length, 0);
    assert.equal('sidecar' in f.widget.akariPreviewSummary.audio.bgm, false);
    assert.equal('sidecarState' in f.widget.akariPreviewSummary.audio.bgm, false);
    assert.equal(f.messages.length, 1);
    assert.equal(f.warnings.length, 0);
    assert.equal([...f.timers.values()].some(timer => timer.delay === 1000), false);
    await f.run(60000);
    assert.deepEqual([...f.sweeps[0].keepKeys], ['initial-key']);
    f.dispose();
});

test('host ready fields copy PCM metadata and omit all undefined metadata fields', () => {
    const f = lifecycle();
    const metadata = { format: 'pcm-s16le', sampleRate: 24000, channels: 1, frames: 0, bytesPerSample: 2 };
    const item = { kind: 'speech', label: 'speech', request: {} };
    for (const values of [metadata, {}]) {
        const result = f.host.previewAudioSidecarFields(item, {
            state: 'ready', stream: { url: 'sidecar' }, ...values
        });
        for (const field of Object.keys(metadata)) {
            assert.equal(result.sidecar[field], values[field]);
            assert.equal(field in result.sidecar, field in values);
        }
    }
    assert.deepEqual(Object.keys(f.host.previewAudioSidecarFields(item, { state: 'not-needed' })), []);
    assert.equal(f.warnings.length, 0);
    f.dispose();
});

test('poll 完了は audio だけ更新し最新 key/probe を sweep に渡す', async () => {
    const f = lifecycle(async () => ({
        state: 'ready', key: 'ready-key', probe: { fingerprint: 'ready-probe' },
        durationSec: 12, bytes: 64, stream: { id: 'sidecar-stream', url: 'sidecar-url' }
    }));
    f.host.startPreviewAudioTracking(f.widget, f.model, true);
    await f.run(1000);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].type, 'akari-preview-audio-update');
    assert.equal(f.widget.akariPreviewSummary.audio.bgm.sidecar.path, 'sidecar-url');
    assert.equal(f.widget.akariPreviewSummary.audio.bgm.sidecarState, 'ready');
    assert.deepEqual([...f.widget.akariPreviewAssetStreamIds], ['sidecar-stream']);
    assert.equal([...f.timers.values()].some(timer => timer.delay === 1000), false);
    await f.run(60000);
    assert.deepEqual([...f.sweeps[0].keepKeys], ['initial-key', 'ready-key']);
    assert.deepEqual([...f.sweeps[0].keepProbes], ['initial-probe', 'ready-probe']);
    assert.equal(f.sweeps[0].minAgeMs, 3600000);
    f.host.startPreviewAudioTracking(f.widget, {
        ...f.model, previewAudioKeepKeys: new Set(['latest']), previewAudioPendingRequests: []
    }, true);
    await f.run(600000);
    assert.deepEqual([...f.sweeps[1].keepKeys], ['latest']);
    f.dispose();
    assert.equal(f.timers.size, 0);
});

test('再読込 / dispose 中に返った古い stream を捨て、旧経路は poll しない', async () => {
    for (const finish of ['reload', 'dispose']) {
        let settle;
        const f = lifecycle(() => new Promise(resolve => { settle = resolve; }));
        f.host.startPreviewAudioTracking(f.widget, f.model, true);
        await f.run(1000);
        if (finish === 'dispose') f.dispose();
        else f.host.stopPreviewAudioPolling(f.widget);
        settle({ state: 'ready', stream: { id: 'obsolete', url: 'obsolete-url' } });
        await f.flush();
        assert.equal(f.messages.length, 0);
        assert.deepEqual(f.released, ['obsolete']);
        assert.equal(f.widget.akariPreviewSummary.audio.bgm.sidecarState, 'queued');
        f.dispose();
    }
    const legacy = lifecycle(() => assert.fail('legacy must not poll'));
    legacy.host.startPreviewAudioTracking(legacy.widget, legacy.model, false);
    assert.deepEqual([...legacy.timers.values()].map(timer => timer.delay), [60000]);
    assert.equal(legacy.messages.length, 0);
    legacy.dispose();
});

test('完了順に speech / sfx / narration を反映し、残りの pending だけ再要求する', async () => {
    const states = new Map([['speech', 'ready'], ['sfx', 'generating'], ['narration', 'failed']]);
    const calls = [];
    const f = lifecycle(async request => {
        calls.push(request.kind);
        const state = states.get(request.kind);
        return { state, ...(state === 'ready' ? { stream: { id: 'speech-stream', url: 'speech-url' } } : {}) };
    });
    const audio = { sfx: [], narration: [], speech: [] };
    f.model.previewAudioPendingRequests = ['speech', 'sfx', 'narration'].map(kind => {
        audio[kind].push({ id: kind, sidecarState: 'queued' });
        return { kind, id: kind, label: kind + ' sidecar', request: { kind } };
    });
    f.widget.akariPreviewSummary.audio = audio;
    f.host.startPreviewAudioTracking(f.widget, f.model, true);
    await f.run(1000);
    assert.equal(f.messages.length, 2);
    assert.equal(audio.speech[0].sidecarState, 'ready');
    assert.equal(audio.narration[0].sidecarState, 'unavailable');
    assert.equal(f.widget.akariPreviewAudioPendingRequests.length, 1);
    states.set('sfx', 'no-audio');
    await f.run(1000);
    assert.deepEqual(calls, ['speech', 'sfx', 'narration', 'sfx']);
    assert.equal(audio.sfx[0].sidecarState, 'no-audio');
    assert.equal(f.messages.length, 3);
    assert.equal(f.warnings.length, 2);
    assert.equal(f.widget.akariPreviewAudioPendingRequests.length, 0);
    f.dispose();
});

test('差分更新では採用した sidecar の stream だけを保持する', () => {
    const f = lifecycle();
    const model = {
        assetStreamIds: ['source', 'new-sidecar', 'duplicate-sidecar'],
        previewAudioStreams: new Map([
            ['preview-audio:speech:voice:new-key', { id: 'new-sidecar', url: 'new-url' }],
            ['preview-audio:bgm:old-key', { id: 'duplicate-sidecar', url: 'duplicate-url' }]
        ])
    };
    const summary = { audio: {
        bgm: { sidecar: { path: 'previous-url' } }, speech: [{ id: 'voice', sidecar: { path: 'new-url' } }]
    } };
    f.host.retainPreviewAudioStreams(f.widget, model, summary);
    assert.deepEqual([...f.widget.akariPreviewAssetStreamIds], ['new-sidecar']);
    assert.deepEqual(model.assetStreamIds, ['source', 'duplicate-sidecar']);
    assert.equal(f.widget.akariPreviewAssetUrlByUri.get('preview-audio:speech:voice:new-key'), 'new-url');
});
