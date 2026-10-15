import { readHandlerCompiled } from './helpers/handler-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const compiled = readHandlerCompiled();
const start = compiled.indexOf('queueCaptionsUpdate(widget, sourceOverride) {');
const end = compiled.indexOf('previewModelSnapshot(', start);
assert.ok(start >= 0 && end > start);
const cue = { id: 'c1', start: 0, end: 1, text: 'Added later' };

function setup(captions, captionTrackId) {
    const errors = [];
    const host = vm.runInNewContext('(new (class { ' + compiled.slice(start, end).trim() + ' }))', {
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
    await new Promise(resolve => setTimeout(resolve, 0));
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

test('cue text, paint, runs and emphasis arrive together as a caption-only update', async () => {
    const changed = { ...cue, text: 'これ、AIと対話する',
        textStyle: { color: '#facc15', weight: 900, italic: true, background: { opacity: 0 } },
        runs: [{ from: 3, to: 8, role: 'emphasis', style: { color: '#FB923C', font_weight: 900 } }] };
    const emphasisWords = [{ id: 'e-0001', t_start: 0.2, t_end: 0.8,
        word: '対話', emotion: 'emphasis', style_preset: 'emphasis-red' }];
    const { host, widget, messages, refreshes } = setup([], 't-captions-implied');
    widget.akariPreviewModelSnapshot = { captions: [], emphasisWords: [] };
    host.loadPreviewCaptions = async () => ({ captions: [changed], emphasisWords });
    host.normalizeEmphasisWords = value => value;
    host.queueCaptionsUpdate(widget);
    await widget.akariPreviewCaptionsUpdate;
    assert.equal(refreshes.length, 0);
    assert.equal(messages[0].type, 'akari-preview-captions-update');
    assert.equal(messages[0].captions[0].textStyle.color, '#facc15');
    assert.equal(messages[0].captions[0].runs[0].style.font_weight, 900);
    assert.deepEqual(messages[0].emphasisWords, emphasisWords);
    assert.equal(widget.akariPreviewModelSnapshot.captions[0].text, changed.text);
});

test('連続した字幕通知は実行中一回と最新一回に合流する', async () => {
    const { host, widget, messages } = setup([cue], 't-captions-implied');
    let reads = 0;
    let release;
    host.loadPreviewCaptions = async () => {
        reads++;
        if (reads === 1) await new Promise(resolve => { release = resolve; });
        return { captions: [cue] };
    };
    host.queueCaptionsUpdate(widget);
    host.queueCaptionsUpdate(widget);
    host.queueCaptionsUpdate(widget);
    assert.equal(reads, 1);
    release();
    await widget.akariPreviewCaptionsUpdate;
    assert.equal(reads, 2);
    assert.equal(messages.length, 2);
});

test('caption plate uses auto for missing tracks and preserves the shared z-order for string track IDs', () => {
    const blockStart = compiled.indexOf('const applyOverlayTracks = () => {');
    const blockEnd = compiled.indexOf('\n            };', blockStart);
    assert.ok(blockStart >= 0 && blockEnd > blockStart);
    const apply = vm.runInNewContext(`(summary, captionLayer, zForTrack) => {
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
