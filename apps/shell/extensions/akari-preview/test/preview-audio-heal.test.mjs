import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { createPreviewPage, diagnosticsModule, injectedScript, methodTemplateSource } from './helpers/preview-diagnostics-page.mjs';

const require = createRequire(import.meta.url);
const heal = require('../lib/common/preview-audio-heal.js');
const source = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');

test('(a) one stalled sidecar request times out while another and the next poll can progress', async () => {
    const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
    const methods = ['previewAudioSidecarFields', 'stopPreviewAudioPolling', 'startPreviewAudioTracking']
        .map(name => {
            const start = compiled.indexOf(`    ${name}(`);
            const end = compiled.indexOf('\n    }', start) + '\n    }'.length;
            assert.ok(start >= 0 && end > start, name);
            return compiled.slice(start, end);
        }).join('\n');
    const timers = new Map();
    let timerId = 0;
    const warnings = [];
    const Host = vm.runInNewContext(`(class { ${methods} })`, {
        setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id),
        console: { warn: (...args) => warnings.push(args) },
    });
    const instance = new Host();
    let slowCalls = 0;
    instance.currentWorkspaceRoots = async () => [];
    instance.disposeAssetStreams = async () => {};
    instance.previewService = {
        requestPreviewAudioSidecar: async request => {
            if (request.kind === 'bgm') return { state: 'ready', key: 'bed-key',
                stream: { id: 'bed-stream', url: 'asset://bed' } };
            slowCalls += 1;
            if (slowCalls === 1) return new Promise(() => {});
            return { state: 'ready', key: 'slow-key', stream: { id: 'slow-stream', url: 'asset://slow' } };
        },
    };
    const widget = { isDisposed: false, disposed: { connect() {} }, sendMessage() {},
        akariPreviewSummary: { audio: { bgms: [{ id: 'bed', sidecarState: 'queued' }],
            sfx: [{ id: 'slow', sidecarState: 'queued' }] } } };
    const model = { previewAudioPendingRequests: [
        { kind: 'bgm', id: 'bed', state: 'queued', label: 'bed', request: { kind: 'bgm' } },
        { kind: 'sfx', id: 'slow', state: 'queued', label: 'slow', request: { kind: 'sfx' } },
    ] };
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const fire = async ms => {
        const entry = [...timers].find(([, value]) => value.ms === ms);
        assert.ok(entry, `timer ${ms} exists`);
        timers.delete(entry[0]);
        entry[1].fn();
        await flush();
    };
    instance.startPreviewAudioTracking(widget, model, true);
    await fire(1000);
    assert.equal(widget.akariPreviewSummary.audio.bgms[0].sidecarState, 'ready');
    await fire(15000);
    assert.equal(widget.akariPreviewSummary.audio.bgms[0].sidecarState, 'ready');
    assert.equal(widget.akariPreviewSummary.audio.sfx[0].sidecarState, 'queued');
    await fire(1000);
    assert.equal(widget.akariPreviewSummary.audio.sfx[0].sidecarState, 'ready');
    assert.equal(slowCalls, 2);
    assert.equal(warnings.length, 1);
});

