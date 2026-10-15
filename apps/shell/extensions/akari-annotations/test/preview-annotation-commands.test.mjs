import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setLanguage } from '@akari-video/i18n';
import { appendAnnotationLine, emptyReviewSource, parseReview, removeAnnotationLine } from '../lib/common/annotation-store.js';

globalThis.Element ??= class { constructor() { this.classList = { add() {} }; this.style = {}; }
    matches() { return false; } };
globalThis.HTMLElement ??= globalThis.Element;
globalThis.MouseEvent ??= class extends Event {};
globalThis.DragEvent ??= class extends MouseEvent {};
globalThis.document ??= { createElement: () => new Element(), documentElement: { style: {} },
    body: new Element(), queryCommandSupported: () => false };
globalThis.window ??= Object.assign(new EventTarget(), { localStorage: { getItem: () => '1' } });
globalThis.window.navigator = { maxTouchPoints: 0 };
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
require.extensions['.css'] = () => {};
require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({});
const { PreviewAnnotationCommands } = require('../lib/browser/preview-annotation-commands.js');
const { SentAnnotationStore } = require('../lib/browser/sent-annotation-store.js');
const { UiTargetLabelStore } = require('../lib/browser/ui-target-label-store.js');
const { AkariAnnotationsServiceImpl } = require('../lib/node/akari-annotations-service.js');
const { handAnnotation } = require('../lib/common/annotation-handoff-flow.js');
const { CLIP_ANNOTATION_LABELS_EVENT } = require('../lib/common/timeline-context-menu-items.js');

setLanguage('ja');
test.after(() => setLanguage(undefined));

const root = new URI('file:///project');
const reviewUri = root.resolve('project/review.json').toString();
const editUri = root.resolve('project/edit.json').toString();

function annotation(id, overrides = {}) {
    return {
        id, createdAt: '2026-10-15T00:00:00.000Z', src: null, sourceT: 3,
        sourceRange: null, timelineT: null, target: null, targetKind: 'instant',
        region: null, strokes: null, refs: null, insertPosition: null, intent: null,
        text: `本文 ${id}`, input: 'typed', audio: null, transcript: null, session: null,
        poses: null, status: 'open', response: null, ...overrides
    };
}

function harness(initial = []) {
    let source = initial.reduce(appendAnnotationLine, emptyReviewSource());
    let reviewExists = true;
    let resolvedLocation = { root, reviewUri: new URI(reviewUri), editUri: new URI(editUri) };
    const data = new Map();
    const changed = [];
    const sent = new SentAnnotationStore();
    sent.storage = {
        getData: async (key, fallback) => data.get(key) ?? fallback,
        setData: async (key, value) => { data.set(key, value); }
    };
    sent.onDidChange(uri => changed.push(uri));
    const model = { location: resolvedLocation, annotations: [...initial] };
    const labels = new UiTargetLabelStore();
    const calls = [];
    let resolvedCalls = 0;
    let outcome = 'typed';
    const commands = new PreviewAnnotationCommands();
    Object.assign(commands, {
        model, sent, labels,
        contribution: { findReviewLocationForProjectRoot: async requestedRoot => {
            resolvedCalls++;
            return requestedRoot.toString() === resolvedLocation.root.toString() ? resolvedLocation : undefined;
        } },
        files: {
            exists: async uri => uri.toString() === root.toString()
                || (reviewExists && (uri.toString() === resolvedLocation.reviewUri.toString()
                    || uri.toString() === model.location?.reviewUri.toString())),
            readFile: async () => ({ value: { toString: () => source } })
        },
        annotationsService: {
            createAnnotation: async request => {
                calls.push(['create', request]);
                const created = annotation(`a-${String(parseReview(source).annotations.length + 1).padStart(4, '0')}`, {
                    src: request.src, sourceT: request.sourceT, sourceRange: request.sourceRange,
                    target: request.target, targetKind: request.targetKind, region: request.region,
                    strokes: request.strokes, text: request.text
                });
                source = appendAnnotationLine(source, created);
                return { annotation: created, committed: false };
            },
            deleteAnnotation: async request => {
                calls.push(['delete', request]);
                const removed = removeAnnotationLine(source, request.annotationId);
                source = removed.source;
                return { annotation: removed.removed };
            }
        },
        commands: { executeCommand: async (id, prompt) => {
            calls.push(['type', id, prompt]);
            return outcome;
        } },
        clipboard: { writeText: async text => { calls.push(['copy', text]); } },
        messages: { info: async (...args) => { calls.push(['notice', ...args]); return undefined; } }
    });
    const registry = new Map();
    commands.registerCommands({ registerCommand: (command, handler) => registry.set(command.id, handler.execute) });
    return {
        exec: (id, request) => registry.get(`akari.annotations.${id}`)(request),
        source: () => source, data, changed, calls, sent, labels, model,
        resolvedCalls: () => resolvedCalls,
        setResolvedLocation: value => { resolvedLocation = value; },
        setReviewExists: value => { reviewExists = value; },
        setOutcome: value => { outcome = value; }
    };
}

