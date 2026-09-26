import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { shouldShowProjectPath } from '../lib/common/project-tree-policy.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const adapters = ['.agents', '.codex', '.cursor', '.opencode', '.devin'];

function stringArray(source, pattern) {
    const match = source.match(pattern);
    assert.ok(match);
    return [...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]);
}

test('3 か所の fallback hidden がスキルリンク置き場を含み、既存 workflow は和集合で読み込む', async () => {
    const files = [
        'apps/shell/extensions/akari-project/src/browser/akari-workflow-service.ts',
        'apps/shell/extensions/akari-project/src/node/akari-project-service.ts',
        'packages/project-scaffold/src/index.mjs'
    ];
    for (const file of files) {
        const source = await readFile(resolve(repo, file), 'utf8');
        const hidden = stringArray(source, /hidden: \[([^\]]+)\]/);
        for (const adapter of adapters) { assert.ok(hidden.includes(adapter), `${file}: ${adapter}`); }
    }
    const workflow = await readFile(resolve(repo, files[0]), 'utf8');
    const scaffold = await readFile(resolve(repo, files[2]), 'utf8');
    assert.deepEqual(stringArray(workflow, /SKILL_ADAPTER_HIDDEN = \[([^\]]+)\]/),
        stringArray(scaffold, /SKILL_ADAPTER_DIRECTORIES = \[([^\]]+)\]/));
    assert.match(workflow, /hidden: withSkillAdapterHidden\(parsed\.tree\?\.hidden \?\? DEFAULT_WORKFLOW\.tree\.hidden\)/);
    assert.match(workflow, /new Set\(\[\.\.\.hidden, \.\.\.SKILL_ADAPTER_HIDDEN\]\)/);
    const loadedPolicy = { hidden: ['keep-hidden', ...adapters], sidecarSuffixes: [] };
    assert.equal(shouldShowProjectPath('.devin/skills/example', loadedPolicy, false), false);
    assert.equal(shouldShowProjectPath('.devin/skills/example', loadedPolicy, true), true);
    assert.equal(shouldShowProjectPath('keep-hidden/file', loadedPolicy, false), false);
});
