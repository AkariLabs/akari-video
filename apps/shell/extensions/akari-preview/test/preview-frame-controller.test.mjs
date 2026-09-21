import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { installPreviewFrameCapture } from '../lib/common/preview-frame-controller.js';

function renderer({ clipped = false, broken = false, ready } = {}) {
    const sent = [], raf = [], timers = new Map(), classes = new Set();
    const listeners = {};
    let resumeCalls = 0, freezeCalls = 0;
    const button = { disabled: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
    const box = { x: 20, y: 30, left: 20, top: 30, width: 320, height: 180, right: 340, bottom: 210 };
    const stage = { getBoundingClientRect: () => clipped && !classes.has('akari-gen-capture-fit') ? { ...box, left: -20 } : box };
    const frame = { getBoundingClientRect: () => ({ x: 7, y: 9, width: 644, height: 484 }),
        offsetWidth: 644, offsetHeight: 484, clientLeft: 2, clientTop: 2 };
    const context = vm.createContext({
        document: { documentElement: { classList: { add: (...values) => values.forEach(v => classes.add(v)), remove: (...values) => values.forEach(v => classes.delete(v)) } },
            getElementById: id => id === 'akari-gen-capture-frame' ? button : id === 'preview-stage' ? stage
                : { getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 480 }) } },
        window: { addEventListener: (name, fn) => { listeners[name] = fn; }, innerWidth: 640, innerHeight: 480,
            frameElement: broken ? null : frame, parent: { innerWidth: 660, innerHeight: 500 }, top: {} },
        requestAnimationFrame: fn => raf.push(fn),
        setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
        environment: { pageId: 'page-1', send: m => sent.push(m), freeze: () => {
            freezeCalls++; return { time: 12.345, ready, resume: () => { resumeCalls++; } };
        } }
    });
    vm.runInContext(`(${installPreviewFrameCapture.toString()})(environment)`, context);
    return { sent, raf, classes, button, timers, click: () => listeners.click(),
        message: message => listeners.message({ data: message }),
        command: type => ({ type, requestId: sent[0].requestId, pageId: 'page-1' }),
        counts: () => ({ resumeCalls, freezeCalls }) };
}

test('capture sends ready in the same task as class changes, uses post-fit geometry, and restores by request id', async () => {
    const r = renderer({ clipped: true });
    r.click(); r.click();
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].type, 'akari-preview-capture-frame');
    await r.message({ type: 'akari-preview-capture-prepare', requestId: 'stale', pageId: 'page-1' });
    assert.equal(r.raf.length, 0);
    const prepared = r.message(r.command('akari-preview-capture-prepare'));
    await Promise.resolve();
    assert.equal(r.classes.size, 0);
    assert.equal(r.sent.length, 1);
    assert.equal(r.raf.length, 1);
    r.raf.shift()();
    await Promise.resolve();
    assert.equal(r.classes.size, 0); // Even fit must stay unapplied through the first frame.
    assert.equal(r.sent.length, 1);
    r.raf.shift()();
    await prepared;
    assert(r.classes.has('akari-gen-capture-fit'));
    assert.equal(r.raf.length, 0); // No frame wait after capture CSS is applied.
    assert.equal(r.sent[1].type, 'akari-preview-capture-ready');
    assert.equal(r.sent[1].time, 12.345);
    assert.deepEqual(JSON.parse(JSON.stringify(r.sent[1].rect)), { x: 29, y: 41, width: 320, height: 180 });
    await r.message(r.command('akari-preview-capture-restore'));
    assert.equal(r.sent[2].type, 'akari-preview-capture-restored');
    assert.equal(r.classes.size, 0);
    assert.equal(r.button.disabled, false);
    assert.equal(r.timers.size, 0);
    assert.deepEqual(r.counts(), { resumeCalls: 1, freezeCalls: 1 });
});

