import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { selectPreviewAudioItemsAt } from '../lib/common/preview-audio-priority.js';
import { selectPreviewAudioItemsAt as selectServer } from '../../../../../packages/preview-server/src/preview-audio-summary.mjs';

const compiledUrl = new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url);
const compiled = readFileSync(compiledUrl, 'utf8');
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const require = createRequire(compiledUrl);

test('priority selector mirrors server for boundaries, unknown duration, state, stable ties and missing at', () => {
    const items = Object.freeze([
        { id: 'speech', kind: 'speech', state: 'queued', at: 5, durationSec: 5 },
        { id: 'unknown', kind: 'narration', state: 'generating', at: 2 },
        { id: 'tie', kind: 'sfx', state: 'queued', at: 5, durationSec: 5 },
        { id: 'bed', kind: 'bgm', state: 'queued', at: 0, durationSec: 1 },
        { id: 'no-at', kind: 'sfx', state: 'queued' },
        ...['ready', 'no-audio', 'unavailable', 'failed'].map(state => ({ id: state, kind: 'bgm', state })),
        ...[0, -1, Infinity, NaN].map(durationSec => ({ id: String(durationSec), kind: 'sfx', state: 'queued', at: 20, durationSec })),
    ].map(Object.freeze));
    for (const time of [-1, 0, 2, 4.999, 5, 9.999, 10, 20, 3000, NaN, Infinity]) {
        assert.deepEqual(selectPreviewAudioItemsAt(items, time), selectServer(items, time));
    }
    assert.deepEqual(selectPreviewAudioItemsAt(items, 5).map(item => item.id), ['bed', 'no-at', 'unknown', 'tie', 'speech']);
    assert.deepEqual(selectPreviewAudioItemsAt(items, -1).map(item => item.id), ['bed', 'no-at']);
});

function hostHarness() {
    const start = compiled.indexOf('    async handlePreviewAudioPriority(');
    const end = compiled.indexOf('\n    }', start) + '\n    }'.length;
    assert.ok(start >= 0 && end > start);
    const body = compiled.slice(start, end);
    const bindings = {};
    for (const [, name, path] of compiled.matchAll(/^const (\w+) = require\("([^"]+)"\);$/gmu)) {
        if (new RegExp(`\\b${name}\\b`, 'u').test(body)) bindings[name] = require(path);
    }
    const warnings = [];
    const Host = vm.runInNewContext(`(class { ${body} })`, { ...bindings, console: { warn: (...args) => warnings.push(args) } });
    const host = new Host();
    const calls = [];
    const queue = [];
    host.previewService = { async promotePreviewAudioSidecars(request) {
        calls.push(request);
        for (const value of [...request.keys, ...request.sourcePaths]) queue.unshift(value);
        return { promoted: [...request.keys, ...request.sourcePaths] };
    } };
    // Execute the actual onMessage branch as well as the compiled host method.
    const branchStart = compiled.indexOf("            if (message && message.type === 'akari-preview-audio-priority')");
    const branchEnd = compiled.indexOf('\n            }', branchStart) + '\n            }'.length;
    assert.ok(branchStart >= 0);
    const onMessage = vm.runInNewContext(`(function(widget, message) {${compiled.slice(branchStart, branchEnd)}})`);
    return { host, calls, queue, warnings, async send(widget, message) {
        let pending;
        onMessage.call({ handlePreviewAudioPriority: (...args) => (pending = host.handlePreviewAudioPriority(...args)) }, widget, message);
        await pending;
    } };
}

