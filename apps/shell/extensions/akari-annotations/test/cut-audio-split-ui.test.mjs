import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { audioSections } from './helpers/audio-clip-fx-fixture.mjs';

const require = createRequire(import.meta.url);
const kernel = require('@akari-video/edit-store');
const mutations = require('../lib/common/edit-v2-mutations.js');
const { buildTimelineClipMenuItems } = require('../lib/common/timeline-context-menu-items.js');
const { withAudioTrimMenuItem } = require('../lib/browser/akari-timeline-context-menu.js');
const { isTrackLocked, lockedTrackMessage } = require('../lib/common/track-lock-guard.js');
const { audioClipFxFieldsForSnapshot } = require('../lib/browser/inspector/audio-clip-fx.js');
const { updateAudioClipFxDocument } = require('../lib/browser/inspector/audio-clip-fx.js');
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const widgetText = read('browser/akari-annotations-widget.ts');
const source = ts.createSourceFile('widget.ts', widgetText, ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const method = name => {
    const member = widget.members.find(node => node.name?.getText(source) === name);
    assert.ok(member, name);
    return member.getText(source);
};
const names = [
    'linkedCutAudioPair', 'linkedPairForSelection', 'rejectLockedCutAudio', 'performLinkedDeletion',
    'performDeleteSelected', 'performDeleteSelectedCut', 'performDeleteMultiSelected',
    'commitEditMutation', 'performEditMutation', 'splittableItemId', 'dispatchTimelineClipMenuAction', 'commitDrag', 'commitEditV2Drag',
    'moveV2PreviewItem', 'currentTrackId', 'cutItemId', 'frameAt', 'rawV2Item',
    'trackIdOfItem', 'trackIdOfSelection', 'trackIdOfDrag', 'isTrackLocked', 'showLockedTrack',
    'updateLinkedDragGhost', 'updateDragAltKey', 'withNarrationEnvelope', 'snapshotForSelection',
    'audioEnvelopeFieldsForSnapshot', 'handleInspectorWriteV2', 'handleAudioClipFxWrite',
    'openTimelineClipContextMenu', 'selectionKey'
];
const menuEvents = new Map();
let openedMenu;
const dependencies = {
    ...kernel, ...mutations, isTrackLocked, lockedTrackMessage, audioClipFxFieldsForSnapshot, updateAudioClipFxDocument,
    removeV2Item: mutations.removeItem, updateV2Item: mutations.updateItem,
    moveV2ItemToNewTrack: mutations.moveItemToNewTrack, MINIMUM_ITEM_DURATION: 0.15,
    removeCaptionLine: require('../lib/common/caption-store.js').removeCaptionLine,
    buildTimelineClipMenuItems, withAudioTrimMenuItem,
    openTimelineContextMenu: options => { openedMenu = options; },
    closeTimelineContextMenu: () => { openedMenu = undefined; },
    window: {
        addEventListener: (name, fn) => menuEvents.set(name, fn),
        removeEventListener: name => menuEvents.delete(name)
    }
};
const code = ts.transpileModule(`class Handler { ${names.map(method).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Handler = new Function(...Object.keys(dependencies), `${code}\nreturn Handler;`)(...Object.values(dependencies));

function document() {
    return {
        version: 2, output: { fps: 30, width: 320, height: 180 }, sources: [{ id: 'src', path: 'clip.mp4' }],
        tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'cut', at: 90, duration: 60,
            source: { kind: 'media', src: 'src', in: 1, out: 3, gain_db: -4 },
            keyframes: [{ t: 0, gain_db: -2 }, { t: 60, gain_db: 0 }] }] }]
    };
}
const cutSelection = { kind: 'cut', index: 0 };
const audioSelection = { kind: 'audio', id: 'cut-audio' };
const item = (doc, id) => doc.tracks.flatMap(track => track.items ?? []).find(value => value.id === id);

function fixture(split = true) {
    const context = new Handler();
    let disk = mutations.stringifyEditV2(split ? kernel.splitCutAudio(document(), { cutId: 'cut' }).document : document());
    context.location = { editUri: 'edit.json', captionsUri: 'captions.json', root: '.' };
    context.editMutationTail = Promise.resolve();
    context.contentEndDuration = () => 5;
    context.fps = 30;
    context.cutItemIds = ['cut'];
    context.audioSfx = [];
    context.audioNarration = [];
    context.audioSpeech = [];
    context.captions = [];
    context.multiSelection = [];
    context.expandedTimelineTreeRows = [];
    context.localLockedTrackIds = new Set();
    context.footer = {};
    context.notices = [];
    context.history = [];
    context.captionsDisk = '';
    context.fileService = { readFile: async uri => ({ value: uri === 'captions.json' ? context.captionsDisk : disk }) };
    context.writeEditSnapshotGuarded = async (value, captions) => {
        disk = value;
        if (captions !== undefined) context.captionsDisk = captions;
    };
    context.reloadCaptions = async () => {};
    context.reloadEdit = async source => {
        context.editDocument = JSON.parse(source ?? disk);
        context.itemLocations = mutations.indexEditV2Items(context.editDocument);
        context.timelineTracks = context.editDocument.tracks.map(track => ({ id: track.id, kind: track.lane === 'audio' ? 'audio' : 'cuts' }));
        context.displayTimelineTracks = context.timelineTracks;
    };
    context.reloadEdit();
    context.prepareMotionChanges = async () => [];
    context.writeMotionChanges = async () => {};
    context.pushHistory = entry => context.history.push(entry);
    context.applySelection = selection => { context.selection = selection; };
    context.showNotice = message => context.notices.push(message);
    context.hideNotice = () => {};
    context.revealOutputPreview = () => {};
    context.errorMessage = error => error.message;
    context.messages = { error: message => context.notices.push(message) };
    context.computeTrackAutoNames = () => new Map();
    context.commitCount = 0;
    context.commitEditMutation = (...args) => {
        context.commitCount++;
        context.pending = Handler.prototype.commitEditMutation.apply(context, args);
        return context.pending;
    };
    return context;
}

test('menu additions preserve the relative order of every existing entry and show kernel blocker reasons', () => {
    const tree = { canGroup: true, canDetach: true };
    for (const hasClipboard of [false, true]) {
        const original = buildTimelineClipMenuItems('cut', hasClipboard, tree);
        for (const split of [{ ok: true }, { ok: false, message: '速度を変えたカットはまだ音声を分離できません' }]) {
            const next = buildTimelineClipMenuItems('cut', hasClipboard, tree, { split });
            assert.deepEqual(next.filter(entry => entry.id !== 'split-audio'), original);
            const entry = next.find(entry => entry.id === 'split-audio');
            assert.equal(entry.label, '音声を分離');
            assert.equal(entry.disabled, split.ok ? undefined : true);
            assert.equal(entry.disabledReason, split.message);
        }
    }
    assert.deepEqual(buildTimelineClipMenuItems('audio', false, {}, { linked: true }).map(entry => entry.id), ['copy', 'cut', 'paste', 'duplicate', 'unlink-audio', 'delete']);
    const menu = read('browser/akari-timeline-context-menu.ts');
    assert.match(menu, /button\.disabled = true/);
    assert.match(menu, /button\.title = item\.disabledReason/);
    assert.match(menu, /if \(item\.disabled\) return/);
});

test('split and unlink dispatch through one snapshot history entry, with one-step Undo/Redo', async () => {
    const context = fixture(false);
    const before = structuredClone(context.editDocument);
    context.dispatchTimelineClipMenuAction('split-audio', cutSelection, 0, true);
    await context.pending;
    assert.equal(context.commitCount, 1);
    assert.equal(context.history[0].label, '音声を分離');
    assert.equal(item(context.editDocument, 'cut').audio, false);
    assert.equal(item(context.editDocument, 'cut-audio').link, 'cut');
    assert.ok(context.notices.includes('音声を分離しました'));
    await context.history[0].undo();
    assert.deepEqual(context.editDocument, before);
    await context.history[0].redo();
    const split = structuredClone(context.editDocument);
    context.dispatchTimelineClipMenuAction('unlink-audio', audioSelection, 0);
    await context.pending;
    assert.equal(context.history[1].label, 'リンクを解除');
    assert.equal(item(context.editDocument, 'cut-audio').link, undefined);
    assert.equal(item(context.editDocument, 'cut').audio, false);
    await context.history[1].undo();
    assert.deepEqual(context.editDocument, split);
});

test('known silent sources fail with the kernel message; unknown availability permits splitting', async () => {
    const silent = fixture(false);
    silent.dispatchTimelineClipMenuAction('split-audio', cutSelection, 0, false);
    await assert.rejects(silent.pending, /音声がありません/);
    assert.equal(silent.history.length, 0);
    const unknown = fixture(false);
    unknown.dispatchTimelineClipMenuAction('split-audio', cutSelection, 0);
    await unknown.pending;
    assert.equal(unknown.history.length, 1);
});

for (const kind of ['cut-move', 'audio']) for (const altKey of [false, true]) {
    test(`${kind}: Alt=${altKey} moves the intended side(s), preserves offsets and local keyframes, one Undo`, async () => {
        const context = fixture();
        await context.commitEditMutation('offset', doc => mutations.updateItem(doc, { itemId: 'cut-audio', patch: { at: 120 } }));
        context.history = [];
        context.commitCount = 0;
        const before = structuredClone(context.editDocument);
        await context.commitDrag(kind === 'cut-move'
            ? { kind, index: 0, at: 4, altKey, rejected: false }
            : { kind, id: 'cut-audio', t: 5, altKey, rejected: false });
        assert.equal(item(context.editDocument, 'cut').at, kind === 'cut-move' || !altKey ? 120 : 90);
        assert.equal(item(context.editDocument, 'cut-audio').at, kind === 'audio' || !altKey ? 150 : 120);
        assert.equal(item(context.editDocument, 'cut-audio').link, 'cut');
        assert.deepEqual(item(context.editDocument, 'cut-audio').keyframes, item(before, 'cut-audio').keyframes);
        assert.equal(context.commitCount, 1);
        assert.equal(context.history.length, 1);
        await context.history[0].undo();
        assert.deepEqual(context.editDocument, before);
        await context.history[0].redo();
        assert.equal(item(context.editDocument, kind === 'audio' ? 'cut-audio' : 'cut').at, kind === 'audio' ? 150 : 120);
    });
}

for (const selection of [cutSelection, audioSelection]) for (const altKey of [false, true]) {
    test(`delete ${selection.kind}, Alt=${altKey}: pair or one side with one Undo`, async () => {
        const context = fixture();
        const before = structuredClone(context.editDocument);
        context.selection = selection;
        await context.performDeleteSelected(altKey);
        assert.equal(Boolean(item(context.editDocument, 'cut')), altKey && selection.kind === 'audio');
        assert.equal(Boolean(item(context.editDocument, 'cut-audio')), altKey && selection.kind === 'cut');
        if (altKey && selection.kind === 'audio') assert.equal(item(context.editDocument, 'cut').audio, false);
        if (altKey && selection.kind === 'cut') assert.equal(item(context.editDocument, 'cut-audio').link, undefined);
        assert.equal(context.commitCount, 1);
        assert.equal(context.history.length, 1);
        await context.history[0].undo();
        assert.deepEqual(context.editDocument, before);
    });
}

for (const altKey of [false, true]) test(`selecting both partners deletes the pair once, Alt=${altKey}`, async () => {
    const context = fixture();
    context.multiSelection = [audioSelection, cutSelection];
    await context.performDeleteMultiSelected(altKey);
    assert.deepEqual(context.editDocument.tracks.flatMap(track => track.items ?? []), []);
    assert.equal(context.commitCount, 1);
    assert.equal(context.history.length, 1);
    await context.history[0].undo();
    assert.ok(item(context.editDocument, 'cut-audio'));
});

for (const locked of ['visual', 'audio']) test(`linked operations reject a locked ${locked} owner before committing`, async () => {
    for (const action of ['move-cut', 'move-audio', 'delete-cut', 'delete-audio', 'multi-delete', 'unlink']) {
        const context = fixture();
        const trackId = locked === 'visual' ? 'visual' : context.itemLocations.get('cut-audio').trackId;
        context.localLockedTrackIds.add(trackId);
        const before = structuredClone(context.editDocument);
        if (action.startsWith('move')) await context.commitDrag(action === 'move-cut'
            ? { kind: 'cut-move', index: 0, at: 4 } : { kind: 'audio', id: 'cut-audio', t: 4 });
        else if (action === 'multi-delete') {
            context.multiSelection = [cutSelection, audioSelection];
            await context.performDeleteMultiSelected();
        } else if (action.startsWith('delete')) {
            context.selection = action === 'delete-cut' ? cutSelection : audioSelection;
            await context.performDeleteSelected();
        } else context.dispatchTimelineClipMenuAction('unlink-audio', audioSelection, 0);
        assert.equal(context.commitCount, 0, action);
        assert.match(context.footer.textContent, /ロック中/);
        assert.deepEqual(context.editDocument, before);
    }
});

test('Alt respects the changed side; deleting a cut also checks the surviving link owner', async () => {
    const context = fixture();
    const audioTrack = context.itemLocations.get('cut-audio').trackId;
    context.localLockedTrackIds.add(audioTrack);
    await context.commitDrag({ kind: 'cut-move', index: 0, at: 4, altKey: true });
    assert.equal(item(context.editDocument, 'cut').at, 120);
    assert.equal(item(context.editDocument, 'cut-audio').at, 90);
    context.commitCount = 0;
    context.selection = cutSelection;
    await context.performDeleteSelected(true);
    assert.equal(context.commitCount, 0);
    context.selection = audioSelection;
    await context.performDeleteSelected(true);
    assert.equal(context.commitCount, 0);
});

test('split checks the cut and an existing destination track before committing', () => {
    for (const destinationLocked of [false, true]) {
        const context = fixture(false);
        if (destinationLocked) {
            context.editDocument.tracks[0].items.push({ id: 'other', at: 0, duration: 30, audio: false,
                source: { kind: 'media', src: 'src', in: 0, out: 1 } });
            context.editDocument.tracks.push({ id: 'destination', lane: 'audio', items: [{
                id: 'other-audio', role: 'speech', link: 'other', at: 0, duration: 30,
                source: { kind: 'media', src: 'src', in: 0, out: 1 }
            }] });
        }
        context.localLockedTrackIds.add(destinationLocked ? 'destination' : 'visual');
        context.dispatchTimelineClipMenuAction('split-audio', cutSelection, 0, true);
        assert.equal(context.commitCount, 0);
        assert.match(context.footer.textContent, /ロック中/);
    }
});

test('ghost follows the partner with the same frame delta and disappears with Alt', () => {
    const context = fixture();
    const ghosts = [];
    context.strip = { querySelectorAll: () => [{ dataset: { akariItemKind: 'audio', akariItemId: 'cut-audio' } }],
        appendChild: ghost => ghosts.push(ghost) };
    context.createDragGhost = () => ({ remove() { this.removed = true; } });
    context.setGhostRange = (ghost, start, end) => Object.assign(ghost, { start, end });
    context.setGhostRejected = (ghost, rejected) => { ghost.rejected = rejected; };
    const state = { kind: 'cut-move', index: 0 };
    assert.equal(context.updateLinkedDragGhost(state, 4), false);
    assert.equal(state.linkedGhost.start, 4);
    assert.equal(state.linkedGhost.end, 6);
    state.altKey = true;
    assert.equal(context.updateLinkedDragGhost(state, 5), false);
    assert.equal(state.linkedGhost, undefined);
    assert.equal(ghosts[0].removed, true);
    assert.match(method('installDragListeners'), /state\.altKey = event\.altKey/);
    assert.match(method('cancelDrag'), /state\.linkedGhost\?\.remove/);
});

test('speech uses the narration chip styling, actual track and existing editable audio sections', () => {
    assert.match(widgetText, /this\.audioSpeech = this\.withNarrationEnvelope\(speechView\.audioSpeech/);
    assert.match(widgetText, /this\.audioNarration\.push\(\.\.\.this\.audioSpeech\)/);
    assert.match(widgetText, /trackLayout\('audio', this\.narrationDisplayTrack\(narration\)\)/);
    assert.match(widgetText, /akari-annotations-strip-audio akari-annotations-strip-audio-narration/);
    assert.match(widgetText, /element\.dataset\.akariLinked = 'cut'/);
    const context = fixture();
    context.audioSpeech = [{ id: 'cut-audio', path: 'clip.mp4', t: 3, duration: 2, gainDb: -4, fadeIn: 0.2 }];
    context.pathBaseName = path => path;
    context.trackDisplayNameForItem = () => 'Audio';
    const snapshot = context.snapshotForSelection(audioSelection);
    const sections = audioSections(snapshot, async () => ({ ok: true }));
    for (const id of ['audio', 'audio:fades', 'audio:keyframes', 'audio:pitch-time', 'audio:enhancement']) {
        assert.ok(sections.some(section => section.id === id), id);
    }
    assert.equal(snapshot.fadeIn, 0.2);
    assert.equal(item(context.editDocument, 'cut-audio').role, 'speech');
});

test('speech inspector gain, fades, ducking, keyframes and FX update the audio owner through history', async () => {
    const context = fixture();
    const originalCut = structuredClone(item(context.editDocument, 'cut'));
    const requests = [
        { kind: 'sfx-gain', id: 'cut-audio', value: -8 },
        { kind: 'sfx-fade-in', id: 'cut-audio', value: 0.2 },
        { kind: 'sfx-fade-out', id: 'cut-audio', value: 0.3 },
        { kind: 'sfx-ducking', id: 'cut-audio', value: true },
        { kind: 'audio-keyframes', audioKind: 'sfx', id: 'cut-audio', value: [{ t: 0, gain_db: -5 }, { t: 60, gain_db: 0 }] },
        { kind: 'audio-clip-fx', audioKind: 'sfx', id: 'cut-audio', field: 'pitch_semitones', value: 3 },
        { kind: 'audio-clip-fx', audioKind: 'sfx', id: 'cut-audio', field: 'lowcut_hz', value: 90 }
    ];
    for (const request of requests) {
        assert.deepEqual(await context.handleInspectorWriteV2(request), { ok: true }, request.kind);
    }
    const audio = item(context.editDocument, 'cut-audio');
    assert.equal(audio.gain_db, -8);
    assert.equal(audio.fade_in, 0.2);
    assert.equal(audio.fade_out, 0.3);
    assert.equal(audio.ducking, true);
    assert.equal(audio.source.pitch_semitones, 3);
    assert.equal(audio.lowcut_hz, 90);
    assert.equal(audio.role, 'speech');
    assert.equal(audio.link, 'cut');
    assert.deepEqual(item(context.editDocument, 'cut'), originalCut);
    assert.equal(context.history.length, requests.length);
});

test('a linked pair and caption deletion share one snapshot Undo/Redo including caption styling', async () => {
    const context = fixture();
    const caption = JSON.stringify({ captions: [{ id: 'caption', start: 0, end: 1, text: 'Hello',
        speaker: null, sourceRef: { segment: 0 }, edited: false, time_domain: 'output', text_style: { bold: true } }] }) + '\n';
    context.captionsDisk = caption;
    context.captions = [{ id: 'caption' }];
    context.captionTreeRow = () => undefined;
    context.multiSelection = [cutSelection, audioSelection, { kind: 'caption', id: 'caption' }];
    await context.performDeleteMultiSelected();
    assert.equal(context.history.length, 1, context.notices.join('\n'));
    assert.deepEqual(JSON.parse(context.captionsDisk).captions, []);
    await context.history[0].undo();
    assert.equal(context.captionsDisk, caption);
    assert.ok(item(context.editDocument, 'cut-audio'));
    await context.history[0].redo();
    assert.deepEqual(JSON.parse(context.captionsDisk).captions, []);
    assert.equal(item(context.editDocument, 'cut-audio'), undefined);
});

test('speech projection preserves muted-track ownership and its own timing after unlink', () => {
    const doc = kernel.splitCutAudio(document(), { cutId: 'cut' }).document;
    const owner = doc.tracks.find(track => track.lane === 'audio');
    owner.muted = true;
    const audio = item(doc, 'cut-audio');
    audio.at = 120;
    delete audio.link;
    const internal = kernel.readInternalEdit(doc);
    assert.equal(kernel.projectLegacyEdit(internal).audioSpeech, undefined);
    const view = kernel.projectLegacyEdit({ ...internal, tracks: internal.tracks.map(track =>
        track.lane === 'audio' ? { ...track, muted: false } : track) });
    assert.equal(view.audioSpeech[0].id, 'cut-audio');
    assert.equal(view.audioSpeech[0].t, 4);
    const displayOwner = view.timeline.tracks.find(track => track.kind === 'audio' && track.ref === view.audioSpeech[0].track);
    assert.equal(displayOwner.id, owner.id);
    assert.equal(doc.tracks.find(track => track.id === owner.id).muted, true);
});

test('probe RPC signatures agree, normalize file paths, and leave failed probes unknown in the menu', () => {
    const signature = /probeSourceHasAudio\(request: ProbeSourceHasAudioRequest\): Promise<ProbeSourceHasAudioResult>/;
    assert.match(read('common/akari-annotations-protocol.ts'), signature);
    assert.match(read('node/akari-annotations-service.ts'), signature);
    assert.match(read('node/akari-annotations-service.ts'), /probeSourceHasAudio\(await fs\.realpath\(path\)\)/);
    assert.match(method('openTimelineClipContextMenu'), /hasAudio === undefined \? \{\} : \{ hasAudio \}/);
});

test('opening a cut menu probes the original source once and uses only a known result', async () => {
    for (const result of [{ hasAudio: false }, { hasAudio: true }, undefined]) {
        const context = fixture(false);
        context.cuts = [{ src: 'src' }];
        context.editSources = [{ id: 'src', declaredPath: 'clip.mp4', declaredProxy: 'silent-proxy.mp4' }];
        context.timelineTreeRows = [];
        context.timelineSelectionFromElement = () => cutSelection;
        context.closeAnnotationPopup = () => {};
        context.resolveEditMediaUri = path => path;
        let calls = 0;
        context.annotationsService = { probeSourceHasAudio: async request => {
            calls++;
            assert.deepEqual(request, { path: 'clip.mp4' });
            if (!result) throw new Error('unavailable');
            return result;
        } };
        await context.openTimelineClipContextMenu({ preventDefault() {}, clientX: 1, clientY: 2 }, { dataset: {}, isConnected: true });
        assert.equal(calls, 1);
        assert.equal(openedMenu.items.find(entry => entry.id === 'split-audio').disabled, result?.hasAudio === false ? true : undefined);
        assert.equal(menuEvents.size, 0);
        context.editDocument = structuredClone(context.editDocument);
        openedMenu.onSelect('split-audio', { altKey: false });
        assert.equal(context.commitCount, 0, 'stale menus cannot address a different cut index');
    }
});

test('linked move rejects a negative partner position atomically; unlink then moves independently', async () => {
    const context = fixture();
    await context.commitEditMutation('offset', doc => mutations.updateItem(doc, { itemId: 'cut-audio', patch: { at: 0 } }));
    context.history = [];
    const before = structuredClone(context.editDocument);
    await context.commitDrag({ kind: 'cut-move', index: 0, at: 1 });
    assert.deepEqual(context.editDocument, before);
    assert.equal(context.history.length, 0);
    assert.match(context.notices.join('\n'), /先頭より前/);
    context.dispatchTimelineClipMenuAction('unlink-audio', audioSelection, 0);
    await context.pending;
    await context.commitDrag({ kind: 'audio', id: 'cut-audio', t: 1 });
    assert.equal(item(context.editDocument, 'cut-audio').at, 30);
    assert.equal(item(context.editDocument, 'cut').at, 90);
});

test('probe memoizes concurrent calls, uses the semaphore and ffprobe audio selector, and retries failures', async () => {
    const ast = ts.createSourceFile('media.ts', read('node/media-cache.ts'), ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'probeSourceHasAudio');
    const transpiled = ts.transpileModule(fn.getText(ast).replace('export ', ''), {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    let calls = 0;
    let runs = 0;
    let fail = false;
    const probe = new Function('sourceHasAudioCache', 'ffprobePath', 'videoExtractionSemaphore', 'execFileAsync',
        `${transpiled}; return probeSourceHasAudio;`)(new Map(), async () => 'ffprobe', { run: fn => { runs++; return fn(); } },
        async (_bin, args) => {
            calls++;
            assert.deepEqual(args.slice(0, 8), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'json']);
            if (fail) throw new Error('probe failed');
            return { stdout: JSON.stringify({ streams: args.at(-1) === 'silent.mp4' ? [] : [{ codec_type: 'audio' }] }) };
        });
    const first = probe('clip.mp4');
    assert.equal(probe('clip.mp4'), first);
    assert.deepEqual(await first, { hasAudio: true });
    assert.deepEqual(await probe('silent.mp4'), { hasAudio: false });
    assert.equal(calls, 2);
    assert.equal(runs, 2);
    fail = true;
    await assert.rejects(probe('retry.mp4'), /probe failed/);
    fail = false;
    assert.deepEqual(await probe('retry.mp4'), { hasAudio: true });
    assert.equal(calls, 4);
});
