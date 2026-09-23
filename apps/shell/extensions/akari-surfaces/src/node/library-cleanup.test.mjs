import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectLabCleanupTargets } = require('../../lib/node/library-cleanup.js');

test('片づけ候補は確認済みの Lab ディレクトリだけで、置き場の外を除く', () => {
    const root = path.join(path.sep, 'tmp', 'akari-test-library');
    const candidate = (sourceKind, name, actualDir = path.join(root, name)) => ({
        sourceKind, libraryDir: path.join(root, name), actualDir
    });
    const lab = candidate('lab', 'audio/lab');
    const site = candidate('site', 'audio/site');
    const own = candidate('own', 'audio/own');
    const outside = candidate('lab', 'audio/outside', path.join(path.sep, 'tmp', 'outside'));
    const rootItself = candidate('lab', 'audio/root', root);
    const unconfirmed = candidate('lab', 'audio/unconfirmed');
    const confirmed = [lab, site, own, outside, rootItself].map(item => item.libraryDir);
    assert.deepEqual(selectLabCleanupTargets([lab, site, own, outside, rootItself, unconfirmed, lab], [root], confirmed), [lab.actualDir]);
});
