import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setLanguage } from '@akari-video/i18n';
import { AkariNewProjectServiceImpl } from '../lib/node/akari-new-project-service.js';

test('applyPlaybook があれば呼び、無ければ二つの文書とレポート注記を写す', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-playbook-create-'));
    setLanguage('ja');
    try {
        const source = join(temp, 'source');
        await mkdir(source);
        await writeFile(join(source, 'playbook.md'), '# Example\n');
        await writeFile(join(source, 'playbook.json'), '{"kind":"akari-playbook"}\n');
        for (const hasApply of [true, false]) {
            const destination = join(temp, hasApply ? 'with-apply' : 'fallback');
            const calls = [];
            const service = new AkariNewProjectServiceImpl();
            service.createProject = async uri => {
                calls.push(['create', uri]);
                await mkdir(join(destination, 'planning'), { recursive: true });
                await mkdir(join(destination, '.akari', 'reports'), { recursive: true });
                await writeFile(join(destination, '.akari', 'reports', 'create-project-report.html'), '<html><body></body></html>');
            };
            service.loadScaffoldModule = async () => hasApply
                ? { applyPlaybook: async options => calls.push(['apply', options]) } : {};
            await service.createProjectFromPlaybook(pathToFileURL(destination).toString(), source);
            assert.equal(calls[0][0], 'create');
            if (hasApply) assert.deepEqual(calls[1], ['apply', { projectDir: destination, playbookDir: source }]);
            else {
                assert.equal(await readFile(join(destination, 'planning', 'playbook.md'), 'utf8'), '# Example\n');
                assert.equal(await readFile(join(destination, 'planning', 'playbook.json'), 'utf8'), '{"kind":"akari-playbook"}\n');
                assert.match(await readFile(join(destination, '.akari', 'reports', 'create-project-report.html'), 'utf8'), /仮枠は後で/);
            }
        }
    } finally {
        setLanguage(undefined);
        await rm(temp, { recursive: true, force: true });
    }
});
