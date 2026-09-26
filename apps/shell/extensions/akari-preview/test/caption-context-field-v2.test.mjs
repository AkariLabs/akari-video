import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { applyCaptionContextField } from '../../akari-annotations/lib/common/caption-context-edit.js';
import { captionTextStyleVars, renderCaptionFragment } from '../../../../../packages/render-cut/src/captions.mjs';
import { parseCaptions } from '../../../../../packages/edit-store/lib/index.js';
import { harness } from './caption-animator-webview-harness.mjs';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');

const original = '{"captions":[{"id":"a","start":0,"end":1,"text":"赤","text_style":{"background":{"opacity":0.3},"color":"#ff0000"}},{"id":"b","start":1,"end":2,"text":"青"}]}';

test('captionField は複数 cue の text_style だけを変え undo/redo を一履歴にまとめる', async () => {
    let source = original;
    const history = [];
    let writes = 0;
    const deps = { readSource: async () => source, writeSource: async value => { source = value; writes++; },
        recordHistory: entry => history.push(entry), reload: async () => undefined };
    assert.deepEqual(await applyCaptionContextField('a', 'opacity', 0.6, ['a', 'b'], deps), { ok: true });
    assert.equal(history.length, 1);
    assert.equal(writes, 1);
    const parsed = JSON.parse(source);
    assert.equal(parsed.captions[0].text_style.background.opacity, 0.3);
    assert.equal(parsed.captions[0].text_style.opacity, 0.6);
    assert.equal(parsed.captions[1].text_style.opacity, 0.6);
    await history[0].undo();
    assert.equal(source, original);
    await history[0].redo();
    assert.equal(JSON.parse(source).captions[1].text_style.opacity, 0.6);
});

test('captionField の bool・enum 書き込みと無効な値の拒否', async () => {
    for (const [field, value] of [['italic', true], ['underline', true], ['strikethrough', true],
        ['list', 'bullet'], ['list', null], ['align', 'right'], ['vertical', true],
        ['vertical_align', 'middle'], ['text_transform', 'upper']]) {
        let source = original;
        const result = await applyCaptionContextField('a', field, value, ['a'], {
            readSource: async () => source, writeSource: async next => { source = next; },
            recordHistory: () => undefined, reload: async () => undefined });
        assert.equal(result.ok, true, field);
        assert.equal(JSON.parse(source).captions[0].text_style[field], value, field);
    }
    assert.deepEqual(await applyCaptionContextField('a', 'opacity', 2, [], {
        readSource: async () => original, writeSource: async () => { throw Error('unexpected'); },
        recordHistory: () => undefined, reload: async () => undefined }), { ok: false });
});

test('配列ルートと空の text_style でも cue 以外を保持する', async () => {
    let source = '[ {"id":"a","text_style":{ }} , {"id":"b","note":"保つ"} ]';
    await applyCaptionContextField('a', 'underline', true, [], {
        readSource: async () => source, writeSource: async next => { source = next; },
        recordHistory: () => undefined, reload: async () => undefined });
    assert.deepEqual(JSON.parse(source)[0].text_style, { underline: true });
    assert.match(source, /\{"id":"b","note":"保つ"\}/u);
});

