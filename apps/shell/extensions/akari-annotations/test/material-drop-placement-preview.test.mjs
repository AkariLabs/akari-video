import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { insertItem as insertV2Item, insertTrack as insertV2Track } from '../lib/common/edit-v2-mutations.js';
import { materialOverlapInsertIndex } from '../lib/common/material-drop-overlap.js';
import { computeMaterialGhostRange, materialGhostRejectLabel, materialGhostVisibility } from '../lib/common/timeline-material-insert.js';
import { hitTestTimelineTrackDrop } from '../lib/common/timeline-track-drop.js';
import { textStyleDropBandLayout, textStyleGhostEnd } from '../lib/browser/library-drop-model.js';
import { timelineApplyTarget } from '../lib/browser/library-apply-plan.js';
import { shouldShowTimelineGhost } from '../lib/common/timeline-visibility.js';

globalThis.document = { documentElement: { dataset: { akariTimelineHidden: 'false' } } };

const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['resolveMaterialDropTarget', 'timelineTrackDropLayouts', 'materialDropTargetWithoutOverlap',
    'materialGhostDurationSeconds', 'materialGhostAllowed', 'updateMaterialGhost', 'hideMaterialGhost',
    'showMaterialDropBadge', 'updateShapeDropGhost', 'updateTextStyleDropGhost', 'textStyleDropBandLayout',
    'addShapeAt', 'handleMaterialDrop', 'positionInsertionGhost', 'showTrackInsertIndicatorAt',
    'hideTrackInsertIndicator', 'setGhostRejected'];
const methods = names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source));
const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const bindings = {
    hitTestTimelineTrackDrop, materialOverlapInsertIndex, computeMaterialGhostRange,
    materialGhostRejectLabel, materialGhostVisibility, shouldShowTimelineGhost,
    textStyleDropBandLayout, textStyleGhostEnd, timelineApplyTarget,
    insertV2Track, insertV2Item,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS: 5, MATERIAL_INSERT_FALLBACK_DURATION_SECONDS: 3,
    SHAPE_PLACE_DEFAULT_DURATION_SECONDS: 5, PLACED_TEXT_TRACK_ID: 'placed-text',
    SUBROW_STRIDE: 32, LANE_GAP: 4, SUBROW_GAP: 2,
    LIBRARY_DRAG_MIME: 'application/x-akari-library-item',
    PLACE_TEXT_COMMAND_ID: 'akari.caption.placeText',
    SHAPE_PRESET_COMMAND_ID: 'akari.library.shapePreset', SHAPE_PLACED_EVENT: 'akari.shape.placed',
    textStyleDropStart: () => 13, textPlaceOptions: start => ({ start }),
    textStylePlaceOptions: (_payload, start) => ({ start }),
    parseShapePlaceRequest: request => request,
    nextShapeItemId: () => 'shape-new',
    buildShapeItem: options => ({ id: options.id, at: options.at, duration: options.duration,
        source: { kind: 'shape' } }),
    placePreviewShapeInCanvas: () => undefined,
    insertShapeItem: () => assert.fail('明示されたタイムライン行を使う'),
    window: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
};
const Handler = new Function(...Object.keys(bindings), `${code}\nreturn Handler;`)(...Object.values(bindings));

const item = (id, at = 0, duration = 180) => ({ id, at, duration, source: { kind: 'media' } });
const track = (id, lane, items = []) => ({ id, lane, items });
function fixture(tracks) {
    const handler = new Handler();
    handler.editDocument = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, tracks };
    handler.displayTimelineTracks = tracks;
    const layouts = [...tracks].reverse().map((entry, index) => ({ id: entry.id, track: index,
        top: index * 40, height: 32 }));
    handler.laneLayout = { tracks: layouts,
        audioTracks: layouts.filter(layout => tracks.find(entry => entry.id === layout.id).lane === 'audio'),
        captions: { top: 100, height: 32 } };
    handler.isAttached = true;
    handler.isVisible = true;
    handler.fps = 30;
    handler.playheadT = 3;
    handler.frameAt = time => Math.round(time * 30);
    handler.isTrackLocked = () => false;
    handler.materialDurationCache = new Map();
    handler.strip = { getBoundingClientRect: () => ({ top: 0, left: 0 }) };
    handler.stripScroll = { scrollTop: 0, clientHeight: 400 };
    handler.rulerRowHeightPx = () => 14;
    handler.materialDropTime = x => x / 10;
    handler.materialGhost = { style: {}, dataset: {}, classList: { toggle() {} } };
    handler.materialDropBadge = { style: {}, textContent: '' };
    handler.trackInsertIndicator = { style: {} };
    handler.setGhostRange = (ghost, start, end) => { ghost.range = [start, end]; };
    handler.materialPanelDropPoint = (x, y) => ({ x, y, zone: 'strip' });
    handler.isMaterialDragTransfer = () => true;
    handler.stopMaterialDragAutoScroll = () => {};
    handler.clearLibraryTransitionDragState = () => {};
    handler.viewStart = 0;
    handler.visibleDuration = () => 10;
    handler.libraryTextStyleOutputDuration = 0;
    handler.footer = { textContent: '' };
    handler.location = { editUri: { toString: () => 'edit' } };
    handler.hideNotice = () => {};
    handler.revealOutputPreview = () => {};
    handler.messages = { warn: assert.fail, error: assert.fail };
    handler.errorMessage = error => error.message;
    return handler;
}
const dragEvent = (x, y) => ({ clientX: x, clientY: y, dataTransfer: { types: [] },
    preventDefault() {}, stopPropagation() {} });

