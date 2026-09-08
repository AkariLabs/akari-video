import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TIMELINE_ASPECT_PRESETS, isTimelineEditFileName, timelineSlugFromEditFileName,
    timelineEditFileName, timelineCaptionsFileName, timelineReviewFileName,
    slugifyTimelineName, uniqueTimelineSlug, estimateAspectFromOrientation,
    timelineDisplayName, timelineWidgetId, sortTimelineEditFileNames, createTimelineEditContent
} from '../lib/common/timeline-files.js';

test('only canonical and lowercase kebab infix edit files are discovered', () => {
    for (const name of ['edit.json', 'edit.a-b.json', 'edit.123.json', 'edit.backup.json']) {
        assert.equal(isTimelineEditFileName(name), true, name);
    }
    for (const name of ['edit.A.json', 'edit..json', 'edit.a_b.json', 'edit.a--b.json',
        'edit.-a.json', 'edit.a-.json', 'editx.json', 'edit.a.json.bak', 'Edit.json',
        'edit.縦長.json', 'project/edit.json']) {
        assert.equal(isTimelineEditFileName(name), false, name);
        assert.equal(timelineSlugFromEditFileName(name), undefined);
    }
    assert.equal(timelineSlugFromEditFileName('edit.json'), undefined);
    assert.equal(timelineSlugFromEditFileName('edit.a-b.json'), 'a-b');
});

test('all sidecars use the same infix without renaming the first timeline', () => {
    for (const [fn, stem] of [[timelineEditFileName, 'edit'], [timelineCaptionsFileName, 'captions'], [timelineReviewFileName, 'review']]) {
        assert.equal(fn(), `${stem}.json`);
        assert.equal(fn('a-b'), `${stem}.a-b.json`);
        for (const invalid of ['', '../x', 'A', 'a_b']) assert.throws(() => fn(invalid));
    }
});

test('ASCII names become kebab slugs, Japanese names permit an editable fallback', () => {
    assert.equal(slugifyTimelineName('  My NEW Timeline!  '), 'my-new-timeline');
    assert.equal(slugifyTimelineName('縦長版'), '');
    assert.equal(slugifyTimelineName('日本語 Clip 2'), 'clip-2');
    assert.equal(slugifyTimelineName(' -- '), '');
    assert.equal(uniqueTimelineSlug('', []), 'timeline');
    assert.equal(uniqueTimelineSlug('', ['timeline', 'timeline-2']), 'timeline-3');
    assert.equal(uniqueTimelineSlug('my-cut', ['my-cut', 'my-cut-2', 'my-cut-4']), 'my-cut-3');
    assert.equal(uniqueTimelineSlug('unused', ['other']), 'unused');
});

test('presets and orientation defaults cover portrait, landscape, square and unavailable media', () => {
    assert.deepEqual(TIMELINE_ASPECT_PRESETS.map(({ id, label, width, height }) => [id, label, width, height]), [
        ['16:9', '16:9', 1920, 1080], ['9:16', '9:16', 1080, 1920],
        ['1:1', '1:1', 1080, 1080], ['4:5', '4:5', 1080, 1350]
    ]);
    assert.deepEqual(estimateAspectFromOrientation(720, 1280), { width: 1080, height: 1920 });
    for (const dimensions of [[1920, 1080], [100, 100], [], [undefined, 1920], [720, undefined],
        [0, 1920], [-1, 1920], [NaN, 1920], [720, Infinity]]) {
        assert.deepEqual(estimateAspectFromOrientation(...dimensions), { width: 1920, height: 1080 });
    }
});

test('tab labels prefer title and IDs preserve the canonical widget', () => {
    assert.equal(timelineDisplayName(undefined), 'タイムライン');
    assert.equal(timelineDisplayName('portrait'), 'portrait');
    assert.equal(timelineDisplayName('portrait', '縦長版'), '縦長版');
    assert.equal(timelineDisplayName(undefined, '本編'), '本編');
    assert.equal(timelineDisplayName('portrait', '  '), 'portrait');
    assert.equal(timelineWidgetId(), 'akari-annotations-widget');
    assert.equal(timelineWidgetId('portrait'), 'akari-annotations-widget:portrait');
});

test('canonical file sorts first, other slugs sort ascending without mutating input', () => {
    const input = ['edit.z.json', 'edit.aa.json', 'edit.a-b.json', 'edit.json', 'edit.A.json', 'captions.json'];
    const before = [...input];
    assert.deepEqual(sortTimelineEditFileNames(input), ['edit.json', 'edit.a-b.json', 'edit.aa.json', 'edit.z.json']);
    assert.deepEqual(input, before);
    assert.deepEqual(sortTimelineEditFileNames([]), []);
});

test('creation keeps the v2 skeleton and chosen dimensions and fps without meta', () => {
    assert.deepEqual(createTimelineEditContent({ width: 1080, height: 1920 }), {
        version: 2, output: { width: 1080, height: 1920, fps: 30 }, sources: [], tracks: []
    });
    assert.deepEqual(createTimelineEditContent({ width: 640, height: 480, fps: 24 }), {
        version: 2, output: { width: 640, height: 480, fps: 24 }, sources: [], tracks: []
    });
    assert.equal('meta' in createTimelineEditContent({ width: 1, height: 1 }), false);
});