test('字幕の線は文字色、配置は内容幅の箱、箇条書きと透明度は必要時だけ CSS に届く', () => {
    const style = { color: '#ff0000', stroke: { color: '#000000', width_px: 3 }, underline: true,
        strikethrough: true, align: 'right', list: 'bullet', opacity: 0.4 };
    const vars = captionTextStyleVars(style);
    assert.equal(vars['--caption-text-decoration'], 'underline line-through');
    assert.equal(vars['--caption-line-width'], undefined);
    assert.equal(vars['--caption-align-items'], undefined);
    assert.equal(vars['--caption-list-display'], 'list-item');
    assert.equal(vars['--caption-opacity'], '0.4');
    const vertical = captionTextStyleVars({ vertical: true, vertical_align: 'top' });
    assert.equal(vertical['--caption-writing-mode'], 'vertical-rl');
    assert.equal(vertical['--caption-text-orientation'], 'upright');
    assert.equal(vertical['--caption-right'], '4%');
    assert.equal(vertical['--caption-width'], 'max-content');
    const html = renderCaptionFragment('長い字幕\n短い', { textStyleActive: true, contextStyle: style });
    assert.match(html, /<div class="akari-caption__alignbox"><p class="akari-caption__line" data-decoration-text=/u);
    assert.match(html, /\.akari-caption--aligned \.akari-caption__alignbox\{display:flex;flex-direction:column;width:max-content/u);
    assert.match(html, /\.akari-caption--aligned \.akari-caption__alignbox \.akari-caption__line\{box-sizing:border-box;width:100%/u);
    assert.match(html, /text-decoration-color:var\(--caption-color,#fff\)/u);
    assert.match(html, /-webkit-text-stroke:0 transparent!important;text-shadow:none!important/u);
    assert.match(html, /list-style-type:disc/u);
    assert.match(html, /opacity:var\(--caption-opacity,1\)/u);
    const unchanged = renderCaptionFragment('長い字幕\n短い', { textStyleActive: true,
        contextStyle: { color: '#ff0000' } });
    assert.doesNotMatch(unchanged, /akari-caption__alignbox|text-decoration-color|list-style-type|opacity:var/u);
    assert.deepEqual(parseCaptions(JSON.stringify({ captions: [{ id: 'a', start: 0, end: 1, text: '字',
        edited: true, sourceRef: null, speaker: null, text_style: style }] })).warnings, []);
});

test('縦書きの選択枠は行の実測矩形を追う', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /const captionVisualRect = [\s\S]*?querySelectorAll\('\.akari-caption__line'\)[\s\S]*?getBoundingClientRect\(\)/u);
    assert.match(source, /const rect = captionVisualRect\(\);\s*updateCaptionSelectBoxForRect\(rect\)/u);
});

test('縦書きプレートは出力プレビューで物理的な左右の固定端を保つ', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /\.akari-caption\.akari-caption--vertical \.akari-caption__plate\{left:var\(--caption-left,0\);right:var\(--caption-right,0\);width:var\(--caption-width,max-content\);margin-inline:0;writing-mode:horizontal-tb;align-items:var\(--caption-align-items,center\);\}/u);
    for (const [vertical_align, items] of [['top', 'flex-end'], ['middle', 'center'], ['bottom', 'flex-start']]) {
        assert.equal(captionTextStyleVars({ vertical: true, vertical_align })['--caption-align-items'], items);
    }
});

