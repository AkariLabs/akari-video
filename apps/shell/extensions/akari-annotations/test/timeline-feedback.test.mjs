import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as laneLayout from '../lib/common/lane-layout.js';
const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function method(name) {
    const start = source.indexOf(`    ${name}(`);
    assert.ok(start >= 0, name);
    const rest = source.slice(start);
    const end = rest.indexOf('\n    }') + 6;
    return rest.slice(0, end);
}
const Widget = new Function('lane_layout_1', `
const CLIP_HEIGHT=64, DEFAULT_AUDIO_TRACK_HEIGHT_PX=48, SUBROW_STRIDE=36, SUBROW_GAP=4, LANE_GAP=6, STRIP_BOTTOM_MARGIN=6;
const RULER_MIN_TICK_SPACING_PX=80;
const RULER_STEP_SECONDS=[0.5,1,2,5,10,15,30,60,120,300,600];
const RULER_STEP_MULTIPLIERS_FRAMES=[1,2,5,10,15,30,60,120,300];
return class { ${['timeAtClientX','materialDropTimeAtClientX','computeRulerTicks','niceStepFromCandidates','formatTickLabel','formatFrameTimestamp','formatRulerTimestamp','defaultTrackHeight','handleMaterialDragOver','calculateLaneLayout'].map(method).join('\n')} };`)(laneLayout);
test('dropping over the header clamps to the visible start, never a negative time', () => {
    const widget = Object.assign(new Widget(), { strip: { getBoundingClientRect: () => ({ left: 200, width: 1000 }) }, viewStart: 0, visibleDuration: () => 10 });
    assert.equal(widget.materialDropTimeAtClientX(100), 0);
    assert.equal(widget.materialDropTimeAtClientX(200), 0);
    widget.viewStart = 30;
    assert.equal(widget.materialDropTimeAtClientX(100), 30);
});
test('header drag shows copy for compatible tracks and preserves rejection for wrong kinds', () => {
    let reject = false, ghost;
    const widget = Object.assign(new Widget(), { materialDragPayload: { kind: 'video' }, isMaterialDragTransfer: () => true,
        resolveMaterialDropTarget: () => ({ rejected: reject, reason: 'wrong kind' }), footer: {}, updateMaterialGhost: (...point) => { ghost = point; } });
    const event = { clientX: 100, clientY: 50, dataTransfer: {}, preventDefault() {}, stopPropagation() {} };
    widget.handleMaterialDragOver(event);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
    assert.deepEqual(ghost, [100, 50]);
    reject = true;
    widget.handleMaterialDragOver(event);
    assert.equal(event.dataTransfer.dropEffect, 'none');
});
test('high zoom ticks use project frames including one-frame intervals', () => {
    const widget = Object.assign(new Widget(), { strip: { getBoundingClientRect: () => ({ width: 1000 }) } });
    const ticks = widget.computeRulerTicks(0, 0.25, 30);
    assert.equal(ticks[1].label, '00:00:01');
    assert.ok(Math.abs(ticks[1].time - 1 / 30) < 1e-10);
    assert.equal(widget.formatFrameTimestamp(1 + 5 / 60, 60), '00:01:05');
});

test('layer, HTML, and caption rows honor resized heights without collapsing overlaps', () => {
    const widget = Object.assign(new Widget(), {
        computeAudioDisplayTracks() {}, computeCaptionsDisplayTrack() {}, captions: [{start:0,end:2}], captionRows: [0], beats: [], layers: [{id:'one',track:0,t:0,duration:2},{id:'two',track:0,t:0,duration:2}], overlays: [],
        videoItemBounds: new Map(), overlayRows: new Map(), layerRows: new Map(), audioSfxRows: new Map(), audioNarrationRows: new Map(), audioTrackSubrowCounts: new Map(),
        displayTimelineTracks: ['layers','overlays','captions'].map(kind => ({id:kind,kind,ref:0})),
        trackHeightFor: () => 120
    });
    widget.calculateLaneLayout();
    assert.deepEqual(widget.laneLayout.tracks.map(track => track.height), [120,120,120]);
    widget.trackHeightFor = () => 28;
    widget.calculateLaneLayout();
    assert.equal(widget.laneLayout.layerTracks[0].height, 72);
});

 test('shared video row exposes cut/layer hit areas and separate bounds for overlapping media', () => {
    const widget = Object.assign(new Widget(), {
        computeAudioDisplayTracks() {}, computeCaptionsDisplayTrack() {}, captions: [], captionRows: [], beats: [],
        layers: [{id:'layer',track:2,t:0,duration:2}], segments:[{index:0,track:2,tlStart:0,tlEnd:2}], overlays: [],
        videoItemBounds: new Map(), overlayRows: new Map(), layerRows: new Map(), audioSfxRows: new Map(), audioNarrationRows: new Map(), audioTrackSubrowCounts: new Map(),
        displayTimelineTracks: [{id:'v',kind:'video',ref:2}], trackHeightFor:()=>120
    });
    widget.calculateLaneLayout();
    assert.equal(widget.laneLayout.tracks.length,1);
    assert.equal(widget.laneLayout.cutTracks[0].id,'v');assert.equal(widget.laneLayout.layerTracks[0].id,'v');
    const cut=widget.videoItemBounds.get('cut:0'), layer=widget.videoItemBounds.get('layer:layer');
    assert.ok(cut.top>=layer.top+layer.height);
 });
