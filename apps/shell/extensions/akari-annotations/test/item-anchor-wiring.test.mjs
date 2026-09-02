import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { lintProject } from '../../../../../packages/edit-lint/src/edit-lint.mjs';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const text = value => `${JSON.stringify(value, null, 2)}\n`;
const uri = path => pathToFileURL(path).toString();
const cleanup = root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

function anchoredEdit(caption = 'c-0003', at = 0, duration = 1) {
    return {
        version: 2,
        output: { width: 320, height: 180, fps: 30 },
        sources: [{ id: 'main', path: 'main.mp4' }],
        tracks: [
            { id: 'main', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 300, source: { kind: 'media', src: 'main', in: 0, out: 10 } }] },
            { id: 'overlay', lane: 'visual', items: [{ id: 'box', at, duration, source: { kind: 'html', path: 'box.html' }, anchor: { caption } }] }
        ]
    };
}

const caption = (id, start, end, extra = {}) => ({
    id, start, end, text: id, speaker: null, source_ref: { segment: 0 }, edited: false, ...extra
});

async function project(edit = anchoredEdit(), captions = [caption('c-0003', 1, 2)]) {
    const root = await mkdtemp(join(tmpdir(), 'annotations-anchor-wiring-'));
    await writeFile(join(root, 'edit.json'), text(edit));
    await writeFile(join(root, 'captions.json'), text(captions));
    await writeFile(join(root, 'box.html'), '<div>box</div>');
    return {
        root,
        editPath: join(root, 'edit.json'),
        captionsPath: join(root, 'captions.json'),
        request: { projectRootUri: uri(root), captionsUri: uri(join(root, 'captions.json')) }
    };
}

function item(edit) {
    return edit.tracks[1].items[0];
}

test('setCaptionTiming は 0.5 秒の移動を anchor cache の +15 frames へ反映する', async () => {
    const fixture = await project(anchoredEdit('c-0003', 30, 30));
    try {
        const service = new AkariAnnotationsServiceImpl();
        await service.setCaptionTiming({
            ...fixture.request, captionId: 'c-0003', start: 1.5, end: 2.5,
            timeDomain: 'source', edited: true
        });
        assert.deepEqual(
            { at: item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).at,
                duration: item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).duration },
            { at: 45, duration: 30 }
        );
    } finally {
        await cleanup(fixture.root);
    }
});

test('shiftCaption は字幕書き込み後に anchor cache を更新する', async () => {
    const fixture = await project(anchoredEdit('c-0003', 30, 30));
    try {
        const service = new AkariAnnotationsServiceImpl();
        await service.shiftCaption({
            ...fixture.request, captionId: 'c-0003', deltaStart: 0.5, deltaEnd: 0.5
        });
        assert.equal(item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).at, 45);
    } finally {
        await cleanup(fixture.root);
    }
});

test('removeCaption は参照切れを警告し cache を保持する', async () => {
    const fixture = await project(anchoredEdit('c-0003', 30, 30));
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...values) => warnings.push(values.join(' '));
    try {
        const service = new AkariAnnotationsServiceImpl();
        await service.removeCaption({ ...fixture.request, captionId: 'c-0003' });
        assert.deepEqual(
            { at: item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).at,
                duration: item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).duration },
            { at: 30, duration: 30 }
        );
        assert.ok(warnings.some(value => value.includes('caption-not-found')));
    } finally {
        console.warn = originalWarn;
        await cleanup(fixture.root);
    }
});

