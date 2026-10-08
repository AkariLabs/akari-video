import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
    WINDOWS_OUTPUT_VOLUME_SCRIPT,
    createSystemOutputVolumeReader,
    parseMacOutputVolume,
    parseWindowsOutputVolume
} from '../src/node/system-output-volume.ts';

const hostSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const adapterSource = readFileSync(new URL('../src/browser/preview-script-host-adapter.ts', import.meta.url), 'utf8');

test('macOS output parser accepts normal and muted settings, rejects unavailable or malformed output', () => {
    assert.deepEqual(parseMacOutputVolume('output volume:50, input volume:75, alert volume:100, output muted:false'),
        { volume: 50, muted: false });
    assert.deepEqual(parseMacOutputVolume('output volume:40, input volume:75, output muted:true'),
        { volume: 40, muted: true });
    assert.equal(parseMacOutputVolume('output volume:missing value, output muted:false'), undefined);
    assert.deepEqual(parseMacOutputVolume('output volume:missing value, output muted:true'),
        { volume: 100, muted: true });
    assert.deepEqual(parseMacOutputVolume('output volume:50, output muted:missing value'),
        { volume: 50, muted: false });
    assert.equal(parseMacOutputVolume('broken'), undefined);
});

test('Windows output parser accepts normal and muted JSON, rejects malformed JSON', () => {
    assert.deepEqual(parseWindowsOutputVolume('{"volume":25.5,"muted":false}\n'), { volume: 25.5, muted: false });
    assert.deepEqual(parseWindowsOutputVolume('{"volume":0,"muted":true}'), { volume: 0, muted: true });
    assert.equal(parseWindowsOutputVolume('{broken'), undefined);
    assert.equal(parseWindowsOutputVolume('{"volume":101,"muted":false}'), undefined);
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /GetMasterVolumeLevelScalar/);
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /GetMute/);
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /Add-Type -Path \$dll/);
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /-OutputAssembly \$tmp/);
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /ReadAllBytes\(\$tmp\)/);
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /Move-Item -LiteralPath \$tmp -Destination \$dll -Force/);
    assert.ok(WINDOWS_OUTPUT_VOLUME_SCRIPT.includes(String.raw`"{\"volume\":"`));
    assert.ok(WINDOWS_OUTPUT_VOLUME_SCRIPT.includes(String.raw`",\"muted\":"`));
    assert.match(WINDOWS_OUTPUT_VOLUME_SCRIPT, /\n\n$/);
    assert.ok([...WINDOWS_OUTPUT_VOLUME_SCRIPT].every(char => char.charCodeAt(0) < 128));
});

test('Windows reader compiles, reuses, and repairs its DLL',
    { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
        const directory = mkdtempSync(join(tmpdir(), 'akari-volume-test-'));
        const cacheDirectory = join(directory, 'akari-video');
        const dependencies = { tmpdir: () => directory };
        const assertVolume = value => {
            assert.notEqual(value, undefined);
            assert.equal(typeof value.volume, 'number');
            assert.ok(value.volume >= 0 && value.volume <= 100);
            assert.equal(typeof value.muted, 'boolean');
        };
        const assertCache = () => {
            const names = readdirSync(cacheDirectory);
            const dlls = names.filter(name => name.endsWith('.dll'));
            assert.equal(dlls.length, 1);
            assert.equal(names.filter(name => name.endsWith('.tmp')).length, 0);
            return join(cacheDirectory, dlls[0]);
        };
        try {
            assertVolume(await createSystemOutputVolumeReader('win32', undefined, undefined, dependencies)());
            const dll = assertCache();

            assertVolume(await createSystemOutputVolumeReader('win32', undefined, undefined, dependencies)());
            assert.equal(assertCache(), dll);

            writeFileSync(dll, 'garbage');
            const repairDependencies = {
                ...dependencies,
                fs: { existsSync: () => false, mkdirSync }
            };
            assertVolume(await createSystemOutputVolumeReader('win32', undefined, undefined, repairDependencies)());
            assert.equal(assertCache(), dll);
            assert.ok(statSync(dll).size > 100);
            assert.notEqual(readFileSync(dll, 'utf8'), 'garbage');
        } finally {
            try { rmSync(directory, { recursive: true, force: true }); } catch { }
        }
    });

