import assert from 'node:assert/strict';
import test from 'node:test';
import uriModule from '@theia/core/lib/common/uri.js';
import { currentTimelineCaptionsUri, currentTimelineEditUri, editUriForVisibleTimeline,
    onActiveTimelineEditUriChange, setActiveTimelineEditUri } from '../lib/browser/active-timeline.js';
const URI = uriModule.default;

test('active timeline follows tab changes and falls back to edit.json', () => {
    const root = new URI('file:///project');
    try {
        assert.equal(currentTimelineEditUri(root).path.base, 'edit.json');
        setActiveTimelineEditUri(root.resolve('edit.v20.json'));
        assert.equal(currentTimelineEditUri(root).path.base, 'edit.v20.json');
        assert.equal(currentTimelineCaptionsUri(root).path.base, 'captions.v20.json');
        setActiveTimelineEditUri(root.resolve('edit.json'));
        assert.equal(currentTimelineCaptionsUri(root).path.base, 'captions.json');
        setActiveTimelineEditUri(new URI('file:///elsewhere/edit.v20.json'));
        assert.equal(currentTimelineEditUri(root).path.base, 'edit.json');
    } finally {
        setActiveTimelineEditUri(undefined);
    }
});

test('active timeline change fires once per URI change and stops after dispose', () => {
    const root = new URI('file:///project');
    const events = [];
    setActiveTimelineEditUri(undefined);
    const subscription = onActiveTimelineEditUriChange(uri => events.push(uri?.path.base));
    try {
        setActiveTimelineEditUri(root.resolve('edit.json'));
        setActiveTimelineEditUri(new URI(root.resolve('edit.json').toString()));
        setActiveTimelineEditUri(root.resolve('edit.v20.json'));
        assert.deepEqual(events, ['edit.json', 'edit.v20.json']);
        subscription.dispose();
        setActiveTimelineEditUri(root.resolve('edit.json'));
        assert.deepEqual(events, ['edit.json', 'edit.v20.json']);
    } finally {
        subscription.dispose();
        setActiveTimelineEditUri(undefined);
    }
});

test('only a visible configured timeline contributes an edit URI', () => {
    const editUri = new URI('file:///project/edit.v20.json');
    for (const [visible, location, expected] of [
        [false, { editUri }, undefined],
        [true, undefined, undefined],
        [true, { editUri }, editUri]
    ]) {
        assert.equal(editUriForVisibleTimeline({ isVisible: visible, timelineLocation: location }), expected);
    }
});
