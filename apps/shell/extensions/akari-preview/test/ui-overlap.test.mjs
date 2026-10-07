import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { barItems } from '../lib/common/context-bar-view.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const contextBar = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
const handler = readHandlerSource();
const rule = selector => handler.split('\n').find(line => line.startsWith(selector + ' {'));
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

test('種類を問わず表示中の帯から印を逃がし、帯が消えたら元の位置へ戻す', async t => {
    assert.match(contextBar, /const visibleBar = !this\.bar\.hidden && !this\.report\.busy/u);
    assert.match(contextBar, /const selected = !!state\?\.selectedId && state\.multi === 0/u);
    assert.match(contextBar, /const barSignature = JSON\.stringify\(barRectInFrame\)/u);
    assert.match(contextBar, /sendMessage\(\{ type: 'akari-preview-context-bar-rect', rect: barRectInFrame \}\)/u);
    assert.doesNotMatch(contextBar, /captionBarVisible/u);
    const start = bootstrap.indexOf("window.addEventListener('message', event => {", bootstrap.indexOf("const indicatorPopup ="));
    const end = bootstrap.indexOf('            const videoFxFailedIndicators', start);
    assert.ok(start > 0 && end > start);
    assert.match(bootstrap.slice(start, end), /const rect = event\.data\.rect/u);
    let onMessage;
    const indicatorToggle = { style: { top: '' } };
    vm.runInContext(bootstrap.slice(start, end), vm.createContext({
        window: { addEventListener: (_type, listener) => { onMessage = listener; } }, indicatorToggle
    }));
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        const base = { editUri: 'file:///edit.json', selectedId: 'selected', sourcePath: null, parentId: null,
            locked: false, hasCorners: false, multi: 0, styleCopy: null, output: { width: 1920, height: 1080 }, lockedIds: [] };
        // contextBarKind: video と HTML overlay は other、placed text は text。複数選択は選択 id が無く帯を出さない。
        const scenarios = [
            { name: '字幕', kind: 'caption', item: { textStyle: {} }, keys: ['captionFont', 'captionSize', 'captionStyle'], align: 'right' },
            { name: '動画クリップ', kind: 'other', item: { source: { kind: 'media' } }, align: 'right' },
            { name: 'HTML オーバーレイ', kind: 'other', item: { source: { kind: 'html' } }, align: 'center' },
            { name: '配置した文字', kind: 'text', item: { source: { kind: 'caption' } }, align: 'left' }
        ];
        for (const scenario of scenarios) {
            const items = barItems({ ...base, kind: scenario.kind, item: scenario.item });
            const keys = scenario.keys ?? items.filter(item => item.kind !== 'separator').map(item => item.key);
            assert.ok(keys.length > 0 && keys.every(key => items.some(item => item.key === key)), scenario.name);
            for (const width of [360, 520, 900]) {
                await page.setViewport({ width, height: 260 });
                await page.setContent(`<style>body{margin:0}.bar{position:absolute;top:5px;left:50%;transform:translateX(-50%);height:30px;width:calc(100% - 16px);display:flex;justify-content:${scenario.align};align-items:center;gap:2px}.bar button{height:28px;min-width:28px}#indicator-toggle{position:absolute;top:8px;right:8px;height:24px}</style>
                    <div class="bar">${keys.map(key => `<button data-key="${key}">${key}</button>`).join('')}</div><button id="indicator-toggle">ⓘ 未対応 3</button>`);
                const bar = await page.evaluate(() => {
                    const r = document.querySelector('.bar').getBoundingClientRect();
                    return { top: r.top, height: r.height };
                });
                onMessage({ data: { type: 'akari-preview-context-bar-rect', rect: bar } });
                const boxes = await page.evaluate(top => {
                    document.querySelector('#indicator-toggle').style.top = top;
                    const rect = element => {
                        const r = element.getBoundingClientRect();
                        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                    };
                    return { indicator: rect(document.querySelector('#indicator-toggle')),
                        buttons: [...document.querySelectorAll('.bar button')].map(rect) };
                }, indicatorToggle.style.top);
                assert.ok(boxes.buttons.length > 0, scenario.name);
                assert.ok(boxes.buttons.every(button => !intersects(boxes.indicator, button)),
                    `${scenario.name} width ${width}`);
            }
        }
        const multi = barItems({ ...base, selectedId: null, kind: null, item: null, multi: 2 });
        assert.deepEqual(multi, [], '複数選択には帯を描かない');
        onMessage({ data: { type: 'akari-preview-context-bar-rect', rect: null } });
        assert.equal(indicatorToggle.style.top, '');
        await page.setContent('<button id="indicator-toggle" style="position:absolute;top:8px;right:8px;height:24px">ⓘ 未対応 3</button>');
        assert.equal(await page.evaluate(() => document.querySelectorAll('.bar button').length), 0);
    } finally { await browser.close(); }
});

