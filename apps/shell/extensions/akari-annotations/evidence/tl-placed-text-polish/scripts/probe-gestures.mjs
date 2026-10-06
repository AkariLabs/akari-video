#!/usr/bin/env node
// Probe the first move of a placed-text drag and all four corner handles in a running preview.
// Usage: node probe-gestures.mjs <project-directory> <output-json>
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, realDrag } from '../../timeline-dnd-polish/scripts/cdp-lib.mjs';
import { view } from '../../timeline-dnd-polish/scripts/l1-common.mjs';

const [project, outputFile] = process.argv.slice(2);
if (!project || !outputFile) throw new Error('project and output JSON are required');
const captionsFile = `${project}/captions.json`;
const initial = JSON.parse(await readFile(captionsFile, 'utf8'));
const mainTarget = (await listTargets(9476)).find(target => target.type === 'page');
if (!mainTarget) throw new Error('workbench target not found');
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
const preview = await view(9476);
const data = { pointerStepPx: 8, cases: [], handles: [] };
const round = value => Math.round(value * 1000) / 1000;
const metric = () => preview.eval(`(()=>{const p=[...document.querySelectorAll('.caption-row-plate')]
    .find(e=>e.textContent.includes('こんにちは'));const line=p?.querySelector('.akari-caption__line');
    if(!line)return null;const range=document.createRange();range.selectNodeContents(line);
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
    return{line:rect(line),ink:rect({getBoundingClientRect:()=>range.getBoundingClientRect()}),
        translate:p.style.translate,scale:p.style.getPropertyValue('--caption-scale'),
        rotate:p.style.getPropertyValue('--caption-rotate'),
        selected:document.querySelector('#caption-select-box')?.classList.contains('is-active')}})()`);
