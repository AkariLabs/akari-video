import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { timelineCaptionsPath, timelineEditPath, timelineEditPathForCaptions } from '../lib/node/timeline-target.js';

test('node target accepts canonical variants and rejects other basenames and traversal', () => {
    const root = process.cwd();
    const uri = path => pathToFileURL(path).toString();
    assert.equal(timelineEditPath(root), join(root, 'edit.json'));
    assert.equal(timelineEditPath(root, uri(join(root, 'edit.v20.json'))), join(root, 'edit.v20.json'));
    assert.equal(timelineCaptionsPath(join(root, 'edit.v20.json')), join(root, 'captions.v20.json'));
    assert.equal(timelineEditPathForCaptions(join(root, 'captions.v20.json'), root), join(root, 'edit.v20.json'));
    assert.throws(() => timelineEditPathForCaptions(join(root, 'captions.Bad.json'), root));
    for (const bad of [uri(join(root, '..', 'edit.json')), uri(join(root, 'other.json')),
        uri(join(root, 'edit.A.json')), uri(join(root, 'edit..json'))]) {
        assert.throws(() => timelineEditPath(root, bad));
    }
});