test('createFromPreview writes pen, pin and range annotations through createAnnotation', async () => {
    const h = harness();
    const stroke = { tool: 'pen', space: 'content-rect', frame: { sourceT: 3, cutIndex: null },
        points: [[0.1, 0.2], [0.8, 0.9]] };
    assert.deepEqual(await h.exec('createFromPreview', {
        projectRootUri: root.toString(), sourceT: 3, strokes: [stroke], text: ''
    }), { id: 'a-0001' });
    await h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 4, text: 'ピン' });
    await h.exec('createFromPreview', {
        projectRootUri: root.toString(), src: 'source-1', sourceT: 5,
        sourceRange: [5, 8], text: '範囲'
    });
    const items = parseReview(h.source()).annotations;
    assert.equal(items.length, 3);
    assert.deepEqual(items[0].strokes, [stroke]);
    assert.equal(items[0].status, 'open');
    assert.equal(items[1].strokes, null);
    assert.deepEqual(items[2].sourceRange, [5, 8]);
    assert.equal(items[2].targetKind, 'range');
    assert.equal(h.model.annotations.length, 3);
    assert.equal(h.calls.filter(call => call[0] === 'create').length, 3);
    assert.ok(h.calls.filter(call => call[0] === 'create').every(call => call[1].nudge === false));
    const dir = mkdtempSync(join(tmpdir(), 'akari-preview-annotations-'));
    try {
        const file = join(dir, 'review.json');
        writeFileSync(file, h.source());
        const validator = fileURLToPath(new URL('../../../../../packages/schemas/bin/validate-review.mjs', import.meta.url));
        const checked = spawnSync(process.execPath, [validator, file], { encoding: 'utf8' });
        assert.equal(checked.status, 0, checked.stderr);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('createFromPreview writes a real nudge-false event beside review.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'akari-preview-event-'));
    try {
        const reviewPath = join(dir, 'review.json');
        writeFileSync(reviewPath, emptyReviewSource());
        const project = pathToFileURL(dir).toString();
        const location = { root: new URI(project), reviewUri: new URI(pathToFileURL(reviewPath).toString()) };
        const commands = new PreviewAnnotationCommands();
        Object.assign(commands, {
            model: { location, annotations: [] },
            annotationsService: new AkariAnnotationsServiceImpl(),
            files: { exists: async uri => existsSync(fileURLToPath(uri.toString())) },
            contribution: { findReviewLocationForProjectRoot: async () => location }
        });
        const registry = new Map();
        commands.registerCommands({ registerCommand: (command, handler) => registry.set(command.id, handler.execute) });
        const result = await registry.get('akari.annotations.createFromPreview')({
            projectRootUri: project, sourceT: 1, point: [0.65, 0.4], text: 'ピン'
        });
        const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
        assert.equal(review.annotations[0].id, result.id);
        assert.deepEqual(review.annotations[0].region.box, [0.64, 0.39, 0.02, 0.02]);
        const eventsDir = join(dir, '.akari/events');
        const names = readdirSync(eventsDir);
        assert.equal(names.length, 1);
        const event = JSON.parse(readFileSync(join(eventsDir, names[0]), 'utf8'));
        assert.equal(event.annotationId, result.id);
        assert.equal(event.nudge, false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('point maps to a centred schema-valid region, including all four edges and range coexistence', async () => {
    const h = harness();
    const cases = [
        [[0.65, 0.4], [0.64, 0.39, 0.02, 0.02], 'region'],
        [[0, 0], [0, 0, 0.02, 0.02], 'region'],
        [[1, 0], [0.98, 0, 0.02, 0.02], 'region'],
        [[0, 1], [0, 0.98, 0.02, 0.02], 'region'],
        [[1, 1], [0.98, 0.98, 0.02, 0.02], 'region']
    ];
    for (const [point, box, targetKind] of cases) {
        await h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 1, point, text: 'ピン' });
        const item = parseReview(h.source()).annotations.at(-1);
        assert.deepEqual(item.region.box, box);
        assert.equal(item.targetKind, targetKind);
        assert.ok(item.region.box[0] + item.region.box[2] <= 1);
        assert.ok(item.region.box[1] + item.region.box[3] <= 1);
    }
    await h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 2,
        sourceRange: [2, 4], point: [0.5, 0.5], text: '範囲と点' });
    const ranged = parseReview(h.source()).annotations.at(-1);
    assert.equal(ranged.targetKind, 'range');
    assert.deepEqual(ranged.sourceRange, [2, 4]);
    assert.deepEqual(ranged.region.box, [0.49, 0.49, 0.02, 0.02]);
    await h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 5, text: '時点' });
    assert.equal(parseReview(h.source()).annotations.at(-1).targetKind, 'instant');
    const dir = mkdtempSync(join(tmpdir(), 'akari-preview-points-'));
    try {
        const file = join(dir, 'review.json');
        writeFileSync(file, h.source());
        const validator = fileURLToPath(new URL('../../../../../packages/schemas/bin/validate-review.mjs', import.meta.url));
        const checked = spawnSync(process.execPath, [validator, file], { encoding: 'utf8' });
        assert.equal(checked.status, 0, checked.stderr);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('point rejects malformed coordinates with the preview annotation error', async () => {
    const h = harness();
    for (const point of ['bad', {}, [], [0], [0, 0, 0], Array(2), [-0.01, 0], [0, 1.01],
        [NaN, 0], [Infinity, 0], ['0.5', 0]]) {
        await assert.rejects(h.exec('createFromPreview', {
            projectRootUri: root.toString(), sourceT: 1, point, text: 'bad'
        }), { message: 'Invalid preview annotation' });
    }
});

test('composePacket includes a point position in both single and batch prompts', async () => {
    const h = harness();
    const first = await h.exec('createFromPreview', {
        projectRootUri: root.toString(), sourceT: 4, point: [0.65, 0.4], text: 'ここを直す'
    });
    const single = await h.exec('composePacket', { projectRootUri: root.toString(), ids: [first.id] });
    assert.match(single, /位置: 65%, 40%/);
    const second = await h.exec('createFromPreview', {
        projectRootUri: root.toString(), sourceT: 5, text: '次も直す'
    });
    const batch = await h.exec('composePacket', { projectRootUri: root.toString(), ids: [first.id, second.id] });
    assert.match(batch, /位置: 65%, 40%/);
    assert.equal(batch.match(/位置:/g)?.length, 1);
});

test('deleteFromPreview removes any status, refreshes the panel and clears sent state', async () => {
    const h = harness([annotation('a-0001', { status: 'resolved' }), annotation('a-0002')]);
    await h.sent.mark(reviewUri, 'a-0001');
    assert.deepEqual(await h.exec('deleteFromPreview', { projectRootUri: root.toString(), id: 'a-0001' }),
        { deleted: true });
    assert.deepEqual(parseReview(h.source()).annotations.map(item => item.id), ['a-0002']);
    assert.deepEqual(h.model.annotations.map(item => item.id), ['a-0002']);
    assert.deepEqual([...await h.sent.read(reviewUri)], []);
    assert.deepEqual(h.calls.find(call => call[0] === 'delete')[1], { reviewUri, annotationId: 'a-0001' });
    await h.sent.mark(reviewUri, 'a-0001');
    assert.deepEqual(await h.exec('deleteFromPreview', { projectRootUri: root.toString(), id: 'a-0001' }),
        { deleted: false });
    assert.deepEqual([...await h.sent.read(reviewUri)], []);
    assert.equal(h.calls.filter(call => call[0] === 'delete').length, 1);
});

test('deleteFromPreview validates id, project and review location', async () => {
    const h = harness();
    for (const id of [undefined, null, '', '  ', 42]) {
        await assert.rejects(h.exec('deleteFromPreview', { projectRootUri: root.toString(), id }),
            { message: 'Invalid annotation id' });
    }
    await assert.rejects(h.exec('deleteFromPreview', { projectRootUri: 'http://bad', id: 'a-0001' }),
        { message: 'Invalid projectRootUri' });
    h.setReviewExists(false);
    await assert.rejects(h.exec('deleteFromPreview', { projectRootUri: root.toString(), id: 'a-0001' }),
        { message: 'review.json does not exist' });
});

test('createFromPreview rejects malformed requests and missing review.json', async () => {
    const h = harness();
    for (const request of [
        { projectRootUri: root.toString(), sourceT: -1, text: 'bad' },
        { projectRootUri: root.toString(), sourceT: 1, text: '  ' },
        { projectRootUri: root.toString(), sourceT: 1, sourceRange: [3, 2], text: 'bad' },
        { projectRootUri: root.toString(), sourceT: 1, strokes: [{ tool: 'pen', space: 'content-rect',
            frame: { sourceT: 1, cutIndex: null }, points: [[2, 0], [1, 1]] }], text: '' },
        { projectRootUri: 'http://example.com', sourceT: 1, text: 'bad' }
    ]) await assert.rejects(h.exec('createFromPreview', request));
    h.model.location = undefined;
    await assert.rejects(h.exec('createFromPreview', { projectRootUri: 'file:///missing', sourceT: 1, text: 'bad' }));
    h.setReviewExists(false);
    await assert.rejects(h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 1, text: 'bad' }));
    assert.equal(parseReview(h.source()).annotations.length, 0);
});

