import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';
import { previewChatReviewScript } from '../lib/browser/preview-chat-review.js';
import { reviewAnnotationRequest } from '../lib/common/chat-review-attachments.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readFileSync(new URL('../src/browser/preview-chat-review.ts', import.meta.url), 'utf8');
const handler = readHandlerSource();
const declaration = source.match(/export function reviewNotePosition\([\s\S]*?\n\}/)?.[0];
assert.ok(declaration);
const javascript = ts.transpileModule(`${declaration.replace('export function', 'function')}\nglobalThis.position = reviewNotePosition;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const context = vm.createContext({});
vm.runInContext(javascript, context);
const position = context.position;
const viewport = { width: 400, height: 300 };
const popup = { width: 180, height: 70 };
const box = (x, y) => ({ left: x, right: x + 20, top: y, bottom: y + 20 });

test('popup opens to the right and aligns with the anchor top', () => {
    assert.deepEqual({ ...position(box(100, 50), popup, viewport) }, { left: 128, top: 50, maxHeight: 284 });
});

test('popup flips left and places a horizontally clamped popup below the anchor', () => {
    assert.equal(position(box(370, 50), popup, viewport).left, 182);
    assert.deepEqual({ ...position(box(180, 50), { width: 250, height: 70 }, viewport) },
        { left: 142, top: 78, maxHeight: 284 });
    assert.equal(position(box(130, 50), { width: 250, height: 70 }, viewport).left, 130);
    assert.deepEqual({ ...position(box(180, 50), { width: 500, height: 70 }, viewport) },
        { left: 8, top: 78, maxHeight: 284 });
});

test('horizontally clamped popup moves above when below is full, then uses viewport bounds', () => {
    assert.equal(position(box(180, 260), { width: 250, height: 70 }, viewport).top, 182);
    assert.equal(position(box(180, 125), { width: 250, height: 180 }, viewport).top, 112);
});

test('popup clamps vertically and limits its height', () => {
    assert.equal(position(box(100, -10), popup, viewport).top, 8);
    assert.equal(position(box(100, 280), popup, viewport).top, 222);
    assert.deepEqual({ ...position(box(100, 125), { width: 180, height: 500 }, viewport) },
        { left: 128, top: 8, maxHeight: 284 });
});

test('bottom limit keeps right and left popups above the transport, even when anchors are below it', () => {
    const limited = { ...viewport, bottom: 180 };
    assert.deepEqual({ ...position(box(100, 150), popup, limited) },
        { left: 128, top: 110, maxHeight: 172 });
    assert.deepEqual({ ...position(box(370, 150), popup, limited) },
        { left: 182, top: 110, maxHeight: 172 });
    assert.equal(position(box(100, 220), popup, limited).top, 110);
    assert.equal(position(box(370, 220), popup, limited).top, 110);
    assert.deepEqual({ ...position(box(100, 150), { width: 180, height: 500 }, limited) },
        { left: 128, top: 8, maxHeight: 172 });
    assert.equal(position(box(100, 220), popup, viewport).top, 220);
});

test('horizontally clamped popup tries below then above using the bottom limit', () => {
    const limited = { ...viewport, bottom: 120 };
    assert.equal(position(box(180, 20), { width: 250, height: 70 }, limited).top, 48);
    assert.equal(position(box(180, 100), { width: 250, height: 70 }, limited).top, 22);
    assert.equal(position(box(180, 20), { width: 250, height: 70 }, { ...viewport, bottom: 110 }).top, 20);
});

const positionStart = source.indexOf('        const positionPopups = () => {');
const positionEnd = source.indexOf("        window.addEventListener('resize', positionPopups);", positionStart);
assert.ok(positionStart >= 0 && positionEnd > positionStart);
const positionScript = source.slice(positionStart, positionEnd) + '\npositionPopups();';

function placedNote(review, strokeRect, transportTop = 500) {
    const badge = { getBoundingClientRect: () => box(515, 100) };
    const stroke = strokeRect && { getBoundingClientRect: () => strokeRect };
    const note = { style: {}, getBoundingClientRect: () => ({ width: 180, height: 70 }) };
    const marksNode = { querySelector: selector => selector.startsWith('.review-mark-stroke') ? stroke : badge };
    vm.runInNewContext(positionScript, { activeNote: { id: 'mark' }, pinDrag: null, trayOpen: false,
        markIndex: () => 0, marks: [{ review }], marksNode, seekMarks: { querySelector: () => null }, seek: badge,
        attachButton: badge, tray: note, note, notePosition: position, window: { innerWidth: 1100, innerHeight: 500 },
        transport: { getBoundingClientRect: () => ({ top: transportTop }) }, document: { querySelector: () => null } });
    return note.style;
}

test('pen note anchors to the entire stroke; legacy pen uses its badge', () => {
    assert.deepEqual(placedNote({ tool: 'pen', points: [[.1, .1], [.8, .7]] },
        { left: 525, right: 575, top: 100, bottom: 470 }),
    { left: '583px', top: '100px', maxHeight: '484px' });
    assert.deepEqual(placedNote({ tool: 'pen', shape: { x: .5, y: .5 } }, null),
        { left: '543px', top: '100px', maxHeight: '484px' });
});

test('very low transport falls back to the viewport bottom', () => {
    assert.deepEqual(placedNote({ tool: 'pin' }, null, 100),
        { left: '543px', top: '100px', maxHeight: '484px' });
});

const moveDeclaration = handler.match(/export async function movePinAnnotation\([\s\S]*?\n\}/)?.[0];
assert.ok(moveDeclaration);
const moveJavascript = ts.transpileModule(`${moveDeclaration.replace('export async function', 'async function')}\nglobalThis.move = movePinAnnotation;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const moveContext = vm.createContext({ reviewAnnotationRequest });
vm.runInContext(moveJavascript, moveContext);
const movePinAnnotation = moveContext.move;
const oldPin = { id: 'mark-1', tool: 'pin', source: 'edit.json', sourceLabel: 'Edit', time: 2,
    sourceT: 2, text: 'Fix', shape: { x: .2, y: .3 }, annotationId: 'old' };
const newPin = { ...oldPin, shape: { x: .6, y: .7 } };

test('moving an annotated pin creates its replacement before deleting the old annotation', async () => {
    const calls = [];
    const result = await movePinAnnotation(newPin, oldPin, 'file:///project', async (id, request) => {
        calls.push({ id, request });
        return id === 'akari.annotations.createFromPreview' ? { id: 'new' } : { deleted: true };
    });
    assert.deepEqual(calls.map(call => call.id), ['akari.annotations.createFromPreview', 'akari.annotations.deleteFromPreview']);
    assert.deepEqual(calls[0].request.point, [.6, .7]);
    assert.equal(calls[0].request.text, 'Fix');
    assert.equal(calls[1].request.id, 'old');
    assert.equal(result.mark.annotationId, 'new');
    assert.equal(result.createFailed, false);
    assert.equal(result.deleteFailed, false);
});

test('create failure retains the old annotation id and updated pending shape', async () => {
    const calls = [];
    const result = await movePinAnnotation(newPin, oldPin, 'file:///project', async id => {
        calls.push(id); throw Error('unavailable');
    });
    assert.deepEqual(calls, ['akari.annotations.createFromPreview']);
    assert.equal(result.mark.annotationId, 'old');
    assert.equal(result.mark.shape.x, .6);
    assert.equal(result.createFailed, true);
});

test('delete failure keeps the new annotation id and reports a warning flag', async () => {
    const result = await movePinAnnotation(newPin, oldPin, 'file:///project', async id => {
        if (id === 'akari.annotations.createFromPreview') return { id: 'new' };
        throw Error('unavailable');
    });
    assert.equal(result.mark.annotationId, 'new');
    assert.equal(result.deleteFailed, true);
});

const htmlStart = handler.indexOf('return `<!doctype html>');
const styleStart = handler.indexOf('<style>', htmlStart) + '<style>'.length;
const styleEnd = handler.indexOf('</style>', styleStart);
const css = handler.slice(styleStart, styleEnd).split('\n').filter(line => !line.includes('${')).join('\n');

async function reviewPage(browser, transportWidth = 500) {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    await page.setContent(`<style>${css}\n#preview-stage { position:relative; width:500px; height:300px; margin:40px; background:#080808; }
#pen-layer { position:absolute; inset:0; } .transport { width:${transportWidth}px; margin:40px; }
.transport-tail { display:flex; } .transport-seek { position:relative; }</style>
<div id="preview-stage"><div id="pen-layer"></div></div><div class="transport"><div class="transport-controls"><div class="transport-tail"></div></div><div class="transport-seek"><input id="seek" type="range" min="0" max="30" value="2"></div></div>`);
    await page.evaluate(script => {
        window.__messages = [];
        Object.defineProperty(crypto, 'randomUUID', { value: () => `review-${window.__messages.length}` });
        window.__akariPreview = { kind: 'output', reviewSource: 'edit.json', reviewSourceLabel: 'Edit' };
        window.akari = { reviewChatPost: message => window.__messages.push(message),
            previewAnnotationFrame: () => ({ timelineT: Number(document.querySelector('#seek').value),
                sourceT: Number(document.querySelector('#seek').value), cutIndex: 0, src: 'clip' }) };
        window.eval(script);
    }, previewChatReviewScript());
    return page;
}

test('narrow mark button opens the three existing tools without moving seek or controls', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) { if (error?.message !== 'headless Chrome が見つかりません') throw error; t.skip('headless Chrome 不在'); return; }
    try {
        const page = await reviewPage(browser, 240);
        const layout = () => page.evaluate(() => {
            const box = selector => { const r = document.querySelector(selector).getBoundingClientRect();
                return { top:r.top, bottom:r.bottom, left:r.left, right:r.right }; };
            return { seek:box('.transport-seek'), controls:box('.transport-controls'), transport:box('.transport') };
        });
        const before = await layout();
        await page.click('[data-review-mark-toggle]');
        const open = await page.evaluate(() => ({ expanded:document.querySelector('[data-review-mark-toggle]').getAttribute('aria-expanded'),
            tools:[...document.querySelectorAll('.review-tool-choices [data-review-tool]')]
                .filter(button => button.getClientRects().length).map(button => button.dataset.reviewTool) }));
        assert.equal(open.expanded, 'true');
        assert.deepEqual(open.tools, ['pen', 'pin', 'range']);
        assert.deepEqual(await layout(), before);
        await page.click('[data-review-tool="range"]');
        assert.equal(await page.evaluate(() => document.querySelector('#review-range-controls').hidden), false);
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-mark-toggle]').getAttribute('aria-expanded')), 'false');
        assert.deepEqual(await layout(), before);
        await page.click('[data-review-mark-toggle]');
        await pointer(page, 'window', 'pointerdown', 0, 0);
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-mark-toggle]').getAttribute('aria-expanded')), 'false');
        await page.click('[data-review-mark-toggle]');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-mark-toggle]').getAttribute('aria-expanded')), 'false');
    } finally { await browser.close(); }
});

