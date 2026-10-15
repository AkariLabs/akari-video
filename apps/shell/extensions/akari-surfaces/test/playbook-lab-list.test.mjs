import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { AkariNewProjectServiceImpl } from '../lib/node/akari-new-project-service.js';

test('installed kit symlink appears as Lab; ordinary local and channel keep their sources', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-playbook-lab-list-'));
    const previous = process.env.AKARI_HOME;
    const home = join(temp, 'home');
    const id = 'lab-one';
    const kitDir = join(home, 'assets', 'store', 'kit-one');
    const source = join(kitDir, 'playbooks', id);
    const link = join(home, 'playbooks', id);
    const local = join(home, 'playbooks', 'local-one');
    const record = name => ({ version: 0, kind: 'akari-playbook', id: name, name,
        playbookVersion: 1, depth: 1, category: 'explainer', steps: [], settings: {}, license: 'CC0-1.0', provenance: {} });
    try {
        process.env.AKARI_HOME = home;
        await Promise.all([source, local, join(home, 'kits')].map(dir => mkdir(dir, { recursive: true })));
        await writeFile(join(source, 'playbook.json'), JSON.stringify(record(id)));
        await writeFile(join(local, 'playbook.json'), JSON.stringify(record('local-one')));
        await symlink(relative(dirname(link), source), link);
        await writeFile(join(home, 'kits', 'installed.json'), JSON.stringify({
            schema: 'akari-installed-kits/v0', kits: [{ id: 'kit-one', kitDir, playbooks: [id] }]
        }));
        const service = new AkariNewProjectServiceImpl();
        assert.deepEqual((await service.listPlaybooks()).map(entry => [entry.playbook.id, entry.source]),
            [[id, 'lab'], ['local-one', 'local']]);
        const homeAlias = join(temp, 'home-alias');
        await symlink(home, homeAlias, 'dir');
        process.env.AKARI_HOME = homeAlias;
        assert.deepEqual((await service.listPlaybooks()).map(entry => [entry.playbook.id, entry.source]),
            [[id, 'lab'], ['local-one', 'local']], 'alternate spelling of AKARI_HOME keeps the Lab source');
        process.env.AKARI_HOME = home;
        await writeFile(join(home, 'kits', 'installed.json'), JSON.stringify({ schema: 'akari-installed-kits/v0', kits: [] }));
        assert.equal((await service.listPlaybooks()).find(entry => entry.playbook.id === id).source, 'local');
        assert.match(await readFile(join(source, 'playbook.json'), 'utf8'), /lab-one/);
    } finally {
        if (previous === undefined) delete process.env.AKARI_HOME;
        else process.env.AKARI_HOME = previous;
        await rm(temp, { recursive: true, force: true });
    }
});
