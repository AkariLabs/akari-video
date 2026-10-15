import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
