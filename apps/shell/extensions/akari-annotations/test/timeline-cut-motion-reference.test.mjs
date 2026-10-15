import { t } from '@akari-video/i18n';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readSourceFile, findMember } from './helpers/widget-source.mjs';
import uriModule from '@theia/core/lib/common/uri.js';
import { BinaryBuffer } from '@theia/core/lib/common/buffer.js';
import { cutMotionReferencePaths, hydrateCutMotionReferences, restoreUncutMotionReferences,
    serializeMotion } from '@akari-video/edit-store';
import { pinAutomaticBgmDuration, prepareV2KeyframeDistribution,
    stringifyEditV2 } from '../lib/common/edit-v2-mutations.js';
import { runTimelineCutKernel } from '../lib/common/timeline-cut-kernel.js';

const URI = uriModule.default ?? uriModule;
const names = ['commitEditMutation', 'performEditMutation', 'commitTimelineRipple', 'applyHydratedCutKernel',
    'prepareMotionChanges', 'writeMotionChanges'];
const sourceFile = readSourceFile('widget').ast;
const members = names.map(name => findMember(name, { in: 'widget' }).node.getText(sourceFile)).join('\n');
const code = ts.transpileModule(`class Timeline { ${members} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies = { cutMotionReferencePaths, hydrateCutMotionReferences, restoreUncutMotionReferences,
    serializeMotion, pinAutomaticBgmDuration, prepareV2KeyframeDistribution, stringifyEditV2,
    runTimelineCutKernel, BinaryBuffer, t };
const Timeline = new Function(...Object.keys(dependencies), `${code}\nreturn Timeline;`)(...Object.values(dependencies));
const times = [0, 398, 400, 401, 402, 403, 441, 450, 936];
const points = times.map((t, index) => ({ t, transform: { scale: index === 0 || index === 8 ? 1 : 1.1 } }));
const edit = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'video', path: 'video.mp4' }, { id: 'other', path: 'other.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'sample-split', at: 152, duration: 936,
            source: { kind: 'media', src: 'video', in: 0, out: 936 / 30 },
            keyframes: { path: 'motion/sample-split.json', count: 9 } },
        { id: 'other', at: 1200, duration: 100,
            source: { kind: 'media', src: 'other', in: 0, out: 100 / 30 },
            keyframes: { path: 'motion/other.json', count: 2 } }
    ] }] });

function fixture() {
    const timeline = new Timeline();
    const root = new URI('file:///project');
    const editUri = root.resolve('edit.json');
    const texts = new Map([
        [editUri.toString(), `${JSON.stringify(edit(), null, 2)}\n`],
        [root.resolve('motion/sample-split.json').toString(), serializeMotion({ version: 0,
            group: 'sample-split', items: { 'sample-split': structuredClone(points) } })],
        [root.resolve('motion/other.json').toString(), serializeMotion({ version: 0, group: 'other', items: { other: [
            { t: 0, transform: { scale: 1 } }, { t: 100, transform: { scale: 1 } }
        ] } })]
    ]);
    const history = [];
    const notices = [];
    timeline.location = { root, editUri };
    timeline.fileService = {
        readFile: async uri => {
            if (!texts.has(uri.toString())) throw new Error('見つかりません');
            return { value: { toString: () => texts.get(uri.toString()) } };
        },
        createFolder: async () => undefined,
        writeFile: async (uri, value) => { texts.set(uri.toString(), value.toString()); },
        delete: async uri => { texts.delete(uri.toString()); }
    };
    timeline.editMutationTail = Promise.resolve();
    timeline.frameAt = seconds => Math.round(seconds * 30);
    timeline.contentEndDuration = () => 50;
    timeline.prepareMotionChanges = Timeline.prototype.prepareMotionChanges;
    timeline.writeMotionChanges = Timeline.prototype.writeMotionChanges;
    timeline.writeEditSnapshotGuarded = async next => { texts.set(editUri.toString(), next); };
    timeline.reloadEdit = async () => undefined;
    timeline.pushHistory = entry => history.push(entry);
    timeline.revealOutputPreview = () => undefined;
    timeline.showNotice = message => notices.push(message);
    timeline.errorMessage = error => error.message;
    timeline.footer = { textContent: '' };
    return { timeline, texts, root, editUri, history, notices };
}

async function checkReferences(fixture) {
    const document = JSON.parse(fixture.texts.get(fixture.editUri.toString()));
    for (const track of document.tracks) for (const item of track.items) {
        if (!item.keyframes || Array.isArray(item.keyframes)) continue;
        const bag = JSON.parse(fixture.texts.get(fixture.root.resolve(item.keyframes.path).toString()));
        assert.equal(bag.items[item.id].length, item.keyframes.count);
    }
    return document;
}

for (const localFrame of [148, 900]) test(`分割 ${localFrame} フレームは袋と edit を一履歴で戻せる`, async () => {
    const state = fixture();
    const originalEdit = JSON.parse(state.texts.get(state.editUri.toString()));
    const originalBag = state.texts.get(state.root.resolve('motion/sample-split.json').toString());
    const otherBag = state.texts.get(state.root.resolve('motion/other.json').toString());
    await state.timeline.commitTimelineRipple('再生ヘッドで分割', doc => runTimelineCutKernel(doc,
        { kind: 'split', frame: 152 + localFrame, itemIds: ['sample-split'], lockedTrackIds: [] }));
    assert.equal(state.notices.length, 0);
    assert.equal(state.history.length, 1);
    const after = await checkReferences(state);
    assert.equal(after.tracks[0].items.filter(item => item.source.src === 'video').length, 2);
    assert.deepEqual(after.tracks[0].items.find(item => item.id === 'other').keyframes,
        originalEdit.tracks[0].items[1].keyframes);
    assert.equal(state.texts.get(state.root.resolve('motion/other.json').toString()), otherBag);
    await state.history[0].undo();
    const undone = await checkReferences(state);
    assert.deepEqual(undone.tracks, originalEdit.tracks);
    assert.equal(state.texts.get(state.root.resolve('motion/sample-split.json').toString()), originalBag);
    await state.history[0].redo();
    await checkReferences(state);
});

test('袋が無ければ分割前に失敗し、画面に理由を出す', async () => {
    const state = fixture();
    const before = state.texts.get(state.editUri.toString());
    state.texts.delete(state.root.resolve('motion/sample-split.json').toString());
    await state.timeline.commitTimelineRipple('再生ヘッドで分割', doc => runTimelineCutKernel(doc,
        { kind: 'split', frame: 300, itemIds: ['sample-split'], lockedTrackIds: [] }));
    assert.equal(state.texts.get(state.editUri.toString()), before);
    assert.equal(state.history.length, 0);
    assert.match(state.notices[0], /再生ヘッドで分割を実行できません: .*袋を読み込めない/);
});
