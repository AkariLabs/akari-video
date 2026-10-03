import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextCaptionPanel, retainCaptionPanel, captionPanelChangedDetail, captionPanelFontWrite,
    captionPanelLookWrite, filterCaptionFonts, captionFontWeights, captionPanelTextStyle, captionFontRowDetail,
    renderableCaptionFonts, CAPTION_FONT_FAMILY } from '../lib/common/caption-panel-state.js';
import { CAPTION_PANEL_FONTS } from '../lib/common/caption-panel-catalog.js';
import { filterCaptionPanelFonts } from '../lib/common/caption-font-label.js';
import { captionRevealDestination } from '../lib/common/caption-reveal-destination.js';
import { assignSectionToTab } from '../lib/browser/inspector/tab-model.js';
import { createCaptionPanel, CAPTION_PANEL_STYLES } from '../lib/browser/inspector/caption-panels.js';
import { updateCaptionTextStyleInSource } from '../lib/common/caption-store.js';
import { createRequire } from 'node:module';
import { appendLibraryTextstyleShowcaseItems, parsePresetShowcaseJsonl } from '../../akari-project/lib/common/preset-showcase.js';
import { libraryTextStyleSample } from '../../akari-preview/lib/common/textstyle-sample.js';

const require = createRequire(import.meta.url);
const { CAPTION_SAMPLE_TEXT } = require('../../../../../packages/edit-store/lib/index.js');

class Element {
    children = [];
    attributes = {};
    listeners = new Map();
    style = { setProperty(name, value) { this[name] = value; } };
    textContent = '';
    constructor(tagName) { this.tagName = tagName; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    fire(type) { this.listeners.get(type)?.({ target: this }); }
}
const document = { createElement: tagName => new Element(tagName) };
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
const actions = { close() {}, switchTo() {}, font() {}, style() {}, save() {}, openLibrary() {}, rerender() {},
    preview() {}, confirm() {}, escape() {} };
const state = () => ({ query: '', filtersOpen: true, filters: new Set(), recentFonts: [], recentStyles: [] });
const faces = new Map(CAPTION_PANEL_FONTS.filter(font => font.bundled).map(font => [font.id,
    font.id === 'noto-sans-jp' ? CAPTION_FONT_FAMILY : font.family]));

test('同じコマンドで閉じ、別のコマンドで切り替え、文字以外の選択で閉じる', () => {
    assert.equal(nextCaptionPanel(null, 'font', true), 'font');
    assert.equal(nextCaptionPanel('font', 'font', true), null);
    assert.equal(nextCaptionPanel('font', 'style', true), 'style');
    assert.equal(nextCaptionPanel(null, 'font', false), null);
    assert.equal(retainCaptionPanel('font', true), 'font');
    assert.equal(retainCaptionPanel('font', false), null);
});

test('通知 detail は開く・切り替える・閉じるの状態をそのまま表す', () => {
    let panel = nextCaptionPanel(null, 'font', true);
    assert.deepEqual(captionPanelChangedDetail(panel), { panel: 'font' });
    panel = nextCaptionPanel(panel, 'style', true);
    assert.deepEqual(captionPanelChangedDetail(panel), { panel: 'style' });
    panel = nextCaptionPanel(panel, 'style', true);
    assert.deepEqual(captionPanelChangedDetail(panel), { panel: null });
    panel = retainCaptionPanel('font', false);
    assert.deepEqual(captionPanelChangedDetail(panel), { panel: null });
});

test('表示できる 9 書体だけを検索・複数タグ AND フィルターで絞る', () => {
    assert.equal(CAPTION_PANEL_FONTS.length, 31);
    const available = renderableCaptionFonts(CAPTION_PANEL_FONTS, faces);
    assert.equal(filterCaptionFonts(available, '', new Set()).length, 9);
    const selected = new Set(['gothic', 'rounded']);
    const rows = filterCaptionFonts(available, '', selected);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.tags.includes('gothic') && row.tags.includes('rounded')));
    assert.ok(filterCaptionFonts(available, 'Noto', new Set()).every(row => row.title.includes('Noto')));
    assert.ok(!available.some(row => row.id === 'ab-kirigirisu'));
    assert.equal(faces.get('noto-sans-jp'), CAPTION_FONT_FAMILY);
    assert.match(captionFontRowDetail(['latin']), /日本語は代わりの書体で表示/u);
    assert.doesNotMatch(captionFontRowDetail(['japanese']), /代わりの書体/u);
});