test('composePacket and handToPartner use identical single, batch and extraLines text', async () => {
    const h = harness([annotation('a-0001'), annotation('a-0002', { sourceT: 5 })]);
    for (const ids of [['a-0001'], ['a-0001', 'a-0002']]) {
        for (const extraLines of [undefined, ['コマの絵', '添付を見て']]) {
            const request = { projectRootUri: root.toString(), ids, extraLines };
            const expected = await h.exec('composePacket', request);
            assert.equal(await h.exec('handToPartner', request), 'typed');
            assert.equal(h.calls.filter(call => call[0] === 'type').at(-1)[2], expected);
            if (extraLines) assert.ok(expected.endsWith('\n\nコマの絵\n添付を見て'));
        }
    }
    assert.equal(await h.exec('composePacket', { projectRootUri: root.toString(), ids: ['missing', 'a-0002'] }),
        await h.exec('composePacket', { projectRootUri: root.toString(), ids: ['a-0002'] }));
    await assert.rejects(h.exec('composePacket', { projectRootUri: root.toString(), ids: ['missing'] }));
    await assert.rejects(h.exec('handToPartner', { projectRootUri: root.toString(), ids: [] }));
});

test('ui:timeline:cut packet matches the right panel with the shared display label', async () => {
    const note = annotation('a-0001', { target: 'ui:timeline:cut:0' });
    const h = harness([note]);
    h.labels.listen();
    window.dispatchEvent(Object.assign(new Event(CLIP_ANNOTATION_LABELS_EVENT), {
        detail: { editUri, labels: { 'timeline:cut:0': '冒頭のカット' } }
    }));
    let panelPrompt;
    await handAnnotation(note, h.labels.get(editUri), {
        hand: async prompt => { panelPrompt = prompt; return 'no-partner'; },
        markSent: async () => { throw new Error('unexpected mark'); }
    });
    const request = { projectRootUri: root.toString(), ids: [note.id] };
    assert.equal(await h.exec('composePacket', request), panelPrompt);
    assert.equal(await h.exec('handToPartner', request), 'typed');
    assert.equal(h.calls.find(call => call[0] === 'type')[2], panelPrompt);
    assert.match(panelPrompt, /冒頭のカット/);
});