test('reader handles process failure, timeout, unsupported OS, shared work and short cache', async () => {
    let calls = 0;
    let command;
    let args;
    let options;
    let stdin;
    let stdinErrorHandler;
    let dllExists = false;
    const fs = {
        mkdirSync: (directory, options) => { assert.equal(directory, join('test-temp', 'akari-video')); assert.equal(options.recursive, true); },
        existsSync: () => dllExists
    };
    const dependencies = { fs, tmpdir: () => 'test-temp', env: { SystemRoot: 'C:\\Windows' } };
    const execute = (file, argv, opts, callback) => {
        calls += 1;
        command = file;
        args = argv;
        options = opts;
        queueMicrotask(() => callback(null, '{"volume":0,"muted":false}', ''));
        return { stdin: {
            on: (event, handler) => { assert.equal(event, 'error'); stdinErrorHandler = handler; },
            end: text => { assert.equal(typeof stdinErrorHandler, 'function'); stdin = text; }
        } };
    };
    let now = 1000;
    const read = createSystemOutputVolumeReader('win32', execute, () => now, dependencies);
    const [a, b] = await Promise.all([read(), read()]);
    assert.deepEqual(a, { volume: 0, muted: false });
    assert.deepEqual(b, a);
    assert.equal(calls, 1);
    assert.equal(command, join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-Command', '-']);
    assert.equal(options.timeout, 10000);
    assert.match(options.env.AKARI_SYSTEM_VOLUME_DLL, /^test-temp[/\\]akari-video[/\\]system-volume-[0-9a-f]{12}\.dll$/);
    assert.equal(stdin.includes(options.env.AKARI_SYSTEM_VOLUME_DLL), false);
    assert.equal(stdin, WINDOWS_OUTPUT_VOLUME_SCRIPT);
    assert.doesNotThrow(() => stdinErrorHandler(new Error('EPIPE')));
    now += 1499;
    await read();
    assert.equal(calls, 1);
    now += 1;
    dllExists = true;
    await read();
    assert.equal(calls, 2);
    assert.equal(options.timeout, 4000);
    const failure = createSystemOutputVolumeReader('darwin', (file, _args, _opts, callback) => {
        assert.equal(file, '/usr/bin/osascript');
        queueMicrotask(() => callback(new Error('failed'), '', ''));
        return {};
    });
    assert.equal(await failure(), undefined);
    const timeout = createSystemOutputVolumeReader('win32', (_file, _args, _opts, callback) => {
        queueMicrotask(() => callback(Object.assign(new Error('timeout'), { killed: true }), '', ''));
        return { stdin: { on: event => { assert.equal(event, 'error'); }, end() {} } };
    }, Date.now, dependencies);
    assert.equal(await timeout(), undefined);
    const unavailableCache = createSystemOutputVolumeReader('win32', () => { throw new Error('called'); },
        Date.now, { fs: { existsSync: () => false, mkdirSync: () => { throw new Error('unwritable'); } },
            tmpdir: () => 'test-temp' });
    assert.equal(await unavailableCache(), undefined);
    assert.equal(await createSystemOutputVolumeReader('linux', () => { throw new Error('called'); })(), undefined);
});

function createHostHarness(volumes) {
    const start = hostSource.indexOf('        let lastAudioMeterFrame: AudioMeterFrame | undefined;');
    const end = hostSource.indexOf('        widget.disposed.connect(', start);
    const meterStart = hostSource.indexOf('            if (isAudioMeterFrame(message)) {', end);
    const meterEnd = hostSource.indexOf("            if (message && message.type === 'akari-preview-audio-priority')", meterStart);
    const tickStart = hostSource.indexOf('            if (isPlaybackTickRequest(message)) {', meterEnd);
    const tickEnd = hostSource.indexOf('            if (isOverlaySelectedRequest(message)) {', tickStart);
    assert.ok(start > 0 && end > start && meterStart > end && meterEnd > meterStart
        && tickStart > meterEnd && tickEnd > tickStart);
    const setup = stripTypeScriptTypes(
        '(function (widget) {\n' + hostSource.slice(start, end)
        + '\nreturn message => {\n' + hostSource.slice(meterStart, meterEnd)
        + hostSource.slice(tickStart, tickEnd) + '\n};\n})',
        { mode: 'strip' }
    );
    const sent = [];
    const notes = [];
    const timers = new Map();
    let nextTimer = 0;
    let calls = 0;
    const widget = {
        isDisposed: false,
        akariPreviewPlaybackPageId: 'page',
        akariPreviewMuted: false,
        akariPreviewAllTracksMutedScopes: [],
        sendMessage: value => sent.push(value)
    };
    const context = {
        isAudioMeterFrame: message => message.type === 'akari-preview-audio-meter',
        isPlaybackTickRequest: message => message.type === 'akari-preview-playback-tick',
        kind: 'output',
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id)
    };
    const setupFn = vm.runInNewContext(setup, context);
    const host = {
        previewService: { readSystemOutputVolume: async () => { calls += 1; return volumes.shift(); } },
        previewDiagnostics: { note: value => notes.push(value) },
        forwardAudioMeterFrame() {},
        forwardPlaybackTick() {}
    };
    const receive = setupFn.call(host, widget);
    const meter = playing => receive({ type: 'akari-preview-audio-meter', playing });
    const playback = (playing, pageId = widget.akariPreviewPlaybackPageId) =>
        receive({ type: 'akari-preview-playback-tick', playing, pageId });
    const tick = async () => {
        const [id, timer] = timers.entries().next().value;
        timers.delete(id);
        assert.equal(timer.delay, 3000);
        timer.callback();
        await flush();
    };
    const dismiss = () => receive({ type: 'akari-preview-system-volume-dismissed' });
    return { sent, notes, timers, widget, host, meter, playback, dismiss, tick, get calls() { return calls; } };
}

