import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readInternalEdit } from '@akari-video/edit-store';
import { expandBagOverlays } from '../lib/common/preview-parts.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, '../../../../../packages/render-cut/test/fixtures/object-tree-html-bag');

test('shell preview bridge uses the shared object-tree projection without duplicating it', () => {
    const internal = readInternalEdit(readFileSync(join(fixtureRoot, 'edit.json'), 'utf8'));
    const overlays = expandBagOverlays(internal, reference =>
        reference.trimStart().startsWith('<')
            ? reference
            : readFileSync(join(fixtureRoot, reference), 'utf8'));

    assert.deepEqual(overlays.map(overlay => overlay.id), [
        's01#A', 's01.B', 'g1.first', 'g1.second', 'plain', 's01.C'
    ]);
    assert.equal(overlays.filter(overlay => overlay.part).length, 3);
    assert.equal(overlays.find(overlay => overlay.id === 's01.B').transform.y, -40);
});
