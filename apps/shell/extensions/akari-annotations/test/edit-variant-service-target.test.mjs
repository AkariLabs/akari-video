import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

class DirectWriteService extends AkariAnnotationsServiceImpl {
    async writeProjectFileGuarded(file, source) { await writeFile(file, source); }
}

test('applyNarrations writes only the selected variant and rejects invalid edit URIs', async () => {
    const base = await mkdtemp(join(tmpdir(), 'akari-variant-service-'));
    try {
        const project = join(base, 'project');
        const outside = join(base, 'outside');
        await mkdir(join(project, 'out', 'narration'), { recursive: true });
        await mkdir(outside);
        const canonical = join(project, 'edit.json');
        const variant = join(project, 'edit.v20.json');
        const canonicalBytes = '{"version":2,"tracks":[],"audio":{"narration":[]}}\n';
        const variantBytes = '{"version":2,"tracks":[],"audio":{"narration":[]},"variant":"v20"}\n';
        await writeFile(canonical, canonicalBytes);
        await writeFile(variant, variantBytes);
        await writeFile(join(project, 'other.json'), canonicalBytes);
        await writeFile(join(outside, 'edit.json'), canonicalBytes);
        await writeFile(join(project, 'out', 'narration', 'n-0001.wav'), 'RIFF');
        const service = new DirectWriteService();
        const request = { projectRootUri: pathToFileURL(project).href,
            items: [{ path: 'out/narration/n-0001.wav', t: 0, script: 'test', reading: 'test' }] };
        await service.applyNarrations({ ...request, editUri: pathToFileURL(variant).href });
        assert.equal(await readFile(canonical, 'utf8'), canonicalBytes);
        const changed = await readFile(variant, 'utf8');
        assert.notEqual(changed, variantBytes);
        assert.equal(JSON.parse(changed).audio.narration[0].id, 'n-0001');
        for (const invalid of [join(project, 'other.json'), join(outside, 'edit.json')]) {
            await assert.rejects(service.applyNarrations({ ...request, editUri: pathToFileURL(invalid).href }));
            assert.equal(await readFile(canonical, 'utf8'), canonicalBytes);
            assert.equal(await readFile(variant, 'utf8'), changed);
        }
    } finally { await rm(base, { recursive: true, force: true }); }
});
