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

test('transport は実マークアップと CSS でツールを左に置き、2 段以内と再生中央を維持する', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        const measurements = [];
        for (const width of [1100, 961, 800, 600, 480, 380]) {
            await page.setViewport({ width, height: 500 });
            await page.setContent(`<style>${css}</style><main class="workspace"><section class="preview-pane"></section></main>${transportHtml}`);
            await page.evaluate(({ toolbarHtml, dockHtml }) => {
                const transport = document.querySelector('.transport');
                const controls = transport.querySelector('.transport-controls');
                const toolbar = document.createElement('div');
                toolbar.className = 'review-toolbar';
                toolbar.innerHTML = toolbarHtml;
                const lead = transport.querySelector('.transport-lead');
                const tail = transport.querySelector('.transport-tail');
                if (lead) lead.append(toolbar);
                else if (tail) tail.append(toolbar);
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
                const toolsElement = document.querySelector('.review-tools');
                const tools = rect(toolsElement);
                const firstTool = rect(document.querySelector('[data-review-tool="pen"]'));
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
                    tools, firstTool, right: rect(right), center, time: rect(time), hint: hintBox,
                    hintVisible: hintStyle.display !== 'none', hintEllipsis: hintStyle.textOverflow === 'ellipsis',
                    leadDivider: getComputedStyle(toolsElement, '::before').display,
                    area, dividerDisplay: getComputedStyle(divider).display,
                    dividerWidth: rect(divider).width, dockAfterControls: document.querySelector('.transport-controls').nextElementSibling.id === 'review-dock',
                    trayInsideDock: document.querySelector('#review-chat-tray').parentElement.id === 'review-dock',
                    timeClipped: time.scrollWidth > time.clientWidth,
                    popupAnchor: popup.parentElement === right && getComputedStyle(right).position === 'relative'
                        && getComputedStyle(popup).position === 'absolute' };
            });
            const check = (result, state) => {
                assert.ok(result.rows <= 2, `${width}px ${state}: ${result.rows} rows`);
                assert.ok(result.playDrift <= 8, `${width}px ${state}: play drift ${result.playDrift}`);
                assert.ok(result.dockAfterControls, `${width}px ${state}: dock order`);
                assert.ok(result.trayInsideDock, `${width}px ${state}: tray inside dock`);
                assert.ok(result.popupAnchor, `${width}px ${state}: popup anchor`);
                assert.equal(result.timeClipped, false, `${width}px ${state}: time label fits`);
                assert.ok(result.buttons.length > 10, `${width}px ${state}: buttons present`);
                assert.ok(result.buttons.every(button => button.width >= 24 && button.height >= 24), `${width}px ${state}: button size`);
                assert.ok(result.buttons.every(button => button.left >= result.area.left - 0.5 && button.right <= result.area.right + 0.5),
                    `${width}px ${state}: horizontal bounds`);
                assert.ok(result.area.right - result.right.right <= 8,
                    `${width}px ${state}: right controls at right edge`);
                if (width > 960) {
                    assert.equal(result.rows, 1, `${width}px ${state}: one row`);
                    assert.ok(result.time.right < result.firstTool.left, `${width}px ${state}: tools after time`);
                    assert.ok(result.tools.right < result.center.left, `${width}px ${state}: tools before playback`);
                    assert.ok(result.buttons.filter(button => button.right > result.time.right + 0.5
                        && button.left < result.firstTool.left - 0.5).length === 0,
                    `${width}px ${state}: no button between time and tools`);
                    assert.notEqual(result.leadDivider, 'none', `${width}px ${state}: time divider`);
                } else {
                    assert.equal(result.rows, 2, `${width}px ${state}: two rows`);
                    const bottom = result.buttons.filter(button => Math.abs(button.top - result.firstTool.top) <= 4);
                    assert.ok(bottom.every(button => button.left >= result.firstTool.left - 0.5),
                        `${width}px ${state}: review tools start bottom row`);
                    assert.ok(result.firstTool.left - result.area.left <= 12,
                        `${width}px ${state}: review tools at left edge`);
                    assert.ok(bottom.every(button => button.right <= result.right.right + 0.5),
                        `${width}px ${state}: right controls end bottom row`);
                    assert.ok(result.tools.right <= result.right.left + 0.5,
                        `${width}px ${state}: bottom groups do not overlap`);
                    assert.ok(Math.abs(result.right.top - result.firstTool.top) <= 4,
                        `${width}px ${state}: tools and right controls share bottom row`);
                }
                if (result.hintVisible) {
                    assert.ok(result.hintEllipsis, `${width}px ${state}: hint ellipsis`);
                    assert.ok(result.hint.right <= result.area.right + 0.5, `${width}px ${state}: hint bounds`);
                    assert.ok(!result.buttons.some(button => button.left < result.hint.right - 0.5
                        && button.right > result.hint.left + 0.5 && button.top < result.hint.bottom - 0.5
                        && button.bottom > result.hint.top + 0.5), `${width}px ${state}: hint clear of buttons`);
                    if (width > 960) {
                        assert.ok(result.hint.left >= result.tools.right - 0.5, `${width}px ${state}: hint after tools`);
                        assert.ok(result.center.left - result.hint.right >= 8, `${width}px ${state}: hint to playback gap`);
                    }
                }
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
            const beforeDock = { rows: selected.rows, playDrift: selected.playDrift };
            await page.evaluate(() => {
                document.querySelector('#review-dock').hidden = false;
            });
            const dockOpen = await measure();
            check(dockOpen, 'dock');
            assert.deepEqual({ rows: dockOpen.rows, playDrift: dockOpen.playDrift }, beforeDock,
                `${width}px dock does not move controls`);
            await page.evaluate(() => {
                document.querySelector('#review-chat-tray').hidden = false;
                document.querySelector('#system-volume-notice').hidden = false;
            });
            const trayOpen = await measure();
            check(trayOpen, 'tray and system volume');
            assert.deepEqual({ rows: trayOpen.rows, playDrift: trayOpen.playDrift }, beforeDock,
                `${width}px tray does not move controls`);
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