const pin = { id: 'pin-1', tool: 'pin', source: 'edit.json', sourceLabel: 'Edit', time: 2,
    sourceT: 2, text: '', shape: { x: .4, y: .5 } };
const pen = { id: 'pen-1', tool: 'pen', source: 'edit.json', sourceLabel: 'Edit', time: 2,
    sourceT: 2, text: '', points: [[.2, .2], [.7, .7]], shape: { x: .2, y: .2, w: .5, h: .5 } };

function state(page, reviews) {
    return page.evaluate(reviews => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'akari-preview-chat-review-state', attachments: reviews.map(review => ({ kind: 'review', label: 'Mark', review }))
    } })), reviews);
}

async function pointer(page, selector, type, x, y, pointerId = 1) {
    await page.evaluate(({ selector, type, x, y, pointerId }) => {
        const target = selector === 'window' ? window : document.querySelector(selector);
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId, clientX: x, clientY: y }));
    }, { selector, type, x, y, pointerId });
}

test('real Chrome keeps both popups open on outside click and closes them with their own buttons', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) { if (error?.message !== 'headless Chrome が見つかりません') throw error; t.skip('headless Chrome 不在'); return; }
    try {
        const page = await reviewPage(browser);
        await state(page, [{ ...pin, elements: ['Caption'] }]);
        await page.click('[data-review-attach-count]');
        const trayPlacement = await page.evaluate(() => {
            const anchor = document.querySelector('[data-review-attach-count]').getBoundingClientRect();
            const tray = document.querySelector('#review-chat-tray').getBoundingClientRect();
            return { anchor: { left: anchor.left, right: anchor.right, top: anchor.top },
                tray: { left: tray.left, right: tray.right, top: tray.top, bottom: tray.bottom }, width: innerWidth, height: innerHeight };
        });
        assert.ok(trayPlacement.tray.left >= 8 && trayPlacement.tray.right <= trayPlacement.width - 8);
        assert.ok(trayPlacement.tray.top >= 8 && trayPlacement.tray.bottom <= trayPlacement.height - 8);
        assert.ok(trayPlacement.tray.left >= trayPlacement.anchor.right + 7
            || trayPlacement.tray.right <= trayPlacement.anchor.left - 7);
        await page.click('[data-review-row="0"]');
        await page.mouse.move(0, 0);
        let result = await page.evaluate(() => ({ note: document.querySelector('[data-review-note]').hidden,
            tray: document.querySelector('#review-chat-tray').hidden,
            noteInBody: document.querySelector('[data-review-note]').parentElement === document.body,
            trayInBody: document.querySelector('#review-chat-tray').parentElement === document.body,
            heading: document.querySelector('[data-review-tray-heading]').textContent,
            noteWidth: document.querySelector('[data-review-note]').getBoundingClientRect().width,
            noteRowBottom: document.querySelector('.review-note-line').getBoundingClientRect().bottom,
            noteMetaRight: document.querySelector('.review-note-meta').getBoundingClientRect().right,
            noteActionsLeft: document.querySelector('.review-note-actions').getBoundingClientRect().left,
            noteCloseRight: document.querySelector('[data-review-note-close]').getBoundingClientRect().right,
            memoTop: document.querySelector('[data-review-memo]').getBoundingClientRect().top,
            memoBottom: document.querySelector('[data-review-memo]').getBoundingClientRect().bottom,
            elementsTop: document.querySelector('[data-review-elements]').getBoundingClientRect().top,
            trayHeadingTop: document.querySelector('[data-review-tray-heading]').getBoundingClientRect().top,
            trayCloseTop: document.querySelector('[data-review-tray-close]').getBoundingClientRect().top,
            closeBorder: getComputedStyle(document.querySelector('[data-review-note-close]')).borderTopWidth,
            closeBackground: getComputedStyle(document.querySelector('[data-review-note-close]')).backgroundColor,
            trayAlpha: getComputedStyle(document.querySelector('#review-chat-tray')).backgroundColor,
            noteAlpha: getComputedStyle(document.querySelector('[data-review-note]')).backgroundColor }));
        assert.deepEqual([result.note, result.tray, result.noteInBody, result.trayInBody], [false, false, true, true]);
        assert.equal(result.heading, '添付 1 件');
        assert.ok(result.noteWidth <= 340 && result.memoTop > result.noteRowBottom && result.elementsTop >= result.memoBottom);
        assert.ok(result.noteActionsLeft >= result.noteMetaRight && result.noteCloseRight > result.noteActionsLeft);
        assert.ok(Math.abs(result.trayHeadingTop - result.trayCloseTop) < 8);
        assert.equal(result.closeBorder, '0px');
        assert.equal(result.closeBackground, 'rgba(0, 0, 0, 0)');
        assert.match(result.trayAlpha, /0\.78\)/);
        assert.match(result.noteAlpha, /0\.78\)/);
        await page.setViewport({ width: 380, height: 600 });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        const narrow = await page.evaluate(() => {
            const badge = document.querySelector('[data-review-badge="0"]').getBoundingClientRect();
            const note = document.querySelector('[data-review-note]').getBoundingClientRect();
            return { viewport: innerWidth, badgeBottom: badge.bottom, noteTop: note.top, noteLeft: note.left, noteRight: note.right };
        });
        assert.ok(narrow.noteTop >= narrow.badgeBottom + 7, JSON.stringify(narrow));
        assert.ok(narrow.noteLeft >= 8 && narrow.noteRight <= 372, JSON.stringify(narrow));
        await page.setViewport({ width: 800, height: 600 });
        await pointer(page, '#preview-stage', 'pointerdown', 45, 45);
        result = await page.evaluate(() => ({ note: document.querySelector('[data-review-note]').hidden,
            tray: document.querySelector('#review-chat-tray').hidden }));
        assert.deepEqual(result, { note: false, tray: false });
        await page.type('[data-review-memo]', 'Fix this');
        await page.click('[data-review-note-close]');
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-note]').hidden), true);
        assert.equal(await page.evaluate(() => window.__messages.some(message => message.type === 'akari-preview-chat-review-update' && message.review.text === 'Fix this')), true);
        assert.equal(await page.evaluate(() => document.querySelector('#review-chat-tray').hidden), false);
        await page.click('[data-review-tray-close]');
        assert.equal(await page.evaluate(() => document.querySelector('#review-chat-tray').hidden), true);
        await page.click('[data-review-attach-count]');
        assert.equal(await page.evaluate(() => document.querySelector('#review-chat-tray').hidden), false);
        await page.click('[data-review-attach-count]');
        assert.equal(await page.evaluate(() => document.querySelector('#review-chat-tray').hidden), true);
        await page.close();
    } finally { await browser.close(); }
});

