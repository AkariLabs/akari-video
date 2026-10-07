import test from 'node:test';
import assert from 'node:assert/strict';
import { memberText, readSourceFile } from './helpers/role-buckets-source.mjs';

const pane = readSourceFile('materials').text;

test('素材面の状態変更は公開メソッドとルート変更時の初期化に集約する', () => {
    const setter = memberText('setMaterialView', { in: 'materials' });
    const loader = memberText('loadMaterials', { in: 'materials' });
    assert.match(setter, /applyMaterialViewPatch\(this\.view, patch\)/u);
    assert.match(setter, /this\.host\.update\(\)/u);
    assert.match(loader, /rootKey !== this\.viewRootKey/u);
    assert.match(loader, /this\.view = DEFAULT_MATERIAL_VIEW/u);
    assert.equal((pane.match(/this\.view\s*=/gu) ?? []).length, 2);
    assert.match(memberText('getMaterialView', { in: 'materials' }), /this\.view/u);
});

test('素材バーは共通分割ボタンと押下状態を使い、従来の空表示を保つ', () => {
    const render = memberText('renderMaterialsTab', { in: 'materials' });
    assert.equal((render.match(/className='akari-seg'/gu) ?? []).length, 2);
    assert.equal((render.match(/role='group'/gu) ?? []).length, 2);
    assert.equal((render.match(/aria-pressed=/gu) ?? []).length, 2);
    assert.equal((render.match(/onClick=\{\(\) => this\.setMaterialView\(/gu) ?? []).length, 3);
    assert.match(render, /selectedKind === undefined && <span>絞り込み中<\/span>/u);
    assert.match(render, /filterMaterials\(this\.materials/u);
    assert.match(render, /filterMaterials\(this\.unorganizedMaterials/u);
    assert.match(render, /sortMaterials\(/u);
    assert.match(render, /data-akari-material-search-empty/u);
    assert.match(render, /プロジェクトを開いてください/u);
    assert.match(render, /読み込み中/u);
    assert.match(render, /ここにはまだ素材がありません/u);
    assert.doesNotMatch(render, /<button(?![^>]*className=)[^>]*>/gu);
});