test('another active root uses locateAll sidecar resolution instead of a fixed project path', async () => {
    const h = harness([annotation('a-0001')]);
    const resolved = {
        root, editUri: root.resolve('timelines/edit-b.json'),
        reviewUri: root.resolve('timelines/review-b.json')
    };
    h.model.location = { root: new URI('file:///other'), reviewUri: new URI('file:///other/review.json') };
    h.setResolvedLocation(resolved);
    await h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 2, text: 'new' });
    assert.equal(h.calls.find(call => call[0] === 'create')[1].reviewUri, resolved.reviewUri.toString());
    assert.equal(await h.exec('composePacket', { projectRootUri: root.toString(), ids: ['a-0001'] })
        .then(text => text.includes('a-0001')), true);
    const commandSource = readFileSync(new URL('../src/browser/preview-annotation-commands.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(commandSource, /project\/review\.json/);
});

test('the active panel location wins when its root matches the requested project', async () => {
    const h = harness();
    h.setResolvedLocation({
        root, editUri: root.resolve('other/edit.json'), reviewUri: root.resolve('other/review.json')
    });
    await h.exec('createFromPreview', { projectRootUri: root.toString(), sourceT: 2, text: 'active' });
    assert.equal(h.calls.find(call => call[0] === 'create')[1].reviewUri, reviewUri);
    assert.equal(h.resolvedCalls(), 0);
});

