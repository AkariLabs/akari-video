import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProjectStages, currentStage, stageSummary, EMPTY_PRESENCE } from '../lib/browser/home/project-progress-model.js';

const p = (over) => ({ ...EMPTY_PRESENCE, ...over });

test('作ったばかり: いまここは企画・札は「作ったばかり」', () => {
    const stages = computeProjectStages(EMPTY_PRESENCE);
    assert.equal(stages.length, 5);
    assert.deepEqual(stages.map(s => s.label), ['企画', '素材', '編集', '確認', '書き出し']);
    assert.equal(stages.find(s => s.current)?.key, 'plan');
    assert.equal(stageSummary(EMPTY_PRESENCE), '作ったばかり');
});

test('企画と素材あり・編集なし: いまここは編集・札は「素材まで」', () => {
    const v = p({ planningDocs: 1, assetFiles: 6 });
    assert.equal(currentStage(v), 'edit');
    assert.equal(stageSummary(v), '素材まで');
    assert.equal(computeProjectStages(v).find(s => s.key === 'assets')?.detail, '6 件');
});

test('編集あり・レポートなし: 企画が無くても いまここは編集（編集の途中）', () => {
    const v = p({ assetFiles: 2, editHasContent: true });
    assert.equal(currentStage(v), 'edit');
    assert.equal(stageSummary(v), '編集の途中');
    assert.equal(computeProjectStages(v).find(s => s.key === 'edit')?.detail, '編集あり');
});

test('レポートあり・書き出しなし: いまここは書き出し・札は「確認中」', () => {
    const v = p({ planningDocs: 1, assetFiles: 2, editHasContent: true, reportFiles: 1 });
    assert.equal(currentStage(v), 'export');
    assert.equal(stageSummary(v), '確認中');
    assert.equal(computeProjectStages(v).find(s => s.key === 'export')?.current, true);
});

test('全部済み: いまここは無し・札は「書き出し済み」', () => {
    const v = p({ planningDocs: 1, assetFiles: 2, editHasContent: true, reportFiles: 1, exportFiles: 1 });
    const stages = computeProjectStages(v);
    assert.equal(stages.every(s => s.done), true);
    assert.equal(stages.some(s => s.current), false);
    assert.equal(stageSummary(v), '書き出し済み');
});
