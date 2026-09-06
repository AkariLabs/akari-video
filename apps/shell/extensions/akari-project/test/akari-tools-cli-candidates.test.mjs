import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mediaCliCandidates, captionsCliCandidates } from '../lib/common/akari-tools-cli-candidates.js';

const DIRNAME = '/Applications/AKARI Video.app/Contents/Resources/app.asar/node_modules/akari-project/lib/node';
const RESOURCES_PATH = '/Applications/AKARI Video.app/Contents/Resources';

for (const [tool, candidatesFor] of [['media', mediaCliCandidates], ['captions', captionsCliCandidates]]) {
    test(`${tool}: 同梱版の候補を開発時の全候補より先に探索する`, () => {
        const development = candidatesFor(DIRNAME, '/repo/apps/shell');
        assert.equal(development.length, 4);
        assert.ok(development.includes(resolve(`/repo/packages/akari-tools/bin/${tool}.mjs`)));
        assert.deepEqual(candidatesFor(DIRNAME, '/repo/apps/shell', RESOURCES_PATH), [
            resolve(RESOURCES_PATH, `packages/akari-tools/bin/${tool}.mjs`), ...development
        ]);
    });
}
