import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, source } from './caption-animator-webview-harness.mjs';

function editingHarness(cue, write = async () => {}) {
    const h = harness({ cues: [cue] });
    h.tick(1);
    const plate = h.plate;
    const classes = new Set();
    plate.classList = { add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle() {} };
    let editor;
    const layout = {
        replaceChildren(element) { editor = element; plate.innerHTML = '<div class="temporary-editor"></div>'; },
        get firstElementChild() { return editor; }
    };
    const query = plate.querySelector.bind(plate);
    plate.querySelector = selector => selector === '.akari-caption__plate' ? layout : query(selector);
    h.context.document.createElement = () => {
        const attributes = new Map();
        return { className: '', textContent: '', style: {},
            getAttribute: name => attributes.get(name) ?? null,
            setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
            closest: () => plate, focus() {} };
    };
    h.context.window.getSelection = () => null;
    h.context.window.akari.reportCaptionSelection = () => {};
    h.context.window.akari.engine = { captionWrite: write };
    h.context.window.akari.showWriteError = () => {};
    const start = source.indexOf('const restoreCaptionEditAttribute =');
    const end = source.indexOf("captionLayer.addEventListener('dblclick'", start);
    h.run(source.slice(start, end));
    return { ...h, get editor() { return editor; }, classes };
}
const spoken = () => ({ id: 'speech', start: 0, end: 4, text: 'one two', style: 'karaoke', words: [
    { text: 'one', start: 0, end: 1.5 }, { text: 'two', start: 1.5, end: 4 }
] });

for (const kind of ['styled', 'block']) {
    for (const finish of ['cancel', 'unchanged', 'reject', 'save']) {
        test(`${kind}: ${finish} rebuilds real caption markup, including during a pending write`, async () => {
            const cue = spoken();
            if (kind === 'block') { delete cue.words; cue.text = 'one\ntwo'; cue.textStyle = { background: { mode: 'block' } }; }
            let settle;
            const writes = [];
            const pendingWrite = new Promise((resolve, reject) => { settle = finish === 'reject' ? () => reject(Error('write rejected')) : resolve; });
            const h = editingHarness(cue, (...args) => { writes.push(args); return pendingWrite; });
            const original = h.plate.innerHTML;
            assert.match(original, /akari-caption__plate/);
            assert.match(original, kind === 'styled' ? /akari-caption__tok/ : /akari-caption__block/);
            h.run('beginCaptionEdit(captions[0])');
            assert.notEqual(h.plate.innerHTML, original);
            assert.equal(h.editor.getAttribute('contenteditable'), 'true');
            if (finish !== 'unchanged') h.editor.textContent = 'changed text';
            if (finish === 'cancel') h.run('cancelCaptionEdit()');
            else {
                const completion = h.run('commitCaptionEdit()');
                assert.equal(h.plate.innerHTML, original, 'temporary editor must not survive the pending write');
                settle();
                await completion;
            }
            assert.equal(h.run('activeCaptionEdit'), null);
            assert.equal(h.classes.has('akari-caption-host--editing'), false);
            assert.equal(h.editor.getAttribute('contenteditable'), null);
            if (finish === 'save') {
                assert.equal(writes.length, 1);
                assert.equal(cue.text, 'changed text');
                const fresh = harness({ cues: [structuredClone(cue)] });
                fresh.tick(1);
                assert.equal(h.plate.innerHTML, fresh.plate.innerHTML, 'saved text uses the normal renderer');
            } else {
                assert.equal(h.plate.innerHTML, original, 'line and token wrappers are restored byte-for-byte');
                assert.equal(writes.length, finish === 'reject' ? 1 : 0);
            }
        });
    }
}

test('user deselection removes transcript-supplied plate attributes and handles without echoing incoming selection', () => {
    const h = harness({ cues: [spoken()], selectedIds: ['speech'] });
    const reports = [];
    h.context.window.akari.reportCaptionSelection = id => reports.push(id);
    h.tick(1);
    h.run("selectCaption('speech', { report: false })");
    assert.deepEqual(reports, []);
    assert.equal(h.plate.hasAttribute('data-selected'), true);
    assert.ok(h.plate.querySelectorAll('.akari-caption-handle').length > 0);
    h.run('deselectCaption()');
    assert.deepEqual(reports, [null]);
    assert.equal(h.plate.hasAttribute('data-selected'), false);
    assert.equal(h.plate.querySelectorAll('.akari-caption-handle').length, 0);
});