test('real Chrome keeps a tall attachment tray and a low pin note above the transport', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) { if (error?.message !== 'headless Chrome が見つかりません') throw error; t.skip('headless Chrome 不在'); return; }
    try {
        const page = await reviewPage(browser);
        await page.setViewport({ width: 1100, height: 600 });
        await state(page, Array.from({ length: 24 }, (_, index) => ({ ...pin, id: `pin-${index}`, shape: { x: .4, y: .98 } })));
        await page.click('[data-review-attach-count]');
        await page.click('[data-review-row="0"]');
        const bounds = await page.evaluate(() => {
            const tray = document.querySelector('#review-chat-tray');
            const rows = tray.querySelector('[data-review-rows]');
            const send = tray.querySelector('[data-review-send]');
            const note = document.querySelector('[data-review-note]');
            const floor = Math.min(document.querySelector('.transport').getBoundingClientRect().top,
                document.querySelector('.transport-seek').getBoundingClientRect().top);
            return { floor, tray: tray.getBoundingClientRect().toJSON(), note: note.getBoundingClientRect().toJSON(),
                send: send.getBoundingClientRect().toJSON(), rowsScrollable: rows.scrollHeight > rows.clientHeight,
                trayHidden: tray.hidden, noteHidden: note.hidden };
        });
        assert.equal(bounds.trayHidden, false);
        assert.equal(bounds.noteHidden, false);
        assert.ok(bounds.tray.bottom <= bounds.floor - 7.5, JSON.stringify(bounds));
        assert.ok(bounds.note.bottom <= bounds.floor - 7.5, JSON.stringify(bounds));
        assert.ok(bounds.rowsScrollable, JSON.stringify(bounds));
        assert.ok(bounds.send.top >= bounds.tray.top && bounds.send.bottom <= bounds.tray.bottom, JSON.stringify(bounds));
        const rowScroll = await page.evaluate(async () => {
            const rows = document.querySelector('[data-review-rows]');
            rows.scrollTop = 100;
            await new Promise(resolve => setTimeout(resolve, 0));
            return rows.scrollTop;
        });
        assert.ok(rowScroll > 0, `attachment rows retain scroll position: ${rowScroll}`);
        await page.close();
    } finally { await browser.close(); }
});

