import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { methodBody, readHandlerSource, sliceBetween } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const perspectiveFunctions = sliceBetween('            const layerPerspectiveNow =',
    '            const setPerspectivePanelOpen =', { source });
const perspectiveEvents = sliceBetween('            for (const button of layerPerspectivePresetButtons) {',
    "            window.addEventListener('keydown', event => {", {
        source, from: source.indexOf('            const setPerspectivePanelOpen =')
    });

function element(attributes = {}) {
    const listeners = new Map();
    return {
        listeners,
        classList: { toggle() {}, remove() {} },
        getAttribute: name => attributes[name],
        addEventListener: (name, listener) => listeners.set(name, listener),
        fire(name) {
            const event = { pointerId: 1, preventDefault() {}, stopPropagation() {} };
            listeners.get(name)(event);
        },
        setPointerCapture() {}
    };
}

function panelFixture({ initial = null, layerWrite = async () => {} } = {}) {
    const calls = [];
    const errors = [];
    const entry = { spec: { id: 'layer-1' }, video: { dataset: {} } };
    if (initial) entry.video.dataset.akariPerspectiveCorners = JSON.stringify(initial);
    const toggle = element();
    const button = element({ 'data-akari-perspective-preset': 'right' });
    const angle = element();
    angle.value = '30';
    const clear = element();
    let layouts = 0;
    const window = { akari: {
        updateLayerLayout: () => { layouts++; },
        frameEngineClock: { applyLivePreview: message => calls.push(message) },
        engine: { layerWrite },
        showWriteError: error => errors.push(error)
    } };
    const make = new Function('window', 'entry', 'toggle', 'button', 'angle', 'clear', `
        let activePerspectivePreset = null;
        let perspectiveSliderOriginal = null;
        const selectedLayerId = entry.spec.id;
        const findLayerEntry = id => id === entry.spec.id ? entry : null;
        const layerPerspectiveToggle = toggle;
        const layerPerspectivePresetButtons = [button];
        const layerPerspectiveAngleInput = angle;
        const layerPerspectiveAngleValueEl = { textContent: '' };
        const layerPerspectiveClearButton = clear;
        ${perspectiveFunctions}
        ${perspectiveEvents}
        return { applyLayerPerspectiveNow, commitLayerPerspective };
    `);
    const panel = make(window, entry, toggle, button, angle, clear);
    return { ...panel, entry, button, angle, clear, calls, errors, layouts: () => layouts };
}

function expectedCalls(corners) {
    return ['tl', 'tr', 'bl', 'br'].flatMap((corner, index) =>
        ['x', 'y'].map((axis, coordinate) => ({
            target: { kind: 'layer', id: 'layer-1' },
            field: `perspective.${corner}.${axis}`,
            value: corners[index][coordinate]
        })));
}

test('panel applies all eight perspective coordinates and keeps the dataset in sync', () => {
    const fixture = panelFixture();
    const corners = [[0.1, 0.2], [0.9, 0.3], [0.2, 0.8], [0.8, 0.7]];
    fixture.applyLayerPerspectiveNow(fixture.entry, corners);
    assert.deepEqual(fixture.calls, expectedCalls(corners));
    assert.deepEqual(JSON.parse(fixture.entry.video.dataset.akariPerspectiveCorners), corners);
    fixture.calls.length = 0;
    fixture.applyLayerPerspectiveNow(fixture.entry, null);
    assert.deepEqual(fixture.calls, expectedCalls([[0, 0], [1, 0], [0, 1], [1, 1]]));
    assert.equal('akariPerspectiveCorners' in fixture.entry.video.dataset, false);
    assert.equal(fixture.layouts(), 2);
});

test('angle input stays live; change and preset each save once', async () => {
    const writes = [];
    const fixture = panelFixture({ layerWrite: async (...args) => { writes.push(args); } });
    fixture.button.fire('pointerup');
    assert.equal(writes.length, 1);
    assert.equal(fixture.calls.length, 8);
    fixture.calls.length = 0;
    fixture.angle.value = '40';
    fixture.angle.fire('input');
    fixture.angle.value = '50';
    fixture.angle.fire('input');
    assert.equal(writes.length, 1);
    assert.equal(fixture.calls.length, 16);
    fixture.angle.fire('change');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1][1], {
        perspective: { corners: JSON.parse(fixture.entry.video.dataset.akariPerspectiveCorners) }
    });
    });

