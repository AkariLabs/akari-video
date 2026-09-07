import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { liveTimelineUpdate } = createRequire(import.meta.url)('../lib/common/live-timeline-update.js');
const edit = { cuts: [{ in: 0, out: 3, at: 0, track: 0 }], layers: [{ id: 'blue', src: 'blue.webm', t: 0, duration: 2, track: 1 }], timeline: { tracks: [{ id: 'v1', kind: 'video', ref: 0 }] } };
const check = (mutate, multi = false) => { const next = structuredClone(edit); mutate(next); return liveTimelineUpdate(JSON.stringify(edit), JSON.stringify(next), multi); };
test('placements and trims reuse existing media', () => {
    assert.ok(check(e => { e.cuts[0].at = 1; e.cuts[0].out = 2; e.layers[0].t = 3; }));
    assert.ok(check(e => { e.cuts[0].track = 2; e.timeline.tracks.unshift({ kind: 'video', ref: 2 }); }, true));
});
test('media, transforms, captions, and track controls require complete refresh', () => {
    for (const mutate of [e => e.layers[0].src = 'new.webm', e => e.cuts[0].transform = { scale: .5 }, e => e.captions = [{ text: 'new' }], e => e.tracks = { cuts: [{ hidden: true }] }, e => e.cuts.push({ in: 0, out: 1 })]) {
        assert.equal(check(mutate), undefined);
    }
});
test('switching into multi-cut rendering needs new media nodes', () => {
    const before = JSON.stringify({ cuts: [{ in: 0, out: 1, track: 0 }, { in: 0, out: 1, at: 1, track: 0 }] });
    const next = JSON.parse(before); next.cuts[1].track = 1;
    assert.equal(liveTimelineUpdate(before, JSON.stringify(next), false), undefined);
    assert.ok(liveTimelineUpdate(before, JSON.stringify(next), true));
});

test('injected live-update handler applies metadata without rebuilding the document', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const begin = source.indexOf("                if (message && message.type === 'akari-preview-timeline-update') {");
    const end = source.indexOf("                if (message && message.type === 'akari-preview-captions-update')", begin);
    const run = new Function('message', 'summary', 'layerEntries', 'window', `
        let isPlaying = false, resolvedTracks = [], outputTime = 1;
        const visualTrackZ = new Map(), zForTrack = () => -1;
        let rebuilt = 0, ticks = 0, seek;
        const togglePlayback = () => {}, rebuildSegments = () => rebuilt++, seekTimelineTime = t => seek = t, tick = () => ticks++;
        (() => { ${source.slice(begin, end)} })();
        return {rebuilt, ticks, seek};
    `);
    const summary = structuredClone(edit);
    const entries = [{ spec: summary.layers[0], video: { style: {} } }];
    const next = structuredClone(edit); next.cuts[0].at = 2; next.layers[0].t = 3;
    const result = run({type: 'akari-preview-timeline-update', edit: next, time: 4}, summary, entries, {AkariEditKernel: {computeCutTrackSegments: () => []}});
    assert.equal(summary.cuts[0].at, 2);
    assert.equal(entries[0].spec.t, 3);
    assert.deepEqual(result, {rebuilt: 1, ticks: 1, seek: 4});
});
