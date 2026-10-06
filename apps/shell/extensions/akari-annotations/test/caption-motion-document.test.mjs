import { readInspectorSource } from './helpers/inspector-source.mjs';
import './timeline-harness-dependencies.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPTION_WORD_STYLES, CAPTION_EMPHASIS_STYLES, readCaptionMotionCue,
    readOwnerMotion, upsertCaptionEmphasis, upsertCaptionKaraoke } from '../lib/browser/inspector/caption-motion-document.js';
import { captionMotionComboWrites } from '../lib/browser/inspector/caption-motion-cards.js';
import { withCaptionMultiTargets } from '../lib/browser/inspector/caption-multi-targets.js';
import { replaceMyStylePartsInSource } from '../lib/browser/my-style-look.js';
import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';
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

test('袋の尺は fps に関係なく v2 のフレーム値で読み、組は字幕 animation に書く', () => {
    const edit = JSON.stringify({ output: { fps: 24 }, tracks: [{ id: 't1', items: [{ id: 'bag-1',
        duration: 72, motion: { loop: { preset: 'blink', period: 60 } }, source: { kind: 'captions' } }] }] });
    const owner = readOwnerMotion(edit, 'bag-1', 2);
    assert.equal(owner.durationFrames, 72);
    const requests = captionMotionComboWrites(cue.id, 'smart');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'caption-style-my-style');
    assert.equal(requests[0].id, cue.id);
    assert.deepEqual(requests[0].value.parts[0].animation, {
        in: { id: 'slide-up', duration_sec: .4 },
        out: { id: 'slide-up', duration_sec: .27 },
        loop: { id: 'float', duration_sec: 3 }
    });
    assert.deepEqual(owner.motion, { loop: { preset: 'blink', period: 60 } });
});

test('袋の複数行へ組を一度で書き、袋の motion を残したまま一手で戻す', async () => {
    const edit = { tracks: [{ items: [{ id: 'bag-1', source: { kind: 'captions' },
        motion: { in: { preset: 'fade', duration: 12 } } }] }] };
    const before = JSON.stringify({ captions: [
        { id: 'c-1', text_style: { color: '#ffffff' } },
        { id: 'c-2', text_style: { animation: { out: { id: 'pop' } } } }
    ] });
    const request = withCaptionMultiTargets(captionMotionComboWrites('c-1', 'smart')[0],
        [{ kind: 'caption', id: 'c-1' }, { kind: 'caption', id: 'c-2' }]);
    assert.deepEqual(request.targets.map(target => target.id), ['c-1', 'c-2']);
    let source = replaceMyStylePartsInSource(before, request.targets.map(target => target.id),
        request.value.parts, { motionDelta: request.value.multi_motion_delta });
    const rows = JSON.parse(source).captions;
    assert.deepEqual(rows.map(row => row.text_style.animation.in.id), ['slide-up', 'slide-up']);
    assert.deepEqual(rows.map(row => row.text_style.animation.loop.id), ['float', 'float']);
    assert.deepEqual(edit.tracks[0].items[0].motion, { in: { preset: 'fade', duration: 12 } });
    const history = new AkariEditHistoryService();
    history.push({ label: '字幕の動きを変更', undo: async () => { source = before; },
        redo: async () => { source = replaceMyStylePartsInSource(before,
            request.targets.map(target => target.id), request.value.parts,
            { motionDelta: request.value.multi_motion_delta }); } });
    await history.undo();
    assert.equal(source, before);
    assert.equal(history.canUndo, false);
});