test('ready must resolve, then two browser frames pass, before hiding editor UI; failure never captures', async () => {
    let resolve;
    const r = renderer({ ready: new Promise(done => { resolve = done; }) });
    r.click();
    const pending = r.message(r.command('akari-preview-capture-prepare'));
    assert.equal(r.classes.size, 0);
    assert.equal(r.raf.length, 0);
    resolve();
    // The promise crosses the VM realm; allow promise assimilation to drain.
    await new Promise(setImmediate);
    assert.equal(r.classes.size, 0);
    assert.equal(r.raf.length, 1);
    r.raf.shift()();
    await Promise.resolve();
    assert.equal(r.classes.size, 0);
    assert.equal(r.sent.length, 1);
    r.raf.shift()();
    await pending;
    assert(r.classes.has('akari-gen-capturing'));
    assert.equal(r.raf.length, 0);
    await r.message(r.command('akari-preview-capture-restore'));
    const failed = renderer({ ready: Promise.reject(new Error('decode failed')) });
    failed.click();
    await failed.message(failed.command('akari-preview-capture-prepare'));
    assert.match(failed.sent[1].error, /decode failed/);
    assert.equal(failed.raf.length, 0);
    assert.equal(failed.classes.size, 0);
    assert.equal(failed.counts().resumeCalls, 1);
});

test('late GPU failure from an expired request cannot restore a newer capture', async () => {
    let reject;
    const r = renderer({ ready: new Promise((_, fail) => { reject = fail; }) });
    r.click();
    const old = r.message(r.command('akari-preview-capture-prepare'));
    [...r.timers.values()][0]();
    r.click();
    reject(new Error('late decode failure'));
    await old;
    assert.equal(r.button.disabled, true);
    assert.equal(r.sent.filter(m => m.type === 'akari-preview-capture-restored').length, 1);
    [...r.timers.values()][0]();
});

test('missing iframe and host timeout restore UI/playback; no late ready response escapes', async () => {
    const broken = renderer({ broken: true });
    broken.click();
    const preparation = broken.message(broken.command('akari-preview-capture-prepare'));
    await Promise.resolve();
    broken.raf.shift()(); broken.raf.shift()();
    await preparation;
    assert.equal(broken.raf.length, 0);
    assert.match(broken.sent[1].error, /inner preview frame/);
    assert.equal(broken.classes.size, 0);
    assert.equal(broken.button.disabled, false);
    let finishReady;
    const timeout = renderer({ ready: new Promise(done => { finishReady = done; }) });
    timeout.click();
    const pending = timeout.message(timeout.command('akari-preview-capture-prepare'));
    await Promise.resolve();
    [...timeout.timers.values()][0]();
    finishReady();
    await pending;
    assert.equal(timeout.sent.some(m => m.type === 'akari-preview-capture-ready'), false);
    assert.deepEqual(timeout.counts(), { resumeCalls: 1, freezeCalls: 1 });
});

test('timeout during the paint wait cannot apply capture classes or capture a resumed frame', async () => {
    const r = renderer();
    r.click();
    const pending = r.message(r.command('akari-preview-capture-prepare'));
    await Promise.resolve();
    r.raf.shift()();
    [...r.timers.values()][0]();
    r.raf.shift()();
    await pending;
    assert.equal(r.classes.size, 0);
    assert.equal(r.sent.some(m => m.type === 'akari-preview-capture-ready'), false);
    assert.deepEqual(r.counts(), { resumeCalls: 1, freezeCalls: 1 });
});

test('camera freezes playing preview without scheduling a scrub render; DOM tick follows the awaited render', async () => {
    const source = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const capture = source.slice(source.indexOf('(${installPreviewFrameCapture.toString()})'));
    const body = capture.match(/freeze: \(\) => \{([\s\S]*?)\n                \}\n            \}\);/)[1];
    const calls = [];
    let finishRender;
    const ready = new Promise(resolve => { finishRender = resolve; });
    const context = vm.createContext({
        outputTime: 2, isPlaying: true,
        togglePlayback: () => { context.isPlaying = !context.isPlaying; calls.push(context.isPlaying ? 'resume' : 'stop'); },
        tick: () => { calls.push('dom-tick'); },
        window: { akari: { frameEngineClock: {
            pause: time => { calls.push(['pin', time]); },
            seek: () => { throw new Error('capture must not enqueue an independent scrub'); },
            refreshAdjustBypass: () => { calls.push('render'); return ready; }
        } } }
    });
    const frozen = vm.runInContext(`(() => {${body}})()`, context);
    assert.deepEqual(calls, ['stop', ['pin', 2], 'render']);
    assert.equal(frozen.time, 2);
    finishRender(); await frozen.ready;
    assert.equal(calls.at(-1), 'dom-tick');
    frozen.resume();
    assert.equal(calls.at(-1), 'resume');
});

