import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, access, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
import { placeTextCaption, nextDaihonCaptionId } from '../lib/common/place-text.js';
import { placedMyStyleTextStyle, placedMyStyleMotion, appliedMyStyleKinds, myStyleApplyNotice, appendMyStyleUsage } from '../lib/browser/my-style-look.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { parseCaptions, readInternalEdit, toAnchorCaptions, timelineDurationSeconds } from '@akari-video/edit-store';

const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(item => ts.isClassDeclaration(item) && item.name.text === 'AkariAnnotationsWidget');
const code = ts.transpileModule(`class Widget { ${['placeText', 'withHistory', 'recordMyStyleUsage'].map(name => declaration.members.find(item => item.name?.getText(source) === name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Widget = new Function('placeTextCaption', 'parseCaptions', 'readInternalEdit', 'toAnchorCaptions', 'timelineDurationSeconds', 'placedMyStyleTextStyle', 'placedMyStyleMotion', 'appliedMyStyleKinds', 'myStyleApplyNotice', 'appendMyStyleUsage', 'BinaryBuffer', 'window', 'CustomEvent', `${code}; return Widget;`)(
    placeTextCaption, parseCaptions, readInternalEdit, toAnchorCaptions, timelineDurationSeconds,
    placedMyStyleTextStyle, placedMyStyleMotion, appliedMyStyleKinds, myStyleApplyNotice, appendMyStyleUsage,
    { fromString: value => value },
    { dispatchEvent() {} }, class { constructor(type, options) { this.type = type; this.detail = options.detail; } });

// Keep the real RPC, file reads and edit-store surgery; replace only post-write lint/git I/O.
class Service extends AkariAnnotationsServiceImpl {
    writes = [];
    async writeProjectFileGuarded(path, text) { this.writes.push(path); await writeFile(path, text); }
    async commitWrite() { return false; }
    async writeEditSnapshot(request) {
        if (request.editSource !== undefined) await writeFile(fileURLToPath(request.editUri), request.editSource);
        if (request.captionsSource !== undefined) await writeFile(fileURLToPath(request.captionsUri), request.captionsSource);
        return { committed: false };
    }
}
const uri = path => ({ toString: () => pathToFileURL(path).toString(),
    resolve: child => uri(join(path, child)), parent: { toString: () => pathToFileURL(join(path, '..')).toString() } });
const edit = { version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'card', at: 0, duration: 300, source: { kind: 'html', path: 'card.html' } }] }] };
async function fixture(t, captions) {
    const root = await mkdtemp(join(tmpdir(), 'place-text-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const editPath = join(root, 'edit.json'), captionsPath = join(root, 'captions.json');
    await writeFile(editPath, JSON.stringify(edit));
    if (captions !== undefined) await writeFile(captionsPath, captions);
    const service = new Service(), history = [], notices = [], warnings = [], selection = [], seeks = [], previewSelection = [];
    const widget = Object.assign(new Widget(), {
        location: { root: uri(root), editUri: uri(editPath), captionsUri: uri(captionsPath) },
        annotationsService: service, playheadT: 2, playhead: { style: {} },
        fileService: {
            readFile: async path => ({ value: await readFile(fileURLToPath(path.toString())) }),
            exists: async path => { try { await access(fileURLToPath(path.toString())); return true; } catch { return false; } },
            delete: async path => unlink(fileURLToPath(path.toString())),
            createFolder: async path => mkdir(fileURLToPath(path.toString()), { recursive: true }),
            writeFile: async (path, value) => writeFile(fileURLToPath(path.toString()), value)
        },
        async reloadEdit() {}, async reloadCaptions() {},
        selectCaptions: (_uri, ids) => selection.push(ids), requestSeek: async (...args) => seeks.push(args),
        publishPrimaryPreviewSelection: value => previewSelection.push(value),
        percent: value => value * 10, pushHistory: entry => history.push(entry),
        errorMessage: error => error.message, showNotice: message => notices.push(message), messages: { warn: message => warnings.push(message) }
    });
    return { root, editPath, captionsPath, service, widget, history, notices, warnings, selection, seeks, previewSelection,
        request: { captionsUri: pathToFileURL(captionsPath).toString(), projectRootUri: pathToFileURL(root).toString() } };
}

test('command defaults center the plate with tc and omitted x, and use the shared caption id generator', () => {
    assert.deepEqual(placeTextCaption({}, 4, 20, ['c-0002', 'c-0012']), {
        id: 'c-0013', start: 4, end: 7, text: 'テキストを入力', timeDomain: 'output',
        sourceRef: null, edited: true, speaker: null, textStyle: { position: { y: .4625 }, textAnchor: 'tc' }
    });
    // Preview tc treats y as the top; half of a default 38px × 1.42 line on 720px is 0.03747.
    assert.ok(Math.abs(.4625 + (38 * 1.42 / 2 / 720) - .5) < .001);
    assert.deepEqual(placeTextCaption({ position: { y: .3 } }, 0, 10, []).textStyle.position, { y: .3 });
    assert.equal(placeTextCaption({}, 8, 10, []).end, 10);
    assert.equal(placeTextCaption({}, 0, 0, []).end, 3);
    assert.equal(nextDaihonCaptionId(['c-9999']), 'c-10000');
    assert.throws(() => placeTextCaption({}, 10, 10, []), /時刻/);
    assert.throws(() => placeTextCaption({ start: NaN }, 0, 10, []), /時刻/);
    assert.throws(() => placeTextCaption({ position: { x: 2, y: 0 } }, 0, 10, []), /位置/);
    assert.throws(() => placeTextCaption({ position: { x: NaN, y: 0 } }, 0, 10, []), /位置/);
});

test('missing captions.json: one insertion includes preset, selects/seeks, one undo removes file, redo restores all fields', async t => {
    const f = await fixture(t);
    const id = await f.widget.placeText({ stylePreset: 'title-impact' });
    assert.equal(id, 'c-0001', f.warnings.join(' / '));
    const after = await readFile(f.captionsPath, 'utf8');
    assert.deepEqual(JSON.parse(after).captions[0], {
        id, start: 2, end: 5, text: 'テキストを入力', speaker: null, sourceRef: null, edited: true,
        time_domain: 'output', text_style: { position: { y: .4625 }, text_anchor: 'tc' }, style_preset: 'title-impact'
    });
    assert.equal(f.service.writes.length, 1);
    assert.equal(f.history.length, 1);
    assert.deepEqual(f.selection, [[id]]);
    assert.deepEqual(f.seeks, [[2, { domain: 'output' }]]);
    assert.deepEqual(f.previewSelection, [{ kind: 'caption', id }]);
    await f.history[0].undo();
    await assert.rejects(readFile(f.captionsPath), { code: 'ENOENT' });
    await f.history[0].redo();
    assert.equal(await readFile(f.captionsPath, 'utf8'), after);
});

test('マイスタイルの＋とドラッグは見た目を挿入時に書き、undo 1 回で元へ戻る', async t => {
    const f = await fixture(t);
    const myStyle = { uid: '01K5ZXY1234ABCDEFGHJKMNPQRS', revision: 1,
      parts: [{ kind: 'look', text_style: { color: '#ff1744', reference_height_px: 1920,
        stroke: { color: '#ffffff', width_px: 6 }, background: { color: '#111111', opacity: 0.7 } } },
        { kind: 'motion', animation: { in: { id: 'pop' } } }] };
    const id = await f.widget.placeText({ start: 1, myStyle });
    assert.equal(id, 'c-0001', f.warnings.join(' / '));
    assert.equal(f.history.length, 1);
    assert.equal(f.service.writes.length, 1);
    const after = JSON.parse(await readFile(f.captionsPath, 'utf8')).captions[0];
    assert.equal(after.text_style.color, '#ff1744');
    assert.deepEqual(after.text_style.stroke, { color: '#ffffff', width_px: 6 });
    assert.deepEqual(after.text_style.position, { y: .4625 });
    assert.equal(after.text_style.reference_height_px, 1920);
    assert.deepEqual(after.text_style.animation, { in: { id: 'pop' } });
    const usage = JSON.parse(await readFile(join(f.root, '.akari/style-usage.json'), 'utf8'));
    assert.deepEqual(usage.entries[0].caption_ids, [id]);
    assert.equal(usage.entries[0].style_uid, myStyle.uid);
    assert.deepEqual(usage.entries[0].parts, ['look', 'motion']);
    assert.deepEqual(f.notices, []);
    await f.history[0].undo();
    await assert.rejects(readFile(f.captionsPath), { code: 'ENOENT' });
    const replacedId = await f.widget.placeText({ start: 1, stylePreset: 'title-impact', myStyle });
    const replaced = JSON.parse(await readFile(f.captionsPath, 'utf8')).captions[0];
    assert.equal(replaced.id, replacedId);
    assert.equal('style_preset' in replaced, false);
    assert.equal(replaced.text_style.reference_height_px, 1920);
});

test('置いた文字は既定 layout との衝突を挿入前に通知し、字幕を変更しない', async t => {
    const before = JSON.stringify({ default_text_style: { layout: { mode: 'reference-pixel',
        reference_width_px: 1920, reference_height_px: 1080, left_px: 261, width_px: 1120,
        bottom_px: 29, text_align: 'center', max_lines: 1 } }, captions: [] });
    const f = await fixture(t, before);
    const id = await f.widget.placeText({ myStyle: { uid: '01K5ZXY1234ABCDEFGHJKMNPQRS', revision: 1,
        parts: [{ kind: 'look', text_style: { color: '#f00', reference_height_px: 1920 } }] } });
    assert.equal(id, undefined);
    assert.match(f.warnings.join(' / '), /layout.*基準高さ/);
    assert.match(f.notices.join(' / '), /layout.*基準高さ/);
    assert.equal(await readFile(f.captionsPath, 'utf8'), before);
    assert.equal(f.service.writes.length, 0);
    assert.equal(f.history.length, 0);
});

test('overlapping spoken captions are allowed; undo preserves the original bytes and metadata', async t => {
    const before = '{"captions":[{"id":"c-0007","start":0,"end":9,"text":"発話","speaker":null,"sourceRef":null,"edited":false}],"default_text_style":{"color":"#fff"}}\n';
    const f = await fixture(t, before);
    assert.equal(await f.widget.placeText({ start: 1, end: 7, text: '見出し', position: { x: .2, y: .3 } }), 'c-0008', f.warnings.join(' / '));
    assert.equal(f.history.length, 1);
    const row = JSON.parse(await readFile(f.captionsPath, 'utf8')).captions[1];
    assert.equal(row.text, '見出し');
    assert.deepEqual(row.text_style.position, { x: .2, y: .3 });
    await f.history[0].undo();
    assert.equal(await readFile(f.captionsPath, 'utf8'), before);
});

test('same output group overlap is inserted and one undo restores original bytes', async t => {
    const before = JSON.stringify([{ id: 'c-0001', start: 1, end: 5, text: '既存', time_domain: 'output', sourceRef: null, speaker: null, edited: true }]);
    const f = await fixture(t, before);
    assert.equal(await f.widget.placeText(), 'c-0002', f.warnings.join(' / '));
    assert.equal(JSON.parse(await readFile(f.captionsPath, 'utf8')).length, 2);
    assert.equal(f.history.length, 1);
    await f.history[0].undo();
    assert.equal(await readFile(f.captionsPath, 'utf8'), before);
});

test('service serializes concurrent insertions and keeps both overlapping output captions', async t => {
    const f = await fixture(t);
    const results = await Promise.allSettled([1, 2].map(i => f.service.insertCaption({ ...f.request,
        caption: { ...placeTextCaption({}, 0, 10, []), id: `c-000${i}` } })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
    assert.equal(JSON.parse(await readFile(f.captionsPath, 'utf8')).captions.length, 2);
});

test('removing placed text uses one snapshot undo and restores captions.json bytes', async t => {
    const before = '{"captions":[{"id":"c-0001","start":1,"end":5,"text":"置いた文字","time_domain":"output","style_preset":"title-impact"}]}\n';
    const f = await fixture(t, before);
    await f.widget.withHistory('文字の削除', async () => {
        await f.service.removeCaption({ ...f.request, captionId: 'c-0001' });
    });
    assert.equal(f.history.length, 1);
    assert.equal(JSON.parse(await readFile(f.captionsPath, 'utf8')).captions.length, 0);
    await f.history[0].undo();
    assert.equal(await readFile(f.captionsPath, 'utf8'), before);
});

test('placed text timing preserves output domain and duration, with one byte-exact undo', async t => {
    const before = '{"captions":[{"id":"c-0001","start":1,"end":4,"text":"置いた文字","time_domain":"output","edited":true}]}\n';
    const f = await fixture(t, before);
    await f.widget.withHistory('文字のタイミングを調整', async () => {
        await f.service.setCaptionTiming({ ...f.request, captionId: 'c-0001', start: 2, end: 5, edited: true });
    });
    const moved = JSON.parse(await readFile(f.captionsPath, 'utf8')).captions[0];
    assert.deepEqual([moved.start, moved.end, moved.time_domain], [2, 5, 'output']);
    assert.equal(f.history.length, 1);
    await f.history[0].undo();
    assert.equal(await readFile(f.captionsPath, 'utf8'), before);
});

test('empty edit has a three second default, independent of the timeline display extent', async t => {
    const f = await fixture(t);
    await writeFile(f.editPath, JSON.stringify({ ...edit, tracks: [] }));
    f.widget.playheadT = 0;
    await f.widget.placeText();
    assert.equal(JSON.parse(await readFile(f.captionsPath, 'utf8')).captions[0].end, 3);
});

test('unreadable captions path is not mistaken for a missing file', async t => {
    const f = await fixture(t);
    await mkdir(f.captionsPath);
    await assert.rejects(f.service.insertCaption({ ...f.request, caption: placeTextCaption({}, 0, 10, []) }));
    assert.equal(f.service.writes.length, 0);
});
