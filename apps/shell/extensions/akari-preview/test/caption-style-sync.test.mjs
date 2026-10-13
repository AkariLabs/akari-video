import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { captionEmphasisMatches, normalizePreviewEmphasisWords } from '../lib/common/preview-emphasis-seat.js';
import { parsePreviewCaptions } from '../lib/browser/akari-preview-captions.js';
import { readHandlerCompiled } from './helpers/handler-source.mjs';
import { prioritizeCaptionStyleMarkup } from '../lib/common/caption-style-composition.js';
import { harness } from './caption-animator-webview-harness.mjs';
const { resolveCaptionWordStyleVars, TEXTSTYLE_CATALOG } = createRequire(import.meta.url)('@akari-video/edit-store');

test('cue overrides survive a preset in the legacy caption reader', () => {
    const [cue] = parsePreviewCaptions(JSON.stringify({ captions: [{
        id: 'c-0006', start: 7, end: 9, text: 'これ、AIと対話する', style_preset: 'plate-coral',
        text_style: { color: '#facc15', weight: 900, italic: true,
            background: { opacity: 0 } },
        runs: [{ from: 3, to: 8, role: 'emphasis', style: { color: '#FB923C', font_weight: 900 } }]
    }] }));
    assert.equal(cue.textStyle.color, '#facc15');
    assert.equal(cue.textStyle.weight, 900);
    assert.equal(cue.textStyle.italic, true);
    assert.equal(cue.textStyle.background.opacity, 0);
    assert.equal(cue.runs[0].style.color, '#FB923C');
});

test('emphasis preset without emotion is retained and targets the exact text', () => {
    const words = normalizePreviewEmphasisWords([{
        id: 'e-0001', t_start: 7.4, t_end: 8.2, word: '対話', style_preset: 'emphasis-red'
    }]);
    assert.equal(words[0].emotion, 'emphasis');
    assert.deepEqual(captionEmphasisMatches('これ、AIと対話する', 7, 9, words)
        .map(({ from, to }) => [from, to]), [[6, 8]]);
    assert.equal(captionEmphasisMatches('これ、AIと対話する', 9, 10, words).length, 0);
    const sourced = [{ ...words[0], src: 'source-1' }];
    assert.equal(captionEmphasisMatches('対話', 7, 9, sourced, 'source-2').length, 0);
    assert.equal(captionEmphasisMatches('対話', 7, 9, sourced, 'source-1').length, 1);
});

test('new emphasis keeps its caption-size opt-in through preview normalization', () => {
    const [marked, legacy] = normalizePreviewEmphasisWords([
        { id: 'e-0001', t_start: 0, t_end: 1, word: 'A', style_preset: 'emphasis-red', inherit_caption_size: true },
        { id: 'e-0002', t_start: 1, t_end: 2, word: 'B', style_preset: 'emphasis-red' }
    ]);
    assert.equal(marked.inherit_caption_size, true);
    assert.equal(legacy.inherit_caption_size, undefined);
});