test('編集パネルは語の表示と強調の保存先、カラオケ未終了色を接続する', () => {
    const widget = readInspectorSource();
    const panel = readFileSync(new URL('../src/browser/inspector/caption-motion-panel.ts', import.meta.url), 'utf8');
    assert.match(widget, /layerAudioService\.setCaptionFields\(/u);
    assert.match(widget, /captionsSource = upsertCaptionEmphasis/u);
    assert.match(widget, /layerAudioService\.writeEditSnapshot\(/u);
    assert.match(panel, /kind: 'caption-style-color'/u);
    assert.match(panel, /歌い終わった文字の色/u);
    assert.match(panel, /1 文字ずつ/u);
    assert.match(panel, /開始位置/u);
    assert.match(panel, /#fb923c.*#ffd94a.*#f87171.*#4ade80.*#60a5fa/u);
    assert.match(panel, /button\.akari-caption-motion-swatch\{[^}]*width:22px;height:22px/u);
    assert.match(panel, /button\.akari-caption-motion-swatch\[aria-pressed=[^\]]+\]\{outline:2px solid/u);
    assert.match(panel, /swatch\.className = 'akari-caption-motion-swatch'/u);
    assert.match(panel, /現在: 語ごとに色がじわっと変わります/u);
    assert.match(panel, /setKaraoke\(\{ done_color: '#fb923c', fill: 'char' \}, true\)/u);
    assert.match(panel, /play\('karaoke', 'word-style'\)/u);
    assert.doesNotMatch(panel, /固定の黄色/u);
    assert.match(panel, /語の時刻（words\[\]）がない字幕/u);
    assert.match(panel, /語の時刻がない字幕では、カラオケ・ポップ・1 語ずつは動きません/u);
    const timelineWidget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
    assert.match(timelineWidget, /request\.path === 'motion'[\s\S]*?raw\.source\?\.kind === 'captions'[\s\S]*?字幕の動きは各行の設定から変更/u);
});

test('inspector のカラオケは 1 操作 1 履歴で undo/redo でき、外部変更を拒否する', async () => {
    const source = readInspectorSource();
    const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node)
        && node.name?.text === 'AkariInspectorWidget');
    const method = widget.members.find(node => node.name?.getText(ast) === 'captionMotionServices');
    assert.ok(method);
    const compiled = ts.transpileModule(`class Harness { ${method.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const Harness = new Function('readCaptionMotionCue', 'readOwnerMotion', 'upsertCaptionEmphasis', 'upsertCaptionKaraoke',
        `${compiled}; return Harness;`)(readCaptionMotionCue, readOwnerMotion, upsertCaptionEmphasis, upsertCaptionKaraoke);
    const instance = new Harness();
    const root = { toString: () => 'project', resolve: name => ({ toString: () => `project/${name}` }) };
    let captionSource = JSON.stringify([cue]);
    const editSource = JSON.stringify({ output: { fps: 30 }, tracks: [{ items: [{ id: 'bag-1',
        duration: 60, source: { kind: 'captions' } }] }] });
    const calls = [];
    const renders = [];
    const pushed = [];
    instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
    instance.model = { snapshot: { kind: 'caption', id: cue.id } };
    instance.render = () => { renders.push(captionSource); };
    instance.history = new AkariEditHistoryService();
    instance.history.onDidPush(entry => pushed.push(entry));
    instance.fileService = { readFile: async uri => ({ value: {
        toString: () => uri.toString().endsWith('captions.json') ? captionSource : editSource
    } }) };
    instance.layerAudioService = {
        setCaptionFields: async request => { calls.push(['style', request]); return { committed: true }; },
        writeEditSnapshot: async request => {
            calls.push(['snapshot', request]);
            captionSource = request.captionsSource;
            return { committed: true };
        }
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
    const before = captionSource;
    assert.deepEqual(await services.setKaraoke({ done_color: '#fb923c', fill: 'char' }, true), { ok: true });
    assert.equal(calls.length, 3);
    assert.deepEqual(JSON.parse(calls[2][1].captionsSource).captions[0].text_style.karaoke,
        { done_color: '#fb923c', fill: 'char' });
    assert.equal(JSON.parse(calls[2][1].captionsSource).captions[0].style, 'karaoke');
    const after = captionSource;
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].label, 'カラオケの選択');
    assert.equal(pushed[0].before, before);
    assert.equal(pushed[0].after, after);
    await instance.history.undo();
    assert.equal(captionSource, before);
    await instance.history.redo();
    assert.equal(captionSource, after);
    assert.deepEqual(renders, [before, after]);
    assert.deepEqual(await services.setKaraoke({ fill: 'smooth' }), { ok: true });
    assert.equal(pushed.length, 2);
    assert.equal(pushed[1].label, 'カラオケの設定の変更');
    await instance.history.undo();
    assert.equal(captionSource, after);
    captionSource = 'external edit\n';
    await assert.rejects(instance.history.undo(), /字幕ファイルが後から変更されています/u);
    assert.equal(captionSource, 'external edit\n');
    assert.equal(renders.length, 3);
    assert.equal((await services.readOwner()).durationFrames, 60);
});

test('karaoke writer preserves unrelated fields and default inheritance', () => {
    const source = JSON.stringify({ default_text_style: { karaoke: { done_color: '#ffd94a', fill: 'word' } },
        captions: [{ ...cue, text_style: { color: '#ffffff' } }] });
    assert.deepEqual(readCaptionMotionCue(source, cue.id).text_style.karaoke,
        { done_color: '#ffd94a', fill: 'word' });
    const updated = JSON.parse(upsertCaptionKaraoke(source, cue.id, { fill: 'smooth', start_index: 2 }));
    assert.deepEqual(updated.default_text_style.karaoke, { done_color: '#ffd94a', fill: 'word' });
    assert.deepEqual(updated.captions[0].text_style,
        { color: '#ffffff', karaoke: { fill: 'smooth', start_index: 2 } });
});
