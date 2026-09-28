import assert from 'node:assert/strict';
import test from 'node:test';
import uriModule from '@theia/core/lib/common/uri.js';
import { locatePreviewCaptions } from '../lib/browser/akari-preview-captions.js';
const URI = uriModule.default;

test('preview uses the sidecar belonging to the requested timeline', () => {
    const project = new URI('file:///workspace/project');
    const root = project.parent;
    assert.equal(locatePreviewCaptions(project.resolve('edit.json'), root)?.path.base, 'captions.json');
    assert.equal(locatePreviewCaptions(project.resolve('edit.v20.json'), root)?.path.base, 'captions.v20.json');
    assert.equal(locatePreviewCaptions(undefined, root)?.path.base, 'captions.json');
});