test('caption update reaches the webview and redraws only its active caption row', () => {
    const compiled = readHandlerCompiled();
    assert.match(compiled, /type: 'akari-preview-captions-update', captions: nextCaptions, emphasisWords/);
    assert.match(compiled, /captionPlate\.innerHTML = captionHtml;[\s\S]*decorateCaptionEmphasis\(captionPlate, caption\)/);
    assert.match(compiled, /if \(caption !== row\.renderedCaption\)/);
    assert.match(compiled, /captionEmphasisMatchesFn\(line\.textContent/);
    assert.match(compiled, /caption\.emphasisStart \?\? caption\.start/);
    assert.match(compiled, /\.akari-caption__run \{ -webkit-text-fill-color: currentColor; \}/);
});

test('runs and timed emphasis share one cue while cue paint remains outside their ranges', () => {
    const raw = { captions: [{ id: 'c-0006', start: 7.84, end: 9.9,
        text: 'これ、AIと対話する', style_preset: 'plate-coral',
        text_style: { color: '#facc15', weight: 400, italic: true },
        runs: [{ from: 3, to: 8, role: 'emphasis',
            style: { color: '#FB923C', font_weight: 900 } }] }] };
    const cue = parsePreviewCaptions(JSON.stringify(raw))[0];
    const emphasisWords = normalizePreviewEmphasisWords([{ id: 'e-0001',
        t_start: 9.076, t_end: 9.488, word: '対話', style_preset: 'emphasis-red' }]);
    for (const engine of [false, true]) {
        const app = harness({ cues: [cue], emphasisWords, engine });
        app.tick(8.4);
        const markup = app.plate.innerHTML;
        assert.match(markup, /font-weight:400!important/u);
        assert.match(markup, /font-style:italic!important/u);
        assert.match(markup, /color:#FB923C!important;-webkit-text-fill-color:#FB923C!important;font-weight:900!important/u);
        assert.equal((markup.match(/class="akari-caption__run"/gu) ?? []).length, 5);
    }
    const combined = prioritizeCaptionStyleMarkup('<div class="akari-caption"><p class="akari-caption__line">字幕</p></div>',
        cue.textStyleVars);
    assert.match(combined, /font-weight:400!important/u);
    assert.deepEqual(captionEmphasisMatches(cue.text, cue.start, cue.end, emphasisWords)
        .map(match => cue.text.slice(match.from, match.to)), ['対話']);
});

test('timed emphasis paint has priority over an overlapping run', () => {
    const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
    const start = source.indexOf('            const applyEmphasisPaint =');
    const end = source.indexOf('            const decorateCaptionEmphasis =', start);
    assert.ok(start >= 0 && end > start);
    const apply = new Function('emphasisPresets', 'inheritedEmphasisVars',
        `${source.slice(start, end)}; return applyEmphasisPaint;`)(
        { 'emphasis-red': { style: { color: '#ff1744', weight: 700 } } },
        { 'emphasis-red': { '--caption-tok-webkit-text-stroke': '0.065217em #ffffff' } });
    const values = new Map();
    const span = { style: { setProperty(name, value, priority) {
        values.set(name, [value, priority]);
    } } };
    apply(span, { style_preset: 'emphasis-red' });
    assert.deepEqual(values.get('color'), ['#ff1744', 'important']);
    assert.deepEqual(values.get('-webkit-text-fill-color'), ['#ff1744', 'important']);
    assert.deepEqual(values.get('font-weight'), ['700', 'important']);
    const markedValues = new Map();
    const marked = { style: { fontSize: '92px', setProperty(name, value) { markedValues.set(name, value); }, removeProperty(name) {
        if (name === 'font-size') this.fontSize = '';
    } } };
    apply(marked, { style_preset: 'emphasis-red', inherit_caption_size: true });
    assert.equal(marked.style.fontSize, '');
    assert.equal(markedValues.get('-webkit-text-stroke'), '0.065217em #ffffff');
});

test('resolved karaoke removes its paint only around marked emphasis in the real DOM', async () => {
    const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
    const start = source.indexOf('            const applyEmphasisPaint =');
    const end = source.indexOf('            const resolveEmphasisStyle =', start);
    assert.ok(start >= 0 && end > start);
    const caption = { id: 'c-1', start: 0, end: 2, text: '字幕と表示', style: 'karaoke',
        resolvedTimeline: true, textStyle: { sizePx: 64, karaoke: { fill: 'smooth', doneColor: '#FB923C' } },
        resolvedWords: ['字', '幕', 'と', '表', '示'].map((text, index) => ({
            text, start: index * .4, end: (index + 1) * .4, line: 0
        })) };
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const inherit of [false, true]) {
            const emphasis = [{ id: 'e-0001', t_start: 0, t_end: .8, word: '字幕',
                style_preset: 'title-impact', emotion: 'emphasis',
                ...(inherit ? { inherit_caption_size: true } : {}) }];
            const view = harness({ cues: [caption], emphasisWords: emphasis });
            view.tick(.5);
            assert.match(view.plate.innerHTML, /data-karaoke-text="字"/u);
            await page.setContent(`<div id="host">${view.plate.innerHTML}</div>`);
            const result = await page.evaluate(({ code, emphasis, caption, catalog, inherited, matcher }) => {
                const match = new Function(`return (${matcher})`)();
                const decorate = new Function('emphasisPresets', 'inheritedEmphasisVars', 'emphasisWords',
                    'captionEmphasisMatchesFn', 'formatCaptionSeconds', `${code}; return decorateCaptionEmphasis;`)(
                    catalog, inherited, emphasis, match, value => String(value));
                const host = document.getElementById('host');
                decorate(host, caption);
                const markers = [...host.querySelectorAll('[data-emphasis-id]')];
                const karaoke = [...host.querySelectorAll('.akari-caption__tok--karaoke-smooth')];
                return { markers: markers.map(marker => ({ text: marker.textContent,
                    karaokeAncestor: Boolean(marker.closest('.akari-caption__tok--karaoke-smooth')),
                    pseudo: getComputedStyle(marker.parentElement, '::after').content })),
                karaoke: karaoke.map(token => token.textContent) };
            }, { code: source.slice(start, end), emphasis, caption, catalog: TEXTSTYLE_CATALOG,
                inherited: Object.fromEntries(Object.entries(TEXTSTYLE_CATALOG).map(([id, preset]) => [id,
                    resolveCaptionWordStyleVars(preset.style, undefined, true)])),
                matcher: captionEmphasisMatches.toString() });
            assert.deepEqual(result.markers.map(marker => marker.text), ['字', '幕']);
            assert.ok(result.markers.every(marker => !marker.karaokeAncestor && marker.pseudo === 'none'));
            assert.deepEqual(result.karaoke, ['と', '表', '示']);
        }
    } finally { await browser.close(); }
});