test('clear click immediately previews identity and saves one null patch', () => {
    const writes = [];
    const fixture = panelFixture({
        initial: [[0, 0], [0.8, 0.2], [0, 1], [0.8, 0.8]],
        layerWrite: async (...args) => { writes.push(args); }
    });
    fixture.clear.fire('pointerup');
    assert.deepEqual(fixture.calls, expectedCalls([[0, 0], [1, 0], [0, 1], [1, 1]]));
    assert.deepEqual(writes, [['layer-1', { perspective: null }]]);
    assert.equal('akariPerspectiveCorners' in fixture.entry.video.dataset, false);
});

test('failed save restores the original corners in the frame engine, including after slider input', async () => {
    const original = [[0, 0.1], [1, 0], [0, 0.9], [1, 1]];
    const failure = new Error('write rejected');
    const fixture = panelFixture({ initial: original, layerWrite: async () => { throw failure; } });
    fixture.button.fire('pointerup');
    await new Promise(setImmediate);
    assert.deepEqual(fixture.calls.slice(-8), expectedCalls(original));
    fixture.calls.length = 0;
    fixture.angle.fire('input');
    fixture.angle.value = '45';
    fixture.angle.fire('input');
    fixture.angle.fire('change');
    await new Promise(setImmediate);
    assert.deepEqual(fixture.calls.slice(-8), expectedCalls(original));
    assert.deepEqual(JSON.parse(fixture.entry.video.dataset.akariPerspectiveCorners), original);
    assert.deepEqual(fixture.errors, [failure, failure]);
});

test('perspective patch uses the preview transform history command', async () => {
    const code = ts.transpileModule(`class Handler {
${methodBody('persistPreviewTransform', { source })}
${methodBody('handleLayerWrite', { source })}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const history = [];
    const dependencies = {
        validateLayerTransformPatch: () => undefined,
        validateLayerCropPatch: () => undefined,
        validateLayerPerspectivePatch: () => undefined,
        isNestedPreviewLayer: () => false,
        resolvePreviewItemWrite: (_text, write) => ({ candidateText: JSON.stringify(write) }),
        BinaryBuffer: { fromString: text => text }
    };
    const Handler = new Function('dependencies', `
        const { validateLayerTransformPatch, validateLayerCropPatch, validateLayerPerspectivePatch,
            isNestedPreviewLayer, resolvePreviewItemWrite, BinaryBuffer } = dependencies;
        ${code}
        return Handler;
    `)(dependencies);
    const handler = new Handler();
    handler.readText = async () => '{}';
    handler.previewService = { lintEditCandidate: async () => ({ pass: true }) };
    handler.commandRegistry = {
        getCommand: () => ({}),
        executeCommand: async (...args) => { history.push(args); return true; }
    };
    handler.markRecentWrite = () => {};
    handler.fileService = { writeFile: () => assert.fail('history command should handle this write') };
    const responses = [];
    const widget = {
        akariPreviewEditUri: { toString: () => 'edit.json' },
        akariPreviewLastKnownTime: 2,
        sendMessage: response => responses.push(response)
    };
    const patches = [
        { perspective: { corners: [[0, 0], [0.8, 0.1], [0, 1], [0.8, 0.9]] } },
        { perspective: null }
    ];
    for (const [index, patch] of patches.entries()) {
        await handler.handleLayerWrite(widget, { requestId: `perspective-${index}`, layerId: 'layer-1', patch });
    }
    assert.deepEqual(history, patches.map(patch => [
        'akari.annotations.commitPreviewTransform', 'edit.json',
        { kind: 'layer', itemId: 'layer-1', patch, playheadSeconds: 2 }
    ]));
    assert.deepEqual(responses, patches.map((_patch, index) => ({
        type: 'akari-preview-layer-write-response', requestId: `perspective-${index}`, ok: true
    })));
});
