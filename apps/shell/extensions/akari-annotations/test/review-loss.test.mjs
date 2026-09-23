import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { appendAnnotationsAtomic } from '../../../../../skills/compile-review-session/bin/core/review-store.mjs';

const execFileAsync = promisify(execFile);

async function fixture(run) {
    const root = await mkdtemp(join(tmpdir(), 'issue69-service-'));
    const review = join(root, 'review.json');
    const service = new AkariAnnotationsServiceImpl();
    const reviewUri = pathToFileURL(review).toString();
    const projectRootUri = pathToFileURL(root).toString();
    try { await run({ root, review, service, reviewUri, projectRootUri }); }
    finally { await rm(root, { recursive: true, force: true }); }
}

function annotation(id, status = 'open') {
    return { id, createdAt: '2026-01-01T00:00:00Z', src: null, sourceT: 1,
        sourceRange: null, timelineT: null, target: null, targetKind: null,
        region: null, strokes: null, refs: null, insertPosition: null, intent: null,
        text: id, input: 'typed', audio: null, transcript: null, session: null,
        poses: null, status, response: null };
}
async function save(review, annotations) {
    await writeFile(review, JSON.stringify({ version: 0, annotations }, null, 2) + '\n');
}
async function ids(review) {
    return JSON.parse(await readFile(review, 'utf8')).annotations.map(item => item.id);
}

test('追加・解決・削除・復元は外部追記行を維持する', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    await save(review, [annotation('a-0001', 'addressed'), annotation('a-0002')]);
    await service.resolveAnnotation({ reviewUri, annotationId: 'a-0001' });
    assert.deepEqual(await ids(review), ['a-0001', 'a-0002']);
    await service.deleteAnnotation({ reviewUri, annotationId: 'a-0001' });
    assert.deepEqual(await ids(review), ['a-0002']);
    await service.restoreAnnotation({ reviewUri, annotation: annotation('a-0001') });
    assert.deepEqual(await ids(review), ['a-0002', 'a-0001']);
    await service.createAnnotation({ reviewUri, projectRootUri, text: '後続', sourceT: 1 });
    assert.deepEqual(await ids(review), ['a-0002', 'a-0001', 'a-0003']);
}));

test('壊れた review.json への追加・復元は拒否しファイルを保持する', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    await writeFile(review, '{broken');
    await assert.rejects(service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 }));
    await assert.rejects(service.restoreAnnotation({ reviewUri, annotation: annotation('a-0004') }));
    assert.equal(await readFile(review, 'utf8'), '{broken');
    await writeFile(review, '{"version":0,"annotations":{}}');
    await assert.rejects(service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 }));
    assert.equal(await readFile(review, 'utf8'), '{"version":0,"annotations":{}}');
}));

test('version 1 の review.json には追加・復元せず元ファイルを保つ', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    const newer = JSON.stringify({ version: 1, annotations: [annotation('a-0001')] }, null, 2) + '\n';
    await writeFile(review, newer);
    await assert.rejects(
        service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 }),
        /version 1 は新しい形式です/
    );
    await assert.rejects(
        service.restoreAnnotation({ reviewUri, annotation: annotation('a-0002') }),
        /version 1 は新しい形式です/
    );
    assert.equal(await readFile(review, 'utf8'), newer);
}));

test('イベント記録と commit は review.json のロック解放後に行う', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    const calls = [];
    service.recordGateEvent = async () => {
        await assert.rejects(readFile(`${review}.lock`), { code: 'ENOENT' });
        calls.push('event');
        return review;
    };
    service.commitIfOwnRoot = async () => {
        await assert.rejects(readFile(`${review}.lock`), { code: 'ENOENT' });
        calls.push('commit');
        return true;
    };
    const result = await service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 });
    assert.equal(result.committed, true);
    assert.deepEqual(calls, ['event', 'commit']);
}));

test('別セッションが記録した ID をアプリの追加でも再利用しない', async () => fixture(async ({ root, review, service, reviewUri, projectRootUri }) => {
    await mkdir(join(root, 'review/sessions/s-0011'), { recursive: true });
    await writeFile(join(root, 'review/sessions/s-0011/session.json'), JSON.stringify({ compiledAnnotations: ['a-0009'] }));
    const result = await service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 });
    assert.equal(result.annotation.id, 'a-0010');
    assert.deepEqual(await ids(review), ['a-0010']);
}));

