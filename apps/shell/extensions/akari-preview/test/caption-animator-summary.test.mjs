import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { buildCaptionAnimatorSummaryFields as project } from '../lib/common/edit-summary-fields.js';
import { readPreviewInternalEdit } from '../lib/common/preview-items.js';

const animator = [{ id: 'a1', basis: 'chars', shape: 'ramp', start: 0, end: 0.3, offset: -0.3, amount: { opacity: -1 } }];
const keyframes = [{ t: 0, animator: { a1: { offset: -0.3 } } },
    { t: 0.51, ease: 'hold', animator: { a1: { offset: 1 } } }];
const captions = [
    { id: 'c1-part-1', sourceCueId: 'c1', start: 3, end: 4, text: '前半' },
    { id: 'c1-part-2', sourceCueId: 'c1', start: 4, end: 5, text: '後半' },
    { id: 'c2', start: 5, end: 6, text: '次' }
];
const item = (kind = 'captions', extra = {}) => ({
    at: 2, source: { kind, ...(kind === 'caption' ? { id: 'c1' } : {}) },
    declaration: { animator, keyframes }, ...extra
});
const internal = (...items) => ({ output: { fps: 30 }, tracks: [{ items }] });

test('袋宣言を全表示 cue に供給し、inline 秒を整数フレームへ戻す（入力は不変）', () => {
    const tree = internal(item());
    const before = structuredClone({ captions, tree });
    const result = project(captions, tree);
    for (let i = 0; i < captions.length; i++) {
        assert.deepEqual(result[i], { ...captions[i], animator, animatorStart: 2,
            animatorKeyframes: [{ ...keyframes[0], t: 0 }, { ...keyframes[1], t: 15 }] });
    }
    assert.deepEqual({ captions, tree }, before);
});

test('cue item は sourceCueId が一致する表示断片だけに供給する', () => {
    const result = project(captions, internal(item('caption')));
    assert.equal(result[0].animator, animator);
    assert.equal(result[1].animator, animator);
    assert.equal(result[2], captions[2]);
    assert.equal(project([{ id: 'c1' }], internal(item('caption')))[0].animator, animator);
});

test('袋の exclude を守り、分離 cue の宣言は袋に上書きされない', () => {
    const bag = item('captions', { source: { kind: 'captions', exclude: ['c1'] } });
    assert.equal(project(captions, internal(bag))[0], captions[0]);
    const cue = item('caption', { at: 3, declaration: { animator: [{ id: 'cue', basis: 'words' }] } });
    for (const items of [[bag, cue], [cue, bag]]) {
        assert.equal(project(captions, internal(...items))[0].animator[0].id, 'cue');
        assert.equal(project(captions, internal(...items))[0].animatorStart, 3);
    }
});

test('hidden item・hidden 親・hidden track は投影しない', () => {
    for (const hidden of [item('captions', { hidden: true }),
        item('captions', { declaration: { animator, hidden: true } }),
        item('group', { declaration: { hidden: true }, children: [item()] })]) {
        assert.deepEqual(project(captions, internal(hidden)), captions);
    }
    assert.deepEqual(project(captions, { output: { fps: 30 }, tracks: [{ hidden: true, items: [item()] }] }), captions);
    assert.equal(project(captions, internal(item('group', { children: [item()] })))[0].animator, animator);
});

test('解決済み sidecar の整数フレームは再変換せず、宣言なしではフィールドを増やさない', () => {
    const points = [{ t: 0 }, { t: 15, animator: { a1: { offset: 1 } } }];
    assert.deepEqual(project(captions, internal(item('captions', {
        keyframesRef: { path: 'motion/captions.json' }, declaration: { animator, keyframes: points }
    })))[0].animatorKeyframes, points);
    for (const declaration of [{}, { animator: [] }, { animator: null }]) {
        const result = project(captions, internal(item('captions', { declaration })));
        result.forEach((cue, i) => assert.equal(cue, captions[i]));
    }
    assert.equal(project(captions), captions);
});

test('実際の v2 読込から item の絶対開始秒と animator 点を復元する', () => {
    const tree = readPreviewInternalEdit(JSON.stringify({
        version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
        tracks: [{ id: 'text', lane: 'visual', items: [{ id: 'bag', at: 60, duration: 180,
            source: { kind: 'captions', path: 'captions.json' }, animator,
            keyframes: [{ t: 0, animator: { a1: { offset: -0.3 } } },
                { t: 15, animator: { a1: { offset: 1 } } }]
        }] }]
    }), true);
    const [cue] = project(captions, tree);
    assert.equal(cue.animatorStart, 2);
    assert.deepEqual(cue.animatorKeyframes.map(point => point.t), [0, 15]);
});

test('初期モデルと字幕差分更新は同じ純関数で宣言を供給する', async () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /const outputCaptions = buildCaptionAnimatorSummaryFields\(normalizePreviewCaptionClock\([\s\S]*?\), internal\)/);
    assert.match(source, /captions: outputCaptions,/);
    assert.match(source, /captions: buildCaptionAnimatorSummaryFields\(normalizePreviewCaptionClock\(captions, \[\]\), internal\)/);
    assert.equal(source.match(/widget\.akariPreviewCaptionAnimatorInternal = model\.captionAnimatorInternal/g)?.length, 2);
    assert.match(source, /widget\.akariPreviewCaptionAnimatorInternal = model\.captionAnimatorInternal;\s*if \(!forceRebuild/);
    const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
    const start = compiled.indexOf('queueCaptionsUpdate(widget) {');
    const end = compiled.indexOf('previewModelSnapshot(', start);
    assert.ok(start >= 0 && end > start);
    const host = vm.runInNewContext('({' + compiled.slice(start, end).trim() + '})', {
        edit_summary_fields_1: { buildCaptionAnimatorSummaryFields: project },
        exports: { normalizePreviewCaptionClock: values => values }, console
    });
    host.loadPreviewCaptions = async () => ({ captions });
    host.previewCaptionTimelineSegments = () => [];
    const messages = [];
    const widget = { akariPreviewCaptionAnimatorInternal: internal(item()), sendMessage: value => messages.push(value) };
    host.queueCaptionsUpdate(widget);
    await widget.akariPreviewCaptionsUpdate;
    assert.equal(messages[0].type, 'akari-preview-captions-update');
    assert.deepEqual(messages[0].captions, project(captions, widget.akariPreviewCaptionAnimatorInternal));
});