async function flush() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

test('host reads at playback start, sends zero and stops repeating after ok', async () => {
    const h = createHostHarness([{ volume: 0, muted: false }, { volume: 0, muted: false }, { volume: 30, muted: false }]);
    h.meter(false);
    h.playback(false);
    h.playback(true);
    await flush();
    assert.equal(h.calls, 1);
    assert.equal(h.sent[0].state, 'zero');
    assert.equal(h.timers.size, 1);
    h.meter(true);
    h.playback(true);
    await flush();
    assert.equal(h.calls, 1);
    await h.tick();
    assert.equal(h.calls, 2);
    assert.equal(h.sent.length, 1);
    assert.equal(h.notes.length, 1);
    assert.equal(h.timers.size, 1);
    await h.tick();
    assert.equal(h.calls, 3);
    assert.equal(h.sent[1].state, 'ok');
    assert.equal(h.timers.size, 0);
    assert.equal(h.notes.length, 2);
});

test('host sends ok for a clear start and does not poll or send for unavailable volume', async () => {
    const clear = createHostHarness([{ volume: 45, muted: false }]);
    clear.playback(true);
    await flush();
    assert.equal(clear.sent[0].state, 'ok');
    assert.equal(clear.timers.size, 0);
    const unavailable = createHostHarness([undefined]);
    unavailable.playback(true);
    await flush();
    assert.equal(unavailable.calls, 1);
    assert.deepEqual(unavailable.sent, []);
    assert.equal(unavailable.timers.size, 0);
});

test('host ignores immediate false meter frames and repeated ticks during playback', async () => {
    const h = createHostHarness([{ volume: 35, muted: false }]);
    h.playback(true);
    await flush();
    for (let i = 0; i < 4; i += 1) {
        h.playback(true);
        h.meter(true);
        h.meter(false);
        h.meter(true);
    }
    await flush();
    assert.equal(h.calls, 1);
    assert.equal(h.sent.length, 1);
    assert.equal(h.timers.size, 0);
});

test('host reads again after a playback tick reports stop then start', async () => {
    const h = createHostHarness([{ volume: 35, muted: false }, { volume: 0, muted: false }]);
    h.playback(true);
    await flush();
    h.playback(false);
    h.playback(true);
    await flush();
    assert.equal(h.calls, 2);
    assert.equal(h.sent.at(-1).state, 'zero');
});