test('(b) sidecar gate and persistent pending key request resync, with host route and five-second throttle', () => {
    const since = new Map();
    const gateState = { holdingSidecar: false };
    const supply = { gate: { holding: false, reason: null, heldMs: 0 }, pendingSidecar: ['audio-key'] };
    assert.deepEqual(heal.previewAudioResyncKeys(supply, since, 0, gateState), []);
    assert.deepEqual(heal.previewAudioResyncKeys(supply, since, 4999, gateState), []);
    assert.deepEqual(heal.previewAudioResyncKeys(supply, since, 5000, gateState), ['audio-key']);
    const held = { ...supply, gate: { holding: true, reason: 'sidecar', heldMs: 2750 } };
    const released = { ...supply, gate: { holding: false, reason: null, heldMs: 0 } };
    const observedGate = { holdingSidecar: false };
    const observedSince = new Map();
    assert.deepEqual(heal.previewAudioResyncKeys(held, observedSince, 2750, observedGate), []);
    assert.deepEqual(heal.previewAudioResyncKeys(released, observedSince, 3000, observedGate), ['audio-key']);
    const resolvedGate = { holdingSidecar: false };
    const resolvedSince = new Map();
    heal.previewAudioResyncKeys(held, resolvedSince, 2750, resolvedGate);
    assert.deepEqual(heal.previewAudioResyncKeys({ ...released, pendingSidecar: [] },
        resolvedSince, 3000, resolvedGate), []);
    const elapsedGate = { holdingSidecar: false };
    const elapsedSince = new Map();
    assert.deepEqual(heal.previewAudioResyncKeys({ ...held, gate: { ...held.gate, heldMs: 100 } },
        elapsedSince, 0, elapsedGate), []);
    assert.deepEqual(heal.previewAudioResyncKeys({ ...held, gate: { ...held.gate, heldMs: 2500 } },
        elapsedSince, 3000, elapsedGate), ['audio-key']);
    assert.deepEqual(heal.previewAudioResyncKeys({ ...supply,
        gate: { holding: true, reason: 'sidecar', heldMs: 2900 } }, new Map(), 0,
    { holdingSidecar: false }), ['audio-key']);
    assert.match(source('preview-script-frame-engine-bootstrap.ts'), /lastAudioResyncAt >= 5000/u);
    assert.match(source('preview-script-diagnostics.ts'), /type: 'akari-preview-audio-resync'/u);
    assert.match(source('akari-preview-open-handler.ts'), /this\.handlePreviewAudioResync\(widget/u);
});

test('(c) resync queries queued summary even with a ready request, restores ready, and joins an in-flight run', async () => {
    const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
    const methods = ['previewAudioSidecarFields', 'handlePreviewAudioResync'].map(name => {
        const start = compiled.indexOf(`    ${name}(`);
        const end = compiled.indexOf('\n    }', start) + '\n    }'.length;
        assert.ok(start >= 0 && end > start, name);
        return compiled.slice(start, end);
    }).join('\n');
    const Host = vm.runInNewContext(`(class { ${methods} })`, { console, setTimeout, clearTimeout, Date, Promise, Set, Map });
    const host = new Host();
    const calls = [];
    let resolveRequest;
    host.currentWorkspaceRoots = async () => [];
    host.disposeAssetStreams = async () => {};
    host.startPreviewAudioTracking = () => {};
    host.previewService = { requestPreviewAudioSidecar: request => {
        calls.push(request.kind);
        return new Promise(resolve => { resolveRequest = resolve; });
    } };
    const messages = [];
    const widget = { isDisposed: false, sendMessage: message => messages.push(message),
        akariPreviewSummary: { audio: { bgms: [{ id: 'bed', sidecarState: 'queued' }],
            sfx: [{ id: 'done', sidecarState: 'ready' }] } },
        akariPreviewAudioModel: { previewAudioPendingRequests: [
            { kind: 'bgm', id: 'bed', state: 'ready', label: 'bed', request: { kind: 'bgm' } },
            { kind: 'sfx', id: 'done', state: 'ready', label: 'done', request: { kind: 'sfx' } },
        ] } };
    const first = host.handlePreviewAudioResync(widget, ['unknown-key']);
    const second = host.handlePreviewAudioResync(widget, ['bgm:bed']);
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['bgm']);
    assert.equal(messages[0].type, 'akari-preview-audio-update');
    resolveRequest({ state: 'ready', key: 'bed-key', stream: { id: 'bed-stream', url: 'asset://bed' } });
    await first;
    assert.equal(widget.akariPreviewSummary.audio.bgms[0].sidecarState, 'ready');
    assert.equal(widget.akariPreviewSummary.audio.bgms[0].sidecar.path, 'asset://bed');
    assert.ok(messages.some(message => message.type === 'akari-preview-audio-update'
        && message.audio.bgms[0].sidecarState === 'ready'));
    assert.equal(widget.akariPreviewAssetUrlByUri.get('preview-audio:bed:bed-key'), 'asset://bed');
    assert.equal(widget.akariPreviewAssetStreamIds[0], 'bed-stream');
});

