import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Exercise the actual widget listeners without booting Theia's application services.
const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const start = source.indexOf('    updateTrimAffordance(');
const end = source.indexOf('    updateDragPreview(', start);
const Widget = new Function(`const DRAG_THRESHOLD_PX = 3; return class { ${source.slice(start, end)} };`)();
function fixture(detail) {
    const handlers = new Map();
    const element = {
        style: {}, dataset: {},
        addEventListener(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
        getBoundingClientRect: () => ({ left: 0, right: 100 }),
        cloneNode: () => ({ style: {}, removeAttribute() {} }),
        setPointerCapture() {}
    };
    const widget = Object.assign(new Widget(), { pinTimelineViewport() {},
        toolMode: 'select', strip: { appendChild() {} }, cuts: [], audioSfx: [],
        detectCutDoubleClick: () => false,
        cancelDrag() { this.dragState = undefined; },
        selectionFromDragState: state => ({ kind: state.kind, id: state.id }),
        applySelection(selection) { this.selection = selection; },
        selectTimeAtClientX() { assert.fail('Selecting an item must not seek'); },
        updateDragPreview: state => state,
        commitDrag() { this.committed = true; }
    });
    widget.installDragListeners(element, () => detail);
    const dispatch = (name, clientX = 50) => {
        for (const handler of handlers.get(name) ?? []) {
            handler({ button: 0, pointerId: 1, clientX, clientY: 10, preventDefault() {}, stopPropagation() {} });
        }
    };
    return { widget, element, dispatch };
}
for (const detail of [
    { kind: 'cut-move', index: 0 }, { kind: 'caption', mode: 'move', id: 'caption-1' },
    { kind: 'overlay', mode: 'move', id: 'overlay-1' },
    { kind: 'layer', mode: 'move', id: 'layer-1' }, { kind: 'audio', id: 'audio-1' }
]) {
    test(`${detail.kind}: click selects without seeking`, () => {
        const { widget, dispatch } = fixture(detail);
        dispatch('pointerdown');
        dispatch('pointerup');
        assert.equal(widget.selection.kind, detail.kind);
        assert.equal(widget.committed, undefined);
    });
}
test('trim hover identifies the active edge and clears on leaving', () => {
    const { element, dispatch } = fixture({ kind: 'cut-trim', edge: 'left' });
    dispatch('pointermove', 2);
    assert.equal(element.dataset.trimEdge, 'left');
    assert.equal(element.style.cursor, 'ew-resize');
    dispatch('pointerleave');
    assert.equal(element.dataset.trimEdge, undefined);
});
test('drag still commits instead of selecting or seeking', () => {
    const { widget, dispatch } = fixture({ kind: 'caption', mode: 'end', id: 'caption-1' });
    dispatch('pointerdown');
    dispatch('pointermove', 70);
    dispatch('pointerup', 70);
    assert.equal(widget.committed, true);
    assert.equal(widget.selection, undefined);
});
