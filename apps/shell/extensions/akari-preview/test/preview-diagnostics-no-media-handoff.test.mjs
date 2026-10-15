import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createPreviewPage, injectedScript } from './helpers/preview-diagnostics-page.mjs';
import { installPreviewTestI18n } from './helpers/preview-i18n.mjs';

const restoreI18n = installPreviewTestI18n();
test.after(restoreI18n);
const require = createRequire(import.meta.url);
const host = require('../lib/browser/preview-diagnostics.js');

test('空キャンバスだけの初回 ready は早期購読から ingest へ届き、監視で警告を出さない', () => {
    const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const configure = handler.slice(handler.indexOf('protected async doConfigurePreview('),
        handler.indexOf('protected forwardAudioMeterFrame('));
    const early = configure.indexOf('listenForEarlyPreviewDiagnostics(widget)');
    const load = configure.indexOf('await this.refreshPreview(widget, identityUri, kind, initialSeekTime)');
    const normal = configure.indexOf('disposables.push(widget.onMessage(message => {');
    const handoff = configure.indexOf('earlyDiagnostics.dispose();', normal);
    assert.ok(early >= 0 && early < load && load < normal && normal < handoff,
        '初回ページ読込より先に診断を購読し、通常の購読後に引き継ぐ');

    const shown = [];
    const timers = [];
    const log = new host.PreviewDiagnosticsLog({
        resolveLogUri: async () => 'file:///tmp/preview-diagnostics-no-media.log',
        readText: async () => undefined,
        writeText: async () => {},
        warn: () => {}
    });
    const center = new host.PreviewDiagnosticsCenter({
        now: () => 100, nowIso: () => '2026-10-15T00:00:00.000Z',
        setTimeout: (handler, ms) => {
            const timer = { handler, ms, active: true };
            timers.push(timer);
            return timer;
        },
        clearTimeout: timer => { timer.active = false; },
        warn: () => {}, copyText: () => {}
    }, log);
    const session = center.register({
        id: 'akari-output-preview-no-media', kind: 'output', editUri: 'file:///p/edit.json',
        overlay: { show: model => shown.push(model), hide: () => {} }
    });
    const listeners = new Set();
    const widget = {
        akariPreviewDiagnostics: session,
        onMessage(listener) {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        }
    };
    const bridge = host.listenForEarlyPreviewDiagnostics(widget);
    for (const stage of ['webview-created', 'model-loaded', 'page-html-set']) {
        session.markStage(stage, 'ok');
    }

    // repro-edit.json と同じく実素材なし、visual レーンには plan 由来の空 group だけ。
    const summary = {
        sources: [],
        tracks: [{ lane: 'visual', items: [
            ['playbook-talking-head', 0, 1200],
            ['playbook-screen', 1200, 600],
            ['playbook-bgm', 1800, 150]
        ].map(([id, at, duration]) => ({
            id, at, duration, source: { kind: 'group', canvas: { origin: 'plan' } }, items: []
        })) }]
    };
    const page = createPreviewPage({
        initial: { frameEngineEnabled: true, videoSources: {}, summary },
        globals: {
            akari: { updateLayerLayout: () => {}, applyCutFramingVisual: () => {},
                frameEngineClock: { totalDuration: 65 } },
            AkariEditKernel: {}, AkariFrameEngine: {}
        }
    });
    page.run(injectedScript('previewDiagnosticsGuardScript'));
    page.diag().attachHost({ postMessage: message => {
        for (const listener of listeners) listener(message);
    } });
    const engineRoot = page.context.document.createElement('div');
    engineRoot.id = 'frame-engine-preview';
    engineRoot.dataset.frameEngineReady = 'true';
    page.context.document.body.append(engineRoot);
    page.probeOnce();

    assert.equal(page.diag().summary().complete, true);
    assert.equal(session.reported, true, 'ページの ready が ingest に届く');
    assert.equal(session.ready, true, 'ready で settle する');
    assert.equal(session.trace.stages.every(stage => stage.status === 'ok'), true);
    assert.equal(page.card(), null);
    assert.equal(shown.length, 0);
    const watchdog = timers.find(timer => timer.ms === host.PREVIEW_DIAGNOSTICS_WATCHDOG_MS);
    assert.ok(watchdog);
    assert.equal(watchdog.active, false, 'ready で初期化監視を解除する');
    bridge.dispose();
    assert.equal(listeners.size, 0);
});
