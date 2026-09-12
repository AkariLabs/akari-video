import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUiTargetRow, needsUiTargetLabels, parseTimelineUiTarget } from '../lib/common/doc-target.js';

test('timeline item target を解釈し、索引の表示名を使う', () => {
    assert.deepEqual(parseTimelineUiTarget('timeline:item:clip-1'), { kind: 'item', id: 'clip-1' });
    assert.deepEqual(buildUiTargetRow('timeline:item:clip-1', { 'timeline:item:clip-1': '導入' }), {
        label: '導入', title: 'ui:timeline:item:clip-1', revealable: true
    });
});

test('timeline cut target は索引なしでも C<n+1> を表示する', () => {
    assert.deepEqual(parseTimelineUiTarget('timeline:cut:2'), { kind: 'cut', index: 2 });
    assert.deepEqual(buildUiTargetRow('timeline:cut:2'), {
        label: 'C3', title: 'ui:timeline:cut:2', revealable: true
    });
});

test('timeline overlay target を解釈し、索引なしでは生 id を表示する', () => {
    assert.deepEqual(parseTimelineUiTarget('timeline:overlay:title-1'), { kind: 'overlay', id: 'title-1' });
    assert.deepEqual(buildUiTargetRow('timeline:overlay:title-1'), {
        label: 'timeline:overlay:title-1', title: 'ui:timeline:overlay:title-1', revealable: true
    });
});

test('未知の ui target は生 id を保ち reveal 不可にする', () => {
    assert.equal(parseTimelineUiTarget('panel:timeline'), undefined);
    assert.deepEqual(buildUiTargetRow('asset:foo.mp4', { 'asset:foo.mp4': '  ' }), {
        label: 'asset:foo.mp4', title: 'ui:asset:foo.mp4', revealable: false
    });
});

test('timeline item は索引なしなら labels の再送を要求する', () => {
    assert.equal(needsUiTargetLabels(['ui:timeline:item:clip-1']), true);
});

test('timeline item は非空の索引があれば labels の再送を要求しない', () => {
    assert.equal(needsUiTargetLabels(
        ['ui:timeline:item:clip-1'], { 'timeline:item:clip-1': '導入' }
    ), false);
});

test('timeline cut は索引なしでも labels の再送を要求しない', () => {
    assert.equal(needsUiTargetLabels(['ui:timeline:cut:2']), false);
});

test('timeline 以外の target は labels の再送を要求しない', () => {
    assert.equal(needsUiTargetLabels([null, undefined, 'doc:report.html#intro', 'ui:panel:timeline']), false);
});