test('日本語表示名と英字名の両方で同じ書体を検索できる', () => {
    const available = renderableCaptionFonts(CAPTION_PANEL_FONTS, faces);
    for (const query of ['明朝', 'しっぽり', 'Shippori']) {
        assert.ok(filterCaptionPanelFonts(available, query, new Set()).some(font => font.id === 'shippori-mincho'));
    }
    for (const query of ['ゴシック', 'DotGothic']) {
        assert.ok(filterCaptionPanelFonts(available, query, new Set()).some(font => font.id === 'dotgothic16'));
    }
    const panel = createCaptionPanel(document, 'font', state(), [], faces, actions);
    const row = descendants(panel).find(node => node.attributes['data-akari-font-row'] === 'shippori-mincho');
    assert.ok(descendants(row).some(node => node.textContent === 'しっぽり明朝'));
    assert.ok(descendants(row).some(node => node.textContent === 'Shippori Mincho'));
});

test('revealField の行き先は編集パネルの実在する欄とタブに一致する', () => {
    for (const [field, owner, section, tab] of [
        ['caption-effect', false, 'style:effect', 'text'],
        ['caption-animation', true, 'motion:caption', 'motion'],
        ['caption-animation', false, 'motion:caption', 'motion'],
        ['caption-style', false, 'style', 'text']
    ]) {
        const destination = captionRevealDestination({ field }, owner);
        assert.equal(destination.sectionId, section);
        assert.equal(destination.tabId, tab);
        assert.equal(assignSectionToTab('caption', section), tab);
    }
});

test('展開する太さはフォントファイルの静的ウェイトまたは可変 wght 軸内だけ', () => {
    assert.deepEqual(captionFontWeights('mplus-rounded-1c'), [500, 800, 900]);
    assert.deepEqual(captionFontWeights('biz-udgothic'), [400, 700]);
    assert.deepEqual(captionFontWeights('noto-serif-jp'), [200, 300, 400, 500, 600, 700, 800, 900]);
    assert.deepEqual(captionFontWeights('ab-kirigirisu'), []);
});

test('選択を確定する要求は既定値を焼き込まず書体と太さだけを一回で渡す', () => {
    const requests = [];
    requests.push(captionPanelFontWrite('cue-1', 'BIZ UDGothic', 700));
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { kind: 'caption-style-effect', id: 'cue-1', value: {
        fontFamily: 'BIZ UDGothic', fontWeight: 700, weight: 700 } });
    assert.deepEqual(captionPanelFontWrite('cue-1', CAPTION_FONT_FAMILY).value,
        { fontFamily: CAPTION_FONT_FAMILY });
    const source = JSON.stringify({ default_text_style: { color: '#ffee00' }, captions: [{ id: 'cue-1',
        start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null, edited: false,
        text_style: { color: '#00ff00' } }] });
    const updated = JSON.parse(updateCaptionTextStyleInSource(source, 'cue-1', requests[0].value));
    assert.deepEqual(updated.captions[0].text_style, {
        color: '#00ff00', font_family: 'BIZ UDGothic', font_weight: 700, weight: 700
    });
    assert.deepEqual(updated.default_text_style, { color: '#ffee00' });
});

