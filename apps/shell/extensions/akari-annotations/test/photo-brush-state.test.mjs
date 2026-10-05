import { readInspectorSource } from './helpers/inspector-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextPhotoBrushItem } from '../lib/browser/inspector/photo-brush-state.js';

test('brush button toggles its pressed item and can switch photos', () => {
    assert.equal(nextPhotoBrushItem(null, 'photo-a'), 'photo-a');
    assert.equal(nextPhotoBrushItem('photo-a', 'photo-a'), null);
    assert.equal(nextPhotoBrushItem('photo-a', 'photo-b'), 'photo-b');
});

test('inspector exposes the pressed brush state', () => {
    const inspector = readInspectorSource();
    assert.match(inspector, /action\.setAttribute\('aria-pressed', String\(field\.pressed\(\)\)\)/u);
});
