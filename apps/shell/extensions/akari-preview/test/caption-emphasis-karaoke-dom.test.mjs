import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { captionEmphasisMatches } from '../lib/common/preview-emphasis-seat.js';
import { harness } from './caption-animator-webview-harness.mjs';
const { resolveCaptionWordStyleVars, TEXTSTYLE_CATALOG } = createRequire(import.meta.url)('@akari-video/edit-store');

// Playwright の chromium を起動する（CI では media レーン。shell レーンからは除外）

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
