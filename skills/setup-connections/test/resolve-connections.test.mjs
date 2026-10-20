import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
    DEFAULT_CONNECTIONS_REGISTRY,
    createCreatorRoot
} from '../../../packages/creator-root/src/index.mjs';
import { withScratchRoot } from '../../../packages/creator-root/test/helpers.mjs';
import {
    ConnectionsResolutionError,
    resolveConnections
} from '../bin/resolve-connections.mjs';

const PROJECT_STUB = {
    providers: [],
    policy: { currency: 'JPY', monthly_budget: null, approval_threshold: null },
    memory: []
};

test('resolveConnections: 作業場も project 上書きも無ければ同梱既定を使う', async () => {
    await withScratchRoot(async (scratch) => {
        const projectRoot = join(scratch, 'standalone-project');
        await writeRegistry(projectRoot, PROJECT_STUB);

        const resolved = await resolveConnections({ projectRoot, env: isolatedEnv(scratch) });

        assert.deepEqual(resolved.effective, DEFAULT_CONNECTIONS_REGISTRY);
        assert.equal(resolved.layers.workspace, null);
        assert.equal(resolved.sources.providers.groq, 'default');
    });
});

test('resolveConnections: project 上書きが無ければ作業場レジストリを使う', async () => {
    await withScratchRoot(async (scratch) => {
        const workspaceRoot = join(scratch, 'AkariVideo');
        await createCreatorRoot(workspaceRoot);
        const workspaceRegistry = clone(DEFAULT_CONNECTIONS_REGISTRY);
        workspaceRegistry.providers[0] = {
            ...workspaceRegistry.providers[0],
            notes: {
                ...workspaceRegistry.providers[0].notes,
                description: 'workspace で管理する Codex Image'
            }
        };
        await writeJson(join(workspaceRoot, '.akari', 'connections.json'), workspaceRegistry);
        const projectRoot = join(workspaceRoot, 'channels', 'my-channel', 'videos', 'project-a');
        await mkdir(projectRoot, { recursive: true });

        const resolved = await resolveConnections({ projectRoot, env: isolatedEnv(scratch) });

        assert.deepEqual(resolved.effective, workspaceRegistry);
        assert.equal(resolved.layers.workspace.rootDir, workspaceRoot);
        assert.equal(resolved.sources.providers['codex-image'], 'workspace');
    });
});

test('resolveConnections: project の provider が勝ち、null の予算は作業場を継承する', async () => {
    await withScratchRoot(async (scratch) => {
        const workspaceRoot = join(scratch, 'AkariVideo');
        await createCreatorRoot(workspaceRoot);
        const workspaceRegistry = clone(DEFAULT_CONNECTIONS_REGISTRY);
        const groqIndex = workspaceRegistry.providers.findIndex((provider) => provider.id === 'groq');
        workspaceRegistry.providers[groqIndex] = providerWithModel(
            workspaceRegistry.providers[groqIndex],
            'whisper-large-v3'
        );
        workspaceRegistry.policy.monthly_budget = 12_000;
        await writeJson(join(workspaceRoot, '.akari', 'connections.json'), workspaceRegistry);

        const projectRoot = join(workspaceRoot, 'channels', 'my-channel', 'videos', 'project-b');
        const projectGroq = providerWithModel(
            workspaceRegistry.providers[groqIndex],
            'whisper-large-v3-turbo'
        );
        await writeRegistry(projectRoot, {
            ...PROJECT_STUB,
            providers: [projectGroq]
        });

        const resolved = await resolveConnections({ projectRoot, env: isolatedEnv(scratch) });
        const effectiveGroq = resolved.effective.providers.find((provider) => provider.id === 'groq');

        assert.equal(effectiveGroq.models.default, 'whisper-large-v3-turbo');
        assert.equal(resolved.sources.providers.groq, 'project');
        assert.equal(resolved.effective.policy.monthly_budget, 12_000);
        assert.equal(resolved.sources.policy.monthly_budget, 'workspace');
    });
});

test('resolveConnections: 壊れた JSON は判別可能なエラーにする', async () => {
    await withScratchRoot(async (scratch) => {
        const projectRoot = join(scratch, 'broken-json');
        await mkdir(join(projectRoot, '.akari'), { recursive: true });
        await writeFile(join(projectRoot, '.akari', 'connections.json'), '{ broken', 'utf8');

        await assert.rejects(
            resolveConnections({ projectRoot, env: isolatedEnv(scratch) }),
            (error) => error instanceof ConnectionsResolutionError
                && error.code === 'CONNECTIONS_INVALID_JSON'
        );
    });
});

test('resolveConnections: schema 外の auth は語彙外エラーにする', async () => {
    await withScratchRoot(async (scratch) => {
        const projectRoot = join(scratch, 'invalid-vocabulary');
        const invalidProvider = {
            ...clone(DEFAULT_CONNECTIONS_REGISTRY.providers[0]),
            auth: 'api-token'
        };
        await writeRegistry(projectRoot, {
            ...PROJECT_STUB,
            providers: [invalidProvider]
        });

        await assert.rejects(
            resolveConnections({ projectRoot, env: isolatedEnv(scratch) }),
            (error) => error instanceof ConnectionsResolutionError
                && error.code === 'CONNECTIONS_INVALID_VOCABULARY'
        );
    });
});

function providerWithModel(provider, model) {
    return {
        ...clone(provider),
        models: {
            default: model,
            allowed: ['whisper-large-v3-turbo', 'whisper-large-v3']
        }
    };
}

function isolatedEnv(scratch) {
    return { AKARI_HOME: join(scratch, 'machine-state') };
}

async function writeRegistry(projectRoot, registry) {
    await writeJson(join(projectRoot, '.akari', 'connections.json'), registry);
}

async function writeJson(filePath, value) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
