import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const compiledUrl = new URL('../../lib/browser/akari-preview-open-handler.js', import.meta.url);
const compiled = readFileSync(compiledUrl, 'utf8');
const require = createRequire(compiledUrl);

// Execute compiled host methods without Theia's DOM/DI, retaining the real model projections.
function method(name) {
    const start = compiled.search(new RegExp(`^    (?:async )?${name}\\(`, 'mu'));
    assert.ok(start >= 0, name);
    const end = compiled.indexOf('\n    }', start);
    assert.ok(end > start, name);
    return compiled.slice(start, end + '\n    }'.length);
}

export function createPreviewAudioHost(resultFor = () => ({ state: 'queued' }), streamFor, defaultEdit) {
    const body = [
        'loadPreviewModel', 'resolveAudioAssets', 'previewAudioSidecarFields',
        'startPreviewAudioTracking', 'stopPreviewAudioPolling', 'positiveNumber', 'finiteNumber', 'transform'
    ].map(method).join('\n');
    const bindings = {};
    for (const [, name, path] of compiled.matchAll(/^const (\w+) = require\("([^"]+)"\);$/gmu)) {
        if (new RegExp(`\\b${name}\\b`, 'u').test(body)) bindings[name] = require(path);
    }
    const warnings = [];
    const timers = new Map();
    let timerId = 0;
    const Host = vm.runInNewContext(`(class { ${body} })`, {
        ...bindings,
        console: { warn: (...args) => warnings.push(args) },
        // No captions or visual overlays in these fixtures; retain the real image classifier for layers.
        exports: {
            normalizePreviewCaptionClock: captions => captions,
            isImageLayerSrc: vm.runInNewContext([
                compiled.match(/^const IMAGE_LAYER_SRC_PATTERN = .*$/mu)[0],
                compiled.match(/^const isImageLayerSrc = .*$/mu)[0],
                'isImageLayerSrc;'
            ].join('\n'))
        },
        EMPTY_SUMMARY: { output: { width: 1280, height: 720, fps: 30 } },
        LAYER_BLEND_TO_CSS: new Map([['normal', 'normal']]),
        setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
        clearTimeout: id => timers.delete(id)
    });
    const host = new Host();
    const calls = [];
    const requests = [];
    host.workspaceService = { roots: Promise.resolve([]) };
    host.lastRawEditVersionByUri = new Map();
    host.migrationCompactionPrompted = new Set();
    host.loadPreviewCaptions = async () => ({ captions: [] });
    host.readText = async () => '';
    host.normalizeEmphasisWords = () => [];
    host.previewCaptionTimelineSegments = () => [];
    host.resolveEditAssetUri = (path, editUri) => editUri.parent.resolve(path);
    host.createAssetStream = async request => streamFor ? streamFor(request)
        : { id: request.assetUri, url: request.assetUri };
    host.disposeAssetStreams = async () => {};
    host.previewService = {
        requestPreviewAudioSidecar: async request => {
            const name = request.sourceUri.endsWith('camera.mp4')
                ? request.inSec === 0 ? 'speech(0)' : 'speech(10.4)'
                : request.sourceUri.endsWith('sfx.wav') ? 'sfx(5)'
                    : request.sourceUri.endsWith('bgm.m4a') ? 'bgm' : 'narration';
            calls.push(name);
            requests.push(request);
            return resultFor(name, request);
        },
        sweepPreviewAudioSidecars: async () => {}
    };
    const URI = require('@theia/core/lib/common/uri').default;
    const load = async (edit = defaultEdit) => {
        const model = await host.loadPreviewModel(new URI('file:///project/edit.json'), JSON.stringify(edit), { frameEngineEnabled: true });
        assert.equal(model.compositeError, undefined, JSON.stringify(warnings));
        return model;
    };
    const poll = async () => {
        const [id, timer] = [...timers].find(([, value]) => value.delay === 1000) ?? [];
        assert.ok(timer, 'poll timer exists');
        timers.delete(id);
        timer.fn();
        await new Promise(resolve => setImmediate(resolve));
    };
    return { host, calls, requests, warnings, load, timers, poll };
}