for (const [name, invoke] of [
    ['setCaptionTiming', (service, request) => service.setCaptionTiming({
        ...request, captionId: 'c-0003', start: 1.25, end: 2.25,
        timeDomain: 'source', edited: true
    })],
    ['shiftCaption', (service, request) => service.shiftCaption({
        ...request, captionId: 'c-0003', deltaStart: 0.25, deltaEnd: 0.25
    })],
    ['insertCaption', (service, request) => service.insertCaption({
        ...request,
        caption: { id: 'c-0004', start: 3, end: 4, text: 'new', speaker: null, sourceRef: { segment: 0 }, edited: false }
    })],
    ['removeCaption', (service, request) => service.removeCaption({
        ...request, captionId: 'c-0003'
    })]
]) {
    test(`v1 edit.json は ${name} RPC の前後でバイト同一`, async () => {
        const legacy = { version: 1, output: { fps: 30 }, sources: [], cuts: [], overlays: [] };
        const fixture = await project(legacy);
        const before = await readFile(fixture.editPath, 'utf8');
        try {
            await invoke(new AkariAnnotationsServiceImpl(), fixture.request);
            assert.equal(await readFile(fixture.editPath, 'utf8'), before);
        } finally {
            await cleanup(fixture.root);
        }
    });
}

test('applyCutRanges は time_domain: output の anchor を source 再写像しない', async () => {
    const fixture = await project(
        anchoredEdit('c-0003', 150, 30),
        [caption('c-0003', 5, 6, { time_domain: 'output' })]
    );
    try {
        const service = new AkariAnnotationsServiceImpl();
        await service.applyCutRanges({
            editUri: uri(fixture.editPath), projectRootUri: uri(fixture.root),
            ranges: [{ in: 1, out: 2, kind: 'silence' }], label: 'test cut'
        });
        assert.equal(item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).at, 150);
    } finally {
        await cleanup(fixture.root);
    }
});

test('anchor 付き v2 edit.json を applyCutRanges しても throw しない', async () => {
    const fixture = await project(anchoredEdit('c-0003', 30, 30));
    try {
        const service = new AkariAnnotationsServiceImpl();
        await assert.doesNotReject(() => service.applyCutRanges({
            editUri: uri(fixture.editPath), projectRootUri: uri(fixture.root),
            ranges: [{ in: 1, out: 2, kind: 'silence' }], label: 'anchor exact-key regression'
        }));
        assert.deepEqual(item(JSON.parse(await readFile(fixture.editPath, 'utf8'))).anchor, {
            caption: 'c-0003'
        });
    } finally {
        await cleanup(fixture.root);
    }
});

test('anchor の無い v2 edit.json は空 ranges の applyCutRanges でバイト同一', async () => {
    const edit = anchoredEdit('c-0003', 30, 30);
    delete edit.tracks[1].items[0].anchor;
    const fixture = await project(edit);
    const before = JSON.stringify(edit);
    await writeFile(fixture.editPath, before);
    await unlink(fixture.captionsPath);
    try {
        const service = new AkariAnnotationsServiceImpl();
        await service.applyCutRanges({
            editUri: uri(fixture.editPath), projectRootUri: uri(fixture.root),
            ranges: [], label: 'empty ranges byte identity'
        });
        assert.equal(await readFile(fixture.editPath, 'utf8'), before);
    } finally {
        await cleanup(fixture.root);
    }
});

test('insertCaption は cache を更新し lint v2.item-anchor-stale を 0 にする', async () => {
    const fixture = await project(anchoredEdit('c-0004', 0, 1), [caption('c-0003', 1, 2)]);
    try {
        const service = new AkariAnnotationsServiceImpl();
        await service.insertCaption({
            ...fixture.request,
            caption: { id: 'c-0004', start: 2, end: 3, text: 'new', speaker: null, sourceRef: { segment: 0 }, edited: false }
        });
        const refreshed = JSON.parse(await readFile(fixture.editPath, 'utf8'));
        assert.deepEqual({ at: item(refreshed).at, duration: item(refreshed).duration }, { at: 60, duration: 30 });
        const lint = await lintProject(fixture.root);
        assert.equal(lint.findings.filter(finding => finding.check === 'v2.item-anchor-stale').length, 0);
    } finally {
        await cleanup(fixture.root);
    }
});
