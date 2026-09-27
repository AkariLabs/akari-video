import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTION_WORD_STYLES, CAPTION_EMPHASIS_STYLES, readCaptionMotionCue,
    readOwnerMotion, upsertCaptionEmphasis } from '../lib/browser/inspector/caption-motion-document.js';
import { captionMotionComboWrites } from '../lib/browser/inspector/caption-motion-cards.js';
import { createMotionWriteRequest } from '../lib/browser/inspector/motion-fields.js';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const cue = { id: 'c-0001', start: 1, end: 3, text: 'とても良い', speaker: null, sourceRef: null,
    edited: false, src: 'main', words: [
        { start: 1.1, end: 1.5, text: 'とても' }, { start: 1.5, end: 2.1, text: '良い' }
    ] };

test('語の表示 4 種と強調 9 種は描画側の語彙に一致する', () => {
    assert.deepEqual(CAPTION_WORD_STYLES.map(item => item.id), ['karaoke', 'pop', 'reveal', 'reveal-word']);
    assert.deepEqual(CAPTION_EMPHASIS_STYLES.map(item => item.id), [
        'one-char-bang', 'one-char-jumble', 'size-pulse', 'color-accent', 'color-only',
        'outline-bold', 'danger', 'positive', 'highlight'
    ]);
});

test('語チップは字幕の words[] の実測 source 秒を使い、配列ルートを object に包む', () => {
    const source = JSON.stringify([cue]);
    assert.deepEqual(readCaptionMotionCue(source, cue.id).words, cue.words);
    const result = JSON.parse(upsertCaptionEmphasis(source, cue.id, 1, 'danger'));
    assert.deepEqual(result.captions, [cue]);
    assert.deepEqual(result.emphasis_words, [{ id: 'e-0001', word: '良い',
        t_start: 1.5, t_end: 2.1, src: 'main', emotion: 'anger', style_hint: 'danger' }]);
});

test('同じ語の強調は上書きし、無関係の強調と既存 id を保つ', () => {
    const existing = { id: 'e-0003', word: '別の語', t_start: 5, t_end: 6,
        emotion: 'joy', style_hint: 'positive' };
    const source = JSON.stringify({ default_text_style: { color: '#ffffff' },
        captions: [cue], emphasis_words: [existing] });
    const first = upsertCaptionEmphasis(source, cue.id, 0, 'one-char-jumble');
    const second = JSON.parse(upsertCaptionEmphasis(first, cue.id, 0, 'highlight'));
    assert.equal(second.emphasis_words.length, 2);
    assert.deepEqual(second.emphasis_words[0], existing);
    assert.equal(second.emphasis_words[1].id, 'e-0001');
    assert.equal(second.emphasis_words[1].style_hint, 'highlight');
    assert.deepEqual(second.default_text_style, { color: '#ffffff' });
});

test('words[] の無い字幕と output 時刻の字幕では強調を書かない', () => {
    assert.throws(() => upsertCaptionEmphasis(JSON.stringify([{ ...cue, words: [] }]), cue.id, 0, 'positive'), /語/u);
    assert.throws(() => upsertCaptionEmphasis(JSON.stringify([{ ...cue, time_domain: 'output' }]),
        cue.id, 0, 'positive'), /source/u);
});

test('袋の組は item-field motion の一回書き込み、袋なしは字幕 animation に書く', () => {
    const edit = JSON.stringify({ output: { fps: 30 }, tracks: [{ id: 't1', items: [{ id: 'bag-1',
        duration: 3, motion: { loop: { preset: 'blink', period: 60 } }, source: { kind: 'captions' } }] }] });
    const owner = readOwnerMotion(edit, 'bag-1', 2);
    assert.equal(owner.durationFrames, 90);
    const requests = captionMotionComboWrites(cue.id, owner, 'smart', owner.durationFrames);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'item-field');
    assert.equal(requests[0].id, 'bag-1');
    assert.equal(requests[0].path, 'motion');
    assert.deepEqual(requests[0].value.in, { preset: 'slide-up', duration: 12 });
    assert.deepEqual(requests[0].value.loop, { preset: 'float', period: 90 });
    assert.deepEqual(requests[0].value.out, { preset: 'slide-up', duration: 8 });
    const noBag = captionMotionComboWrites(cue.id, undefined, 'smart', 60);
    assert.equal(noBag.length, 1);
    assert.equal(noBag[0].kind, 'caption-style-my-style');
    const single = createMotionWriteRequest(owner, 'in', 'preset', 'fade');
    assert.deepEqual(single.value.loop, { preset: 'blink', period: 60 });
});

test('編集パネルは語の表示と強調の保存先、カラオケ未終了色を接続する', () => {
    const widget = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../src/browser/inspector/caption-motion-panel.ts', import.meta.url), 'utf8');
    assert.match(widget, /layerAudioService\.setCaptionFields\(/u);
    assert.match(widget, /captionsSource = upsertCaptionEmphasis/u);
    assert.match(widget, /layerAudioService\.writeEditSnapshot\(/u);
    assert.match(panel, /kind: 'caption-style-color'/u);
    assert.match(panel, /歌い終わった文字は現在、固定の黄色/u);
    assert.match(panel, /語の時刻（words\[\]）がない字幕/u);
});

test('inspector の RPC は語の style と captions ルート emphasis_words を正しい URI へ書く', async () => {
    const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node)
        && node.name?.text === 'AkariInspectorWidget');
    const method = widget.members.find(node => node.name?.getText(ast) === 'captionMotionServices');
    assert.ok(method);
    const compiled = ts.transpileModule(`class Harness { ${method.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Harness = new Function('readCaptionMotionCue', 'readOwnerMotion', 'upsertCaptionEmphasis',
        `${compiled}; return Harness;`)(readCaptionMotionCue, readOwnerMotion, upsertCaptionEmphasis);
    const instance = new Harness();
    const root = { toString: () => 'project', resolve: name => ({ toString: () => `project/${name}` }) };
    const captionSource = JSON.stringify([cue]);
    const editSource = JSON.stringify({ output: { fps: 30 }, tracks: [{ items: [{ id: 'bag-1',
        duration: 2, source: { kind: 'captions' } }] }] });
    const calls = [];
    instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
    instance.fileService = { readFile: async uri => ({ value: {
        toString: () => uri.toString().endsWith('captions.json') ? captionSource : editSource
    } }) };
    instance.layerAudioService = {
        setCaptionFields: async request => { calls.push(['style', request]); return { committed: true }; },
        writeEditSnapshot: async request => { calls.push(['emphasis', request]); return { committed: true }; }
    };
    const services = instance.captionMotionServices({ id: cue.id, sourceStart: 1, sourceEnd: 3,
        animatorOwner: { id: 'bag-1' } });
    assert.equal((await services.loadCue()).words.length, 2);
    assert.deepEqual(await services.setWordStyle('karaoke'), { ok: true });
    assert.deepEqual(calls[0][1], { captionsUri: 'project/captions.json', projectRootUri: 'project',
        captionId: cue.id, style: 'karaoke' });
    assert.deepEqual(await services.setEmphasis(1, 'positive'), { ok: true });
    assert.equal(calls[1][1].editUri, 'project/edit.json');
    assert.equal(JSON.parse(calls[1][1].captionsSource).emphasis_words[0].style_hint, 'positive');
    assert.equal((await services.readOwner()).durationFrames, 60);
});
