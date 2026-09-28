import assert from 'node:assert/strict';
import test from 'node:test';
import { isTimelineEditFileName, timelineCaptionsFileName, timelineSlugFromEditFileName } from '../lib/common/timeline-files.js';
import { previewCaptionsFileName } from '../../akari-preview/lib/browser/akari-preview-captions.js';

test('preview caption naming matches the timeline filename contract', () => {
    for (const editName of [undefined, 'edit.json', 'edit.v20.json', 'edit.timeline.json', 'edit.a-2.json',
        'other.json', 'edit.A.json', 'edit..json', 'edit.a_.json', 'edit.a--b.json']) {
        const expected = editName && isTimelineEditFileName(editName)
            ? timelineCaptionsFileName(timelineSlugFromEditFileName(editName)) : 'captions.json';
        assert.equal(previewCaptionsFileName(editName), expected, String(editName));
    }
});
