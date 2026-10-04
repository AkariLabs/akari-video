import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './caption-animator-webview-harness.mjs';

test('first legacy draw recognizes resolved frame fit vars without another material update', () => {
    const view = harness({ cues: [{ id: 'frame', start: 0, end: 2, text: '速報',
        textStyle: {}, textStyleVars: { '--caption-plate-fit': 'frame' } }] });
    view.tick(1);
    assert.match(view.plate.innerHTML, /\.akari-caption__plate\{left:4%;right:4%;width:auto;/u);
    assert.match(view.plate.innerHTML, /\.akari-caption__line\{box-sizing:border-box;width:100%;/u);
});

test('first resolved draw recognizes direct frame fit style', () => {
    const view = harness({ cues: [{ id: 'frame', start: 0, end: 2, text: '速報', resolvedTimeline: true,
        textStyle: { background: { fit: 'frame' } }, textStyleVars: {} }] });
    view.tick(1);
    assert.match(view.plate.innerHTML, /\.akari-caption--single-line \.akari-caption__plate\{left:4%;right:4%;width:auto;/u);
});
