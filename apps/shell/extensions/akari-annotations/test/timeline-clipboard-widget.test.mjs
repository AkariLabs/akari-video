import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as clipboard from '../lib/common/timeline-clipboard.js';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import * as captions from '../lib/common/caption-store.js';

// 既存の widget テストと同様、実メソッドを抽出してファイル I/O と DOM だけを差し替える。
const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['clipboardSelections', 'clipboardTracks', 'fragmentForSelection', 'copySelectedItem', 'cutSelectedItems',
    'pasteClipboard', 'duplicateSelectedItems', 'queueClipboardMutation', 'readClipboardSnapshot', 'commitTimelineSnapshot',
    'pasteFragment', 'nextCopyId', 'frameAt', 'performEditMutation'];
const dependencies = {
    ...clipboard, ...mutations, ...captions,
    insertV2Item: mutations.insertItem, insertV2Track: mutations.insertTrack,
    splitV2Item: mutations.splitItem, updateV2Item: mutations.updateItem, removeV2Item: mutations.removeItem,
    navigator: { clipboard: { writeText: () => Promise.reject(new Error('権限なし')) } }
};
const code = ts.transpileModule(`class Handler { ${names.map(name => {
    const method = widget.members.find(member => member.name?.getText(source) === name);
    assert.ok(method, name);
    return method.getText(source);
}).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
delete dependencies.default;
delete dependencies['module.exports'];
const Handler = new Function(...Object.keys(dependencies), `${code}; return Handler;`)(...Object.values(dependencies));

const visual = (id, at, duration) => ({ id, at, duration, source: { kind: 'media', src: 'src', in: 0, out: duration / 30 } });
function fixture() {
    const h = new Handler();
    let disk = JSON.stringify({ version: 2, output: { fps: 30 }, sources: [{ id: 'src', path: 'clip.mp4' }], tracks: [
        { id: 'a1', lane: 'audio', items: [{ ...visual('sfx', 30, 60), role: 'sfx' }] },
        { id: 'main', lane: 'visual', items: [visual('cut', 0, 300)] },
        { id: 'v2', lane: 'visual', items: [visual('layer', 30, 60)] },
        { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
    ] });
    let captionDisk = JSON.stringify([{ id: 'caption', start: 1, end: 3, text: '字幕', speaker: null, sourceRef: null, edited: true, time_domain: 'output' }]);
    h.location = { editUri: 'edit', captionsUri: 'captions', root: '.' };
    h.fps = 30;
    h.editMutationTail = Promise.resolve();
    h.pasteTargetTracks = new Set();
    h.displayTimelineTracks = [{ id: 'a1', kind: 'audio', ref: 0 }, { id: 'main', kind: 'cuts', ref: 0 },
        { id: 'v2', kind: 'layers', ref: 0 }, { id: 'captions', kind: 'captions', ref: 0 }];
    h.expandedTimelineTreeRows = [];
    h.multiSelection = [{ kind: 'cut', index: 0 }, { kind: 'layer', id: 'layer' }, { kind: 'caption', id: 'caption' }, { kind: 'audio', id: 'sfx' }];
    h.cutItemId = () => 'cut';
    h.captionRangeToOutputRanges = (_id, start, end) => [[start, end]];
    h.isTrackLocked = () => false;
    h.deepCopy = structuredClone;
    h.contentEndDuration = () => 10;
    h.footer = {};
    h.history = [];
    h.writes = 0;
    h.showNotice = message => { h.error = message; };
    h.hideNotice = () => {};
    h.applySelection = selection => { h.selection = selection; h.multiSelection = []; };
    h.fileService = { readFile: async uri => ({ value: uri === 'edit' ? disk : captionDisk }) };
    h.prepareMotionChanges = async () => [];
    h.writeMotionChanges = async () => {};
    h.writeEditSnapshotGuarded = async (edit, caption) => { disk = edit; if (caption !== undefined) captionDisk = caption; h.writes++; };
    h.pushHistory = entry => h.history.push(entry);
    h.errorMessage = error => error.message;
    h.reloadEdit = async () => {
        h.editDocument = JSON.parse(disk);
        h.itemLocations = mutations.indexEditV2Items(h.editDocument);
        h.audioSfx = h.editDocument.tracks[0].items.filter(item => item.role === 'sfx').map(item => ({ id: item.id, t: item.at / 30, duration: item.duration / 30 }));
    };
    h.reloadCaptions = async () => { h.captions = captions.parseCaptions(captionDisk).captions; };
    h.trackIdOfItem = id => id === 'caption' ? 'captions' : h.itemLocations.get(id)?.trackId;
    h.trackIdOfSelection = selection => h.trackIdOfItem(selection.kind === 'cut' ? 'cut' : selection.id);
    h.read = () => ({ edit: JSON.parse(disk), captions: JSON.parse(captionDisk) });
    return Promise.all([h.reloadEdit(), h.reloadCaptions()]).then(() => h);
}

test('複数種別の貼り付けは保存・履歴が 1 回で、Undo / Redo は字幕もまとめて戻す', async () => {
    const h = await fixture();
    const before = h.read();
    assert.equal(h.copySelectedItem(), true);
    assert.equal(h.clipboard.items.length, 4);
    h.playheadT = 6;
    await h.pasteClipboard();
    assert.equal(h.error, undefined);
    assert.equal(h.history.length, 1);
    assert.equal(h.writes, 1);
    const after = h.read();
    assert.equal(after.edit.tracks.find(t => t.id === 'main').items.length, 3);
    assert.deepEqual(after.edit.tracks.find(t => t.id === 'v2').items.map(i => i.at), [30, 210]);
    assert.equal(after.captions.length, 2);
    await h.history[0].undo();
    assert.deepEqual(h.read(), before);
    await h.history[0].redo();
    assert.deepEqual(h.read(), after);
});

test('OS 書き込みが失敗しても切り取り断片をメモリに残し、一括 Undo できる', async () => {
    const h = await fixture();
    const before = h.read();
    await h.cutSelectedItems();
    assert.equal(h.error, undefined);
    assert.equal(h.clipboard.items.length, 4);
    assert.equal(h.history.length, 1);
    assert.equal(h.read().captions.length, 0);
    assert.equal(h.read().edit.tracks.flatMap(t => t.items ?? []).length, 0);
    await h.history[0].undo();
    assert.deepEqual(h.read(), before);
});

test('BGM とナレーションは複数選択に含まれても断片へ入れない', async () => {
    const h = await fixture();
    h.editDocument.tracks[0].items.push({ ...visual('bgm', 0, 300), role: 'bgm' }, { ...visual('narration', 0, 90), role: 'narration' });
    h.itemLocations = mutations.indexEditV2Items(h.editDocument);
    h.multiSelection = [{ kind: 'audio', id: 'bgm' }, { kind: 'audio', id: 'narration' }, { kind: 'audio', id: 'sfx' }];
    assert.equal(h.copySelectedItem(), true);
    assert.deepEqual(h.clipboard.items.map(i => i.payload.id), ['sfx']);
});

test('種別が違う貼り先はファイルも履歴も変更せずフッターへ理由を返す', async () => {
    const h = await fixture();
    h.multiSelection = [{ kind: 'layer', id: 'layer' }];
    h.copySelectedItem();
    h.pasteTargetTracks.add('a1');
    h.playheadT = 4;
    const before = h.read();
    await h.pasteClipboard();
    assert.match(h.footer.textContent, /種別/);
    assert.equal(h.writes, 0);
    assert.equal(h.history.length, 0);
    assert.deepEqual(h.read(), before);
});

test('切り取り後も選択外の分離音声を残し、削除した映像へのリンクを解除する', async () => {
    const h = await fixture();
    const edit = h.read().edit;
    edit.tracks[0].items[0].link = 'cut';
    await h.writeEditSnapshotGuarded(JSON.stringify(edit));
    await h.reloadEdit();
    h.multiSelection = [{ kind: 'cut', index: 0 }];
    await h.cutSelectedItems();
    assert.equal(h.error, undefined);
    assert.equal(h.read().edit.tracks[0].items.length, 1);
    assert.equal(h.read().edit.tracks[0].items[0].link, undefined);
    assert.equal(h.history.length, 1);
    await h.history[0].undo();
    assert.equal(h.read().edit.tracks[0].items[0].link, 'cut');
});
