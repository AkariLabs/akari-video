import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { readHandlerSource } from './helpers/handler-source.mjs';

const handler = readHandlerSource();
const review = readFileSync(new URL('../src/browser/preview-chat-review.ts', import.meta.url), 'utf8');
const labels = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/preview.json', import.meta.url), 'utf8'));
const uiKeys = new Map([...review.matchAll(/(\w+): translate\('(preview\.chatReview\.ui\.[^']+)'/g)]
    .map(([, key, value]) => [key, value]));
const htmlStart = handler.indexOf('return `<!doctype html>');
const styleStart = handler.indexOf('<style>', htmlStart) + '<style>'.length;
const styleEnd = handler.indexOf('</style>', styleStart);
const css = handler.slice(styleStart, styleEnd).split('\n').filter(line => !line.includes('${')).join('\n');
const transportStart = handler.indexOf('<div class="transport">', styleEnd);
const transportEnd = handler.indexOf('<script>window.__akariPreview', transportStart);
const transportHtml = handler.slice(transportStart, transportEnd).split('\n')
    .map(line => line.includes('${materialRangeEnabled') && line.includes('<input id="seek"')
        ? line.slice(line.indexOf('<input id="seek"')) : line)
    .filter(line => !line.includes('${materialRangeEnabled'))
    .join('\n').replace(/\$\{t\('[^']+'\)\}/g, '操作');

function innerHtml(name) {
    const match = review.match(new RegExp(`${name}\\.innerHTML = ('.*?')\\.replace`));
    assert.ok(match, `${name} innerHTML exists`);
    return vm.runInNewContext(match[1]).replace(/__AKARI_UI_(\w+)__/g, (_, key) => labels[uiKeys.get(key)] ?? key);
}

assert.ok(styleStart > 0 && styleEnd > styleStart && transportStart > styleEnd && transportEnd > transportStart);
assert.doesNotMatch(transportHtml, /\$\{/);
const toolbarHtml = innerHtml('toolbar');
const dockHtml = innerHtml('dock');
const OLD_SEEK_TO_BUTTON = { wide: 16 + 34 + 28, narrow: 16 + 34 + 34 + 28 };

test('transport は実マークアップと CSS で 2 段以内、中央と右端を維持する', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        const measurements = [];
        for (const width of [1100, 800, 600, 480, 380]) {
            await page.setViewport({ width, height: 500 });
            await page.setContent(`<style>${css}</style><main class="workspace"><section class="preview-pane"></section></main>${transportHtml}`);
            await page.evaluate(({ toolbarHtml, dockHtml }) => {
                const transport = document.querySelector('.transport');
                const controls = transport.querySelector('.transport-controls');
                const toolbar = document.createElement('div');
                toolbar.className = 'review-toolbar';
                toolbar.innerHTML = toolbarHtml;
                const tail = transport.querySelector('.transport-tail');
                if (tail) tail.append(toolbar);
                else controls.after(toolbar);
                const dock = document.createElement('div');
                dock.id = 'review-dock';
                dock.hidden = true;
                dock.innerHTML = dockHtml;
                controls.after(dock);
                document.querySelector('#time-label').textContent = '12:34 / 1:02:03';
            }, { toolbarHtml, dockHtml });

            const measure = () => page.evaluate(() => {
                const rect = element => {
                    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
                    return { left, right, top, bottom, width, height };
                };
                const transport = document.querySelector('.transport');
                const buttons = [...document.querySelectorAll('.transport-controls button')]
                    .filter(button => button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden')
                    .map(button => ({ id: button.id || button.dataset.reviewTool || button.dataset.reviewRangeStart || button.dataset.reviewRangeEnd || 'attach', ...rect(button) }));
                const rows = [];
                for (const button of buttons) {
                    if (!rows.some(top => Math.abs(top - button.top) <= 4)) rows.push(button.top);
                }
                const seek = rect(document.querySelector('.transport-seek'));
                const play = rect(document.querySelector('#play-toggle'));
                const tools = rect(document.querySelector('.review-tools'));
                const lastTool = rect(document.querySelector('.review-tools [data-review-attach-count]:not([hidden])')
                    ?? document.querySelector('.review-tools [data-review-tool="range"]'));
                const area = rect(transport);
                const divider = document.querySelector('.review-divider');
                const right = document.querySelector('.transport-right');
                const popup = document.querySelector('#rate-popup');
                const time = document.querySelector('#time-label');
                const hint = document.querySelector('[data-review-hint]');
                const hintStyle = getComputedStyle(hint);
                const hintBox = rect(hint);
                const center = rect(document.querySelector('.transport-center'));
                return { buttons, rows: rows.length, seekToButton: Math.max(...buttons.map(button => button.bottom)) - seek.top,
                    seekToTransport: area.bottom - seek.top, playDrift: Math.abs((play.left + play.right - area.left - area.right) / 2),
                    toolsRight: tools.right, lastToolRight: lastTool.right, area, dividerDisplay: getComputedStyle(divider).display,
                    dividerWidth: rect(divider).width, dockAfterControls: document.querySelector('.transport-controls').nextElementSibling.id === 'review-dock',
                    timeClipped: time.scrollWidth > time.clientWidth, hintGap: hintBox.left + parseFloat(hintStyle.paddingLeft) - center.right,
                    hintBeforeRight: hintBox.right <= rect(right).left + 0.5, hintAligned: hintStyle.textAlign === 'right',
                    popupAnchor: popup.parentElement === right && getComputedStyle(right).position === 'relative'
                        && getComputedStyle(popup).position === 'absolute' };
            });
            const check = (result, state) => {
                assert.ok(result.rows <= 2, `${width}px ${state}: ${result.rows} rows`);
                assert.ok(result.playDrift <= 8, `${width}px ${state}: play drift ${result.playDrift}`);
                assert.ok(result.dockAfterControls, `${width}px ${state}: dock order`);
                assert.ok(result.popupAnchor, `${width}px ${state}: popup anchor`);
                assert.equal(result.timeClipped, false, `${width}px ${state}: time label fits`);
                assert.ok(result.buttons.length > 10, `${width}px ${state}: buttons present`);
                assert.ok(result.buttons.every(button => button.width >= 24 && button.height >= 24), `${width}px ${state}: button size`);
                assert.ok(result.buttons.every(button => button.left >= result.area.left - 0.5 && button.right <= result.area.right + 0.5),
                    `${width}px ${state}: horizontal bounds`);
                assert.ok(result.buttons.every(button => button.right <= result.toolsRight + 0.5), `${width}px ${state}: review tools at right`);
                assert.ok(result.buttons.every(button => button.right <= result.lastToolRight + 0.5),
                    `${width}px ${state}: final review button is rightmost`);
                for (let i = 0; i < result.buttons.length; i++) {
                    for (let j = i + 1; j < result.buttons.length; j++) {
                        const a = result.buttons[i], b = result.buttons[j];
                        assert.ok(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5,
                            `${width}px ${state}: ${a.id} ${JSON.stringify(a)} overlaps ${b.id} ${JSON.stringify(b)}`);
                    }
                }
            };
            const base = await measure();
            check(base, 'base');
            assert.equal(base.dividerDisplay, 'none', `${width}px hidden attachment divider`);
            assert.equal(base.dividerWidth, 0, `${width}px hidden attachment divider width`);
            const popupPosition = await page.evaluate(() => {
                const popup = document.querySelector('#rate-popup');
                popup.hidden = false;
                const a = popup.getBoundingClientRect();
                const b = document.querySelector('.transport-right').getBoundingClientRect();
                popup.hidden = true;
                return { rightGap: Math.abs(a.right - b.right), above: a.bottom <= b.top, width: a.width };
            });
            assert.ok(popupPosition.width > 0 && popupPosition.rightGap <= 0.5 && popupPosition.above,
                `${width}px popup stays anchored above right controls`);

            await page.evaluate(() => {
                document.querySelector('#review-range-controls').hidden = false;
                const hint = document.querySelector('[data-review-hint]');
                hint.hidden = false;
                hint.textContent = '始めと終わりを選択';
                document.querySelector('[data-review-attach-count]').hidden = false;
            });
            const selected = await measure();
            check(selected, 'range and attachment');
            assert.equal(selected.dividerDisplay, 'block', `${width}px shown attachment divider`);
            if (selected.rows === 1) {
                assert.ok(selected.hintGap >= 8, `${width}px hint to center gap: ${selected.hintGap}`);
                assert.ok(selected.hintBeforeRight && selected.hintAligned, `${width}px hint sits right-aligned before right controls`);
            }
            const beforeDock = { rows: selected.rows, playDrift: selected.playDrift };
            await page.evaluate(() => {
                document.querySelector('#review-dock').hidden = false;
                document.querySelector('#review-chat-tray').hidden = false;
                document.querySelector('#system-volume-notice').hidden = false;
            });
            const dockOpen = await measure();
            check(dockOpen, 'dock and system volume');
            assert.deepEqual({ rows: dockOpen.rows, playDrift: dockOpen.playDrift }, beforeDock,
                `${width}px dock does not move controls`);
            const old = width > 600 ? OLD_SEEK_TO_BUTTON.wide : OLD_SEEK_TO_BUTTON.narrow;
            const limit = selected.rows === 1 ? 49 : width <= 480 ? 69 : 74;
            assert.ok(selected.seekToButton < old, `${width}px seek to button: ${selected.seekToButton} < ${old}`);
            assert.ok(selected.seekToButton <= limit, `${width}px seek to button: ${selected.seekToButton} <= ${limit}`);
            assert.ok(selected.seekToTransport < old + 8, `${width}px seek to transport: ${selected.seekToTransport} < ${old + 8}`);
            measurements.push({ width, rows: selected.rows, playDrift: selected.playDrift,
                seekToButton: selected.seekToButton, old });
        }
        console.table(measurements);
    } finally { await browser.close(); }
});