test('dismissal survives page changes and stops polling until an ok playback check', async () => {
    const h = createHostHarness([
        { volume: 0, muted: false }, { volume: 0, muted: false },
        { volume: 0, muted: false }, { volume: 30, muted: false }, { volume: 0, muted: false }
    ]);
    h.playback(true);
    await flush();
    assert.equal(h.sent[0].state, 'zero');
    assert.equal(h.timers.size, 1);
    h.dismiss();
    assert.equal(h.timers.size, 0);
    h.playback(false);
    h.playback(true);
    await flush();
    assert.equal(h.calls, 2);
    assert.equal(h.sent.length, 1);
    assert.equal(h.timers.size, 0);
    h.widget.akariPreviewPlaybackPageId = 'next-page';
    h.playback(true, 'next-page');
    await flush();
    assert.equal(h.calls, 3);
    assert.equal(h.sent.length, 1);
    assert.equal(h.timers.size, 0);
    h.playback(false, 'next-page');
    h.playback(true, 'next-page');
    await flush();
    assert.equal(h.sent.at(-1).state, 'ok');
    assert.equal(h.timers.size, 0);
    h.playback(false, 'next-page');
    h.playback(true, 'next-page');
    await flush();
    assert.equal(h.sent.at(-1).state, 'zero');
    assert.equal(h.timers.size, 1);
});

test('host stops warning checks on pause and never reads while preview is muted', async () => {
    const h = createHostHarness([{ volume: 20, muted: true }]);
    h.widget.akariPreviewMuted = true;
    h.playback(true);
    await flush();
    assert.equal(h.calls, 0);
    h.playback(false);
    h.widget.akariPreviewMuted = false;
    h.widget.akariPreviewSummary = {
        cuts: [{ track: 0, mute: true }],
        audio: { sfx: [], narration: [], speech: [] }
    };
    h.playback(true);
    await flush();
    assert.equal(h.calls, 0);
    h.playback(false);
    h.widget.akariPreviewSummary = undefined;
    h.playback(true);
    await flush();
    assert.equal(h.sent[0].state, 'muted');
    h.playback(false);
    assert.equal(h.timers.size, 0);
});


test('host ignores obsolete pages, disposed widgets and failed RPCs', async () => {
    const h = createHostHarness([{ volume: 0, muted: false }, { volume: 0, muted: false }]);
    h.playback(true);
    await flush();
    assert.equal(h.sent.length, 1);
    h.widget.akariPreviewPlaybackPageId = 'new-page';
    h.playback(true, 'page');
    assert.equal(h.calls, 1);
    h.playback(true);
    await flush();
    assert.equal(h.calls, 2);
    assert.equal(h.sent.length, 2);
    h.widget.isDisposed = true;
    await h.tick();
    assert.equal(h.calls, 2);
    assert.equal(h.sent.length, 2);
    const failed = createHostHarness([]);
    failed.host.previewService.readSystemOutputVolume = async () => { throw new Error('RPC failed'); };
    failed.playback(true);
    await flush();
    assert.deepEqual(failed.sent, []);
});
test('webview warning shows, dismisses until ok, and keeps the full title', () => {
    const start = adapterSource.indexOf("            const systemVolumeNotice = document.getElementById('system-volume-notice');");
    const end = adapterSource.indexOf("            if (initial.kind === 'raw')", start);
    assert.ok(start > 0 && end > start);
    const elements = new Map();
    const posted = [];
    for (const id of ['system-volume-notice', 'system-volume-notice-text', 'system-volume-notice-dismiss']) {
        elements.set(id, { hidden: true, addEventListener(_type, handler) { this.click = handler; } });
    }
    const notice = elements.get('system-volume-notice');
    const text = elements.get('system-volume-notice-text');
    Object.defineProperty(text, 'textContent', {
        get() { return this.value; },
        set(value) { assert.equal(notice.hidden, false); this.value = value; }
    });
    let onMessage;
    vm.runInNewContext(adapterSource.slice(start, end), {
        document: { getElementById: id => elements.get(id) },
        window: { addEventListener: (_type, handler) => { onMessage = handler; } },
        vscode: { postMessage: value => posted.push(value) }
    });
    onMessage({ data: { type: 'akari-preview-system-volume', state: 'zero' } });
    assert.equal(notice.hidden, false);
    assert.equal(text.textContent, 'パソコンの音量が 0 です');
    assert.equal(text.title, text.textContent);
    elements.get('system-volume-notice-dismiss').click();
    assert.equal(notice.hidden, true);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, 'akari-preview-system-volume-dismissed');
    onMessage({ data: { type: 'akari-preview-system-volume', state: 'muted' } });
    assert.equal(notice.hidden, true);
    onMessage({ data: { type: 'akari-preview-system-volume', state: 'ok' } });
    assert.equal(notice.hidden, true);
    onMessage({ data: { type: 'akari-preview-system-volume', state: 'muted' } });
    assert.equal(notice.hidden, false);
    assert.equal(text.textContent, 'パソコンの音がミュートになっています');
});

