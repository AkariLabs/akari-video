import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariOnboardingServiceImpl } from '../../lib/node/onboarding-service.js';
import { createEmptyOnboardingEdit, createOnboardingEdit, createOnboardingCaptions } from '../../lib/onboarding/model.js';

const sampleName = 'サンプル動画.mp4';
const segments = [{ start: 0, end: 1, text: 'こんにちは' }];
const exists = path => stat(path).then(() => true, () => false);

async function fixture(t) {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-tour-reset-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'project');
    const source = join(root, 'library', 'clip.mp4');
    const copied = join(project, 'assets', sampleName);
    const sidecar = join(project, '.akari', 'sidecars', `assets/${sampleName}.analysis`);
    await Promise.all([mkdir(join(project, 'assets'), { recursive: true }),
        mkdir(join(root, 'library'), { recursive: true }), mkdir(sidecar, { recursive: true })]);
    await writeFile(source, 'bundled sample');
    await writeFile(copied, 'bundled sample');
    await writeFile(join(sidecar, 'analysis.json'), '{}');
    await writeFile(join(project, 'edit.json'), `${JSON.stringify(createOnboardingEdit(`assets/${sampleName}`, true), null, 2)}\n`);
    await writeFile(join(project, 'captions.json'), `${JSON.stringify(createOnboardingCaptions(segments, 1, true), null, 2)}\n`);
    const projectUri = pathToFileURL(project).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'tour3', sub: 1, projectUri, exampleActive: true });
    return { project, projectUri, source, copied, sidecar, service };
}

for (const [name, editText] of [
    ['CRLF', () => JSON.stringify(createOnboardingEdit(`assets/${sampleName}`, true), null, 2).replaceAll('\n', '\r\n') + '\r\n'],
    ['インデント', () => JSON.stringify(createOnboardingEdit(`assets/${sampleName}`, true), null, 4) + '\n'],
    ['キー追加', () => JSON.stringify({ ...createOnboardingEdit(`assets/${sampleName}`, true), extra: 'saved by UI' }) + '\n']
]) {
    test(`作例の edit.json が ${name} でも空の編集へ戻せる`, async t => {
        const setup = await fixture(t);
        await writeFile(join(setup.project, 'edit.json'), editText());
        await setup.service.resetTourExample(setup.projectUri, setup.source, segments);
        assert.deepEqual(JSON.parse(await readFile(join(setup.project, 'edit.json'), 'utf8')), createEmptyOnboardingEdit());
        assert.equal(await exists(join(setup.project, 'captions.json')), false);
        assert.equal(await exists(setup.copied), false);
    });
}

test('captions.json が既に無くても空の編集へ戻せる', async t => {
    const setup = await fixture(t);
    await rm(join(setup.project, 'captions.json'));
    await setup.service.resetTourExample(setup.projectUri, setup.source, segments);
    assert.deepEqual(JSON.parse(await readFile(join(setup.project, 'edit.json'), 'utf8')), createEmptyOnboardingEdit());
    assert.equal(await exists(setup.copied), false);
});

test('captions.json の改行コード・インデント・追加キーが違っても片付けられる', async t => {
    const setup = await fixture(t);
    const captions = { ...createOnboardingCaptions(segments, 1, true), extra: 'saved by UI' };
    await writeFile(join(setup.project, 'captions.json'), `${JSON.stringify(captions, null, 4).replaceAll('\n', '\r\n')}\r\n`);
    await setup.service.resetTourExample(setup.projectUri, setup.source, segments);
    assert.deepEqual(JSON.parse(await readFile(join(setup.project, 'edit.json'), 'utf8')), createEmptyOnboardingEdit());
    assert.equal(await exists(join(setup.project, 'captions.json')), false);
});

test('変更されたサンプルのコピーと sidecar は残して片付けを完了する', async t => {
    const setup = await fixture(t);
    await writeFile(setup.copied, 'owner changed this file');
    await setup.service.resetTourExample(setup.projectUri, setup.source, segments);
    assert.deepEqual(JSON.parse(await readFile(join(setup.project, 'edit.json'), 'utf8')), createEmptyOnboardingEdit());
    assert.equal(await exists(join(setup.project, 'captions.json')), false);
    assert.equal(await readFile(setup.copied, 'utf8'), 'owner changed this file');
    assert.equal(await exists(setup.sidecar), true);
});

test('ガイド状態が違うプロジェクトの編集は変えない', async t => {
    const setup = await fixture(t);
    const before = await readFile(join(setup.project, 'edit.json'), 'utf8');
    setup.service.load = async () => ({ schema: 1, step: 'tour3', sub: 1, projectUri: 'file:///other', exampleActive: true });
    await assert.rejects(setup.service.resetTourExample(setup.projectUri, setup.source, segments), /完成例の状態が違います/);
    assert.equal(await readFile(join(setup.project, 'edit.json'), 'utf8'), before);
});

test('ようこそ画像が無くても空の画像として続ける', async t => {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-welcome-missing-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new AkariOnboardingServiceImpl();
    service.welcomeImageCandidates = () => [join(root, 'missing.webp')];
    assert.equal(await service.heroDataUrl(), '');
});