test('(d) stale queued state reproduces a ready regression, and same-key reconciliation prevents it', () => {
    const ready = { audio: { bgms: [{ id: 'music', sidecarKey: 'same-key',
        sidecarState: 'ready', sidecar: { path: 'asset://ready', durationSec: 5 } }] } };
    const stale = { audio: { bgms: [{ id: 'music', sidecarKey: 'same-key', sidecarState: 'queued' }] } };
    assert.equal(stale.audio.bgms[0].sidecarState, 'queued');
    heal.preserveReadyPreviewAudio(ready, stale);
    assert.equal(stale.audio.bgms[0].sidecarState, 'ready');
    assert.equal(stale.audio.bgms[0].sidecar.path, 'asset://ready');
    const changed = { audio: { bgms: [{ id: 'music', sidecarKey: 'new-key', sidecarState: 'queued' }] } };
    heal.preserveReadyPreviewAudio(ready, changed);
    assert.equal(changed.audio.bgms[0].sidecarState, 'queued');
    assert.match(source('akari-preview-open-handler.ts'), /preserveReadyPreviewAudio\(widget\.akariPreviewSummary/u);
});

test('(e) readable report keeps the anomaly, resync events, gate reason, and sends after 20 events', () => {
    const page = createPreviewPage();
    const { webviewScriptText } = require('../lib/common/preview-text.js');
    page.run(webviewScriptText(vm.runInNewContext(methodTemplateSource('previewDiagnosticsGuardScript'), {
        ...diagnosticsModule, formatPreviewAudioDiagnostics: heal.formatPreviewAudioDiagnostics,
        JSON, String, Number,
    })));
    page.attachHost();
    const sample = (at, heldMs, phase = 'preparing', ready = [], pending = heldMs ? ['audio-key'] : [], playing = true,
        startSec = 0, failed = []) => page.diag().audioSample({
        supply: { phase, gate: { holding: heldMs > 0, heldMs,
            reason: heldMs ? 'sidecar' : null, startSec }, required: ['audio-key'], ready,
            pendingSidecar: pending, failed, noAudio: [] },
        contextState: 'running', scheduled: { itemCount: 0 }, prefetch: { pending: 0 }, playing,
        driftMs: 0.2930000000027633, outputLatencyMs: 50,
    }, 'page-1', at);
    sample('t1', 100);
    sample('t2', 3000);
    page.diag().requestAudioResync(['audio-key'], 'page-1');
    sample('t3', 0, 'preparing');
    sample('t4', 0, 'ready', ['audio-key']);
    const record = page.diag().audioRecord();
    assert.equal(record.latest.supply.phase, 'ready');
    assert.equal(record.abnormal.supply.gate.heldMs, 3000);
    assert.ok(record.events.some(event => event.kind === 'gate-end' && event.detail === 'limit'));
    assert.ok(record.events.some(event => event.kind === 'resync-sent' && event.detail === 'audio-key'));
    assert.ok(record.events.some(event => event.kind === 'resync-ready' && event.detail === 'audio-key'));
    sample('2026-10-15T00:00:00.000Z', 100);
    sample('2026-10-15T00:00:02.500Z', 2500);
    sample('2026-10-15T00:00:03.000Z', 0, 'preparing', [], ['audio-key'], false);
    const gateEnd = page.diag().audioRecord().events.filter(event => event.kind === 'gate-end').at(-1);
    assert.equal(gateEnd.detail, 'limit');
    assert.equal(page.diag().audioRecord().abnormal.supply.gate.heldMs, 2500);
    sample('2026-10-15T00:00:04.000Z', 100);
    sample('2026-10-15T00:00:04.500Z', 0, 'ready', ['audio-key']);
    assert.equal(page.diag().audioRecord().events.filter(event => event.kind === 'gate-end').at(-1).detail, 'ready');
    sample('2026-10-15T00:00:08.000Z', 1000, 'preparing', [], ['audio-key'], false);
    sample('2026-10-15T00:00:08.300Z', 1300, 'preparing', [], [], false);
    sample('2026-10-15T00:00:08.550Z', 0, 'ready', ['audio-key'], [], true);
    const recovered = page.diag().audioRecord();
    assert.deepEqual([...recovered.abnormal.episodePending], ['audio-key']);
    assert.equal(recovered.abnormal.supply.pendingSidecar.length, 0);
    assert.equal(recovered.events.filter(event => event.kind === 'gate-end').at(-1).detail, 'ready');
    assert.match(page.diag().report(), /直近の異常 .*pending=-.*waited=audio-key/u);
    assert.match(page.diag().report(), /drift=0\.3ms latency=50ms/u);
    sample('2026-10-15T00:00:09.000Z', 300, 'preparing', [], ['audio-key'], false, 0);
    sample('2026-10-15T00:00:09.250Z', 300, 'preparing', [], ['audio-key'], false, 2);
    assert.equal(page.diag().audioRecord().events.filter(event => event.kind === 'gate-end').at(-1).detail, 'generation');
    assert.equal(page.diag().audioRecord().events.filter(event => event.kind === 'gate-start').at(-1).at,
        '2026-10-15T00:00:09.250Z');
    sample('2026-10-15T00:00:09.500Z', 550, 'preparing', [], ['audio-key'], false, 2, ['failed-key']);
    sample('2026-10-15T00:00:09.750Z', 800, 'preparing', [], [], false, 2);
    assert.deepEqual([...page.diag().audioRecord().abnormal.episodeFailed], ['failed-key']);
    assert.match(page.diag().report(), /failedDuring=failed-key/u);
    const before = page.posted.filter(message => message.type === 'akari-preview-audio-diagnostics').length;
    for (let index = 0; index < 25; index++) {
        sample('cycle-' + index + '-hold', 350);
        sample('cycle-' + index + '-free', 0, 'ready');
    }
    assert.equal(page.diag().audioRecord().events.length, 20);
    assert.ok(page.posted.filter(message => message.type === 'akari-preview-audio-diagnostics').length > before + 20);
    assert.ok(page.posted.some(message => message.type === 'akari-preview-audio-diagnostics'));
    page.diag().setAudioHost({ pending: [{ key: 'audio-key', state: 'generating' }],
        lastQuery: 'query-at', lastUpdate: 'update-at', lastResult: { key: 'audio-key', state: 'ready' } });
    assert.match(page.diag().report(), /ホスト: .*audio-key\(generating\).*query-at.*update-at.*audio-key ready/u);
    const report = heal.formatPreviewAudioDiagnostics(record, {
        heading: 'Audio', latest: 'Latest', abnormal: 'Anomaly', events: 'Events', host: 'Host',
        pending: 'Pending', lastQuery: 'Query', lastUpdate: 'Update', lastResult: 'Result',
    }, { pending: [{ key: 'audio-key', state: 'generating' }], lastResult: { state: 'ready' } });
    assert.match(report, /Anomaly .*gate=holding 3\.0s/u);
    assert.match(report, /Latest .*phase=ready/u);
    assert.match(report, /Host: .*Result=- ready/u);
    assert.doesNotMatch(report, /"phase":/u);
    assert.match(source('preview-script-diagnostics.ts'), /formatPreviewAudioDiagnostics\.toString\(\)/u);
    assert.match(source('preview-diagnostics.ts'), /formatPreviewAudioDiagnostics\(this\.audioRecord/u);
});

test('(f) audio labels exist in ja and en, and English values contain no Japanese characters', () => {
    const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/preview.json', import.meta.url)));
    const en = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/en/preview.json', import.meta.url)));
    const keys = Object.keys(ja).filter(key => key.startsWith('preview.diagnostics.audio.'));
    assert.ok(keys.length >= 9);
    for (const key of keys) {
        assert.ok(en[key], key);
        assert.doesNotMatch(en[key], /[\u3040-\u30ff\u3400-\u9fff]/u);
        assert.doesNotMatch(ja[key], /棚/u);
    }
});
