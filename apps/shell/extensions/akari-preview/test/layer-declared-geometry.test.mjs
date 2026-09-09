import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveLayerDeclaredSize, layerDeclaredGeometryHitAt } from '../lib/common/layer-declared-geometry.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const injected = { resolveLayerDeclaredSize, layerDeclaredGeometryHitAt };
const bootstrapStart = source.indexOf('    protected previewBootstrapScript(): string {');
assert.notEqual(bootstrapStart, -1);
const bootstrapEnd = source.indexOf('\n    }', bootstrapStart);
assert.ok(bootstrapEnd > bootstrapStart);
const bootstrapSource = source.slice(bootstrapStart, bootstrapEnd);
function expandInjectedFunctions(text) {
    return text.replace(/\$\{(resolveLayerDeclaredSize|layerDeclaredGeometryHitAt)\.toString\(\)\}/g,
        (_, name) => injected[name].toString());
}
function expression(name) {
    const match = bootstrapSource.match(new RegExp(`            const ${name} = ([\\s\\S]*?)\\n            };`));
    assert.ok(match, name);
    return expandInjectedFunctions(`${match[1]}\n            }`);
}
function extract(name, context) {
    return new Function(...Object.keys(context), `return (${expression(name)});`)(...Object.values(context));
}
const output = { width: 1000, height: 500 };
const transform = { x: 100, y: -25, scale: 0.5, rotate: 0 };
const crop = { x: 0.2, y: 0.1, w: 0.4, h: 0.6 };
const spec = (id, z = 1) => ({
    spec: { id },
    video: { videoWidth: 0, videoHeight: 0, readyState: 0,
        dataset: { akariLayerId: id }, style: { display: '', zIndex: String(z) } }
});

test('geometry helpers are injected inside previewBootstrapScript and inside their consuming functions', () => {
    const expandedBootstrap = expandInjectedFunctions(bootstrapSource);
    for (const name of ['layerGeometryHitAt', 'updateLayerSelectBox']) {
        assert.ok(bootstrapSource.includes('const ' + name + ' ='), name);
        const body = expression(name);
        assert.ok(body.includes(resolveLayerDeclaredSize.toString()), `${name} owns its size resolver`);
        assert.ok(expandedBootstrap.includes(body), `${name} is in previewBootstrapScript`);
    }
    assert.ok(expression('layerGeometryHitAt').includes(layerDeclaredGeometryHitAt.toString()));
    for (const name of Object.keys(injected)) {
        const interpolation = '${' + name + '.toString()}';
        assert.ok(bootstrapSource.includes(interpolation), `${name} interpolation is in previewBootstrapScript`);
        assert.ok(expandedBootstrap.includes(injected[name].toString()), `${name} body is in previewBootstrapScript`);
        assert.equal((source.slice(0, bootstrapStart) + source.slice(bootstrapEnd)).includes(interpolation), false,
            `${name} must not be injected into another script`);
    }
});

test('zero metadata uses declared output; real dimensions supersede the coherent fallback pair', () => {
    assert.deepEqual(resolveLayerDeclaredSize(0, 0, output), output);
    assert.deepEqual(resolveLayerDeclaredSize(1920, 0, output), output);
    assert.deepEqual(resolveLayerDeclaredSize(1920, 1080, output), { width: 1920, height: 1080 });
});

test('declared crop hit uses translation, scale, crop-centre pivot and half-open bounds', () => {
    const size = resolveLayerDeclaredSize(0, 0, output);
    const hit = (x, y) => layerDeclaredGeometryHitAt(size, output, transform, crop, { x, y });
    assert.equal(hit(600, 225), true);
    assert.equal(hit(500, 150), true);
    assert.equal(hit(499, 225), false);
    assert.equal(hit(701, 225), false);
    assert.equal(hit(600, 300), false);
    assert.equal(layerDeclaredGeometryHitAt(size, output, transform, crop, null), false);
    assert.equal(layerDeclaredGeometryHitAt({ width: 0, height: 0 }, output, transform, crop, { x: 600, y: 225 }), false);
});

test('rotation in degrees inverse-maps into the source crop window', () => {
    const size = resolveLayerDeclaredSize(0, 0, output);
    const rotated = { ...transform, rotate: 90 };
    assert.equal(layerDeclaredGeometryHitAt(size, output, rotated, crop, { x: 600, y: 315 }), true);
    assert.equal(layerDeclaredGeometryHitAt(size, output, rotated, crop, { x: 680, y: 225 }), false);
    const layers = [1, 3, 2].map(z => ({ z, size, transform: rotated, crop }));
    const hits = layers.filter(layer => layerDeclaredGeometryHitAt(layer.size, output, layer.transform, layer.crop, { x: 600, y: 225 }));
    assert.equal(hits.sort((a, b) => b.z - a.z)[0].z, 3);
});

function hitContext(idle = true, clock = undefined) {
    const layers = [spec('V2', 2), spec('V3', 3)];
    const video = { dataset: { akariCutIndex: '0' }, style: { zIndex: '1' },
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 500 }) };
    const window = { akari: { frameEngineClock: clock, interaction: { stageLocalPoint: (x, y) => ({ x, y }) } } };
    const context = { frameEngineMediaIdle: idle, window, summary: { output },
        layerTransformNow: () => transform, layerCropNow: () => crop,
        layerEntries: layers, video, stillImage: {}, segments: [{ kind: 'src', track: 'V1' }], activeSegmentIndex: 0,
        allTracksHiddenByScope: { cuts: false }, hiddenTracksByScope: { cuts: new Set() } };
    context.layerGeometryHitAt = extract('layerGeometryHitAt', context);
    return context;
}

