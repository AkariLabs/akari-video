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

test('音声の知らせは再生ボタンと別行で、省略時の全文を title に持つ', async t => {
    assert.match(bootstrap, /transport\.append\(statusRow\);\s*statusRow\.append\(audioStatus\)/u);
    assert.match(bootstrap, /audioStatus\.title = audioStatus\.textContent \|\| ''/u);
    const rowStyle = bootstrap.match(/statusRow\.style\.cssText = '([^']+)'/u)?.[1];
    const statusStyle = bootstrap.match(/audioStatus\.style\.cssText = '([^']+)'/u)?.[1];
    assert.ok(rowStyle && statusStyle);
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在'); return;
    }
    try {
        const page = await browser.newPage();
        const css = ['.transport', '.transport-controls', '.transport-left', '.transport-center', '.transport-right', '.audio-status']
            .map(rule).filter(Boolean).join('\n');
        for (const width of [320, 480, 900]) {
            await page.setViewport({ width, height: 200 });
            const message = '一部の音声を再生できません: sfx:very-long-name-with-more-details-and-another-source.mp3';
            await page.setContent(`<style>${css}</style><div class="transport"><div class="transport-controls">
                <div class="transport-left"><button>音声</button><span>0:00 / 0:00</span></div>
                <div class="transport-center"><button id="play">再生</button></div><div class="transport-right"><button>全画面</button></div>
                </div><div style="${rowStyle}"><span id="audio-status" class="audio-status" style="${statusStyle}" title="${message}">${message}</span></div></div>`);
            const result = await page.evaluate(() => {
                const r = selector => {
                    const box = document.querySelector(selector).getBoundingClientRect();
                    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
                };
                const status = document.querySelector('#audio-status');
                return { play: r('#play'), status: r('#audio-status'), clipped: status.scrollWidth > status.clientWidth,
                    title: status.title };
            });
            assert.equal(intersects(result.play, result.status), false, `width ${width}`);
            assert.equal(result.title, message);
            if (width === 320) assert.equal(result.clipped, true);
        }
    } finally { await browser.close(); }
});
