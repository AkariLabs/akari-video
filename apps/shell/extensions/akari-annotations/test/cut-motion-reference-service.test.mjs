import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const times = [0, 398, 400, 401, 402, 403, 441, 450, 936];
const points = times.map((t, index) => ({ t, transform: { scale: index === 0 || index === 8 ? 1 : 1.1 } }));
const source = value => `${JSON.stringify(value, null, 2)}\n`;
const uri = path => pathToFileURL(path).toString();
const edit = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'video', path: 'video.mp4' }, { id: 'other', path: 'other.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'sample-split', at: 152, duration: 936,
            source: { kind: 'media', src: 'video', in: 0, out: 936 / 30 },
            keyframes: { path: 'motion/sample-split.json', count: 9 } },
        { id: 'other', at: 1200, duration: 100,
            source: { kind: 'media', src: 'other', in: 0, out: 100 / 30 },
            keyframes: { path: 'motion/other.json', count: 2 } }
    ] }] });
const bag = () => ({ version: 0, group: 'sample-split', items: { 'sample-split': structuredClone(points) } });
const otherBag = () => ({ version: 0, group: 'other', items: { other: [
    { t: 0, transform: { scale: 1 } }, { t: 100, transform: { scale: 1 } }
] } });

async function assertReferences(root, document) {
    for (const track of document.tracks) for (const item of track.items ?? []) {
        if (!item.keyframes) continue;
        if (Array.isArray(item.keyframes)) {
            assert.ok(item.keyframes.length >= 2);
            assert.ok(item.keyframes.every((point, index) => point.t >= 0 && point.t <= item.duration
                && (index === 0 || point.t > item.keyframes[index - 1].t)));
        } else {
            const motion = JSON.parse(await readFile(join(root, item.keyframes.path), 'utf8'));
            assert.equal(motion.items[item.id].length, item.keyframes.count);
        }
    }
}

test('台本の区間カットは袋を分け、元の項目と無関係な参照を保って undo/redo できる', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-cut-motion-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'motion'));
    const editPath = join(root, 'edit.json');
    const original = source(edit());
    const originalBag = source(bag());
    const other = source(otherBag());
    await writeFile(editPath, original);
    await writeFile(join(root, 'captions.json'), '[]\n');
    await writeFile(join(root, 'motion/sample-split.json'), originalBag);
    await writeFile(join(root, 'motion/other.json'), other);
    const service = new AkariAnnotationsServiceImpl();
    const request = { editUri: uri(editPath), projectRootUri: uri(root),
        ranges: [{ in: 41 / 30, out: 63 / 30, kind: 'row', captionId: 'video' }], label: 'カット' };
    await service.applyCutRanges(request);
    const after = await readFile(editPath, 'utf8');
    const document = JSON.parse(after);
    assert.equal(document.tracks[0].items.filter(item => item.source.src === 'video').length, 2);
    await assertReferences(root, document);
    assert.deepEqual(document.tracks[0].items.find(item => item.id === 'other').keyframes,
        edit().tracks[0].items[1].keyframes);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'motion/sample-split.json'), 'utf8')).items['sample-split'], points);
    assert.equal(await readFile(join(root, 'motion/other.json'), 'utf8'), other);

    await service.writeEditSnapshot({ editUri: uri(editPath), projectRootUri: uri(root), editSource: original });
    assert.deepEqual(JSON.parse(await readFile(editPath, 'utf8')).tracks, edit().tracks);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'motion/sample-split.json'), 'utf8')).items['sample-split'], points);
    await assertReferences(root, JSON.parse(await readFile(editPath, 'utf8')));
    await service.writeEditSnapshot({ editUri: uri(editPath), projectRootUri: uri(root), editSource: after });
    await assertReferences(root, JSON.parse(await readFile(editPath, 'utf8')));
});

test('袋が無い場合は edit.json を書かず日本語で失敗する', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-cut-motion-missing-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const editPath = join(root, 'edit.json');
    const original = source(edit());
    await writeFile(editPath, original);
    await writeFile(join(root, 'captions.json'), '[]\n');
    const service = new AkariAnnotationsServiceImpl();
    await assert.rejects(() => service.applyCutRanges({ editUri: uri(editPath), projectRootUri: uri(root),
        ranges: [{ in: 41 / 30, out: 63 / 30, kind: 'row', captionId: 'video' }], label: 'カット' }), /袋を読み込めない/);
    assert.equal(await readFile(editPath, 'utf8'), original);
});

for (const [name, motion] of [
    ['JSON が壊れている', '{'],
    ['item が無い', source({ version: 0, group: 'sample-split', items: {} })],
    ['点数が合わない', source({ version: 0, group: 'sample-split', items: { 'sample-split': points.slice(0, 8) } })]
]) test(`袋の${name}場合も何も保存しない`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-cut-motion-invalid-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'motion'));
    const editPath = join(root, 'edit.json');
    const original = source(edit());
    await writeFile(editPath, original);
    await writeFile(join(root, 'captions.json'), '[]\n');
    await writeFile(join(root, 'motion/sample-split.json'), motion);
    const service = new AkariAnnotationsServiceImpl();
    await assert.rejects(() => service.applyCutRanges({ editUri: uri(editPath), projectRootUri: uri(root),
        ranges: [{ in: 41 / 30, out: 63 / 30, kind: 'row', captionId: 'video' }], label: 'カット' }), /袋を読み込めない/);
    assert.equal(await readFile(editPath, 'utf8'), original);
    assert.equal(await readFile(join(root, 'motion/sample-split.json'), 'utf8'), motion);
});

test('複数区間のカットも袋を一度戻してから適用する', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-cut-motion-multi-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'motion'));
    const editPath = join(root, 'edit.json');
    await writeFile(editPath, source(edit()));
    await writeFile(join(root, 'captions.json'), '[]\n');
    await writeFile(join(root, 'motion/sample-split.json'), source(bag()));
    await writeFile(join(root, 'motion/other.json'), source(otherBag()));
    const service = new AkariAnnotationsServiceImpl();
    await service.applyCutRanges({ editUri: uri(editPath), projectRootUri: uri(root),
        ranges: [{ in: 41 / 30, out: 63 / 30, kind: 'row', captionId: 'video' },
            { in: 400 / 30, out: 403 / 30, kind: 'row', captionId: 'video' }], label: 'カットを整える' });
    const document = JSON.parse(await readFile(editPath, 'utf8'));
    assert.equal(document.tracks[0].items.filter(item => item.source.src === 'video').length, 3);
    await assertReferences(root, document);
});