test('priority message selects pending jobs and preserves mixed key/probe first-use order through RPC', async () => {
    const f = hostHarness();
    const projectRootUri = pathToFileURL(join(tmpdir(), 'priority-project')).toString();
    const sourcePath = join(tmpdir(), 'priority-source.wav');
    const item = (id, kind, at, key, durationSec) => ({ id, kind, at, key, durationSec,
        request: { sourceUri: pathToFileURL(sourcePath).toString() } });
    const widget = { akariPreviewAudioProjectRootUri: projectRootUri, akariPreviewAudioPendingRequests: [
        item('late', 'speech', 5, 'late-key', 10),
        item('bed', 'bgm', 0, 'bed-key', 1),
        item('probe', 'narration', 2),
        item('ended', 'speech', 0, 'ended-key', 5),
        item('future', 'sfx', 6, 'future-key'),
        { ...item('ready', 'bgm', 0, 'ready-key'), state: 'ready' },
    ] };
    await f.send(widget, { type: 'akari-preview-audio-priority', time: 5 });
    assert.deepEqual(f.queue.map(value => process.platform === 'win32' ? value.toLowerCase() : value),
        ['bed-key', sourcePath, 'late-key'].map(value => process.platform === 'win32' ? value.toLowerCase() : value));
    assert.ok(f.calls.every(request => request.projectRootUri === projectRootUri));
    assert.deepEqual(f.warnings, []);
    const count = f.calls.length;
    for (const time of [NaN, Infinity, '5', undefined]) await f.send(widget, { type: 'akari-preview-audio-priority', time });
    await f.send({}, { type: 'akari-preview-audio-priority', time: 5 });
    await f.send(widget, { type: 'unrelated', time: 5 });
    assert.equal(f.calls.length, count);
});

test('priority RPC failures warn without breaking the preview', async () => {
    const f = hostHarness();
    f.host.previewService.promotePreviewAudioSidecars = async () => { throw new Error('offline'); };
    await f.send({ akariPreviewAudioProjectRootUri: 'file:///project',
        akariPreviewAudioPendingRequests: [{ kind: 'bgm', key: 'bed' }] }, { type: 'akari-preview-audio-priority', time: 0 });
    assert.equal(f.warnings.length, 1);
});

test('webview priority is runtime-local, preparing-only, debounced 300 ms, every 10 seconds while playing', () => {
    assert.match(source, /vscode.postMessage\(\{ type: 'akari-preview-audio-priority', time \}\)/u);
    const begin = source.indexOf('                const AUDIO_PRIORITY_DEBOUNCE_MS');
    const end = source.indexOf('\n                updateAudioStatus();', begin);
    const block = source.slice(begin, end);
    assert.match(block, /AUDIO_PRIORITY_DEBOUNCE_MS = 300/u);
    assert.match(block, /AUDIO_PRIORITY_INTERVAL_MS = 10_000/u);
    assert.equal([...block.matchAll(/audioSupply.debug\(\).supply\?\.phase !== 'preparing'/gu)].length, 2);
    assert.match(block, /if \(playing\) requestAudioPriority\(position\)/u);
    assert.doesNotMatch(block, /selectPreviewAudioItemsAt|toString/u);
    assert.match(source, /audioSupply.seek\(position, continuePlaying\);\s*updateAudioStatus\(\);\s*requestAudioPriority\(position\)/u);
    assert.match(source, /clearInterval\(audioPriorityInterval\)/u);
    assert.match(source, /clearTimeout\(audioPriorityTimer\)/u);

    // Execute only the emitted runtime block with fake timers: scrubbing collapses to the last seek,
    // state is checked again on flush, and no CommonJS/module binding is available.
    const timers = new Map();
    const intervals = new Map();
    const sent = [];
    let phase = 'preparing';
    let id = 0;
    const context = {
        disposed: false, playing: false, position: 40,
        audioSupply: { debug: () => ({ supply: { phase } }) },
        window: { akari: { requestAudioPriority: time => sent.push(time) } },
        setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimeout: token => timers.delete(token),
        setInterval: (fn, delay) => { intervals.set(++id, { fn, delay }); return id; },
    };
    vm.createContext(context);
    vm.runInContext(`${block}\nglobalThis.request = requestAudioPriority;`, context);
    context.request(5);
    context.request(3000);
    assert.equal(timers.size, 1);
    const flush = () => { for (const [token, timer] of timers) { timers.delete(token); assert.equal(timer.delay, 300); timer.fn(); } };
    flush();
    assert.deepEqual(sent, [3000]);
    context.request(6);
    phase = 'ready';
    flush();
    context.request(7);
    assert.equal(timers.size, 0);
    phase = 'preparing';
    const interval = [...intervals.values()][0];
    assert.equal(interval.delay, 10000);
    interval.fn();
    assert.equal(timers.size, 0);
    context.playing = true;
    interval.fn();
    flush();
    assert.deepEqual(sent, [3000, 40]);
});
