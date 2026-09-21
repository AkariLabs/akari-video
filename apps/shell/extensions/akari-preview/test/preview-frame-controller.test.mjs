import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { installPreviewFrameCapture } from '../lib/common/preview-frame-controller.js';

function renderer({ clipped = false, broken = false, ready, moving = 0, nodes = [], plate = null, play = null } = {}) {
    const sent = [], raf = [], timers = new Map(), classes = new Set();
    const listeners = {};
    let resumeCalls = 0, freezeCalls = 0;
    const buttonClasses = new Set();
    const button = { classList: { add: v => buttonClasses.add(v), remove: v => buttonClasses.delete(v) }, disabled: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
    const box = { x: 20, y: 30, left: 20, top: 30, width: 320, height: 180, right: 340, bottom: 210 };
    let measures = 0;
    const stage = { getBoundingClientRect: () => {
        if (clipped && !classes.has('akari-gen-capture-fit')) return { ...box, left: -20 };
        const shift = classes.has('akari-gen-capture-fit') ? Math.min(measures++, moving) : 0;
        return { ...box, x: box.x + shift, left: box.left + shift, right: box.right + shift };
    } };
    const frame = { getBoundingClientRect: () => ({ x: 7, y: 9, width: 644, height: 484 }),
        offsetWidth: 644, offsetHeight: 484, clientLeft: 2, clientTop: 2 };
    const context = vm.createContext({
        getComputedStyle: node => node.style,
        document: { querySelectorAll: () => nodes, documentElement: { classList: { add: (...values) => values.forEach(v => classes.add(v)), remove: (...values) => values.forEach(v => classes.delete(v)) } },
            getElementById: id => id === 'play-toggle' ? play : id === 'caption-plate' ? plate : id === 'akari-gen-capture-frame' ? button : id === 'preview-stage' ? stage
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
    return { sent, raf, classes, button, buttonClasses, timers, click: () => listeners.click(),
        message: message => listeners.message({ data: message }),
        command: type => ({ type, requestId: sent[0].requestId, pageId: 'page-1' }),
        counts: () => ({ resumeCalls, freezeCalls }) };
}

test('capture waits two frames after class changes, uses post-fit geometry, and restores by request id', async () => {
    const r = renderer({ clipped: true });
    r.click(); r.click();
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].type, 'akari-preview-capture-frame');
    await r.message({ type: 'akari-preview-capture-prepare', requestId: 'stale', pageId: 'page-1' });
    assert.equal(r.raf.length, 0);
    const prepared = r.message(r.command('akari-preview-capture-prepare'));
    await Promise.resolve();
    assert(r.classes.has('akari-gen-capturing'));
    assert.equal(r.sent.length, 1);
    assert.equal(r.raf.length, 1);
    r.raf.shift()();
    await Promise.resolve();
    assert(r.classes.has('akari-gen-capture-fit')); // Fit and capture styles are already applied.
    assert.equal(r.sent.length, 1);
    r.raf.shift()();
    await prepared;
    assert(r.classes.has('akari-gen-capture-fit'));
    assert.equal(r.raf.length, 0); // Both post-style frames have passed.
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

test('ready resolves before capture CSS, then two browser frames pass before capture; failure never captures', async () => {
    let resolve;
    const r = renderer({ ready: new Promise(done => { resolve = done; }) });
    r.click();
    const pending = r.message(r.command('akari-preview-capture-prepare'));
    assert.equal(r.classes.size, 0);
    assert.equal(r.raf.length, 0);
    resolve();
    // The promise crosses the VM realm; allow promise assimilation to drain.
    await new Promise(setImmediate);
    assert(r.classes.has('akari-gen-capturing'));
    assert.equal(r.raf.length, 1);
    r.raf.shift()();
    await Promise.resolve();
    assert(r.classes.has('akari-gen-capturing'));
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
    await Promise.resolve();
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
async function mainCapture({ scale = 1, capturedWidth = 800, capturedHeight = 450, zoom = 1, paint } = {}) {
    const calls = [], processing = [], warnings = [];
    const image = { getSize: () => ({ width: capturedWidth / scale, height: capturedHeight / scale }),
        toBitmap: () => { processing.push('bitmap'); const pixels = Buffer.alloc(capturedWidth * capturedHeight * 4);
            if (paint) for (let y = 0; y < capturedHeight; y++) for (let x = 0; x < capturedWidth; x++) pixels.set(paint(x, y), (y * capturedWidth + x) * 4);
            return pixels; }, isEmpty: () => false };
    const target = { isDestroyed: () => false, isVisible: () => true, getContentSize: () => [4000, 3000],
        webContents: { getZoomFactor: () => zoom, capturePage: async rect => { calls.push(rect); return image; } } };
    const module = { exports: {} };
    const normalizedImage = (pixels, width, height) => ({
        getSize: () => ({ width, height }),
        toBitmap: () => { processing.push('inspect-bitmap'); return pixels; },
        toDataURL: () => { processing.push('png'); return 'data:image/png;base64,test'; },
        crop: rect => {
            calls.push({ crop: rect });
            const cropped = Buffer.alloc(rect.width * rect.height * 4);
            for (let y = 0; y < rect.height; y++) pixels.copy(cropped, y * rect.width * 4,
                ((rect.y + y) * width + rect.x) * 4, ((rect.y + y) * width + rect.x + rect.width) * 4);
            return normalizedImage(cropped, rect.width, rect.height);
        },
        resize: value => {
            calls.push({ resize: value });
            return normalizedImage(Buffer.alloc(value.width * value.height * 4), value.width, value.height);
        }
    });
    const fakeElectron = { BrowserWindow: { fromWebContents: () => target }, nativeImage: {
        createFromBitmap: (pixels, options) => normalizedImage(pixels, options.width, options.height)
    } };
    vm.runInNewContext(await readFile(new URL('../lib/electron-main/preview-frame-capture.js', import.meta.url), 'utf8'), {
        setTimeout, clearTimeout, console: { warn: message => warnings.push(message) },
        exports: module.exports, require: id => id.includes('electron-shared') ? fakeElectron : id === 'os' ? require('os') : require(id.replace('../common/', '../lib/common/') + '.js')
    });
    return { snapshot: module.exports.capturePreviewFrame, finish: module.exports.finishPreviewFrame, calls, processing, warnings,
        capture: async (sender, request) => {
            const { captureId } = await module.exports.capturePreviewFrame(sender, request);
            return module.exports.finishPreviewFrame(sender, captureId);
        } };

}

test('Retina pixel count is preserved below output, larger captures only shrink, window zoom scales CSS rect', async () => {
    const small = await mainCapture({ scale: 2 });
    const request = { rect: { x: 10, y: 20, width: 400, height: 225 }, output: { width: 1920, height: 1080 }, expectations: { captions: [], chrome: [] } };
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
    const request = { rect: { x: 10, y: 20, width: 400, height: 225 }, output: { width: 1920, height: 1080 }, expectations: { captions: [], chrome: [] } };
    const snapshot = await main.snapshot(sender, request);
    assert.deepEqual(main.processing, []);
    assert.equal(Object.keys(snapshot).join(), 'captureId');
    assert.throws(() => main.finish({}, snapshot.captureId), /another window/);
    const result = main.finish(sender, snapshot.captureId);
    assert.equal(result.width, 800);
    assert.deepEqual(main.processing, ['bitmap', 'inspect-bitmap', 'png']);
    assert.throws(() => main.finish(sender, snapshot.captureId), /expired/);
});

test('discarded or superseded snapshots cannot be encoded and do not do expensive pixel work', async () => {
    const main = await mainCapture();
    const sender = {};
    const request = { rect: { x: 10, y: 20, width: 400, height: 225 }, output: { width: 1920, height: 1080 }, expectations: { captions: [], chrome: [] } };
    const first = await main.snapshot(sender, request);
    const second = await main.snapshot(sender, request);
    assert.throws(() => main.finish(sender, first.captureId), /expired/);
    main.finish(sender, first.captureId, true); // Late cleanup cannot delete the newer snapshot.
    main.finish(sender, second.captureId, true);
    assert.throws(() => main.finish(sender, second.captureId), /expired/);
    assert.deepEqual(main.processing, []);
});

async function frame(r) {
    assert(r.raf.length > 0, 'a browser frame must be pending');
    r.raf.shift()();
    await new Promise(setImmediate);
}

test('fit waits for two stable frame rectangles, but never more than 15 frames', async () => {
    for (const [moving, expectedFrames] of [[4, 6], [1000, 15]]) {
        const r = renderer({ clipped: true, moving });
        r.click();
        const pending = r.message(r.command('akari-preview-capture-prepare'));
        await new Promise(setImmediate);
        for (let index = 0; index < expectedFrames; index++) {
            assert.equal(r.sent.length, 1);
            assert(r.classes.has('akari-gen-capture-fit'));
            await frame(r);
        }
        await pending;
        assert.equal(r.sent[1].type, 'akari-preview-capture-ready');
        assert.equal(r.raf.length, 0);
        await r.message(r.command('akari-preview-capture-restore'));
    }
});

test('retry restores chrome, waits another frame, and keeps the first freeze time; flash only on final success', async () => {
    const r = renderer();
    r.click();
    for (let attempt = 0; attempt < 3; attempt++) {
        const pending = r.message(r.command('akari-preview-capture-prepare'));
        await new Promise(setImmediate);
        if (attempt > 0) {
            assert.equal(r.classes.size, 0);
            await frame(r);
        }
        assert(r.classes.has('akari-gen-capturing'));
        await frame(r); await frame(r); await pending;
        assert.equal(r.sent.at(-1).time, 12.345);
        await r.message({ ...r.command('akari-preview-capture-restore'), keepFrozen: true });
        assert.equal(r.classes.size, 0);
        assert.equal(r.button.disabled, true);
        assert.equal(r.buttonClasses.size, 0);
        assert.deepEqual(r.counts(), { resumeCalls: 0, freezeCalls: 1 });
    }
    await r.message({ ...r.command('akari-preview-capture-restore'), success: true });
    assert.deepEqual(r.counts(), { resumeCalls: 1, freezeCalls: 1 });
    assert.equal(r.button.disabled, false);
    assert.equal(r.classes.size, 0);
    assert(r.buttonClasses.has('akari-gen-capture-flash'));
    [...r.timers.values()][0]();
    assert.equal(r.buttonClasses.size, 0);
});

test('DOM expectations use post-fit rectangles, pre-hide chrome colors, and only visible caption lines', async () => {
    const style = { display: 'block', visibility: 'visible', opacity: '1', backgroundColor: 'rgba(0, 0, 0, 0)',
        borderTopWidth: '0px', borderTopStyle: 'none', borderTopColor: 'rgb(0, 0, 0)',
        outlineWidth: '0px', outlineStyle: 'none', outlineColor: 'rgb(0, 0, 0)', color: 'rgb(230, 150, 60)' };
    const rect = { x: 52, left: 52, y: 66, top: 66, right: 116, bottom: 102, width: 64, height: 36 };
    let r;
    const node = (values = {}) => ({ parentElement: null, offsetWidth: 64, offsetHeight: 36,
        textContent: 'caption', getBoundingClientRect: () => rect, matches: () => true, style, ...values });
    const line = node();
    const invisible = node({ style: { ...style, opacity: '0' } });
    const inheritedHidden = node({ parentElement: node({ style: { ...style, display: 'none' } }) });
    const outside = node({ getBoundingClientRect: () => ({ ...rect, left: 700, right: 764 }) });
    const badge = node({ get style() { return style; } });
    Object.defineProperty(badge, 'style', { get: () => ({ ...style, backgroundColor: 'rgb(90, 60, 120)',
        visibility: r?.classes.has('akari-gen-capturing') ? 'hidden' : 'visible' }) });
    const selected = node({ matches: () => false, style: { ...style, outlineColor: 'rgb(245, 196, 81)',
        outlineWidth: '2px', outlineOffset: '4px', outlineStyle: 'solid' } });
    r = renderer({ clipped: true, nodes: [badge, selected, invisible], plate: { querySelectorAll: () => [line, invisible, inheritedHidden, outside] } });
    r.click();
    const pending = r.message(r.command('akari-preview-capture-prepare'));
    await new Promise(setImmediate);
    await frame(r); await frame(r); await pending;
    const expectations = JSON.parse(JSON.stringify(r.sent[1].expectations));
    assert.equal(expectations.captions.length, 1);
    assert.deepEqual(expectations.captions[0].color, [230, 150, 60]);
    assert.equal(expectations.captions[0].rect.x, 0.1);
    assert.equal(expectations.captions[0].rect.y, 0.2);
    assert.equal(expectations.chrome.length, 2);
    assert.deepEqual(expectations.chrome[0].colors, [[90, 60, 120]]);
    assert.equal(expectations.chrome[0].kind, 'fill');
    assert.equal(expectations.chrome[1].kind, 'edge');
    assert.equal(expectations.chrome[1].rect.x, (52 - 6 - 20) / 320);
    assert.equal(expectations.chrome[1].band.x, 2 / 320);
    await r.message(r.command('akari-preview-capture-restore'));
});

test('failed main-process inspection returns no PNG and cannot encode a rejected frame', async () => {
    const main = await mainCapture();
    const result = await main.capture({}, { rect: { x: 10, y: 20, width: 400, height: 225 },
        output: { width: 1920, height: 1080 }, expectations: { captions: [{ rect: { x: 0, y: 0, width: 1, height: 1 }, color: [255, 255, 255] }], chrome: [] } });
    assert.equal(result.inspection.ok, false);
    assert.equal(result.image, '');
    assert.equal(main.processing.includes('png'), false);
});

test('ready includes the play sentinel in the same iframe coordinates after capture styles', async () => {
    let r;
    const play = { getBoundingClientRect: () => {
        assert(r.classes.has('akari-gen-capturing'));
        return { x: 24, y: 240, width: 28, height: 28, right: 52, bottom: 268 };
    } };
    r = renderer({ play });
    r.click();
    const pending = r.message(r.command('akari-preview-capture-prepare'));
    await new Promise(setImmediate);
    await frame(r); await frame(r); await pending;
    assert.deepEqual(JSON.parse(JSON.stringify(r.sent[1].sentinel)), { x: 33, y: 251, width: 28, height: 28 });
    await r.message(r.command('akari-preview-capture-restore'));
});

test('semi-transparent fills retain blue detection but omit color matching below alpha 0.95', async () => {
    const style = { display: 'block', visibility: 'visible', opacity: '1', borderTopWidth: '0px', borderTopStyle: 'none',
        borderTopColor: 'rgb(0, 0, 0)', outlineWidth: '0px', outlineStyle: 'none', outlineColor: 'rgb(0, 0, 0)' };
    const nodes = [0.5, 0.8, 0.94, 0.95, 1].map(alpha => ({ style: { ...style, backgroundColor: `rgba(0,0,0,${alpha})` },
        parentElement: null, offsetWidth: 40, offsetHeight: 20, matches: () => true,
        getBoundingClientRect: () => ({ left: 40, top: 50, right: 80, bottom: 70, width: 40, height: 20 }) }));
    const r = renderer({ nodes });
    r.click();
    const pending = r.message(r.command('akari-preview-capture-prepare'));
    await new Promise(setImmediate);
    await frame(r); await frame(r); await pending;
    assert.deepEqual(JSON.parse(JSON.stringify(r.sent[1].expectations.chrome.map(entry => entry.colors))), [[], [], [], [[0, 0, 0]], [[0, 0, 0]]]);
    await r.message(r.command('akari-preview-capture-restore'));
});

const sentinelRequest = { rect: { x: 100, y: 40, width: 400, height: 200 }, sentinel: { x: 120, y: 260, width: 28, height: 28 },
    output: { width: 800, height: 400 }, expectations: { captions: [], chrome: [] } };

test('one union capture at DPR 2 and zoom 1.25 crops the lower sentinel separately, then resizes only the stage', async () => {
    const main = await mainCapture({ scale: 2, zoom: 1.25, capturedWidth: 1000, capturedHeight: 620 });
    const result = await main.capture({}, sentinelRequest);
    assert.deepEqual(JSON.parse(JSON.stringify(main.calls)), [
        { x: 125, y: 50, width: 500, height: 310 },
        { crop: { x: 50, y: 550, width: 70, height: 70 } },
        { crop: { x: 0, y: 0, width: 1000, height: 500 } },
        { resize: { width: 800, height: 400, quality: 'best' } }
    ]);
    assert.deepEqual([result.width, result.height, result.capturedWidth, result.capturedHeight], [800, 400, 1000, 500]);
    assert.equal(result.inspection.ok, true);
    assert.equal(main.warnings.length, 0);
});

test('visible icon in the same captured union produces stale-frame and no encoded PNG', async () => {
    const main = await mainCapture({ scale: 2, zoom: 1.25, capturedWidth: 1000, capturedHeight: 620,
        paint: (x, y) => x >= 80 && x < 88 && y >= 570 && y < 600 ? [180, 180, 180, 255] : [30, 30, 30, 255] });
    const result = await main.capture({}, sentinelRequest);
    assert.deepEqual(Array.from(result.inspection.reasons), ['stale-frame']);
    assert.equal(result.inspection.ok, false);
    assert.equal(result.image, '');
    assert.equal(main.processing.includes('png'), false);
});

test('unavailable or out-of-window sentinel warns and falls back to stage-only capture', async () => {
    for (const sentinel of [undefined, { x: 3990, y: 2900, width: 28, height: 28 }]) {
        const main = await mainCapture();
        const result = await main.capture({}, { ...sentinelRequest, sentinel });
        assert.equal(result.inspection.ok, true);
        assert.equal(main.warnings.length, 1);
        assert.match(main.warnings[0], /sentinel unavailable/);
        assert.equal(main.calls.some(call => call.crop), false);
        assert.deepEqual(JSON.parse(JSON.stringify(main.calls[0])), sentinelRequest.rect);
    }
});
