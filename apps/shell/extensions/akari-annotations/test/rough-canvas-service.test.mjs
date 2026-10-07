import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AkariRoughCanvasServiceImpl, decodeRoughCanvasPng } from '../lib/node/rough-canvas-service.js';
import { validateCanvasManifest, validateCanvasStroke } from '../../../../../skills/compile-review-session/bin/core/canvas-compiler.mjs';

const aspect = { w: 1920, h: 1080 };
const ink = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect, objects: [{
    id: 'ink-1', type: 'pen', color: 'red', x: 0.1, y: 0.2,
    points: [[0.1, 0.2], [0.3, 0.4]], strokeWidth: 0.008
}] };
function png() {
    const b = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
    b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(2, 16); b.writeUInt32BE(2, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
}
const request = root => ({ projectRootUri: pathToFileURL(root).href, aspect, aspectSource: 'edit.json',
    ink, paperPng: png(), memo: 'ここに字幕',
    backdrop: { image: png(), outputT: 12.4, editSha256: 'abc' },
    subject: { playhead: { outputT: 12.4 }, selection: [], doc: 'edit.json' } });

test('採番、5 ファイル、旧 canvas 読み手との互換、封印と代替', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rough-canvas-'));
    try {
        const service = new AkariRoughCanvasServiceImpl();
        const first = await service.saveMemo(request(root)); assert.equal(first.id, 'c-0001');
        const dir = join(root, 'review/canvas/c-0001');
        assert.deepEqual((await readdir(dir)).sort(), ['backdrop.png', 'canvas.json', 'ink.json', 'paper.png', 'strokes.json']);
        const canvas = JSON.parse(await readFile(join(dir, 'canvas.json'), 'utf8'));
        assert.equal(canvas.version, 0); assert.equal(canvas.status, 'recorded'); assert.equal(canvas.audio, null);
        assert.deepEqual(canvas.background, { ref: 'backdrop.png',
            hash: `sha256:${createHash('sha256').update(await readFile(join(dir, 'backdrop.png'))).digest('hex')}` });
        assert.deepEqual(canvas.aspect, aspect); assert.equal(canvas.memo, 'ここに字幕');
        assert.ok(validateCanvasManifest(canvas));
        const strokes = JSON.parse(await readFile(join(dir, 'strokes.json'), 'utf8'));
        assert.deepEqual(strokes.strokes[0], { id: 'st-0001', tool: 'pen', space: 'canvas-rect', points: ink.objects[0].points });
        assert.ok(validateCanvasStroke(strokes.strokes[0]));
        assert.equal((await service.saveMemo({ ...request(root), id: 'c-0001', memo: '更新' })).id, 'c-0001');
        assert.equal(JSON.parse(await readFile(join(dir, 'canvas.json'), 'utf8')).memo, '更新');
        assert.equal((await service.saveMemo(request(root))).id, 'c-0002');
        const edit = join(root, 'edit.json'); await writeFile(edit, '{"version":0}');
        assert.equal(await service.hashEdit(pathToFileURL(edit).href), createHash('sha256').update('{"version":0}').digest('hex'));
        await writeFile(join(dir, 'ink.json'), '{broken');
        const read = await service.readMemo(pathToFileURL(root).href, 'c-0001');
        assert.equal(read.ink.objects.length, 1); assert.equal(read.warnings.length, 1);
        await service.sealMemo(pathToFileURL(root).href, 'c-0001', 'send');
        await assert.rejects(service.saveMemo({ ...request(root), id: 'c-0001' }), /送信済み/);
        const sealed = JSON.parse(await readFile(join(dir, 'canvas.json'), 'utf8'));
        assert.equal(sealed.sealed, true); assert.equal(sealed.exits[0].kind, 'send');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('typed メモの言葉を保存する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rough-canvas-'));
    try {
        const service = new AkariRoughCanvasServiceImpl();
        const saved = await service.saveMemo({ ...request(root), speech: {
            transcript: 'transcript.json', engine: 'typed', openedRecT: 0, span: [0, 4.2]
        } });
        const dir = join(root, 'review/canvas', saved.id);
        const transcript = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8'));
        assert.equal(transcript.engine, 'typed'); assert.equal(transcript.segments[0].text, 'ここに字幕');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('空メモは保存せず、不正 PNG を拒否', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rough-canvas-'));
    try {
        const service = new AkariRoughCanvasServiceImpl();
        const base = request(root);
        assert.deepEqual(await service.saveMemo({ ...base, ink: { ...ink, objects: [] }, memo: '', backdrop: undefined }), { id: null });
        const blank = await service.saveMemo({ ...base, backdrop: undefined });
        const blankCanvas = JSON.parse(await readFile(join(root, 'review/canvas', blank.id, 'canvas.json'), 'utf8'));
        assert.equal(blankCanvas.background, null);
        assert.ok(validateCanvasManifest(blankCanvas));
        for (const paperPng of ['oops', 'data:image/png;base64,YWJj', `data:image/png;base64,${Buffer.alloc(17 * 1024 * 1024).toString('base64')}`]) {
            await assert.rejects(service.saveMemo({ ...base, paperPng }));
        }
        assert.throws(() => decodeRoughCanvasPng('data:image/jpeg;base64,YWJj'));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('保存先のシンボリックリンクを拒否', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rough-canvas-'));
    const outside = await mkdtemp(join(tmpdir(), 'rough-canvas-outside-'));
    try {
        await mkdir(join(root, 'review'));
        await symlink(outside, join(root, 'review/canvas'));
        await assert.rejects(new AkariRoughCanvasServiceImpl().saveMemo(request(root)), /実ディレクトリ/);
        assert.deepEqual(await readdir(outside), []);
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
