import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariNewProjectServiceImpl } from '../lib/node/akari-new-project-service.js';

const makePlaybook = id => ({ version: 0, kind: 'akari-playbook', id, name: id,
    playbookVersion: 1, depth: 1, category: 'explainer', steps: [], settings: {}, license: 'CC0-1.0', provenance: {} });

test('チャンネルと手元を順に合算し、壊れた作り方を飛ばす', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-playbook-list-'));
    const previous = process.env.AKARI_HOME;
    try {
        process.env.AKARI_HOME = join(temp, 'home');
        const root = join(temp, 'root');
        const channelName = 'スーパー店長チャンネル';
        const channel = join(root, 'channels', channelName, 'playbooks', 'channel-one');
        const local = join(temp, 'home', 'playbooks', 'local-one');
        const broken = join(temp, 'home', 'playbooks', 'broken');
        await Promise.all([channel, local, broken].map(path => mkdir(path, { recursive: true })));
        await writeFile(join(channel, 'playbook.json'), JSON.stringify(makePlaybook('channel-one')));
        await writeFile(join(local, 'playbook.json'), JSON.stringify(makePlaybook('local-one')));
        await writeFile(join(broken, 'playbook.json'), '{');
        const service = new AkariNewProjectServiceImpl();
        let rootLoads = 0;
        service.loadCreatorRootModule = async () => { rootLoads++; return { resolveCreatorRoot: async () => ({ rootDir: root }) }; };
        const entries = await service.listPlaybooks(channelName);
        assert.deepEqual(entries.map(entry => [entry.source, entry.playbook.id]), [['channel', 'channel-one'], ['local', 'local-one']]);
        assert.deepEqual((await service.listPlaybooks('../x')).map(entry => entry.playbook.id), ['local-one']);
        assert.equal(rootLoads, 1, 'path traversal must not resolve the channel root');
        await rm(join(temp, 'home', 'playbooks'), { recursive: true });
        await rm(join(root, 'channels', channelName, 'playbooks'), { recursive: true });
        assert.deepEqual(await service.listPlaybooks(channelName), []);
    } finally {
        if (previous === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previous;
        await rm(temp, { recursive: true, force: true });
    }
});

test('見本は安全な画像だけを data URL で最大 5 枚・各 1MiB 読む', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-playbook-preview-'));
    const previous = process.env.AKARI_HOME;
    try {
        process.env.AKARI_HOME = temp;
        const dir = join(temp, 'playbooks', 'preview-one');
        await mkdir(join(dir, 'preview'), { recursive: true });
        const outside = join(temp, 'outside.png');
        await writeFile(outside, Buffer.from('outside'));
        await symlink(outside, join(dir, 'preview', 'link.png'));
        for (let n = 1; n <= 6; n++) await writeFile(join(dir, 'preview', `${n}.png`), Buffer.from(`frame-${n}`));
        await writeFile(join(dir, 'preview', 'large.png'), Buffer.alloc(1024 * 1024 + 1));
        await writeFile(join(dir, 'preview', 'wrong.svg'), '<svg/>');
        const playbook = { ...makePlaybook('preview-one'), example: true, preview: {
            cover: 'preview/1.png', frames: ['preview/1.png', 'preview/2.png', '../outside.png', '/tmp/outside.png',
                'preview/link.png', 'preview/large.png', 'preview/wrong.svg', 'preview/3.png', 'preview/4.png', 'preview/5.png', 'preview/6.png']
        } };
        await writeFile(join(dir, 'playbook.json'), JSON.stringify(playbook));
        const [entry] = await new AkariNewProjectServiceImpl().listPlaybooks();
        assert.equal(entry.playbook.example, true);
        assert.match(entry.coverUri, /^data:image\/png;base64,/);
        assert.equal(entry.frameUris.length, 5);
        assert.equal(entry.frameUris[0], entry.coverUri);
        assert.ok(entry.frameUris.every(uri => !uri.includes(Buffer.from('outside').toString('base64'))));
        assert.ok(!entry.frameUris.some(uri => uri.includes(Buffer.from('frame-6').toString('base64'))));
    } finally {
        if (previous === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previous;
        await rm(temp, { recursive: true, force: true });
    }
});

test('400KB 超の見本を残し、1MiB 超のコマだけを飛ばして次のコマを表紙にする', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-playbook-preview-limit-'));
    const previous = process.env.AKARI_HOME;
    try {
        process.env.AKARI_HOME = temp;
        const dir = join(temp, 'playbooks', 'preview-one');
        await mkdir(join(dir, 'preview'), { recursive: true });
        await writeFile(join(dir, 'preview', 'large.png'), Buffer.alloc(1024 * 1024 + 1));
        await writeFile(join(dir, 'preview', 'medium.png'), Buffer.alloc(460 * 1024, 1));
        await writeFile(join(dir, 'preview', 'small.png'), Buffer.from('next'));
        await writeFile(join(dir, 'playbook.json'), JSON.stringify({ ...makePlaybook('preview-one'), preview: {
            cover: 'preview/large.png', frames: ['preview/large.png', 'preview/medium.png', 'preview/small.png']
        } }));
        const [entry] = await new AkariNewProjectServiceImpl().listPlaybooks();
        assert.equal(entry.frameUris.length, 2);
        assert.equal(entry.coverUri, entry.frameUris[0]);
        assert.ok(entry.frameUris[0].length > 400 * 1024);
        assert.match(entry.frameUris[1], new RegExp(Buffer.from('next').toString('base64')));
    } finally {
        if (previous === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previous;
        await rm(temp, { recursive: true, force: true });
    }
});