test('real Chrome moves pins, opens on a short press, and leaves pen marks stationary', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) { if (error?.message !== 'headless Chrome が見つかりません') throw error; t.skip('headless Chrome 不在'); return; }
    try {
        const page = await reviewPage(browser);
        await state(page, [pin, pen]);
        const initial = await page.evaluate(() => {
            const badge = document.querySelector('[data-review-badge="0"]');
            const rect = badge.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await pointer(page, '[data-review-badge="0"]', 'pointerdown', initial.x, initial.y);
        await pointer(page, 'window', 'pointermove', initial.x + 20, initial.y + 20);
        await pointer(page, 'window', 'pointercancel', initial.x + 20, initial.y + 20);
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-badge="0"]').style.left), '40%');
        assert.equal(await page.evaluate(() => window.__messages.filter(message => message.type === 'akari-preview-chat-review-update').length), 0);
        await pointer(page, '[data-review-badge="0"]', 'pointerdown', initial.x, initial.y);
        await pointer(page, 'window', 'pointermove', initial.x + 60, initial.y + 30);
        await pointer(page, 'window', 'pointerup', initial.x + 60, initial.y + 30);
        const update = await page.evaluate(() => window.__messages.filter(message => message.type === 'akari-preview-chat-review-update').at(-1));
        assert.ok(update);
        assert.ok(update.review.shape.x > pin.shape.x && update.review.shape.y > pin.shape.y);
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-note]').hidden), true);
        await pointer(page, '[data-review-badge="0"]', 'pointerdown', initial.x + 60, initial.y + 30);
        await pointer(page, 'window', 'pointermove', initial.x + 62, initial.y + 31);
        await pointer(page, 'window', 'pointerup', initial.x + 62, initial.y + 31);
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-note]').hidden), false);
        await pointer(page, '[data-review-badge="1"]', 'pointerdown', 140, 140);
        await pointer(page, 'window', 'pointermove', 200, 200);
        await pointer(page, 'window', 'pointerup', 200, 200);
        assert.equal(await page.evaluate(() => window.__messages.filter(message => message.type === 'akari-preview-chat-review-update').length), 1);
        assert.equal(await page.evaluate(() => document.querySelector('[data-review-note-tool]').dataset.reviewNoteTool), 'pen');
        await page.close();
    } finally { await browser.close(); }
});