test('host の幅が同じでも帯の高さ変更を監視し、印を新しい下端へ移す', async t => {
    assert.match(contextBar, /resize\.observe\(this\.host\.node\);\s*resize\.observe\(this\.bar\)/u);
    assert.match(contextBar, /Disposable\.create\(\(\) => resize\.disconnect\(\)\)/u);
    const start = bootstrap.indexOf("window.addEventListener('message', event => {", bootstrap.indexOf("const indicatorPopup ="));
    const end = bootstrap.indexOf('            const videoFxFailedIndicators', start);
    let onMessage;
    const indicatorToggle = { style: { top: '' } };
    vm.runInContext(bootstrap.slice(start, end), vm.createContext({
        window: { addEventListener: (_type, listener) => { onMessage = listener; } }, indicatorToggle
    }));
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 520, height: 260 });
        await page.setContent('<style>body{margin:0}.bar{position:absolute;top:5px;left:50%;transform:translateX(-50%);width:300px;height:30px;display:flex;align-items:center;justify-content:flex-end}.bar button{height:100%}#indicator-toggle{position:absolute;top:8px;right:8px;height:24px}</style><div class="bar"><button>スタイル</button></div><button id="indicator-toggle">ⓘ 未対応 3</button>');
        await page.evaluate(() => {
            const bar = document.querySelector('.bar');
            window.__barRects = [];
            window.__barObserver = new ResizeObserver(() => {
                const r = bar.getBoundingClientRect();
                window.__barRects.push({ top: r.top, height: r.height });
            });
            window.__barObserver.observe(bar);
        });
        await page.waitForFunction(() => window.__barRects.length === 1);
        await page.evaluate(() => { document.querySelector('.bar').style.height = '58px'; });
        await page.waitForFunction(() => window.__barRects.length >= 2);
        const rects = await page.evaluate(() => window.__barRects.slice(0, 2));
        assert.equal(rects[0].height, 30);
        assert.equal(rects[1].height, 58);
        onMessage({ data: { type: 'akari-preview-context-bar-rect', rect: rects[0] } });
        assert.equal(indicatorToggle.style.top, '43px');
        onMessage({ data: { type: 'akari-preview-context-bar-rect', rect: rects[1] } });
        const boxes = await page.evaluate(top => {
            const indicator = document.querySelector('#indicator-toggle');
            indicator.style.top = top;
            const a = indicator.getBoundingClientRect();
            const b = document.querySelector('.bar button').getBoundingClientRect();
            return { indicator: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
                button: { left: b.left, right: b.right, top: b.top, bottom: b.bottom } };
        }, indicatorToggle.style.top);
        assert.equal(indicatorToggle.style.top, '71px');
        assert.equal(intersects(boxes.indicator, boxes.button), false);
    } finally { await browser.close(); }
});

