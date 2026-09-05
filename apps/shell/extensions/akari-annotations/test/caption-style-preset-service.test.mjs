import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const run = promisify(execFile);
const uri = value => pathToFileURL(value).toString();
const caption = id => ({
    id, start: 0, end: 1, text: id, speaker: null, sourceRef: null, edited: false,
    words: [{ text: id, start: 0, end: 1 }], text_style: { color: '#abcdef' }
});

class TrackingService extends AkariAnnotationsServiceImpl {
    writeCount = 0;
    async writeProjectFileGuarded(...args) {
        this.writeCount++;
        return super.writeProjectFileGuarded(...args);
    }
}

async function fixture({ git = false } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'caption-style-preset-service-'));
    const captionsPath = join(root, 'captions.json');
    await writeFile(captionsPath, `${JSON.stringify([caption('c-1'), caption('c-2'), caption('c-3')], null, 2)}\n`);
    await writeFile(join(root, 'edit.json'), `${JSON.stringify({
        version: 1, fps: 30, source: 'base.mp4', cuts: [], overlays: [], audio: { sfx: [], narration: [] }
    }, null, 2)}\n`);
    if (git) {
        await run('git', ['init'], { cwd: root });
        await run('git', ['add', 'captions.json', 'edit.json'], { cwd: root });
        await run('git', [
            '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost',
            'commit', '-m', 'initial fixture'
        ], { cwd: root });
    }
    return {
        root,
        captionsPath,
        request: { captionsUri: uri(captionsPath), projectRootUri: uri(root) }
    };
}

const commitCount = async root => Number((await run('git', [
    'rev-list', '--count', 'HEAD'
], { cwd: root })).stdout.trim());

test('1 RPC で N 行を書き換え、自前 git ルートで commit が 1 増える', async () => {
    const data = await fixture({ git: true });
    try {
        const beforeCommits = await commitCount(data.root);
        const beforeSource = await readFile(data.captionsPath, 'utf8');
        const result = await new AkariAnnotationsServiceImpl().setCaptionStylePreset({
            ...data.request, captionIds: ['c-1', 'c-3'], presetId: 'subtitle-news'
        });
        const rows = JSON.parse(await readFile(data.captionsPath, 'utf8'));
        assert.deepEqual(result, { committed: true, changed: 2, beforeSource });
        assert.equal((await commitCount(data.root)) - beforeCommits, 1);
        assert.equal(rows[0].style_preset, 'subtitle-news');
        assert.equal(rows[1].style_preset, undefined);
        assert.equal(rows[2].style_preset, 'subtitle-news');
    } finally {
        await rm(data.root, { recursive: true, force: true });
    }
});

test('同じ値の再適用は書き込みも commit も行わない', async () => {
    const data = await fixture({ git: true });
    try {
        const first = new AkariAnnotationsServiceImpl();
        await first.setCaptionStylePreset({
            ...data.request, captionIds: ['c-1', 'c-2'], presetId: 'subtitle-news'
        });
        const source = await readFile(data.captionsPath, 'utf8');
        const beforeCommits = await commitCount(data.root);
        const service = new TrackingService();
        const result = await service.setCaptionStylePreset({
            ...data.request, captionIds: ['c-1', 'c-2'], presetId: 'subtitle-news'
        });
        assert.deepEqual(result, { committed: false, changed: 0, beforeSource: source });
        assert.equal(service.writeCount, 0);
        assert.equal(await readFile(data.captionsPath, 'utf8'), source);
        assert.equal((await commitCount(data.root)) - beforeCommits, 0);
    } finally {
        await rm(data.root, { recursive: true, force: true });
    }
});

test('git ルートでない project は committed false でも書き込みに成功する', async () => {
    const data = await fixture();
    try {
        const result = await new AkariAnnotationsServiceImpl().setCaptionStylePreset({
            ...data.request, captionIds: ['c-2'], presetId: 'subtitle-variety'
        });
        assert.equal(result.committed, false);
        assert.equal(result.changed, 1);
        assert.equal(JSON.parse(await readFile(data.captionsPath, 'utf8'))[1].style_preset, 'subtitle-variety');
    } finally {
        await rm(data.root, { recursive: true, force: true });
    }
});
