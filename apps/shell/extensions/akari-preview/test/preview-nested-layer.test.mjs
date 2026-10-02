import assert from 'node:assert/strict';
import test from 'node:test';
import { isNestedPreviewLayer } from '../lib/common/preview-nested-layer.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const edit = JSON.stringify({ version: 2, tracks: [{ lane: 'visual', items: [
    { id: 'top', source: { kind: 'media' } },
    { id: 'canvas', source: { kind: 'group' }, items: [
        { id: 'inner', source: { kind: 'group' }, items: [{ id: 'photo', source: { kind: 'media' } }] }
    ] }
] }] });

test('only a canvas descendant uses the nested preview write route', () => {
    assert.equal(isNestedPreviewLayer(edit, 'photo'), true);
    assert.equal(isNestedPreviewLayer(edit, 'top'), false);
    assert.equal(isNestedPreviewLayer(edit, 'missing'), false);
});

test('nested layer commits through the timeline history command', () => {
    const source = readHandlerSource();
    const method = source.slice(source.indexOf('    protected async handleLayerWrite('),
        source.indexOf('    // ㉓ layerWrite', source.indexOf('    protected async handleLayerWrite(')));
    assert.match(method, /if \(isNestedPreviewLayer\(originalText, request\.layerId\)\) \{[\s\S]*?akari\.annotations\.commitPreviewTransform/u);
    assert.ok(method.indexOf('if (isNestedPreviewLayer') < method.indexOf('resolvePreviewItemWrite(originalText, write)'));
});