test('スタイルカードは固定文字に色・縁・座布団・影・書体・太さ・字間を反映する', () => {
    const example = { color: '#ff8800', stroke: { color: '#112233', width_px: 4 },
        background: { color: '#222222', opacity: 0.6, padding_px: 8 },
        shadow: { color: '#000000', opacity: 0.5, blur_px: 4, distance_px: 3 },
        font_family: 'serif', font_weight: 800, letter_spacing_em: 0.1 };
    const converted = captionPanelTextStyle(example);
    assert.equal(converted.color, '#ff8800');
    assert.equal(converted.stroke.widthPx, 4);
    assert.equal(converted.background.color, '#222222');
    assert.equal(converted.shadow.blurPx, 4);
    assert.equal(converted.fontFamily, 'serif');
    assert.equal(converted.weight, 800);
    assert.equal(converted.letterSpacingEm, 0.1);
    const cardRoot = createCaptionPanel(document, 'style', state(), [], faces, actions);
    const cards = descendants(cardRoot).filter(node => node.attributes['data-akari-style-card']);
    assert.equal(cards.length, CAPTION_PANEL_STYLES.length);
    const lines = descendants(cardRoot).filter(node => node.className === 'akari-caption__line');
    assert.ok(lines.length > 0 && lines.every(line => line.textContent === CAPTION_SAMPLE_TEXT));
    const variety = cards.find(card => card.attributes['data-akari-style-card'] === 'subtitle-variety');
    const varietyCaption = descendants(variety).find(node => node.className === 'akari-caption');
    assert.equal(varietyCaption.style['--caption-color'], '#fff200');
    assert.match(varietyCaption.style['--caption-text-shadow'], /-9px -9px 0 #1a1a1a/u);
    const news = cards.find(card => card.attributes['data-akari-style-card'] === 'subtitle-news');
    const newsCaption = descendants(news).find(node => node.className === 'akari-caption');
    assert.equal(newsCaption.style['--plate-bg'], 'rgba(198,40,40,1)');
    assert.equal(newsCaption.style['--plate-pad-x'], '16px');
    const glitch = cards.find(card => card.attributes['data-akari-style-card'] === 'glitch');
    const glitchCaption = descendants(glitch).find(node => node.className === 'akari-caption');
    assert.match(glitchCaption.style['--caption-text-shadow'], /#ff0066/u);
});

test('右のスタイル id は左の索引順とライブラリ由来、続くマイスタイルの順になる', () => {
    const index = readFileSync(new URL('../../../../../presets/textstyle/index.jsonl', import.meta.url), 'utf8');
    const library = [{ id: 'custom-rich', name: '自作リッチ', category: 'title', origin: 'library',
        style: { size_px: 168, color: '#fff' } }];
    const showcase = appendLibraryTextstyleShowcaseItems(parsePresetShowcaseJsonl(index, 'textstyle'), library);
    const mine = [{ id: 'saved', name: '保存', parts: [{ kind: 'look', text_style: { color: '#fff' } }] }];
    const panel = createCaptionPanel(document, 'style', state(), mine, faces, actions, showcase);
    const ids = descendants(panel).filter(node => node.attributes['data-akari-style-card'])
        .map(node => node.attributes['data-akari-style-card']);
    assert.deepEqual(ids, [...showcase.map(item => item.id), 'mystyle/saved']);
});

test('右の見本は共有 CSS で光・多重縁・グラデーション・大文字化を描きサイズを揃える', () => {
    const rich = { size_px: 168, text_transform: 'uppercase',
        glow: { color: '#00eeff', density: 80, spread: 30 },
        strokes: [{ color: '#000000', width_px: 10 }, { color: '#ffffff', width_px: 4 }],
        fill: { type: 'gradient', angle_deg: 180, stops: [
            { at: 0, color: '#111111' }, { at: 100, color: '#ffffff' }] } };
    const presets = [{ id: 'rich', name: 'リッチ', style: rich },
        { id: 'small', name: '小', style: { size_px: 56, color: '#fff' } }];
    const panel = createCaptionPanel(document, 'style', state(), [], faces, actions, presets);
    const cards = descendants(panel).filter(node => node.attributes['data-akari-style-card']);
    const face = card => descendants(card).find(node => node.className === 'akari-caption-style-specimen').children[0];
    const leftSample = libraryTextStyleSample(rich);
    assert.equal(face(cards[0]).style.fontSize, `${leftSample.fontSize}px`);
    assert.equal(face(cards[0]).style.fontSize, face(cards[1]).style.fontSize);
    assert.equal(face(cards[0]).style.WebkitTextStroke, leftSample.WebkitTextStroke);
    assert.equal(face(cards[0]).style.textShadow, leftSample.textShadow);
    assert.equal(face(cards[0]).style.backgroundImage, leftSample.backgroundImage);
    assert.match(face(cards[0]).style.textShadow, /#00eeff/u);
    assert.match(face(cards[0]).style.textShadow, /#ffffff/u);
    assert.match(face(cards[0]).style.WebkitTextStroke, /#000000/u);
    assert.match(face(cards[0]).style.backgroundImage, /linear-gradient/u);
    assert.equal(face(cards[0]).style.textTransform, 'uppercase');
});

test('右から用意されたスタイルは動きとサイズ保持を渡し、マイスタイルは保存サイズを渡す', () => {
    const preset = { id: 'impact', style: { size_px: 168, animation: { in: { id: 'pop' } } } };
    const prepared = captionPanelLookWrite('one', preset.style, preset.id, [preset]);
    assert.equal(prepared.value.keepSize, true);
    assert.deepEqual(prepared.value.parts.map(part => part.kind), ['look', 'motion']);
    assert.deepEqual(prepared.value.parts[1].animation, { in: { id: 'pop' } });
    const saved = captionPanelLookWrite('one', { size_px: 80 }, 'mystyle/saved', [preset]);
    assert.equal(saved.value.keepSize, undefined);
    assert.equal(saved.value.parts[0].text_style.size_px, 80);
});

test('右の同梱スタイルはカードと最近使った行の仮表示でも現在の大きさと px 比を保つ', () => {
    const preset = { id: 'impact', name: 'インパクト', style: { size_px: 168,
        stroke: { color: '#000', width_px: 10 }, shadow: { color: '#111', blur_px: 12 } } };
    const mine = [{ id: 'saved', name: '保存', parts: [{ kind: 'look', text_style: { size_px: 80 } }] }];
    const previews = [];
    const panelState = state();
    panelState.recentStyles = ['impact', 'mystyle/saved'];
    const panel = createCaptionPanel(document, 'style', panelState, mine, faces,
        { ...actions, preview: style => previews.push(style) }, [preset], 56);
    const cards = descendants(panel).filter(node => node.attributes['data-akari-style-card']);
    cards[0].fire('pointerenter');
    assert.equal(previews.at(-1).sizePx, 56);
    assert.ok(Math.abs(previews.at(-1).stroke.widthPx - 10 * 56 / 168) < 1e-10);
    assert.equal(previews.at(-1).shadow.blurPx, 4);
    const recent = descendants(panel).find(node => node.className === 'akari-caption-recent');
    recent.children[0].fire('focus');
    assert.equal(previews.at(-1).sizePx, 56);
    recent.children[1].fire('focus');
    assert.equal(previews.at(-1).sizePx, 80);
    cards[1].fire('pointerenter');
    assert.equal(previews.at(-1).sizePx, 80);
});

test('フォント行・フィルターチップ・追加ボタンは安定した data 属性を持つ', () => {
    const panelState = state();
    const root = createCaptionPanel(document, 'font', panelState, [], faces, actions);
    const nodes = descendants(root);
    assert.equal(nodes.filter(node => node.attributes['data-akari-font-row'] !== undefined).length, 9);
    assert.ok(nodes.some(node => node.attributes['data-akari-font-filter-chip'] === 'gothic'));
    assert.ok(nodes.some(node => node.attributes['data-akari-font-add'] !== undefined));
    const single = nodes.find(node => node.attributes['data-akari-font-row'] === 'dela-gothic-one');
    assert.equal(single.children[0].disabled, true);
    assert.equal(nodes.filter(node => node.attributes['data-akari-font-row'] === 'ab-kirigirisu').length, 0);
    const multiple = nodes.find(node => node.attributes['data-akari-font-row'] === 'biz-udgothic');
    assert.equal(multiple.children[0].attributes['aria-expanded'], 'false');
    assert.match(multiple.children[0].attributes['aria-label'], /太さを開く/u);
    multiple.children[0].fire('click');
    const expanded = descendants(createCaptionPanel(document, 'font', panelState, [], faces, actions))
        .find(node => node.attributes['data-akari-font-row'] === 'biz-udgothic');
    assert.equal(expanded.children[0].attributes['aria-expanded'], 'true');
    assert.match(expanded.children[0].attributes['aria-label'], /太さを閉じる/u);
});