test('音声の知らせは映像領域に重ね、出入りしても映像と再生帯の高さを変えない', async t => {
    assert.match(bootstrap, /transport\.append\(statusRow\);\s*statusRow\.append\(audioStatus\)/u);
    assert.match(bootstrap, /transport\.style\.position = 'relative'/u);
    assert.match(bootstrap, /audioStatus\.title = audioStatus\.textContent \|\| ''/u);
    const rowStyle = bootstrap.match(/statusRow\.style\.cssText = '([^']+)'/u)?.[1];
    const statusStyle = bootstrap.match(/audioStatus\.style\.cssText = '([^']+)'/u)?.[1];
    assert.ok(rowStyle && statusStyle);
    assert.match(rowStyle, /position:absolute;[^;]*left:0;right:0;bottom:100%/u);
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        const css = ['body', '.workspace', '.preview-pane', '.transport', '.transport-seek', '.transport-controls',
            '.transport-left', '.transport-center', '.transport-right', '.audio-status']
            .map(rule).filter(Boolean).join('\n');
        for (const width of [320, 480, 900]) {
            await page.setViewport({ width, height: 200 });
            const message = '一部の音声を再生できません: sfx:very-long-name-with-more-details-and-another-source.mp3';
            await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}${css}</style>
                <main class="workspace"><section class="preview-pane">映像</section></main>
                <div class="transport" style="position:relative"><div class="transport-seek"><input id="seek" type="range"></div><div class="transport-controls">
                <div class="transport-left"><button>音声</button><span>0:00 / 0:00</span></div>
                <div class="transport-center"><button id="play">再生</button></div><div class="transport-right"><button>全画面</button></div>
                </div><div id="status-row" style="${rowStyle}" hidden><span id="audio-status" class="audio-status" style="${statusStyle}" title="${message}">${message}</span></div></div>`);
            const measure = () => page.evaluate(() => {
                const rect = element => {
                    const r = element.getBoundingClientRect();
                    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
                };
                const status = document.querySelector('#audio-status');
                return { transport: rect(document.querySelector('.transport')),
                    preview: rect(document.querySelector('.preview-pane')),
                    controls: rect(document.querySelector('.transport-controls')),
                    buttons: [...document.querySelectorAll('.transport-controls button')].map(rect),
                    status: rect(status), clipped: status.scrollWidth > status.clientWidth, title: status.title };
            });
            const before = await measure();
            await page.evaluate(() => { document.querySelector('#status-row').hidden = false; });
            const shown = await measure();
            assert.deepEqual(shown.transport, before.transport, `transport width ${width}`);
            assert.deepEqual(shown.preview, before.preview, `preview width ${width}`);
            assert.ok(shown.status.bottom <= shown.transport.top, `status above transport width ${width}`);
            assert.ok(shown.buttons.every(button => !intersects(shown.status, button)), `buttons width ${width}`);
            assert.equal(shown.title, message);
            if (width === 320) assert.equal(shown.clipped, true);
            await page.evaluate(() => { document.querySelector('#status-row').hidden = true; });
            const after = await measure();
            assert.deepEqual(after.transport, before.transport, `transport after width ${width}`);
            assert.deepEqual(after.preview, before.preview, `preview after width ${width}`);
        }
    } finally { await browser.close(); }
});

test('音声の知らせはライト・ダーク両方で背景が半透明になり、文字はテーマ前景色になる', async t => {
    const rowStyle = bootstrap.match(/statusRow\.style\.cssText = '([^']+)'/u)?.[1];
    const statusStyle = bootstrap.match(/audioStatus\.style\.cssText = '([^']+)'/u)?.[1];
    assert.ok(rowStyle && statusStyle);
    assert.match(rowStyle, /background:color-mix\(in srgb, var\(--akari-transport-bg\) 60%, transparent\)/u);
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        for (const theme of [
            { name: 'light', background: '#f2f2f2', foreground: 'rgb(36, 36, 36)' },
            { name: 'dark', background: '#242424', foreground: 'rgb(241, 241, 241)' }
        ]) {
            const foreground = theme.name === 'light' ? '#242424' : '#f1f1f1';
            await page.setContent(`<style>:root{--akari-transport-bg:${theme.background};--akari-transport-fg:${foreground}}</style>
                <div style="position:relative;width:300px;margin-top:40px"><div id="status-row" style="${rowStyle}">
                <span id="audio-status" style="${statusStyle}" title="音声を準備中 1/2">音声を準備中 1/2</span></div></div>`);
            const actual = await page.evaluate(() => {
                const row = document.querySelector('#status-row');
                const status = document.querySelector('#audio-status');
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                const context = canvas.getContext('2d');
                context.fillStyle = getComputedStyle(row).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                return { alpha: context.getImageData(0, 0, 1, 1).data[3] / 255,
                    color: getComputedStyle(status).color, title: status.title };
            });
            assert.ok(actual.alpha > 0 && actual.alpha < 1, `${theme.name}: alpha ${actual.alpha}`);
            assert.equal(actual.color, theme.foreground, theme.name);
            assert.equal(actual.title, '音声を準備中 1/2');
        }
    } finally { await browser.close(); }
});
