import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assetResolverSrcCandidates, editLintCliCandidates, presetShowcaseIndexCandidates } from '../lib/node/packaged-tool-candidates.js';

// resourcesPath あり/なしの 2 態で候補の先頭と件数を検証する（task.md §3）。
// resourcesPath ありのとき: 先頭に Contents/Resources 基点の候補が 1 件追加され、
// 既存 4 候補は順序・内容とも変わらず後ろに続く（開発配置の解決を壊さない）。

const DIRNAME = '/Applications/AKARI Video.app/Contents/Resources/app.asar/node_modules/akari-project/lib/node';
const CWD = '/';
const RESOURCES_PATH = '/Applications/AKARI Video.app/Contents/Resources';

test('assetResolverSrcCandidates: resourcesPath なし — 既存 4 候補のみ', () => {
    const candidates = assetResolverSrcCandidates(DIRNAME, CWD);
    assert.equal(candidates.length, 4);
    assert.equal(candidates[0], resolve(DIRNAME, '../asset-resolver/src'));
});

test('assetResolverSrcCandidates: resourcesPath あり — 先頭に resourcesPath 基点が追加され計 5 件', () => {
    const candidates = assetResolverSrcCandidates(DIRNAME, CWD, RESOURCES_PATH);
    assert.equal(candidates.length, 5);
    assert.equal(candidates[0], resolve(RESOURCES_PATH, 'packages/asset-resolver/src'));
    assert.equal(candidates[1], resolve(DIRNAME, '../asset-resolver/src'));
});

test('editLintCliCandidates: resourcesPath なし — 既存 4 候補のみ', () => {
    const candidates = editLintCliCandidates(DIRNAME, CWD);
    assert.equal(candidates.length, 4);
    assert.equal(candidates[0], resolve(DIRNAME, '../edit-lint/bin/edit-lint.mjs'));
});

test('editLintCliCandidates: resourcesPath あり — 先頭に resourcesPath 基点が追加され計 5 件', () => {
    const candidates = editLintCliCandidates(DIRNAME, CWD, RESOURCES_PATH);
    assert.equal(candidates.length, 5);
    assert.equal(candidates[0], resolve(RESOURCES_PATH, 'packages/edit-lint/bin/edit-lint.mjs'));
    assert.equal(candidates[1], resolve(DIRNAME, '../edit-lint/bin/edit-lint.mjs'));
});

test('resourcesPath 空文字は未指定と同様に扱う（ガードが偽値全般に効く）', () => {
    const assetCandidates = assetResolverSrcCandidates(DIRNAME, CWD, '');
    const editLintCandidates = editLintCliCandidates(DIRNAME, CWD, '');
    assert.equal(assetCandidates.length, 4);
    assert.equal(editLintCandidates.length, 4);
});

test('presetShowcaseIndexCandidates: 開発時はリポルート候補を列挙する', () => {
    const candidates = presetShowcaseIndexCandidates('/repo/apps/shell/extensions/akari-project/lib/node', '/repo/apps/shell', 'telop');
    assert.equal(candidates[0], resolve('/repo/presets/telop/index.jsonl'));
    assert.ok(candidates.includes(resolve('/repo/apps/shell/extensions/akari-project/lib/node', '../../../../../../../presets/telop/index.jsonl')));
});

test('presetShowcaseIndexCandidates: パッケージ時は resourcesPath の index を先頭にする', () => {
    const candidates = presetShowcaseIndexCandidates(DIRNAME, CWD, 'luts', RESOURCES_PATH);
    assert.equal(candidates[0], resolve(RESOURCES_PATH, 'presets/luts/index.jsonl'));
    assert.equal(candidates.length, 4);
});

test('presetShowcaseIndexCandidates: textanim / textstyle も同じ探索規則を使う', () => {
    assert.match(presetShowcaseIndexCandidates(DIRNAME, CWD, 'textanim')[0], /presets[\\/]textanim[\\/]index\.jsonl$/u);
    assert.match(presetShowcaseIndexCandidates(DIRNAME, CWD, 'textstyle')[0], /presets[\\/]textstyle[\\/]index\.jsonl$/u);
});