test('音は映像行からも音行へ案内し、音行が無ければ新設位置へ置く', () => {
    for (const tracks of [[track('a1', 'audio'), track('v1', 'visual')], [track('v1', 'visual')]]) {
        const handler = fixture(tracks);
        const visual = handler.laneLayout.tracks.find(layout => layout.id === 'v1');
        const y = visual.top + 16;
        handler.materialDragPayload = { kind: 'audio', relativePath: 'assets/sound.mp3' };
        handler.updateMaterialGhost(30, y);
        const target = handler.resolveMaterialDropTarget('audio', y);
        assert.equal(handler.materialGhost.style.top, `${14 + target.top}px`);
        assert.equal(handler.materialDropBadge.textContent, '音の行に入ります');
        assert.deepEqual(handler.materialGhost.range, [3, 6]);
        assert.equal(target.createAudioTrack === true, tracks.length === 1);
        if (target.createAudioTrack) assert.equal(handler.trackInsertIndicator.style.display, 'block');
        handler.readLibraryAssetDropPayload = () => undefined;
        handler.readMaterialDropPayload = () => handler.materialDragPayload;
        handler.placeMaterialAtTarget = (_payload, destination) => assert.equal(destination.createAudioTrack, target.createAudioTrack);
        handler.handleMaterialDrop(dragEvent(30, y));
    }
});

test('図形はポインタの映像行を使い、重なると直上の新しい行を示す', () => {
    const handler = fixture([track('v1', 'visual'), track('v2', 'visual', [item('existing')])]);
    const placed = [];
    handler.readLibraryShapeDropPayload = () => ({ kind: 'shape', preset: 'rectangle' });
    handler.addShapeAt = options => placed.push(options);
    for (const [id, insertIndex] of [['v1', undefined], ['v2', 2]]) {
        const row = handler.laneLayout.tracks.find(layout => layout.id === id);
        const y = row.top + 16;
        handler.updateShapeDropGhost(30, y);
        assert.deepEqual(handler.materialGhost.range, [3, 8]);
        assert.equal(handler.trackInsertIndicator.style.display, insertIndex === undefined ? 'none' : 'block');
        handler.handleMaterialDrop(dragEvent(30, y));
        assert.equal(placed.at(-1).timelineTarget.targetTrackId, id);
        assert.equal(placed.at(-1).timelineTarget.insertIndex, insertIndex);
    }
});

test('図形の確定配置は仮枠の行へ入り、再生位置を保つ', async () => {
    const handler = fixture([track('v1', 'visual'), track('v2', 'visual', [item('existing')])]);
    let focused;
    handler.commands = { executeCommand: async () => ({ preset: { id: 'rectangle' } }) };
    handler.commitEditMutation = async (_label, mutate) => { handler.editDocument = mutate(handler.editDocument); };
    handler.focusTimelineItem = async (_id, options) => { focused = options; return true; };
    const row = handler.laneLayout.tracks.find(layout => layout.id === 'v2');
    const target = handler.materialDropTargetWithoutOverlap(handler.resolveMaterialDropTarget('image', row.top + 16), 3, 5);
    await handler.addShapeAt({ preset: 'rectangle', t: 3, timelineTarget: target });
    assert.equal(handler.editDocument.tracks[2].items[0].at, 90);
    assert.deepEqual(focused, { seek: false });
    assert.equal(handler.playheadT, 3);
});

test('文字は指定行の帯と札を示し、同じ時刻へ置く', () => {
    const handler = fixture([track('v1', 'visual')]);
    const placed = [];
    handler.readLibraryTextStyleDropPayload = () => ({ kind: 'text' });
    handler.commands = { executeCommand: (_id, options) => placed.push(options) };
    handler.updateTextStyleDropGhost(30, 16);
    assert.deepEqual(handler.materialGhost.range, [13, 16]);
    assert.equal(handler.materialGhost.style.top, '114px');
    assert.equal(handler.materialDropBadge.textContent, '文字の行に入ります');
    handler.handleMaterialDrop(dragEvent(30, 16));
    assert.equal(placed.at(-1).start, 13);
});
