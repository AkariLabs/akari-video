import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const start = compiled.indexOf('queueCaptionsUpdate(widget) {');
const end = compiled.indexOf('previewModelSnapshot(', start);
assert.ok(start >= 0 && end > start);
const cue = { id: 'c1', start: 0, end: 1, text: 'Added later' };

function setup(captions, captionTrackId) {
    const errors = [];
    const host = vm.runInNewContext('({' + compiled.slice(start, end).trim() + '})', {
        exports: { normalizePreviewCaptionClock: values => values },
        edit_summary_fields_1: { buildCaptionAnimatorSummaryFields: values => values },
        console: { error: (...args) => errors.push(args) }
    });
    host.loadPreviewCaptions = async () => ({ captions });
    host.previewCaptionTimelineSegments = () => [];
    const messages = [];
    const refreshes = [];
    const widget = {
        akariPreviewEditUri: { path: 'edit.json' },
        akariPreviewSummary: { captionTrackId },
        sendMessage: message => messages.push(message)
    };
    host.queueRefresh = (...args) => {
        refreshes.push(args);
        widget.akariPreviewRefresh = Promise.resolve().then(() => {
            widget.akariPreviewSummary = {
                hasCaptions: true,
                timelineTracks: [{ id: 't-captions-implied' }],
                captionTrackId: 't-captions-implied'
            };
        });
    };
    return { host, widget, messages, refreshes, errors };
}

for (const missingId of [undefined, '']) {
    test(`cues arriving without a caption track (${JSON.stringify(missingId)}) refresh the model once`, async () => {
        const { host, widget, messages, refreshes, errors } = setup([cue], missingId);
        host.queueCaptionsUpdate(widget);
        await widget.akariPreviewCaptionsUpdate;
        await widget.akariPreviewRefresh;
        assert.equal(refreshes.length, 1);
        assert.deepEqual(refreshes[0], [widget, widget.akariPreviewEditUri, 'output']);
        assert.equal(messages.length, 0, 'the first cue needs the full model instead of a captions-only message');
        assert.equal(widget.akariPreviewSummary.captionTrackId, 't-captions-implied');

        host.queueCaptionsUpdate(widget);
        await widget.akariPreviewCaptionsUpdate;
        assert.equal(refreshes.length, 1, 'ordinary subsequent caption edits must not refresh');
        assert.equal(messages[0].type, 'akari-preview-captions-update');
        assert.deepEqual(messages[0].captions, [cue]);
        assert.deepEqual(errors, []);
    });
}

test('notifications during the presence refresh wait for its summary and do not trigger a refresh loop', async () => {
    const { host, widget, messages, refreshes, errors } = setup([cue]);
    let finishRefresh;
    const ready = new Promise(resolve => { finishRefresh = resolve; });
    host.queueRefresh = (...args) => {
        refreshes.push(args);
        widget.akariPreviewRefresh = ready.then(() => {
            widget.akariPreviewSummary = { captionTrackId: 't-captions-implied' };
            host.queueCaptionsUpdate(widget); // A change notification emitted during refresh.
        });
    };
    host.queueCaptionsUpdate(widget);
    await widget.akariPreviewCaptionsUpdate;
    host.queueCaptionsUpdate(widget);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshes.length, 1);
    assert.equal(messages.length, 0);
    finishRefresh();
    await widget.akariPreviewRefresh;
    await widget.akariPreviewCaptionsUpdate;
    assert.equal(refreshes.length, 1);
    assert.equal(messages.length, 2);
    assert.deepEqual(errors, []);
});

test('empty captions, existing caption tracks, raw previews and disposed widgets do not refresh', async () => {
    for (const { captions, id, raw, disposed } of [
        { captions: [] },
        { captions: [cue], id: 't2' },
        { captions: [cue], id: 't-captions-implied' },
        { captions: [cue], raw: true },
        { captions: [cue], disposed: true }
    ]) {
        const { host, widget, messages, refreshes, errors } = setup(captions, id);
        if (raw) delete widget.akariPreviewEditUri;
        widget.isDisposed = disposed;
        host.queueCaptionsUpdate(widget);
        await widget.akariPreviewCaptionsUpdate;
        assert.equal(refreshes.length, 0);
        assert.equal(messages.length, disposed ? 0 : 1);
        assert.deepEqual(errors, []);
    }
});

test('caption plate uses auto for missing tracks and preserves the shared z-order for string track IDs', () => {
    const blockStart = compiled.indexOf('const applyOverlayTracks = () => {');
    const blockEnd = compiled.indexOf('\n            };', blockStart);
    assert.ok(blockStart >= 0 && blockEnd > blockStart);
    const apply = vm.runInNewContext(`(summary, captionPlate, zForTrack) => {
        const stage = { querySelectorAll: () => [] };
        ${compiled.slice(blockStart, blockEnd + '\n            };'.length)}
        applyOverlayTracks();
    }`);
    for (const tracks of [
        [{ id: 't2' }, { id: 't-overlay' }, { id: 't-captions-implied' }],
        [{ id: 't-captions-implied' }, { id: 't-overlay' }, { id: 't2' }]
    ]) {
        for (const id of [undefined, '', 't2', 't-captions-implied', 't-missing']) {
            const plate = { style: { zIndex: '99' } };
            const calls = [];
            apply({ captionTrackId: id }, plate, trackId => {
                calls.push(trackId);
                return tracks.findIndex(track => track.id === trackId);
            });
            const expectedZ = tracks.findIndex(track => track.id === id);
            assert.equal(plate.style.zIndex, expectedZ >= 0 ? String(expectedZ) : '');
            assert.deepEqual(calls, id ? [id] : []);
        }
    }
});