test('warning text meets contrast ratio in light and dark themes', () => {
    const colors = [...hostSource.matchAll(/(?:body\.vscode-light )?\.system-volume-notice \{[^}]*color: (#[0-9a-f]{6})/g)]
        .map(match => match[1]);
    assert.equal(colors.length, 2);
    const luminance = hex => {
        const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (a, b) => {
        const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (lighter + 0.05) / (darker + 0.05);
    };
    assert.ok(contrast(colors[0], '#121212') >= 4.5);
    assert.ok(contrast(colors[1], '#f2f2f2') >= 4.5);
});
test('warning row stays separate from seek, controls and audio status at narrow widths', async t => {
    let browser;
    try {
        const { launchBrowser } = await import('../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs');
        browser = await launchBrowser();
    } catch (error) {
        if (error?.message !== 'headless Chrome \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093' && error?.code !== 'EPERM') throw error;
        t.skip('headless Chrome unavailable');
        return;
    }
    try {
        const selectors = [
            '.transport', '.transport-seek', '.transport-seek #seek', '.transport-controls',
            '.transport-left, .transport-center, .transport-right', '.transport-left',
            '.transport-center', '.transport-right', '.audio-status', '.audio-status[hidden]',
            '.system-volume-row', '.system-volume-row[hidden]', '.system-volume-notice',
            '.system-volume-notice-text', '.system-volume-notice button'
        ];
        const css = hostSource.split('\n').filter(line =>
            selectors.some(selector => line.startsWith(selector + ' {'))).join('\n');
        assert.match(css, /\.system-volume-row \{ display: flex/u);
        const page = await browser.newPage();
        for (const width of [320, 480, 800]) {
            await page.setViewport({ width, height: 240 });
            await page.setContent('<style>body{margin:0}' + css + '</style>'
                + '<div class="transport"><div class="transport-seek"><input id="seek" type="range"></div>'
                + '<div class="transport-controls"><div class="transport-left"><span id="audio-status" class="audio-status">Some audio could not be played: a very long source name</span></div>'
                + '<div class="transport-center"><button id="play-toggle">Play</button></div>'
                + '<div class="transport-right"><button>Zoom</button></div></div>'
                + '<div id="system-volume-notice" class="system-volume-row"><div class="system-volume-notice">'
                + '<span id="system-volume-notice-text" class="system-volume-notice-text" title="full message">A long system volume warning that may be truncated at narrow widths</span>'
                + '<button id="system-volume-notice-dismiss">x</button></div></div></div>');
            const result = await page.evaluate(() => {
                const box = selector => {
                    const r = document.querySelector(selector).getBoundingClientRect();
                    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                };
                return {
                    notice: box('#system-volume-notice'),
                    seek: box('#seek'), controls: box('.transport-controls'),
                    status: box('#audio-status'), play: box('#play-toggle'),
                    text: box('#system-volume-notice-text'),
                    button: box('#system-volume-notice-dismiss')
                };
            });
            const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            for (const other of [result.seek, result.controls, result.status, result.play]) {
                assert.equal(intersects(result.notice, other), false, 'overlap at width ' + width);
            }
            assert.equal(intersects(result.text, result.button), false, 'text and close button at width ' + width);
            assert.ok(result.notice.right <= width, 'warning exceeds viewport at width ' + width);
        }
    } finally {
        await browser.close();
    }
});