test('プレビューの 2 行字幕も内容幅の箱で左右に揃える', () => {
    for (const align of ['left', 'right']) {
        const view = harness({ cues: [{ id: 'align-v2', start: 1, end: 3, text: '長い字幕\n短い',
            textStyle: { align } }] });
        view.tick(1.5);
        assert.match(view.plate.innerHTML, /<div class="akari-caption__alignbox"><p class="akari-caption__line">/u);
        assert.match(view.plate.innerHTML, /\.akari-caption__alignbox\{display:flex;flex-direction:column;width:max-content/u);
        assert.match(view.plate.innerHTML, /\.akari-caption__alignbox \.akari-caption__line\{box-sizing:border-box;width:100%/u);
    }
});

test('プレビューの線は縁取りと影を持たない上層で文字色になり、bullet は対象 cue に閉じる', () => {
    const view = harness({ cues: [
        { id: 'under', start: 1, end: 3, text: '黄色の字幕', textStyle: {
            color: '#f5c451', underline: true, stroke: { color: '#000000', widthPx: 6 } } },
        { id: 'strike', start: 1, end: 3, text: '青い字幕', textStyle: {
            color: '#4da3ff', strikethrough: true, stroke: { color: '#000000', widthPx: 6 } } },
        { id: 'bullet', start: 1, end: 3, text: '箇条書き', textStyle: { list: 'bullet' } }
    ] });
    view.tick(1.5);
    const html = view.plates.map(plate => plate.innerHTML);
    for (const decorated of html.slice(0, 2)) {
        assert.match(decorated, /akari-caption--decorated/u);
        assert.match(decorated, /data-decoration-text=/u);
        assert.match(decorated, /text-decoration:none!important/u);
        assert.match(decorated, /-webkit-text-stroke:0 transparent!important;text-shadow:none!important/u);
        assert.match(decorated, /text-decoration-color:var\(--caption-color,#fff\)/u);
        assert.doesNotMatch(decorated, /akari-caption--bullet|display:list-item/u);
    }
    assert.match(html[2], /akari-caption--bullet/u);
    assert.match(html[2], /\.akari-caption--bullet \.akari-caption__line\{display:list-item/u);
});

test('縦書きは横長・縦長とも句読点と横書き文字数上限で列を割らない', () => {
    for (const output of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
        const view = harness({ output, cues: [{ id: 'vertical', start: 1, end: 3,
            text: '縦書きの字幕 2026年、AKARI', textStyle: { vertical: true } }] });
        view.tick(1.5);
        assert.equal((view.plate.innerHTML.match(/<p class="akari-caption__line"/gu) ?? []).length, 1);
        assert.match(view.plate.innerHTML, /max-height:var\(--caption-vertical-max-height,90vh\)/u);
        assert.equal(captionTextStyleVars({ vertical: true }, output)['--caption-vertical-max-height'],
            `${output.height * 0.9}px`);
        assert.equal(captionTextStyleVars({ vertical: true }, output)['--caption-left'], '50%');
        const resolved = harness({ output, cues: [{ id: 'resolved-vertical', start: 1, end: 3,
            text: '縦書きの字幕 2026年、AKARI', resolvedTimeline: true,
            displayLines: ['縦書きの字幕 2026年、', 'AKARI'], textStyle: { vertical: true } }] });
        resolved.tick(1.5);
        assert.equal((resolved.plate.innerHTML.match(/<p class="akari-caption__line"/gu) ?? []).length, 1);
    }
});

test('色見本の確定後もポップアップ自身が Esc の焦点を保持し、数字のスピンを隠す', () => {
    let focused = 0;
    const writes = [];
    const view = { state: { selectedId: 'cue-1', kind: 'caption' },
        pop: { focus: () => { focused++; } },
        writeCaptionValue: (...args) => writes.push(args) };
    const color = { dataset: { captionColor: 'color', value: '#f26666' } };
    const target = { closest: selector => selector === '[data-caption-color]' ? color : null };
    PreviewContextBar.prototype.onPopClick.call(view, { target });
    assert.equal(focused, 1);
    assert.deepEqual(writes, [['color', '#f26666']]);
    const source = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    assert.match(source, /const hadFocus = this\.pop\.contains\(document\.activeElement\)/u);
    assert.match(source, /if \(hadFocus\) this\.pop\.focus\(\{ preventScroll: true \}\)/u);
    assert.match(source, /input\[type="number"\]::-webkit-inner-spin-button/u);
    assert.match(source, /input\[type="number"\]::-webkit-outer-spin-button/u);
});

test('バーのアクションは captionField の単一命令を使い、ポップアップを他項目で閉じる', () => {
    const calls = [];
    const view = { state: { item: { textStyle: { underline: false } } }, openWindow: 'captionSpacing', moreOpen: false,
        barSignature: '', run: request => { calls.push(request); return Promise.resolve({ ok: true }); },
        render: () => undefined, commands: { executeCommand: () => Promise.resolve() } };
    PreviewContextBar.prototype.onCaptionBarAction.call(view, 'captionUnderline');
    assert.equal(view.openWindow, null);
    assert.deepEqual(calls, [{ action: 'captionField', field: 'underline', value: true }]);
});

test('ミニポップアップ 3 種と縦書き用の固定位置', () => {
    const view = {};
    const state = { item: { textStyle: { vertical: true, color: '#ff0000', opacity: 0 } } };
    const color = PreviewContextBar.prototype.captionPopHtml.call(view, 'captionTextColor', state);
    const spacing = PreviewContextBar.prototype.captionPopHtml.call(view, 'captionSpacing', state);
    const opacity = PreviewContextBar.prototype.captionPopHtml.call(view, 'captionOpacity', state);
    assert.match(color, /data-caption-field="color"/u);
    assert.match(spacing, /data-caption-field="letterSpacingEm"/u);
    assert.match(spacing, /data-caption-field="lineHeight"/u);
    assert.match(spacing, /data-caption-anchor="top"[^>]*>右/u);
    assert.match(spacing, /data-caption-inspector/u);
    assert.match(opacity, /data-caption-field="opacity"/u);
    assert.match(opacity, /value="0"/u);
});

test('字幕の各トグル・配置・サイズは押下ごとに書き込み 1 回', () => {
    const calls = [];
    const view = { state: { item: { textStyle: { sizePx: 48, align: 'center', textTransform: 'none' } } },
        openWindow: null, moreOpen: false, barSignature: '', captionPending: new Map(), captionOverflow: [],
        run: request => { calls.push(request); return Promise.resolve({ ok: true }); },
        render: () => undefined, writeCaptionValue: PreviewContextBar.prototype.writeCaptionValue,
        commands: { executeCommand: () => Promise.resolve() } };
    for (const key of ['captionBold', 'captionItalic', 'captionUnderline', 'captionStrike', 'captionCase',
        'captionAlign', 'captionBullet', 'captionVertical', 'captionSizeDec', 'captionSizeInc']) {
        PreviewContextBar.prototype.onCaptionBarAction.call(view, key);
    }
    assert.equal(calls.length, 10);
    assert.deepEqual(calls.map(call => [call.action, call.field]), [
        ['captionStyle', 'weight'], ['captionField', 'italic'], ['captionField', 'underline'],
        ['captionField', 'strikethrough'], ['captionField', 'text_transform'], ['captionField', 'align'],
        ['captionField', 'list'], ['captionField', 'vertical'], ['captionStyle', 'sizePx'], ['captionStyle', 'sizePx']]);
    assert.equal(calls.find(call => call.field === 'align').value, 'right');
    assert.equal(calls.at(-2).value, 46);
    assert.equal(calls.at(-1).value, 48);
});

test('サイズ Enter→blur/change と間隔・透明度の数値確定は同値を二重書き込みしない', () => {
    const calls = [];
    const style = { sizePx: 48, lineHeight: 1.2, letterSpacingEm: 0, opacity: 1 };
    const view = { state: { kind: 'caption', selectedId: 'cue-1', item: { textStyle: style } },
        captionPending: new Map(), host: { sendMessage: () => undefined },
        run: request => { calls.push(request); return Promise.resolve({ ok: true }); },
        writeCaptionValue: PreviewContextBar.prototype.writeCaptionValue };
    const size = { matches: selector => selector === '[data-akari-caption-size]', value: '72' };
    PreviewContextBar.prototype.onCaptionSizeChange.call(view, { target: size });
    PreviewContextBar.prototype.onCaptionSizeChange.call(view, { target: size });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { action: 'captionStyle', field: 'sizePx', value: 72 });
    style.sizePx = 72;
    PreviewContextBar.prototype.onCaptionSizeChange.call(view, { target: size });
    const line = { dataset: { captionField: 'lineHeight' }, type: 'number', value: '1.8' };
    PreviewContextBar.prototype.onPopChange.call(view, { target: line });
    PreviewContextBar.prototype.onPopChange.call(view, { target: line });
    PreviewContextBar.prototype.onPopChange.call(view, { target: { ...line, type: 'range' } });
    const spacing = { dataset: { captionField: 'letterSpacingEm' }, type: 'number', value: '0.2' };
    PreviewContextBar.prototype.onPopChange.call(view, { target: spacing });
    PreviewContextBar.prototype.onPopChange.call(view, { target: spacing });
    const opacity = { dataset: { captionField: 'opacity' }, type: 'number', value: '60' };
    PreviewContextBar.prototype.onPopChange.call(view, { target: opacity });
    PreviewContextBar.prototype.onPopChange.call(view, { target: opacity });
    PreviewContextBar.prototype.onPopChange.call(view, { target: { ...opacity, type: 'range' } });
    assert.deepEqual(calls.slice(1), [
        { action: 'captionStyle', field: 'lineHeight', value: 1.8 },
        { action: 'captionStyle', field: 'letterSpacingEm', value: 0.2 },
        { action: 'captionField', field: 'opacity', value: 0.6 }
    ]);
});