test('real Chrome removes an empty fresh pin with close and stops range marking after completion', async t => {
    let browser;
    try { browser = await launchBrowser(); }
    catch (error) { if (error?.message !== 'headless Chrome が見つかりません') throw error; t.skip('headless Chrome 不在'); return; }
    try {
        const page = await reviewPage(browser);
        await page.click('[data-review-tool="pin"]');
        await pointer(page, '#preview-stage', 'pointerdown', 200, 150);
        await pointer(page, 'window', 'pointerup', 200, 150);
        const freshState = await page.evaluate(() => ({ hidden: document.querySelector('[data-review-note]').hidden,
            selected: document.querySelector('[data-review-tool="pin"]').getAttribute('aria-pressed'), messages: window.__messages }));
        assert.equal(freshState.hidden, false, JSON.stringify(freshState));
        await page.click('[data-review-note-close]');
        assert.equal(await page.evaluate(() => window.__messages.some(message => message.type === 'akari-preview-chat-review-remove')), true);
        await page.click('[data-review-tool="range"]');
        await page.evaluate(() => { document.querySelector('#seek').value = '1'; });
        await page.click('[data-review-range-start]');
        await page.evaluate(() => { document.querySelector('#seek').value = '2'; });
        await page.click('[data-review-range-end]');
        for (let i = 0; i < 5; i++) {
            await page.evaluate(i => {
                const seek = document.querySelector('#seek');
                seek.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
                seek.value = String(3 + i);
                seek.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
            }, i);
        }
        const result = await page.evaluate(() => ({ adds: window.__messages.filter(message => message.type === 'akari-preview-chat-review-add' && message.review.tool === 'range').length,
            rangeSelected: document.querySelector('[data-review-tool="range"]').getAttribute('aria-pressed') }));
        assert.deepEqual(result, { adds: 1, rangeSelected: 'false' });
        await page.close();
    } finally { await browser.close(); }
});