test('engine picks frontmost of three overlapping clips with no metadata; hidden and crop misses fall through', () => {
    for (const [idle, clock] of [[true, undefined], [false, {}]]) {
        const context = hitContext(idle, clock);
        const find = extract('findVisualMediaHitAt', context);
        assert.equal(find({ clientX: 600, clientY: 225 }), context.layerEntries[1].video);
        context.layerEntries[1].video.style.display = 'none';
        assert.equal(find({ clientX: 600, clientY: 225 }), context.layerEntries[0].video);
        assert.equal(find({ clientX: 800, clientY: 225 }), context.video);
        context.hiddenTracksByScope.cuts.add('V1');
        assert.equal(find({ clientX: 800, clientY: 225 }), null);
    }
});

test('legacy elementsFromPoint and alpha hit selection remain authoritative', () => {
    const context = hitContext(false);
    const front = context.layerEntries[1];
    front.video.tagName = 'VIDEO';
    context.document = { elementsFromPoint: () => [front.video, context.video] };
    context.findLayerEntry = () => front;
    context.layerAlphaAtPoint = () => 0;
    assert.equal(extract('findVisualMediaHitAt', context)({ clientX: 600, clientY: 225 }), context.video);
    context.layerAlphaAtPoint = () => 255;
    assert.equal(extract('findVisualMediaHitAt', context)({ clientX: 600, clientY: 225 }), front.video);
});

function selectionContext(idle, clock) {
    const entry = spec('upper');
    const listeners = new Map();
    entry.video.addEventListener = (name, callback) => {
        assert.equal(listeners.has(name), false, `duplicate ${name} listener`);
        listeners.set(name, callback);
    };
    const classes = new Set();
    const classList = { add: key => classes.add(key), remove: key => classes.delete(key), toggle() {} };
    const box = { style: {}, dataset: {}, classList };
    let measured = 0;
    const context = { selectedLayerId: 'upper', findLayerEntry: () => entry,
        frameEngineMediaIdle: idle, window: { akari: { frameEngineClock: clock } }, summary: { output },
        layerSelectBox: box, positionLayerCropToggle() {}, positionLayerPerspectiveToggle() {},
        layerTransformNow: () => transform, layerCropNow: () => crop,
        syncLayerHitRegion: () => { measured++; entry.opaqueBox = null; },
        layerScreenRectForVideoRect: (t, rect) => ({ left: rect.x, top: rect.y,
            width: rect.w * t.scale, height: rect.h * t.scale, rotOffX: 0, rotOffY: 0 }),
        applyCropEdgeVisibility() {}, cropModeActive: false,
        layerPerspectiveToggle: { classList }, layerPerspectiveNow: () => null };
    const update = extract('updateLayerSelectBox', { ...context, updateLayerSelectBox: () => update() });
    return { entry, listeners, classes, box, update, measured: () => measured };
}

test('engine selection renders crop before decoding and recomputes on metadata without duplicate listeners', () => {
    for (const [idle, clock] of [[true, undefined], [false, {}]]) {
        const state = selectionContext(idle, clock);
        state.update();
        state.update();
        assert.equal(state.classes.has('is-active'), true);
        assert.equal(state.box.style.width, '200px');
        assert.equal(state.box.style.height, '150px');
        assert.equal(state.measured(), 0);
        state.entry.video.videoWidth = 2000;
        state.entry.video.videoHeight = 1000;
        state.listeners.get('loadedmetadata')();
        assert.equal(state.box.style.width, '400px');
        assert.equal(state.box.style.height, '300px');
        assert.equal(state.measured(), 0);
        state.entry.video.readyState = 2;
        state.update();
        assert.equal(state.measured(), idle ? 0 : 1);
    }
});

test('legacy selection still waits for dimensions and decoded alpha data', () => {
    const state = selectionContext(false, undefined);
    state.update();
    assert.equal(state.classes.has('is-active'), false);
    assert.equal(state.listeners.size, 0);
    state.entry.video.videoWidth = 1000;
    state.entry.video.videoHeight = 500;
    state.update();
    assert.equal(state.classes.has('is-active'), false);
    assert.ok(state.listeners.has('loadeddata'));
    state.entry.video.readyState = 2;
    state.listeners.get('loadeddata')();
    assert.equal(state.classes.has('is-active'), true);
    assert.equal(state.measured(), 1);
});

test('pointer hit selects and drags the evacuated item; layer target writes its v2 id', async () => {
    const entry = spec('upper-v2-id', 3);
    const calls = [];
    const context = { frameEngineMediaIdle: false, video: {}, stillImage: {}, layersStage: {}, stage: {},
        cropModeActive: false, findVisualMediaHitAt: () => entry.video,
        findLayerEntry: id => { assert.equal(id, entry.spec.id); return entry; },
        selectLayer: id => calls.push(['select', id]), beginLayerMoveDrag: e => calls.push(['drag', e.spec.id]) };
    extract('handleVisualMediaPointerDown', context)({ button: 0, target: entry.video });
    assert.deepEqual(calls, [['select', 'upper-v2-id'], ['drag', 'upper-v2-id']]);
    const targetSource = source.match(/const layerDragTarget = entry => \(\{([\s\S]*?)\n            \}\);/)[0];
    const writes = [];
    const target = new Function('entry', 'window', `${targetSource}\nreturn layerDragTarget(entry);`)(entry,
        { akari: { engine: { layerWrite: (...args) => writes.push(args) } } });
    const patch = { transform: { ...transform, x: transform.x + 100 } };
    await target.write(patch);
    assert.deepEqual(writes, [['upper-v2-id', patch]]);
    assert.match(expression('beginLayerMoveDrag'), /beginMediaTransformDrag\(layerDragTarget\(entry\)/);
    assert.match(expression('beginMediaTransformDrag'), /await target\.write\(\{ transform: finalTransform \}\)/);
});
