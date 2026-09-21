import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import { materialOverlapInsertIndex } from '../lib/common/material-drop-overlap.js';
import { computeMaterialGhostRange, materialGhostVisibility } from '../lib/common/timeline-material-insert.js';
import { hitTestTimelineTrackDrop } from '../lib/common/timeline-track-drop.js';
import { libraryAssetGhostPayload } from '../lib/browser/library-drop-model.js';

// 既存 library-asset-placement と同じく実メソッドを実行し、DOM と I/O だけを差し替える。
const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['addMaterialAt', 'addMaterialAtPlayhead', 'addMaterialAtPoint', 'placeMaterialAtTarget',
    'resolveMaterialDropTarget', 'timelineTrackDropLayouts', 'materialDropTargetWithoutOverlap',
    'materialGhostDurationSeconds', 'updateMaterialGhost', 'hideMaterialGhost', 'handleMaterialDragOver',
    'positionInsertionGhost', 'showTrackInsertIndicatorAt', 'hideTrackInsertIndicator', 'handleMaterialDrop', 'setGhostRejected'];
const methods = names.map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source));
const parser = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'parseMaterialDragPayload').getText(source);
const code = ts.transpileModule(`${parser}\nclass Handler { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const bindings = {
    indexEditV2Items: mutations.indexEditV2Items, stringifyEditV2: mutations.stringifyEditV2,
    insertAudioSfxPreferV2: mutations.insertAudioSfxPreferV2,
    insertV2Track: mutations.insertTrack, insertV2Item: mutations.insertItem,
    updateV2Item: mutations.updateItem, materialOverlapInsertIndex, computeMaterialGhostRange,
    materialGhostVisibility, hitTestTimelineTrackDrop, libraryAssetGhostPayload, lockedTrackMessage: id => `locked: ${id}`,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS: 5, MATERIAL_INSERT_FALLBACK_DURATION_SECONDS: 3,
    SUBROW_STRIDE: 32, LANE_GAP: 4
};
const Handler = new Function(...Object.keys(bindings), `${code}\nreturn Handler;`)(...Object.values(bindings));

const item = (id, at = 0, duration = 180) => ({ id, at, duration, source: { kind: 'media', src: 'base', in: 0, out: duration / 30 } });
const track = (id, lane, items = []) => ({ id, lane, items });
function fixture(tracks = [track('v1', 'visual', [item('base-clip')]), track('v2', 'visual')]) {
    const before = JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'base', path: 'assets/base.mp4' }], tracks }, null, 4) + '\n';
    let text = before;
    let probes = 0;
    const history = [], errors = [], writes = [];
    const uri = { toString: () => 'file:///project/edit.json', path: { fsPath: () => '/project' } };
    const handler = Object.assign(new Handler(), {
        location: { root: uri, editUri: uri }, fps: 30, playheadT: 3,
        frameAt: t => Math.round(t * 30), resolveEditMediaUri: () => uri,
        fileService: { readFile: async () => ({ value: { toString: () => text } }) },
        writeTimelineSnapshots: async next => { text = next; writes.push(next); },
        reloadEdit: async () => { handler.editDocument = JSON.parse(text); },
        pushHistory: entry => history.push(entry),
        annotationsService: {
            getAudioDuration: async () => { probes++; return { status: 'ready', durationSeconds: 10 }; },
            measureAudioForLevel: async () => ({ ok: true, gain_db: -3, fade_in: 0, fade_out: 0, basis: 'test', role: 'sfx' })
        },
        messages: { warn: m => errors.push(m), error: m => errors.push(m) },
        errorMessage: error => error.message, showNotice: m => errors.push(m), hideNotice() {},
        revealOutputPreview() {}, beyondCutsEndNote: () => '', footer: { textContent: '' },
        notice: { hasMessage: () => false, node: { textContent: '' } },
        materialDurationCache: new Map(), editDocument: JSON.parse(text),
        isTrackLocked: id => id !== undefined && handler.lockedId === id,
        showLockedTrack: id => errors.push(`locked: ${id}`),
        computeTrackAutoNames: () => new Map(),
        strip: { getBoundingClientRect: () => ({ top: 0 }) },
        stripScroll: { scrollTop: 0, clientHeight: 400 }, rulerRowHeightPx: () => 14,
        materialDropTime: x => x / 10,
        materialGhost: { style: { boxSizing: 'border-box' }, dataset: {}, classList: {
            names: new Set(),
            toggle(name, on) { if (on) this.names.add(name); else this.names.delete(name); },
            contains(name) { return this.names.has(name); }
        } }, trackInsertIndicator: { style: {} },
        setGhostRange: (ghost, start, end) => { ghost.range = [start, end]; },
        hideSnapGuide() {}, isMaterialDragTransfer: () => true,
        materialPanelDropPoint: (x, y) => ({ x, y, zone: 'strip' }), updateMaterialDragAutoScroll() {}
    });
    handler.displayTimelineTracks = tracks;
    const layouts = [...tracks].reverse().map((t, i) => ({ id: t.id, track: i, top: i * 40, height: 32 }));
    handler.laneLayout = { tracks: layouts, audioTracks: layouts.filter(l => tracks.find(t => t.id === l.id).lane === 'audio') };
    return { handler, history, errors, writes, before, text: () => text, doc: () => JSON.parse(text), probes: () => probes };
}

function drag(f, kind, t, id) {
    const row = f.handler.laneLayout.tracks.find(row => row.id === id);
    f.handler.materialDragPayload = { kind, relativePath: `assets/new.${kind === 'audio' ? 'mp3' : 'mp4'}` };
    const event = { clientX: t * 10, clientY: row.top + row.height / 2,
        dataTransfer: {}, preventDefault() {}, stopPropagation() {} };
    f.handler.handleMaterialDragOver(event);
    return event;
}

async function assertOneUndo(f) {
    assert.deepEqual(f.errors, []);
    assert.equal(f.history.length, 1, 'トラックと item を合わせて履歴は1手');
    assert.equal(f.writes.length, 1, '途中の空トラックは保存しない');
    const after = f.text();
    await f.history[0].undo();
    assert.equal(f.text(), f.before, 'Undo 1回で edit.json が byte 一致');
    await f.history[0].redo();
    assert.equal(f.text(), after);
}

for (const kind of ['video', 'image', 'audio']) {
    test(`dragover: ${kind} は重なる位置で挿入表示、空きへ移動すると行表示に戻る`, () => {
        const lane = kind === 'audio' ? 'audio' : 'visual';
        const f = fixture([track('target', lane, [item('existing')])]);
        assert.equal(drag(f, kind, 3, 'target').dataTransfer.dropEffect, 'copy');
        assert.equal(f.handler.trackInsertIndicator.style.display, 'block');
        assert.equal(f.handler.trackInsertIndicator.style.top, kind === 'audio' ? '46px' : '14px');
        assert.equal(f.handler.materialGhost.dataset.akariInsertionPreview, 'true');
        assert.match(f.handler.footer.textContent, /重なるので新しいトラック/);
        drag(f, kind, 6, 'target');
        assert.equal(f.handler.trackInsertIndicator.style.display, 'none');
        assert.equal(f.handler.materialGhost.dataset.akariInsertionPreview, undefined);
        assert.equal(f.handler.materialGhost.style.border, '1px dashed #4dd0c8');
        assert.equal(f.handler.footer.textContent, '');
        assert.equal(f.text(), f.before, 'ドラッグ表示では保存しない');
    });
}

test('ロック行・レーン違いの拒否と本編・行間・音0本のターゲットを保つ', () => {
    const f = fixture([track('a1', 'audio', [item('sound')]), track('v1', 'visual', [item('clip')]), track('v2', 'visual')]);
    f.handler.lockedId = 'v1';
    assert.equal(drag(f, 'video', 3, 'v1').dataTransfer.dropEffect, 'none');
    assert.equal(f.handler.materialGhost.style.display, 'block');
    assert.equal(f.handler.materialGhost.textContent, 'locked: v1');
    f.handler.lockedId = undefined;
    assert.equal(drag(f, 'audio', 3, 'v1').dataTransfer.dropEffect, 'none');
    assert.equal(drag(f, 'video', 3, 'a1').dataTransfer.dropEffect, 'none');
    const gap = f.handler.resolveMaterialDropTarget('video', 36);
    assert.equal(gap.insertIndex, 2);
    assert.equal(f.handler.materialDropTargetWithoutOverlap(gap, 3, 3), gap);
    const cuts = { zone: 'cuts', targetTrackId: 'v1', rejected: false };
    assert.equal(f.handler.materialDropTargetWithoutOverlap(cuts, 3, 3), cuts);
    const emptyAudio = fixture().handler.resolveMaterialDropTarget('audio', 100);
    assert.equal(emptyAudio.createAudioTrack, true);
    assert.equal(emptyAudio.rejected, false);
});

for (const kind of ['video', 'audio']) {
    test(`確定時: 仮尺3秒なら空きでも実尺10秒で重なる ${kind} を隣の新規行へ置く`, async () => {
        const lane = kind === 'audio' ? 'audio' : 'visual';
        const f = fixture([track('lower', lane), track('target', lane, [item('next', 180, 180)]), track('upper', lane)]);
        drag(f, kind, 1, 'target');
        assert.equal(f.handler.trackInsertIndicator.style.display, 'none');
        await f.handler.addMaterialAtPoint('assets/new.mp4', kind, 10, 56);
        assert.equal(f.probes(), 1, 'drop 後に実尺を取得');
        const after = f.doc();
        const createdIndex = kind === 'audio' ? 1 : 2;
        assert.equal(after.tracks.length, 4);
        assert.deepEqual(after.tracks.find(t => t.id === 'target'), JSON.parse(f.before).tracks[1]);
        assert.deepEqual(after.tracks.filter(t => ['lower', 'upper'].includes(t.id)), [JSON.parse(f.before).tracks[0], JSON.parse(f.before).tracks[2]]);
        assert.equal(after.tracks[createdIndex].items[0].at, 30);
        assert.equal(after.tracks[createdIndex].items[0].duration, 300);
        if (kind === 'audio') assert.equal(after.tracks[createdIndex].items[0].gain_db, -3);
        await assertOneUndo(f);
    });
}

for (const kind of ['video', 'image']) {
    test(`プレイヘッド追加: ${kind} は重なる対象行のすぐ上へ置き、Undo 1手`, async () => {
        const f = fixture();
        await f.handler.addMaterialAtPlayhead('assets/new.png', kind);
        assert.equal(f.doc().tracks.length, 3);
        assert.equal(f.doc().tracks[1].items[0].at, 90);
        assert.equal(f.doc().tracks[1].items[0].duration, kind === 'image' ? 150 : 300);
        assert.deepEqual(f.doc().tracks[0], JSON.parse(f.before).tracks[0]);
        assert.equal(f.doc().tracks[2].id, 'v2');
        await assertOneUndo(f);
    });
}

test('プレイヘッド音声追加は audio.sfx[] のままで音トラックを作らない', async () => {
    const f = fixture([track('a1', 'audio', [item('sound')]), track('v1', 'visual')]);
    f.handler.annotationsService.measureAudioForLevel = async () => ({ ok: false, reason: 'test' });
    await f.handler.addMaterialAtPlayhead('assets/new.mp3', 'audio');
    assert.deepEqual(f.doc().tracks, JSON.parse(f.before).tracks);
    assert.equal(f.doc().audio.sfx[0].t, 3);
    await assertOneUndo(f);
});

test('実尺が端で接する配置ではトラックを増やさない', async () => {
    const f = fixture([track('v1', 'visual', [item('next', 330, 60)])]);
    await f.handler.addMaterialAtPoint('assets/new.mp4', 'video', 10, 16);
    assert.equal(f.doc().tracks.length, 1);
    assert.equal(f.doc().tracks[0].items.length, 2);
    await assertOneUndo(f);
});

test('行間へ落とす場合は既存の挿入指定を保ち、余分な行を作らない', async () => {
    const f = fixture();
    await f.handler.addMaterialAtPoint('assets/new.mp4', 'video', 30, 36);
    assert.equal(f.doc().tracks.length, 3);
    assert.deepEqual(f.doc().tracks.map(t => t.items.length), [1, 1, 0]);
    await assertOneUndo(f);
});

test('音トラック0本へのドロップは従来どおり新規行を作る', async () => {
    const f = fixture();
    await f.handler.addMaterialAtPoint('assets/new.mp3', 'audio', 30, 100);
    assert.equal(f.doc().tracks.length, 3);
    assert.equal(f.doc().tracks[0].lane, 'audio');
    assert.equal(f.doc().tracks[0].items[0].at, 90);
    await assertOneUndo(f);
});

test('仮尺では重なっていても実尺が短ければ不要なトラックを作らない', async () => {
    const f = fixture([track('v1', 'visual', [item('next', 90, 60)])]);
    drag(f, 'video', 1, 'v1');
    assert.equal(f.handler.trackInsertIndicator.style.display, 'block');
    f.handler.annotationsService.getAudioDuration = async () => ({ status: 'ready', durationSeconds: 2 });
    await f.handler.addMaterialAtPoint('assets/new.mp4', 'video', 10, 16);
    assert.equal(f.doc().tracks.length, 1);
    assert.equal(f.doc().tracks[0].items[1].duration, 60);
    await assertOneUndo(f);
});

test('hideMaterialGhost は拒否クラスを外し、オレンジの outline と初期スタイルへ戻す', () => {
    const f = fixture([track('a1', 'audio'), track('v1', 'visual')]);
    const h = f.handler;
    drag(f, 'audio', 3, 'v1');
    assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), true);
    assert.equal(h.materialGhost.style.outline, '2px solid #f14c4c');
    h.hideMaterialGhost();
    assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), false);
    assert.equal(h.materialGhost.textContent, '');
    assert.equal(h.materialGhost.dataset.akariInsertionPreview, undefined);
    for (const [key, value] of Object.entries({
        display: 'none', outline: '2px solid #f97316', border: '1px dashed #4dd0c8',
        background: 'rgba(77, 208, 200, .22)', opacity: '', zIndex: '10', color: '', fontSize: '', whiteSpace: ''
    })) assert.equal(h.materialGhost.style[key], value, key);
    assert.equal(h.trackInsertIndicator.style.display, 'none');
});

test('拒否理由は枠内で折り返し、受理時と hide 後は whiteSpace / overflow / padding を含む文字スタイルを消す', () => {
    const f = fixture([track('a1', 'audio'), track('v1', 'visual')]);
    const h = f.handler;
    const rejectedStyles = {
        whiteSpace: 'normal', overflow: 'hidden', wordBreak: 'break-all', lineHeight: '1.2',
        padding: '2px 4px', fontSize: '11px'
    };
    for (const reset of [() => drag(f, 'audio', 3, 'a1'), () => h.hideMaterialGhost()]) {
        drag(f, 'audio', 3, 'v1');
        for (const [key, value] of Object.entries(rejectedStyles)) {
            assert.equal(h.materialGhost.style[key], value, `拒否中: ${key}`);
        }
        assert.equal(h.materialGhost.style.boxSizing, 'border-box', '拒否中も初期値を維持');
        reset();
        for (const key of Object.keys(rejectedStyles)) {
            assert.equal(h.materialGhost.style[key], '', `リセット後: ${key}`);
        }
        assert.equal(h.materialGhost.style.boxSizing, 'border-box', '受理時・hide 後も初期値を維持');
    }
});

for (const y of [-10, 36, 200]) {
    test(`拒否された行外位置 y=${y} では fallback の行に描かずゴーストを隠す`, () => {
        const f = fixture([track('a1', 'audio'), track('v1', 'visual')]);
        const h = f.handler;
        drag(f, 'audio', 3, 'v1');
        assert.equal(h.materialGhost.style.display, 'block');
        const target = h.resolveMaterialDropTarget('audio', y);
        assert.equal(target.rejected, true);
        assert.equal(target.top, 0, '最上段を指す fallback は表示に使わない');
        h.materialDropTime = () => assert.fail('行が無ければ描画計算へ進まない');
        h.updateMaterialGhost(30, y);
        assert.equal(h.materialGhost.style.display, 'none');
        assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), false);
        assert.equal(h.materialGhost.style.outline, '2px solid #f97316');
        assert.equal(h.materialGhost.textContent, '');
        assert.equal(f.text(), f.before);
    });
}

for (const kind of ['video', 'image', 'audio']) {
    test(`拒否表示の純関数: ${kind} は挿入指定が残っていても赤い本体だけを表示`, () => {
        assert.deepEqual(materialGhostVisibility(kind, { rejected: true, insertTrack: 2, overlapInsert: true }),
            { showGhost: true, showInsertIndicator: false, rejected: true });
    });
    for (const origin of ['material', 'asset']) {
        for (const locked of [false, true]) {
            test(`${origin} / ${kind}: ${locked ? 'ロック行' : '異種レーン'}の赤い枠・理由から通常表示へ戻り、拒否 drop は保存しない`, () => {
                const lane = kind === 'audio' ? 'audio' : 'visual';
                const otherLane = lane === 'audio' ? 'visual' : 'audio';
                const f = fixture([track('valid', lane, [item('existing')]),
                    track('reject', locked ? lane : otherLane), track('top', otherLane)]);
                const h = f.handler;
                h.lockedId = locked ? 'reject' : undefined;
                h.stripScroll.scrollTop = 7;
                const asset = { kind: 'asset', key: 'sample', id: 'sample', title: '素材',
                    category: kind === 'audio' ? 'audio' : kind === 'image' ? 'still' : 'broll' };
                const payload = origin === 'asset' ? libraryAssetGhostPayload(asset)
                    : { kind, relativePath: `assets/new.${kind === 'audio' ? 'mp3' : 'mp4'}` };
                const hover = id => {
                    h.materialDragPayload = payload;
                    const row = h.laneLayout.tracks.find(row => row.id === id);
                    const event = { clientX: 30, clientY: row.top + row.height / 2,
                        dataTransfer: {}, preventDefault() {}, stopPropagation() {} };
                    h.handleMaterialDragOver(event);
                    return event;
                };
                hover('valid');
                assert.equal(h.trackInsertIndicator.style.display, 'block');
                const rejectedEvent = hover('reject');
                const reason = locked ? 'locked: reject' : kind === 'audio'
                    ? '映像のレーンには音を置けません。' : '音のレーンには映像を置けません。';
                assert.equal(rejectedEvent.dataTransfer.dropEffect, 'none');
                assert.equal(h.materialGhost.style.display, 'block');
                assert.equal(h.materialGhost.style.top, '47px', '最上段への fallback ではなく実際の行に描く');
                assert.equal(h.materialGhost.style.height, '32px');
                assert.deepEqual(h.materialGhost.range, [3, kind === 'image' ? 8 : 6]);
                assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), true);
                assert.equal(h.materialGhost.style.border, '2px solid #f14c4c');
                assert.equal(h.materialGhost.style.outline, '2px solid #f14c4c');
                assert.equal(h.materialGhost.style.color, '#f14c4c');
                assert.equal(h.materialGhost.style.background, 'rgba(241, 76, 76, .25)');
                assert.equal(h.materialGhost.textContent, reason);
                assert.equal(h.footer.textContent, reason);
                assert.equal(h.materialGhost.dataset.akariInsertionPreview, undefined);
                assert.equal(h.trackInsertIndicator.style.display, 'none');

                hover('valid');
                assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), false);
                assert.equal(h.materialGhost.textContent, '');
                assert.equal(h.materialGhost.style.background, 'rgba(77, 208, 200, .22)');
                assert.equal(h.trackInsertIndicator.style.display, 'block');
                assert.equal(h.materialGhost.style.border, '2px solid #f97316');
                h.materialDropTime = () => 9;
                hover('valid');
                assert.equal(h.trackInsertIndicator.style.display, 'none');
                assert.equal(h.materialGhost.style.border, '1px dashed #4dd0c8');
                assert.equal(h.materialGhost.style.outline, '2px solid #f97316');

                hover('reject');
                h.stopMaterialDragAutoScroll = () => {};
                h.readLibraryAssetDropPayload = () => origin === 'asset' ? asset : undefined;
                h.readMaterialDropPayload = () => payload;
                h.clearLibraryTransitionDragState = () => {};
                h.placeLibraryAssetAtTarget = () => assert.fail('拒否時はライブラリから取り込まない');
                f.errors.length = 0;
                h.handleMaterialDrop(rejectedEvent);
                assert.equal(h.materialGhost.style.display, 'none');
                assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), false);
                assert.equal(h.materialGhost.textContent, '');
                assert.equal(h.materialGhost.style.border, '1px dashed #4dd0c8');
                assert.equal(h.materialGhost.style.outline, '2px solid #f97316');
                assert.equal(h.materialGhost.style.background, 'rgba(77, 208, 200, .22)');
                assert.equal(f.text(), f.before);
                assert.equal(f.writes.length, 0);
                assert.equal(f.probes(), 0);
                assert.deepEqual(f.errors, locked || origin === 'asset' ? [reason] : []);
                hover('valid');
                assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), false);
                assert.equal(h.materialGhost.style.border, '1px dashed #4dd0c8');
                assert.equal(h.materialGhost.style.outline, '2px solid #f97316');
                hover('reject');
                h.materialDragPayload = undefined;
                h.updateMaterialGhost(30, 56);
                assert.equal(h.materialGhost.style.display, 'none');
                assert.equal(h.materialGhost.classList.contains('akari-annotations-ghost-rejected'), false);
                assert.equal(h.materialGhost.textContent, '');
            });
        }
    }
}
