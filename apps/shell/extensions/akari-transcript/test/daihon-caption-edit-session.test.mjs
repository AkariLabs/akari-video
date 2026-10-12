import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { LiveCaptionEdit } = require('../../akari-preview/lib/common/live-caption-edit.js');
const { DaihonCaptionEditSession, seedDaihonCaptionEdit } = require('../lib/common/daihon-caption-edit-session.js');

test('選択中に打った種の 1 文字を 150ms で保存し、IME 開始は種にしない', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const writes = [];
    const live = new LiveCaptionEdit('元', async value => { writes.push(value); });
    seedDaihonCaptionEdit(live, 'S元', false);
    t.mock.timers.tick(149);
    assert.deepEqual(writes, []);
    t.mock.timers.tick(1);
    await Promise.resolve();
    assert.deepEqual(writes, ['S元']);
    seedDaihonCaptionEdit(live, 'Process元', true);
    t.mock.timers.tick(500);
    assert.deepEqual(writes, ['S元']);
});

test('閉じた欄の遅い input は無視し、同じ行の次の編集は途中保存できる', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const writes = [];
    const old = new DaihonCaptionEditSession();
    const first = new LiveCaptionEdit('元', async value => { writes.push(value); });
    if (old.isEditing) first.input('一元');
    t.mock.timers.tick(150);
    await Promise.resolve();
    assert.equal(old.beginClose(), true);
    old.finish();
    if (old.isEditing) first.input('取り消した文字');
    t.mock.timers.tick(500);
    assert.deepEqual(writes, ['一元']);
    const next = new DaihonCaptionEditSession();
    const second = new LiveCaptionEdit('一元', async value => { writes.push(value); });
    if (next.isEditing) second.input('二一元');
    t.mock.timers.tick(150);
    await Promise.resolve();
    assert.deepEqual(writes, ['一元', '二一元']);
});

function finishMethod() {
    const text = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
    const start = text.indexOf('    protected async finishEdit(');
    const end = text.indexOf('    protected replaceRenderedRow(', start);
    assert.ok(start >= 0 && end > start);
    const compiled = ts.transpileModule(`class Harness { ${text.slice(start, end)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(`${compiled}\nreturn Harness;`)().prototype.finishEdit;
}

for (const cancel of [false, true]) {
    test(`${cancel ? '取消' : '確定'}の後に入力欄を外し、古い blur は二度目の保存をしない`, async () => {
        const finishEdit = finishMethod();
        let source = '元';
        let editorPresent = true;
        let writes = 0;
        let redraws = 0;
        let beginReload;
        let releaseReload;
        const reloadStarted = new Promise(resolve => { beginReload = resolve; });
        const reloadGate = new Promise(resolve => { releaseReload = resolve; });
        const row = { id: 'c', text: '元' };
        const input = { value: 'S元', disabled: false };
        const state = { id: 'c', original: '元', input, cancelled: cancel,
            lifecycle: new DaihonCaptionEditSession(), before: Promise.resolve('元'),
            session: {
                async finish(value) { source = value; writes++; },
                async cancel() { source = '元'; writes++; }
            } };
        const uri = { toString: () => 'file:///captions.json' };
        const widget = { editing: state, rows: [row], captionsUri: uri, rootUri: uri, editUri: uri,
            elements: new Map([['c', { root: { contains: candidate => candidate === input && editorPresent,
                classList: { add() {} }, setAttribute() {} } }]]),
            annotationsService: { async writeEditSnapshot() { source = '元'; writes++; } },
            async readText() { return source; }, async reload() { beginReload(); await reloadGate; },
            async setCaptionFieldsWithNotice() {}, historyService: { push() {} },
            replaceRenderedRow() { editorPresent = false; redraws++; },
            restoreRowsFocusAfterEdit() {}, notify() {}, notifyError() {}, errorMessage: String };
        const completion = finishEdit.call(widget, state);
        await reloadStarted;
        assert.equal(editorPresent, false, '保存後の再読込を待つ間も編集欄を残さない');
        releaseReload();
        await completion;
        assert.equal(widget.editing, undefined);
        assert.equal(state.lifecycle.isEditing, false);
        assert.equal(editorPresent, false);
        assert.equal(redraws, 1);
        assert.equal(source, cancel ? '元' : 'S元');
        const priorWrites = writes;
        await finishEdit.call(widget, state);
        assert.equal(writes, priorWrites);
        assert.equal(redraws, 1);
    });
}
