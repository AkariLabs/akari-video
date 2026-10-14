import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { LiveCaptionEdit } = require('../../akari-preview/lib/common/live-caption-edit.js');
const { DaihonCaptionEditSession, seedDaihonCaptionEdit } = require('../lib/common/daihon-caption-edit-session.js');
const { decideDaihonCaptionEdit } = require('../lib/common/daihon-caption-edit-queue.js');
const { nextCaptionNotices } = require('../lib/common/caption-notice-state.js');
const { t: transcriptText } = require('../lib/browser/transcript-text.js');

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
    const start = text.indexOf('    protected finishEdit(');
    const end = text.indexOf('    protected replaceRenderedRow(', start);
    assert.ok(start >= 0 && end > start);
    const compiled = ts.transpileModule(`class Harness { ${text.slice(start, end)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function('decideDaihonCaptionEdit', 't', `${compiled}\nreturn Harness;`)(decideDaihonCaptionEdit, transcriptText).prototype.finishEdit;
}

test('見放した保存が後から返しても通知の副作用を出さない', async () => {
    const text = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
    const start = text.indexOf('    protected async setCaptionFieldsWithNotice(');
    const end = text.indexOf('    @inject(AkariEditHistoryService)', start);
    assert.ok(start >= 0 && end > start);
    const compiled = ts.transpileModule(`class Harness { ${text.slice(start, end)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const Harness = new Function('nextCaptionNotices', `${compiled}\nreturn Harness;`)(nextCaptionNotices);
    const widget = new Harness();
    const messages = [];
    widget.annotationsService = { setCaptionFields: async () => ({ notices: ['文字範囲が外れました'] }) };
    widget.messages = { info: message => messages.push(message) };
    await widget.setCaptionFieldsWithNotice({}, () => false);
    assert.deepEqual(messages, []);
    assert.equal(widget.lastCaptionRunNotice, undefined);
    await widget.setCaptionFieldsWithNotice({}, () => true);
    assert.deepEqual(messages, ['文字範囲が外れました']);
});

for (const cancel of [false, true]) {
    test(`${cancel ? '取消' : '確定'}の直後に入力欄を外し、古い blur は二度目の保存をしない`, async () => {
        const finishEdit = finishMethod();
        let source = '元';
        let editorPresent = true;
        let writes = 0;
        let notices = 0;
        let histories = 0;
        let redraws = 0;
        let releaseFirst;
        let firstCall = true;
        const pending = [];
        const row = { id: 'c', text: '元' };
        const input = { value: 'S元' };
        const state = { id: 'c', original: '元', input, cancelled: cancel,
            lifecycle: new DaihonCaptionEditSession(), before: Promise.resolve('元'),
            session: { close() {} } };
        const uri = { toString: () => 'file:///captions.json' };
        const widget = { editing: state, rows: [row], captionsUri: uri, rootUri: uri, editUri: uri,
            captionEditQueue: { write(id, value, operation, visible, afterWrite, beforeWrite) {
                pending.push(async attempt => {
                    await beforeWrite?.();
                    await operation(attempt);
                    if (!attempt.abandoned) await afterWrite?.();
                });
                return Promise.resolve();
            }, after(operation) { return operation(); }, get() { return undefined; },
            revisionFor() { return 1; }, clearSavedOverride() { return false; } },
            reloadQueue: { resume() {} }, async requestReload() { return true; },
            elements: new Map([['c', { root: { contains: candidate => candidate === input && editorPresent } }]]),
            annotationsService: { async writeEditSnapshot() { source = '元'; writes++; } },
            async readText() { return source; }, async reload() {},
            async setCaptionFieldsWithNotice({ text }, shouldNotify) {
                if (!cancel && firstCall) {
                    firstCall = false;
                    await new Promise(resolve => { releaseFirst = resolve; });
                }
                source = text; writes++;
                if (shouldNotify()) notices++;
            },
            historyService: { push() { histories++; } },
            replaceRenderedRow() { editorPresent = false; redraws++; },
            restoreRowsFocusAfterEdit() {}, notify() {}, notifyError() {}, errorMessage: String };
        finishEdit.call(widget, state);
        assert.equal(editorPresent, false);
        assert.equal(widget.editing, undefined);
        assert.equal(row.text, cancel ? '元' : 'S元');
        assert.equal(state.lifecycle.isEditing, false);
        assert.equal(pending.length, 1);
        finishEdit.call(widget, state);
        assert.equal(pending.length, 1);
        assert.equal(redraws, 1);
        if (!cancel) {
            await pending[0]({ abandoned: true });
            assert.equal(writes, 0);
            const attempt = { abandoned: false };
            const stale = pending[0](attempt);
            await new Promise(resolve => setImmediate(resolve));
            attempt.abandoned = true;
            releaseFirst();
            await stale;
            assert.equal(histories, 0);
            assert.equal(notices, 0);
        }
        await pending[0]({ abandoned: false });
        assert.equal(source, cancel ? '元' : 'S元');
        assert.equal(writes, cancel ? 0 : 2);
        assert.equal(histories, cancel ? 0 : 1);
        assert.equal(notices, cancel ? 0 : 1);
    });
}

test('再読込が失敗しても確定した行の上書きを外さない', async () => {
    const finishEdit = finishMethod();
    const row = { id: 'c', text: '元' };
    const state = { id: 'c', original: '元', input: { value: '新' }, cancelled: false,
        lifecycle: new DaihonCaptionEditSession(), before: Promise.resolve('元'),
        session: { close() {} } };
    const uri = { toString: () => 'file:///captions.json' };
    let clears = 0;
    const widget = { editing: state, rows: [row], captionsUri: uri, rootUri: uri, editUri: uri,
        captionEditQueue: { write() { return Promise.resolve(); }, revisionFor() { return 1; },
            clearSavedOverride() { clears++; return true; } },
        async requestReload() { return false; },
        replaceRenderedRow() {}, restoreRowsFocusAfterEdit() {}, notify() {}, notifyError() {} };
    finishEdit.call(widget, state);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(row.text, '新');
    assert.equal(clears, 0);
});