async function setStyle(style) {
    // Let the preview's recent-write suppression window expire after a handle commit.
    await sleep(1150);
    const document = structuredClone(initial);
    document.default_text_style = { zone: 'bottom' };
    document.captions.find(cue => cue.id === 'c-0005').text_style = style;
    await writeFile(captionsFile, `${JSON.stringify(document, null, 2)}\n`);
    const deadline = Date.now() + 15_000;
    let retried = false;
    while (Date.now() < deadline) {
        const state = await metric();
        if (state && (await preview.eval(`(()=>{const p=[...document.querySelectorAll('.caption-row-plate')]
            .find(e=>e.textContent.includes('こんにちは'));return p?.style.getPropertyValue('--caption-font-size')})()`)) === `${style.size_px}px`) {
            await sleep(700);
            return;
        }
        if (!retried && Date.now() > deadline - 11_000) {
            await writeFile(captionsFile, `${JSON.stringify(document, null, 2)}\n`);
            retried = true;
        }
        await sleep(250);
    }
    throw new Error('caption style did not refresh');
}
async function captionPoint(fraction = .5) {
    const state = await metric();
    if (!state) throw new Error('caption not visible');
    return { x: state.ink.x + state.ink.width * fraction,
        y: state.ink.y + state.ink.height / 2 };
}
async function probePointer(name, style, fraction = .5, setup) {
    await setStyle(style);
    if (setup) await setup();
    // A prior selection is cleared so pointerdown must perform the initial selection again.
    await realClick(preview.cdp, 15, 15);
    const point = await captionPoint(fraction);
    const hit = await preview.eval(`(()=>{const e=document.elementFromPoint(${point.x},${point.y});
        return{className:String(e?.className||''),plate:e?.closest?.('.caption-row-plate')?.id||null}})()`);
    const before = await metric();
    await preview.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
    await preview.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y,
        button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    const down = await metric();
    await preview.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 8, y: point.y,
        button: 'left', buttons: 1 });
    await sleep(60);
    const firstMove = await metric();
    await preview.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await preview.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await preview.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 8, y: point.y,
        button: 'left', buttons: 0 });
    await sleep(150);
    const result = { name, style, fraction, hit, point: { x: round(point.x), y: round(point.y) },
        before, down, firstMove,
        initialJumpPx: round(down.line.x - before.line.x),
        firstMovePx: round(firstMove.line.x - down.line.x),
        flyPx: round(firstMove.line.x - before.line.x - 8) };
    data.cases.push(result);
    await writeFile(outputFile, `${JSON.stringify(data, null, 2)}\n`);
    return result;
}
async function probeHandles(name, style) {
    await setStyle(style);
    const point = await captionPoint(.5);
    await realClick(preview.cdp, point.x, point.y);
    const hits = await preview.eval(`(()=>[...document.querySelectorAll('#caption-select-box .akari-caption-handle')]
        .filter(e=>['nw','ne','sw','se'].includes(e.dataset.h)).map(e=>{const r=e.getBoundingClientRect();
        const x=r.x+r.width/2,y=r.y+r.height/2;const target=document.elementFromPoint(x,y);
        return{corner:e.dataset.h,x,y,hit:target?.closest?.('.akari-caption-handle')?.dataset.h||null,
            targetClass:String(target?.className||'')}}))()`);
    const se = hits.find(hit => hit.corner === 'se');
    const beforeScale = JSON.parse(await readFile(captionsFile, 'utf8')).captions.find(cue => cue.id === 'c-0005').text_style.scale ?? 1;
    if (se?.hit === 'se') await realDrag(preview.cdp,
        [{ x: se.x, y: se.y }, { x: se.x + 24, y: se.y + 12 }], { steps: 8 });
    await sleep(350);
    const afterScale = JSON.parse(await readFile(captionsFile, 'utf8')).captions.find(cue => cue.id === 'c-0005').text_style.scale ?? 1;
    const record = { name, style, hits: hits.map(hit => ({ ...hit, x: round(hit.x), y: round(hit.y) })),
        beforeScale, afterScale, enlarged: afterScale > beforeScale };
    data.handles.push(record);
    await writeFile(outputFile, `${JSON.stringify(data, null, 2)}\n`);
    return record;
}
const base = { font_family: 'Noto Sans JP', weight: 700, size_px: 64, wrap_width_pct: 70, zone: 'bottom' };
const outline = { color: '#000000', width_px: 12 };
try {
    await probePointer('a: first grab, zone only', base);
    await probePointer('b: after size plus', { ...base, size_px: 158 }, .5, async () => {
        const point = await captionPoint();
        await realClick(preview.cdp, point.x, point.y);
        await evalOn(main, `document.querySelector('[data-akari-bar-item="captionSizeInc"]')?.click()`);
        await sleep(500);
    });
    await probeHandles('c: corner from scale 1', base);
    const scaled = JSON.parse(await readFile(captionsFile, 'utf8')).captions.find(cue => cue.id === 'c-0005').text_style.scale ?? 1;
    await probePointer('c: after corner scale', { ...base, scale: scaled });
    await probePointer('d: rotated 25 degrees', { ...base, rotate: 25 });
    await probePointer('e: wide wrap, left glyph', { ...base, wrap_width_pct: 90, align: 'center' }, .1);
    await probePointer('e: wide wrap, right glyph', { ...base, wrap_width_pct: 90, align: 'center' }, .9);
    await probePointer('f: thick outline', { ...base, size_px: 160, wrap_width_pct: 90, stroke: outline });
    await probePointer('g: zoom 150 percent', base, .5, async () => {
        await preview.eval(`window.dispatchEvent(new MessageEvent('message',
            {data:{type:'akari-preview-set-zoom',scale:1.5}}))`);
        await sleep(350);
    });
    await preview.eval(`window.dispatchEvent(new MessageEvent('message',
        {data:{type:'akari-preview-set-zoom',fit:true}}))`);
    await main.send('Emulation.setDeviceMetricsOverride',
        { width: 1000, height: 720, deviceScaleFactor: 1, mobile: false });
    await probePointer('g: narrow window', base);
    await main.send('Emulation.setDeviceMetricsOverride',
        { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await probePointer('h: overlaps spoken caption', { ...base, stroke: outline });
    await probeHandles('b: size 160 after plus', { ...base, size_px: 160 });
    await probeHandles('c: existing 1.4 scale', { ...base, scale: 1.4 });
    await probeHandles('d: rotated 25 degrees', { ...base, rotate: 25 });
    await probeHandles('f: size 160 and outline', { ...base, size_px: 160, stroke: outline });
    await probeHandles('upper size 320 and outline', { ...base, size_px: 320, stroke: outline });
    console.log(JSON.stringify({ cases: data.cases.map(({ name, initialJumpPx, firstMovePx, flyPx, hit }) =>
        ({ name, initialJumpPx, firstMovePx, flyPx, hit: hit.plate })),
        handles: data.handles.map(({ name, beforeScale, afterScale, enlarged, hits }) =>
            ({ name, beforeScale, afterScale, enlarged, corners: hits.map(hit => `${hit.corner}:${hit.hit}`) })) }));
} finally {
    main.close(); preview.cdp.close();
}
