import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AkariOnboardingServiceImpl } from '../../lib/node/onboarding-service.js';
import { splitOnboardingTokens } from '../../lib/onboarding/model.js';
import { readEditV2 } from '../../../../../../packages/edit-store/lib/edit-v2.js';

const sample = join(dirname(fileURLToPath(import.meta.url)), '../../../../resources/onboarding-sample/talkinghead-desk-ja-01');

test('完成した見本の edit.json は厳格な v2 reader で読める', async t => {
    const root = await mkdtemp(join(process.env.AKARI_TEST_SCRATCH || tmpdir(), 'akari-demo-v2-read-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, '.akari'), { recursive: true });
    await copyFile(join(sample, 'clip.mp4'), join(root, 'assets', 'サンプル動画.mp4'));
    await writeFile(join(root, 'edit.json'), '{}');
    const uri = pathToFileURL(root).toString();
    const service = new AkariOnboardingServiceImpl();
    service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true, exampleActive: true });
    const transcript = JSON.parse(await readFile(join(sample, 'transcript.json'), 'utf8'));
    const segments = splitOnboardingTokens(transcript.tokens.items);
    await service.writeExample(uri, join(sample, 'clip.mp4'), segments, segments.length, true, { stage: 8 });
    const edit = readEditV2(await readFile(join(root, 'edit.json'), 'utf8'));
    const phone = edit.tracks.flatMap(track => 'items' in track ? track.items : [])
        .find(item => item.id === 'demo-phone-screen');
    assert.equal(phone?.captions, 'off');
});
