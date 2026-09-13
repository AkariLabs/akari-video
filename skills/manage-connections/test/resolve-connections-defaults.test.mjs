import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
    DEFAULT_CONNECTIONS_REGISTRY,
    createCreatorRoot
} from '../../../packages/creator-root/src/index.mjs';
import { withScratchRoot } from '../../../packages/creator-root/test/helpers.mjs';
import { resolveConnections } from '../bin/resolve-connections.mjs';

const cases = [
    {
        name: '既定のみ',
        workspaceDefaults: null,
        projectDefaults: null,
        expected: { still: 'codex:image', video: 'fal:h3-i2v' }
    },
    {
        name: 'workspace が video だけ上書き',
        workspaceDefaults: { generate: { video: 'workspace:video' } },
        projectDefaults: null,
        expected: { still: 'codex:image', video: 'workspace:video' }
    },
    {
        name: 'project が still だけ上書き',
        workspaceDefaults: { generate: { video: 'workspace:video' } },
        projectDefaults: { generate: { still: 'project:still' } },
        expected: { still: 'project:still', video: 'workspace:video' }
    },
    {
        name: '不正値と未知キーは無視して既定を維持',
        workspaceDefaults: { generate: { still: 123, video: '', foo: 'unknown:model' } },
        projectDefaults: { generate: { still: null, video: '   ', foo: 'other:model' } },
        expected: { still: 'codex:image', video: 'fal:h3-i2v' }
    }
];

for (const fixture of cases) {
    test(`resolveConnections defaults: ${fixture.name}`, async () => {
        await withScratchRoot(async (scratch) => {
            let projectRoot;
            if (fixture.workspaceDefaults) {
                const workspaceRoot = join(scratch, 'AkariVideo');
                await createCreatorRoot(workspaceRoot);
                const workspaceRegistry = clone(DEFAULT_CONNECTIONS_REGISTRY);
                workspaceRegistry.defaults = fixture.workspaceDefaults;
                await writeJson(join(workspaceRoot, '.akari', 'connections.json'), workspaceRegistry);
                projectRoot = join(workspaceRoot, 'channels', 'my-channel', 'videos', 'project');
            } else {
                projectRoot = join(scratch, 'standalone-project');
            }
            await writeJson(join(projectRoot, '.akari', 'connections.json'), {
                providers: [],
                ...(fixture.projectDefaults ? { defaults: fixture.projectDefaults } : {}),
                policy: { currency: 'JPY', monthly_budget: null, approval_threshold: null },
                memory: []
            });

            const resolved = await resolveConnections({
                projectRoot,
                env: { AKARI_HOME: join(scratch, 'machine-state') }
            });

            assert.deepEqual(resolved.effective.defaults.generate, fixture.expected);
        });
    });
}

async function writeJson(filePath, value) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
