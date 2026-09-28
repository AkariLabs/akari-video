import test from 'node:test';
import assert from 'node:assert/strict';
import { isTimelineEditFileName } from '../lib/common/timeline-edit-file-name.js';

test('isTimelineEditFileName accepts timeline edit file names', () => {
    for (const name of ['edit.json', 'edit.v20.json', 'edit.my-cut.json']) {
        assert.equal(isTimelineEditFileName(name), true, name);
    }
});

test('isTimelineEditFileName rejects other names and paths', () => {
    for (const name of [
        'edit.A.json', 'edit..json', 'other.json', '../edit.json',
        'edit.-a.json', 'edit.a-.json', 'captions.json'
    ]) {
        assert.equal(isTimelineEditFileName(name), false, name);
    }
});
