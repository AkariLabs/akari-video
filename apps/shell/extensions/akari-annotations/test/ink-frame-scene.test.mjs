import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { annotationsToInk, duplicateObject, fromAnnotation, inkToAnnotations, moveObject, toAnnotation } from '../lib/common/ink-model.js';
import { importCanvas3d, validateFrameScene } from '../../../../../packages/frame-scene/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../../../packages/schemas/fixtures/frame-scene/valid');
const load = async path => JSON.parse(await readFile(path, 'utf8'));

test('frame-scene の valid fixture にある全注釈が深い等価で戻る', async () => {
    let count = 0;
    for (const folder of await readdir(fixtures)) {
        const scene = await load(join(fixtures, folder, 'scene.json'));
        for (const annotation of scene.scenes.flatMap(item => item.annotations ?? [])) {
            assert.deepStrictEqual(toAnnotation(fromAnnotation(annotation)), annotation, folder);
            count += 1;
        }
    }
    assert.ok(count >= 20, `${count} annotations checked`);
});

test('3D 試作の pen / arrow / text を importCanvas3d 経由で往復', async () => {
    const source = await load(join(here, 'fixtures/ink/canvas3d-annotations.json'));
    const { doc } = importCanvas3d(source);
    assert.deepEqual(doc.scenes[0].annotations.map(item => item.type), ['pen', 'arrow', 'text']);
    const ink = annotationsToInk(doc.scenes[0].annotations, { aspect: { w: 1920, h: 1080 } });
    assert.deepStrictEqual(inkToAnnotations(ink), doc.scenes[0].annotations);
    assert.ok(ink.objects[0].box);
    assert.equal(ink.objects[0].around, source.annotations[0].frame.around);
    assert.equal(ink.objects[1].pointsTo, source.annotations[1].frame.pointsTo);
    assert.equal(ink.objects[2].over, null);
});

test('新しい ink 注釈を載せた最小 frame-scene は非 strict で error 0', () => {
    const ink = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: { w: 1920, h: 1080 }, objects: [
        { id: 'ink-1', type: 'pen', color: '#f97316', x: 0.2, y: 0.3, points: [[0.2, 0.3], [0.4, 0.5]], strokeWidth: 0.008, recT: [1, 2] },
        { id: 'ink-2', type: 'arrow', color: '#f97316', x: 0.5, y: 0.5, from: [0.5, 0.5], to: [0.6, 0.6], strokeWidth: 0.008 },
        { id: 'ink-3', type: 'text', color: '#f97316', x: 0.7, y: 0.7, at: [0.7, 0.7], text: 'メモ', textHeight: 0.045 }
    ] };
    const doc = { schema: 'akari.frame-scene', version: 0, objects: [], scenes: [{ id: 's1', annotations: inkToAnnotations(ink) }] };
    const checked = validateFrameScene(doc);
    assert.deepEqual(checked.errors, []);
    // The current schema accepts annotation frame payloads; strict validation is observed here as well.
    assert.deepEqual(validateFrameScene(doc, { strict: true }).errors, []);
});

test('未知キーと anchor.object を複製・移動後も保持する', () => {
    const raw = { id: 'ink-9', type: 'pen', color: '#2563eb', x: 0.1, y: 0.2, frame: { points: [[0.1, 0.2], [0.2, 0.3]], recT: [2, 3], custom: { label: 'keep' } }, anchor: { object: 'p1', extra: true }, extension: { flag: 1 } };
    assert.deepStrictEqual(toAnnotation(fromAnnotation(raw)), raw);
    const ink = annotationsToInk([raw], { aspect: { w: 1920, h: 1080 } });
    const moved = moveObject(ink, 'ink-9', 0.1, 0.1);
    const result = inkToAnnotations(moved)[0];
    assert.deepEqual(result.anchor, raw.anchor);
    assert.deepEqual(result.extension, raw.extension);
    assert.deepEqual(result.frame.custom, raw.frame.custom);
    const duplicated = duplicateObject(ink, 'ink-9');
    const duplicate = inkToAnnotations(duplicated)[1];
    assert.equal(duplicate.id, 'ink-10');
    assert.deepEqual(duplicate.anchor, raw.anchor);
    assert.deepEqual(duplicate.extension, raw.extension);
});
