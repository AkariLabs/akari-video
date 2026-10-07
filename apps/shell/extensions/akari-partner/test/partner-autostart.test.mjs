import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAutoStart } from '../lib/common/partner-autostart.js';

const cli = { id: 'cli', agent: 'sample', form: 'cli' };
const web = { id: 'web', agent: 'sample', form: 'web' };
const extension = { id: 'extension', agent: 'sample', form: 'extension' };
const base = { enabled: true, hasWorkspace: true, alreadyRunning: false, catalog: [cli, web, extension] };

for (const [change, reason] of [
    [{ enabled: false }, 'disabled'], [{ hasWorkspace: false }, 'no-workspace'],
    [{ alreadyRunning: true }, 'running'], [{ projectLast: { entryId: null } }, 'closed-by-user'],
    [{}, 'no-history'], [{ projectLast: { entryId: 'removed' }, markerAgent: 'sample' }, 'unknown-entry'],
    [{ projectLast: { entryId: 'extension' } }, 'unknown-entry'], [{ markerAgent: 'missing' }, 'unknown-entry']
]) {
    test(`auto-start skips ${reason}`, () => {
        assert.deepEqual(decideAutoStart({ ...base, ...change }), { action: 'skip', reason });
    });
}

test('project entry wins over app marker', () => {
    assert.deepEqual(decideAutoStart({ ...base, projectLast: { entryId: 'cli' }, markerAgent: 'sample' }),
        { action: 'start', entry: cli });
});

test('app marker chooses web before cli', () => {
    assert.deepEqual(decideAutoStart({ ...base, markerAgent: 'sample' }), { action: 'start', entry: web });
});