test('CLI の 9 件追加、アプリで解決、別セッションの 2 件追加で 11 件を保持する', async () => fixture(async ({ review, service, reviewUri }) => {
    const first = await appendAnnotationsAtomic(review,
        Array.from({ length: 9 }, (_, index) => ({ ...annotation('pending'), id: undefined, text: `初回 ${index + 1}` })));
    assert.equal(first.length, 9);
    // アプリは addressed の注釈を resolved にする。
    const value = JSON.parse(await readFile(review, 'utf8'));
    value.annotations[0].status = 'addressed';
    await save(review, value.annotations);
    await service.resolveAnnotation({ reviewUri, annotationId: 'a-0001' });
    const second = await appendAnnotationsAtomic(review, [annotation('pending'), annotation('pending')]);
    assert.deepEqual(second.map(item => item.id), ['a-0010', 'a-0011']);
    const finalIds = await ids(review);
    assert.equal(finalIds.length, 11);
    assert.equal(new Set(finalIds).size, 11);
}));

test('重複 ID と表示不能な行を残したまま、生 ID の最大値から追加する', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    const rows = [annotation('a-0001'), annotation('a-0001'), annotation('a-0002', 'addressed'), { id: 'a-0012', text: '表示不能' }];
    await save(review, rows);
    const result = await service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 });
    assert.equal(result.annotation.id, 'a-0013');
    const after = JSON.parse(await readFile(review, 'utf8')).annotations;
    assert.deepEqual(after.slice(0, 4), rows);
    assert.equal(after.length, 5);
    await service.resolveAnnotation({ reviewUri, annotationId: 'a-0002' });
    const resolved = JSON.parse(await readFile(review, 'utf8')).annotations;
    assert.equal(resolved.length, 5);
    assert.equal(resolved[2].status, 'resolved');
    assert.deepEqual(resolved.filter(item => item.id === 'a-0001'), rows.slice(0, 2));
}));

test('キャンバス記録の ID より後からアプリで採番する', async () => fixture(async ({ root, review, service, reviewUri, projectRootUri }) => {
    const canvas = join(root, 'review/canvas/c-0001');
    await mkdir(canvas, { recursive: true });
    await writeFile(join(canvas, 'canvas.json'), JSON.stringify({ compiledAnnotations: ['a-0014'] }));
    const result = await service.createAnnotation({ reviewUri, projectRootUri, text: '新規', sourceT: 1 });
    assert.equal(result.annotation.id, 'a-0015');
    assert.deepEqual(await ids(review), ['a-0015']);
}));

test('古い空ロックを回復してアプリで追加する', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    const lock = `${review}.lock`;
    await mkdir(lock);
    const old = new Date(Date.now() - 61_000);
    await utimes(lock, old, old);
    await service.createAnnotation({ reviewUri, projectRootUri, text: '回復', sourceT: 1 });
    assert.deepEqual(await ids(review), ['a-0001']);
    await assert.rejects(readFile(lock), { code: 'ENOENT' });
}));

test('別プロセスの CLI 追記とアプリ追加が競合しても全件・一意 ID を保つ', async () => fixture(async ({ review, service, reviewUri, projectRootUri }) => {
    const cliModule = fileURLToPath(new URL('../../../../../skills/compile-review-session/bin/core/review-store.mjs', import.meta.url));
    const cliScript = 'const {appendAnnotationsAtomic}=await import(process.argv[1]); await appendAnnotationsAtomic(process.argv[2],[{text:process.argv[3]}]);';
    const writes = Array.from({ length: 6 }, (_, index) => [
        execFileAsync(process.execPath, ['--input-type=module', '-e', cliScript, pathToFileURL(cliModule).toString(), review, `CLI ${index}`]),
        service.createAnnotation({ reviewUri, projectRootUri, text: `アプリ ${index}`, sourceT: 1 })
    ]).flat();
    await Promise.all(writes);
    const after = JSON.parse(await readFile(review, 'utf8')).annotations;
    assert.equal(after.length, 12);
    assert.equal(new Set(after.map(item => item.id)).size, 12);
    assert.equal(new Set(after.map(item => item.text)).size, 12);
}));