const require = createRequire(import.meta.url);
async function mainCapture({ scale = 1, capturedWidth = 800, capturedHeight = 450, zoom = 1 } = {}) {
    const calls = [], processing = [];
    const image = { getSize: () => ({ width: capturedWidth / scale, height: capturedHeight / scale }),
        toBitmap: () => { processing.push('bitmap'); return Buffer.alloc(capturedWidth * capturedHeight * 4); }, isEmpty: () => false };
    const target = { isDestroyed: () => false, isVisible: () => true, getContentSize: () => [4000, 3000],
        webContents: { getZoomFactor: () => zoom, capturePage: async rect => { calls.push(rect); return image; } } };
    const module = { exports: {} };
    const fakeElectron = { BrowserWindow: { fromWebContents: () => target }, nativeImage: { createFromBitmap: (_pixels, options) => {
        let size = { width: options.width, height: options.height };
        const normalized = { getSize: () => size, toDataURL: () => { processing.push('png'); return 'data:image/png;base64,test'; }, resize: value => {
            calls.push({ resize: value }); size = { width: value.width, height: value.height }; return normalized;
        } }; return normalized;
    } } };
    vm.runInNewContext(await readFile(new URL('../lib/electron-main/preview-frame-capture.js', import.meta.url), 'utf8'), {
        setTimeout, clearTimeout,
        exports: module.exports, require: id => id.includes('electron-shared') ? fakeElectron : require('../lib/common/preview-frame-capture.js')
    });
    return { snapshot: module.exports.capturePreviewFrame, finish: module.exports.finishPreviewFrame, calls, processing,
        capture: async (sender, request) => {
            const { captureId } = await module.exports.capturePreviewFrame(sender, request);
            return module.exports.finishPreviewFrame(sender, captureId);
        } };

}

test('Retina pixel count is preserved below output, larger captures only shrink, window zoom scales CSS rect', async () => {
    const small = await mainCapture({ scale: 2 });
    const request = { rect: { x: 10, y: 20, width: 400, height: 225 }, output: { width: 1920, height: 1080 } };
    const result = await small.capture({}, request);
    assert.equal(result.width, 800);
    assert.equal(result.height, 450);
    assert.equal(result.reduced, true);
    assert.equal(small.calls.length, 1);
    const large = await mainCapture({ capturedWidth: 1600, capturedHeight: 900, zoom: 1.25 });
    const resized = await large.capture({}, { ...request, output: { width: 1280, height: 720 } });
    assert.equal(resized.width, 1280);
    assert.equal(resized.reduced, false);
    assert.deepEqual(JSON.parse(JSON.stringify(large.calls[0])), { x: 13, y: 25, width: 499, height: 281 });
});


test('snapshot returns before bitmap/PNG work; only phase two processes a sender-owned handle once', async () => {
    const main = await mainCapture();
    const sender = {};
    const request = { rect: { x: 10, y: 20, width: 400, height: 225 }, output: { width: 1920, height: 1080 } };
    const snapshot = await main.snapshot(sender, request);
    assert.deepEqual(main.processing, []);
    assert.equal(Object.keys(snapshot).join(), 'captureId');
    assert.throws(() => main.finish({}, snapshot.captureId), /another window/);
    const result = main.finish(sender, snapshot.captureId);
    assert.equal(result.width, 800);
    assert.deepEqual(main.processing, ['bitmap', 'png']);
    assert.throws(() => main.finish(sender, snapshot.captureId), /expired/);
});

test('discarded or superseded snapshots cannot be encoded and do not do expensive pixel work', async () => {
    const main = await mainCapture();
    const sender = {};
    const request = { rect: { x: 10, y: 20, width: 400, height: 225 }, output: { width: 1920, height: 1080 } };
    const first = await main.snapshot(sender, request);
    const second = await main.snapshot(sender, request);
    assert.throws(() => main.finish(sender, first.captureId), /expired/);
    main.finish(sender, first.captureId, true); // Late cleanup cannot delete the newer snapshot.
    main.finish(sender, second.captureId, true);
    assert.throws(() => main.finish(sender, second.captureId), /expired/);
    assert.deepEqual(main.processing, []);
});
