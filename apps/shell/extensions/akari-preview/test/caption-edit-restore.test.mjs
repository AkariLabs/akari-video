import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, source } from './caption-animator-webview-harness.mjs';
import { captionEditorWrapWidth, captionLineCountFromMetrics, captionEditorFitWidth,
    captionEditorLines, captionEditorValue } from '../lib/common/caption-edit-geometry.js';

function editingHarness(cue, write = async () => {}, visibleLines = []) {
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
    const queryAll = plate.querySelectorAll.bind(plate);
    plate.querySelectorAll = selector => selector === '.akari-caption__line'
        ? visibleLines.map(textContent => ({ textContent, offsetWidth: 200, offsetHeight: 20 })) : queryAll(selector);
    h.context.document.createTextNode = text => ({ textContent: text });
    h.context.document.createElement = tag => {
        const attributes = new Map();
        const children = [];
        return { tagName: tag.toUpperCase(), className: '', textContent: '', style: {}, children, parentElement: null,
            get offsetHeight() { return Math.max(20, Math.ceil(this.textContent.length * 20 / (parseFloat(this.style.width) || 200)) * 20); },
            get innerText() { return this.textContent; },
            replaceChildren(...nodes) { this.textContent = nodes.map(node => node.tagName === 'BR' ? '\n' : node.textContent).join(''); },
            getAttribute: name => attributes.get(name) ?? null,
            setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
            appendChild(child) { child.parentElement = this; children.push(child); return child; },
            remove() {
                const siblings = this.parentElement?.children;
                const index = siblings?.indexOf(this) ?? -1;
                if (index >= 0) siblings.splice(index, 1);
                this.parentElement = null;
            },
            closest: () => plate, focus() {} };
    };
    h.context.window.getSelection = () => null;
    h.context.window.akari.reportCaptionSelection = () => {};
    h.context.window.akari.engine = { captionWrite: write };
    h.context.window.akari.showWriteError = () => {};
    h.context.captionEditorLinesFn = captionEditorLines;
    h.context.captionEditorWrapWidthFn = captionEditorWrapWidth;
    h.context.captionLineCountFromMetricsFn = captionLineCountFromMetrics;
    h.context.captionEditorFitWidthFn = captionEditorFitWidth;
    h.context.getComputedStyle = () => ({ lineHeight: '20px', paddingTop: '0px', paddingBottom: '0px' });
    h.context.captionEditorValueFn = captionEditorValue;
    h.context.vscode = { postMessage() {} };
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

test('編集の取消・確定で文字範囲ツールの状態を同期する', async () => {
    const h = editingHarness(spoken(), async () => {});
    let synced = 0;
    h.context.window.akari.syncRunSelection = () => { synced++; };
    h.run('beginCaptionEdit(captions[0])');
    const afterBegin = synced;
    h.run('cancelCaptionEdit()');
    assert.ok(synced > afterBegin);
    h.run('beginCaptionEdit(captions[0])');
    const beforeCommit = synced;
    await h.run('commitCaptionEdit()');
    assert.ok(synced > beforeCommit);
});

test('soft wrapping never becomes a saved newline after typing', async () => {
    const writes = [];
    const h = editingHarness({ id: 'lines', start: 0, end: 4, text: '一行目二行目' },
        async (...args) => { writes.push(args); }, ['一行目', '二行目']);
    h.run('beginCaptionEdit(captions[0])');
    assert.equal(h.editor.innerText, '一行目二行目');
    assert.ok(parseFloat(h.editor.style.width) < 200);
    await h.run('commitCaptionEdit()');
    assert.equal(writes.length, 0);
    h.run('beginCaptionEdit(captions[0])');
    h.editor.textContent += '追記';
    await h.run('commitCaptionEdit()');
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].text, '一行目二行目追記');
});

test('user deselection removes transcript-supplied plate attributes and handles without echoing incoming selection', () => {
    const h = harness({ cues: [spoken()], selectedIds: ['speech'] });
    const reports = [];
    h.context.window.akari.reportCaptionSelection = id => reports.push(id);
    h.tick(1);
    h.run("selectCaption('speech', { report: false })");
    assert.deepEqual(reports, []);
    assert.equal(h.plate.hasAttribute('data-selected'), true);
    assert.ok(h.run('captionSelectBox.children.flatMap(box => box.children).length') > 0);
    h.run('deselectCaption()');
    assert.deepEqual(reports, [null]);
    assert.equal(h.plate.hasAttribute('data-selected'), false);
    assert.equal(h.plate.querySelectorAll('.akari-caption-handle').length, 0);
    assert.equal(h.run('captionSelectBox.children.length'), 0);
});
