import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ours = require('../lib/browser/vibe-dock-pointing.js');
const original = require('../../akari-preview/lib/common/ui-event-target.js');

test('登録済み DOM の最近傍とラベルはプレビューの解決手順と一致する', () => {
    const node = (target, label, parentNode = null) => ({
        getAttribute: name => name === 'data-akari-ui' ? target : name === 'data-akari-ui-label' ? label : null,
        parentNode
    });
    const root = node('panel:project', 'プロジェクト');
    const child = node('timeline:item:c1', null, root);
    for (const start of [undefined, node(null, null), root, child, node(null, null, child)]) {
        assert.deepEqual(ours.resolveUiEventTarget(start), original.resolveUiEventTarget(start));
    }
    assert.equal(ours.resolveUiEventTarget(child).label, 'timeline:item:c1');
    assert.equal(ours.resolveUiEventTarget(node(null, null)), undefined);
    assert.equal(ours.resolveUiEventTarget(root).target, 'panel:project');
    assert.equal(ours.resolvePointableTarget(node(null, null, node('panel:vibe-dock', 'AKARI バイブ'))), undefined);
});

test('出力プレビューの選択イベントを指し先にする', () => {
    const cases = [
        ['akari.preview.overlaySelected', 'overlayId', 'timeline:overlay:'],
        ['akari.preview.cutSelected', 'cutId', 'timeline:item:'],
        ['akari.preview.layerSelected', 'layerId', 'preview:layer:'],
        ['akari.preview.captionSelected', 'captionId', 'preview:caption:']
    ];
    for (const [type, field, prefix] of cases) {
        assert.equal(ours.resolvePreviewPoint(type, { [field]: 'x' }).target, `${prefix}x`);
        assert.equal(ours.resolvePreviewPoint(type, {}), undefined);
    }
});
