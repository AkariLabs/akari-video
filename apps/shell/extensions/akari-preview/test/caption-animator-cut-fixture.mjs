import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readPreviewInternalEdit } from '../lib/common/preview-items.js';
import { buildCaptionAnimatorSummaryFields } from '../lib/common/edit-summary-fields.js';

const compiledUrl = new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url);
const compiled = readFileSync(compiledUrl, 'utf8');
const require = createRequire(compiledUrl);
const examples = new URL('../../../../../packages/schemas/examples/edit-v2-caption-animator-valid/', import.meta.url);
const start = compiled.indexOf('const normalizePreviewCaptionClock =');
const end = compiled.indexOf('exports.normalizePreviewCaptionClock =', start);
assert.ok(start >= 0 && end > start);
export const normalizeClock = vm.runInNewContext(compiled.slice(start, end) + '\nnormalizePreviewCaptionClock;');

export function cutFixture({ fps = 30, at = 0, sourceDomain = false } = {}) {
    const edit = JSON.parse(readFileSync(new URL('edit.json', examples), 'utf8'));
    edit.output = { width: 640, height: 360, fps };
    const bag = edit.tracks[0].items[0];
    bag.at = at;
    edit.sources = [{ id: 'main', path: 'assets/main.mp4' }];
    edit.tracks.unshift({ id: 'video', lane: 'visual', items: [
        { id: 'cut-1', at, duration: 30, source: { kind: 'media', src: 'main', in: 10, out: 10 + 30 / fps } },
        { id: 'cut-2', at: at + 30, duration: 30, source: { kind: 'media', src: 'main', in: 20, out: 20 + 30 / fps } }
    ] });
    const raw = JSON.parse(readFileSync(new URL('captions.json', examples), 'utf8'));
    const captions = raw.map(cue => ({ ...cue,
        start: sourceDomain ? 10 : at / fps, end: sourceDomain ? 20 + 30 / fps : (at + 60) / fps,
        clockDomain: sourceDomain ? 'source' : 'output', ...(sourceDomain ? { clockSourceId: 'main' } : {})
    }));
    const internal = readPreviewInternalEdit(JSON.stringify(edit), true);
    const cuts = internal.tracks[0].items.map(item => item.declaration);
    const { buildTimelineMap } = require('@akari-video/edit-store');
    const segments = buildTimelineMap(cuts, { fps }).segments;
    return { edit, bag, captions, internal, cuts, segments,
        projected: buildCaptionAnimatorSummaryFields(normalizeClock(captions, segments), internal) };
}

function method(name) {
    const start = compiled.search(new RegExp(`^    (?:async )?${name}\\(`, 'mu'));
    const end = compiled.indexOf('\n    }', start);
    assert.ok(start >= 0 && end > start, name);
    return compiled.slice(start, end + '\n    }'.length);
}

// Same compiled-method/real-import approach as preview-audio-request-order.test.mjs.
export function captionHost(fixture) {
    const body = ['loadPreviewModel', 'queueCaptionsUpdate', 'previewCaptionTimelineSegments',
        'previewAudioSidecarFields', 'positiveNumber', 'finiteNumber', 'transform'].map(method).join('\n');
    const bindings = {};
    for (const [, name, path] of compiled.matchAll(/^const (\w+) = require\("([^"]+)"\);$/gmu)) {
        if (new RegExp(`\\b${name}\\b`, 'u').test(body)) bindings[name] = require(path);
    }
    const warnings = [];
    const Host = vm.runInNewContext(`(class { ${body} })`, {
        ...bindings, console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
        exports: { normalizePreviewCaptionClock: normalizeClock },
        EMPTY_SUMMARY: { output: fixture.edit.output }, LAYER_BLEND_TO_CSS: new Map([['normal', 'normal']])
    });
    const host = new Host();
    Object.assign(host, {
        workspaceService: { roots: Promise.resolve([]) }, lastRawEditVersionByUri: new Map(),
        migrationCompactionPrompted: new Set(),
        loadPreviewCaptions: async () => ({ captions: fixture.captions }),
        readText: async () => '', normalizeEmphasisWords: () => [],
        resolveEditAssetUri: (path, editUri) => editUri.parent.resolve(path),
        resolveStreamVideoUri: async uri => uri,
        createAssetStream: async ({ assetUri }) => ({ id: assetUri, url: assetUri }),
        disposeAssetStreams: async () => {}, resolveAudioAssets: async () => ({}),
        previewService: { sweepPreviewAudioSidecars: async () => {},
            requestPreviewAudioSidecar: async () => ({ state: 'not-needed' }) }
    });
    const URI = require('@theia/core/lib/common/uri').default;
    return { host, warnings, load: async () => {
        const model = await host.loadPreviewModel(new URI('file:///project/edit.json'),
            JSON.stringify(fixture.edit), { frameEngineEnabled: true });
        assert.equal(model.compositeError, undefined, JSON.stringify(warnings));
        return model;
    } };
}