test('all four handoff outcomes mark only typed and unsupported; command marks reach the shared store', async () => {
    for (const outcome of ['typed', 'unsupported', 'no-partner', 'copied']) {
        const h = harness([annotation('a-0001'), annotation('a-0002')]);
        h.setOutcome(outcome === 'copied' ? undefined : outcome);
        assert.equal(await h.exec('handToPartner', {
            projectRootUri: root.toString(), ids: ['a-0001', 'missing', 'a-0002']
        }), outcome);
        assert.deepEqual([...await h.sent.read(reviewUri)], outcome === 'typed' || outcome === 'unsupported'
            ? ['a-0001', 'a-0002'] : []);
        assert.equal(h.changed.length, outcome === 'typed' || outcome === 'unsupported' ? 2 : 0);
        assert.equal(h.calls.some(call => call[0] === 'copy'), outcome === 'no-partner' || outcome === 'copied');
    }
});

test('sent store reads the existing key and emits the same URI for panel refresh', async () => {
    const h = harness();
    h.data.set(`akari-review-sent-annotations:${reviewUri}`, ['a-0007']);
    assert.deepEqual([...await h.sent.read(reviewUri)], ['a-0007']);
    await h.sent.mark(reviewUri, 'a-0008');
    assert.deepEqual(h.data.get(`akari-review-sent-annotations:${reviewUri}`), ['a-0007', 'a-0008']);
    assert.deepEqual(h.changed, [reviewUri]);
    const panel = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
    assert.match(panel, /this\.sentStore\.read\(reviewUri\)/);
    assert.match(panel, /this\.sentStore\.onDidChange\(reviewUri =>/);
    assert.match(panel, /this\.sentStore\.mark\(reviewUri, id\)/);
});
