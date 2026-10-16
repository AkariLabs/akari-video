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
const popupsHtml = innerHtml('popups');
const OLD_SEEK_TO_BUTTON = { wide: 16 + 34 + 28, narrow: 16 + 34 + 34 + 28 };

test('transport はツールを 1 段目右に置き、2 段以内と再生中央を維持する', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        const measurements = [];
        for (const width of [1100, 961, 800, 600, 480, 461, 460, 420, 400, 380, 379, 360, 359, 341, 340, 320, 301, 300, 280, 240]) {
            await page.setViewport({ width, height: 500 });
            await page.setContent(`<style>${css}</style><main class="workspace"><section class="preview-pane"></section></main>${transportHtml}`);
            await page.evaluate(({ toolbarHtml, popupsHtml }) => {
                const transport = document.querySelector('.transport');
                const controls = transport.querySelector('.transport-controls');
                const toolbar = document.createElement('div');
                toolbar.className = 'review-toolbar';
                toolbar.innerHTML = toolbarHtml;
                const tail = transport.querySelector('.transport-tail');
                if (tail) tail.prepend(toolbar);
                else controls.after(toolbar);
                const popups = document.createElement('div');
                popups.innerHTML = popupsHtml;
                document.body.append(popups.querySelector('[data-review-note]'), popups.querySelector('#review-chat-tray'));
                document.querySelector('.time-current').textContent = '0:02';
                document.querySelector('.time-total').textContent = ' / 1:02:03';
                const markToggle = toolbar.querySelector('[data-review-mark-toggle]');
                const markChoices = toolbar.querySelector('.review-tool-choices');
                markToggle.addEventListener('click', () => markChoices.classList.toggle('is-open'));
            }, { toolbarHtml, popupsHtml });

            const measure = () => page.evaluate(width => {
                const rect = element => {
                    const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
                    return { left, right, top, bottom, width, height };
                };
                const transport = document.querySelector('.transport');
                const visibleButtons = [...document.querySelectorAll('.transport-controls button')]
                    .filter(button => button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden');
                const buttonBox = button => ({ id: button.id || button.dataset.reviewTool || button.dataset.reviewRangeStart || button.dataset.reviewRangeEnd || 'attach', ...rect(button) });
                const buttons = visibleButtons.map(buttonBox);
                const inlineButtons = visibleButtons.filter(button => !button.closest('.review-tool-choices')).map(buttonBox);
                const rows = [];
                for (const button of buttons) {
                    if (!rows.some(top => Math.abs(top - button.top) <= 4)) rows.push(button.top);
                }
                const seek = rect(document.querySelector('.transport-seek'));
                const play = rect(document.querySelector('#play-toggle'));
                const toolsElement = document.querySelector('.review-tools');
                const tools = rect(toolsElement);
                const firstTool = rect(document.querySelector(width <= 300 ? '[data-review-mark-toggle]' : '[data-review-tool="pen"]'));
                const area = rect(transport);
                const divider = document.querySelector('.review-divider');
                const right = document.querySelector('.transport-right');
                const popup = document.querySelector('#rate-popup');
                const time = document.querySelector('#time-label');
                const hint = document.querySelector('[data-review-hint]');
                const hintStyle = getComputedStyle(hint);
                const hintBox = rect(hint);
                const center = rect(document.querySelector('.transport-center'));
                const attach = document.querySelector('[data-review-attach-count]');
                return { buttons, inlineButtons, seek, controls: rect(document.querySelector('.transport-controls')),
                    rows: rows.length, seekToButton: Math.max(...buttons.map(button => button.bottom)) - seek.top,
                    seekToTransport: area.bottom - seek.top, seekTop: seek.top,
                    controlsTop: rect(document.querySelector('.transport-controls')).top, playDrift: Math.abs((play.left + play.right - area.left - area.right) / 2),
                    tools, firstTool, right: rect(right), center, time: rect(time), hint: hintBox,
                    hintVisible: hintStyle.display !== 'none', hintEllipsis: hintStyle.textOverflow === 'ellipsis',
                    attachVisible: getComputedStyle(attach).display !== 'none', attachDisabled: attach.disabled,
                    area, dividerDisplay: getComputedStyle(divider).display,
                    dividerWidth: rect(divider).width, noDock: !document.querySelector('#review-dock'),
                    trayInBody: document.querySelector('#review-chat-tray').parentElement === document.body,
                    trayFixed: getComputedStyle(document.querySelector('#review-chat-tray')).position === 'fixed',
                    noteFixed: getComputedStyle(document.querySelector('[data-review-note]')).position === 'fixed',
                    previewPane: rect(document.querySelector('.preview-pane')),
                    timeClipped: time.scrollWidth > time.clientWidth,
                    popupAnchor: popup.parentElement === right && getComputedStyle(right).position === 'relative'
                        && getComputedStyle(popup).position === 'absolute' };
            }, width);
            const check = (result, state) => {
                assert.ok(result.rows <= 2, `${width}px ${state}: ${result.rows} rows`);
                assert.ok(result.playDrift <= 8, `${width}px ${state}: play drift ${result.playDrift}`);
                assert.ok(result.noDock, `${width}px ${state}: no layout dock`);
                assert.ok(result.trayInBody && result.trayFixed, `${width}px ${state}: tray fixed in body`);
                assert.ok(result.noteFixed, `${width}px ${state}: note fixed`);
                assert.ok(result.attachVisible, `${width}px ${state}: attachment visible`);
                assert.ok(result.popupAnchor, `${width}px ${state}: popup anchor`);
                assert.equal(result.timeClipped, false, `${width}px ${state}: time label fits`);
                assert.ok(result.time.right <= result.center.left + 0.5,
                    `${width}px ${state}: time ${result.time.right} stays clear of playback ${result.center.left}`);
                assert.ok(result.buttons.length > 10, `${width}px ${state}: buttons present`);
                const minimum = width === 240 ? 22 : 24;
                assert.ok(result.buttons.every(button => button.width >= minimum && button.height >= minimum), `${width}px ${state}: button size`);
                assert.ok(result.buttons.every(button => button.left >= result.area.left - 0.5 && button.right <= result.area.right + 0.5),
                    `${width}px ${state}: horizontal bounds`);
                assert.ok(result.buttons.every(button => button.top >= result.area.top - 0.5 && button.bottom <= result.area.bottom + 0.5),
                    `${width}px ${state}: vertical bounds`);
                assert.ok(result.area.right - result.right.right <= 8,
                    `${width}px ${state}: right controls at right edge`);
                assert.ok(Math.abs((result.firstTool.top + result.firstTool.bottom - result.time.top - result.time.bottom) / 2) <= 6,
                    `${width}px ${state}: tools on first row`);
                assert.ok(result.tools.right <= result.area.right + 0.5,
                    `${width}px ${state}: tools inside right edge`);
                if (width > 960) {
                    assert.equal(result.rows, 1, `${width}px ${state}: one row`);
                    assert.ok(result.firstTool.left >= result.center.right - 0.5,
                        `${width}px ${state}: tools right of playback`);
                    assert.ok(result.tools.right <= result.right.left + 0.5,
                        `${width}px ${state}: tools before right controls`);
                    assert.ok(result.area.right - result.right.right <= 8,
                        `${width}px ${state}: right controls at right edge`);
                } else {
                    assert.equal(result.rows, 2, `${width}px ${state}: two rows`);
                    assert.ok(result.tools.left >= result.center.right - 0.5,
                        `${width}px ${state}: tools right of playback`);
                    assert.ok(result.area.right - result.tools.right <= 12,
                        `${width}px ${state}: tools at right edge`);
                    assert.ok(result.right.top > result.firstTool.top + 4,
                        `${width}px ${state}: right controls on second row`);
                }
                if (result.hintVisible) {
                    assert.ok(result.hintEllipsis, `${width}px ${state}: hint ellipsis`);
                    assert.ok(result.hint.right <= result.area.right + 0.5, `${width}px ${state}: hint bounds`);
                    assert.ok(!result.buttons.some(button => button.left < result.hint.right - 0.5
                        && button.right > result.hint.left + 0.5 && button.top < result.hint.bottom - 0.5
                        && button.bottom > result.hint.top + 0.5), `${width}px ${state}: hint clear of buttons`);
                    if (width > 960) assert.ok(result.hint.right <= result.tools.left + 0.5, `${width}px ${state}: hint before tools`);
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
            assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.time-total')).display === 'none'),
                width <= 380, `${width}px total time visibility`);
            if (width <= 359) {
                assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#skip-back')).display), 'none');
                assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#skip-forward')).display), 'none');
            }
            if (width <= 300) {
                assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-review-mark-toggle]')).display === 'none'), false);
                assert.equal(await page.evaluate(() => [...document.querySelectorAll('.review-tool-choices [data-review-tool]')]
                    .every(button => button.getClientRects().length === 0)), true);
                assert.deepEqual(await page.evaluate(() => {
                    const button = document.querySelector('[data-review-mark-toggle]');
                    return { text:button.textContent.trim(), viewBox:button.querySelector('svg')?.getAttribute('viewBox') };
                }), { text:'', viewBox:'0 0 24 24' });
                const snapshot = result => ({ seek: result.seek, controls: result.controls,
                    area: result.area, buttons: result.inlineButtons });
                const beforeMark = snapshot(base);
                await page.click('[data-review-mark-toggle]');
                const opened = await measure();
                const menu = await page.evaluate(() => {
                    const rect = element => { const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
                        return { left, right, top, bottom, width, height }; };
                    const choices = document.querySelector('.review-tool-choices');
                    return { open: choices.classList.contains('is-open'), box: rect(choices),
                        buttons: [...choices.querySelectorAll('[data-review-tool]')]
                            .filter(button => button.getClientRects().length)
                            .map(button => ({ tool:button.dataset.reviewTool, ...rect(button) })) };
                });
                assert.equal(menu.open, true, `${width}px mark menu opens`);
                assert.deepEqual(menu.buttons.map(button => button.tool), ['pen', 'pin', 'range']);
                assert.ok(menu.buttons.every(button => button.width >= 24 && button.height >= 24),
                    `${width}px mark menu button size`);
                assert.ok(menu.box.left >= opened.area.left - 0.5 && menu.box.right <= opened.area.right + 0.5,
                    `${width}px mark menu stays inside transport width`);
                for (let i = 0; i < menu.buttons.length; i++) {
                    for (let j = i + 1; j < menu.buttons.length; j++) {
                        const a = menu.buttons[i], b = menu.buttons[j];
                        assert.ok(a.right <= b.left + 0.5 || b.right <= a.left + 0.5
                            || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5,
                        `${width}px mark menu ${a.tool} overlaps ${b.tool}`);
                    }
                }
                assert.deepEqual(snapshot(opened), beforeMark, `${width}px mark menu leaves seek, controls and inline buttons in place`);
                await page.click('[data-review-mark-toggle]');
                assert.deepEqual(snapshot(await measure()), beforeMark, `${width}px closing mark menu leaves layout in place`);
            }
            assert.equal(base.dividerDisplay, width <= 359 ? 'none' : 'block', `${width}px attachment divider`);
            if (width > 359) assert.ok(base.dividerWidth > 0, `${width}px attachment divider width`);
            assert.equal(base.attachDisabled, true, `${width}px zero attachments disabled`);
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
                const attach = document.querySelector('[data-review-attach-count]');
                attach.disabled = false;
                attach.dataset.reviewAttachCount = '12';
                attach.querySelector('[data-review-attach-number]').textContent = '12';
            });
            const selected = await measure();
            check(selected, 'range and attachment');
            assert.equal(selected.dividerDisplay, width <= 359 ? 'none' : 'block', `${width}px shown attachment divider`);
            assert.equal(selected.attachDisabled, false, `${width}px attachment enabled`);
            const layout = result => ({ area: result.area, previewPane: result.previewPane,
                seekTop: result.seekTop, controlsTop: result.controlsTop, rows: result.rows });
            const beforePopups = layout(selected);
            await page.evaluate(() => {
                document.querySelector('[data-review-note]').hidden = false;
            });
            const noteOpen = await measure();
            check(noteOpen, 'note');
            assert.deepEqual(layout(noteOpen), beforePopups, `${width}px note leaves layout unchanged`);
            await page.evaluate(() => {
                document.querySelector('#review-chat-tray').hidden = false;
            });
            const trayOpen = await measure();
            check(trayOpen, 'tray');
            assert.deepEqual(layout(trayOpen), beforePopups, `${width}px tray leaves preview, seek and transport unchanged`);
            await page.evaluate(() => { document.querySelector('#system-volume-notice').hidden = false; });
            check(await measure(), 'tray and system volume');
            const old = width > 600 ? OLD_SEEK_TO_BUTTON.wide : OLD_SEEK_TO_BUTTON.narrow;
            const limit = selected.rows === 1 ? 49 : width <= 480 ? 69 : 74;
            assert.ok(selected.seekToButton < old, `${width}px seek to button: ${selected.seekToButton} < ${old}`);
            assert.ok(selected.seekToButton <= limit, `${width}px seek to button: ${selected.seekToButton} <= ${limit}`);
            assert.ok(selected.seekToTransport < old + 8, `${width}px seek to transport: ${selected.seekToTransport} < ${old + 8}`);
            measurements.push({ width, rows: selected.rows, playDrift: selected.playDrift,
                seekToButton: selected.seekToButton, old });
        }
        console.table(measurements);
    } finally {
        let timer;
        try {
            await Promise.race([browser.close(), new Promise(resolve => {
                timer = setTimeout(() => { browser.process()?.kill('SIGKILL'); resolve(); }, 3000);
            })]);
        } finally { clearTimeout(timer); }
    }
});
