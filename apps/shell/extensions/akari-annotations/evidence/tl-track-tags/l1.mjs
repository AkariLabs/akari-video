#!/usr/bin/env node
// 起動済み Electron の CDP に接続する。計測 JSON と画像は隔離ディレクトリだけに保存する。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, realDrag, screenshot } from './cdp-lib.mjs';

const port = 9466;
const tmpRoot = process.env.AKARI_TL_TRACK_TAGS_TMP ?? path.join(path.parse(os.tmpdir()).root, 'tmp');
const project = path.resolve(process.env.AKARI_TL_TRACK_TAGS_PROJECT ?? path.join(tmpRoot, 'akari-tl-track-tags-fixture'));
const output = path.resolve(process.env.AKARI_TL_TRACK_TAGS_RESULTS ?? path.join(tmpRoot, 'akari-tl-track-tags-l1'));
const editPath = path.join(project, 'edit.json');
const q = JSON.stringify;
const result = { port, checks: {}, screenshots: [], project, output };
const editBytes = () => readFile(editPath);
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
async function waitFor(label, fn, timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    let last;
    while (Date.now() < until) {
        try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
        await sleep(200);
    }
    throw new Error(`${label} did not converge${last ? `: ${last.message}` : ''}`);
}
const run = async (name, fn) => {
    try {
        const value = await fn();
        result.checks[name] = { pass: true, value };
        return value;
    } catch (error) {
        result.checks[name] = { pass: false, error: String(error?.message ?? error) };
        throw error;
    }
};
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const key=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!key)throw Error('CommandService unavailable');await window.theia.container.get(key).executeCommand(${q(id)});return true})()`;
const header = id => `.akari-track-header-row[data-akari-timeline-track-id=${q(id)}]`;
const tag = id => `${header(id)} [data-akari-ripple-tag=${q(id)}]`;
const state = cdp => evalOn(cdp, `(()=>[...document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]')].map(row=>({id:row.dataset.akariTimelineTrackId,mode:row.querySelector('[data-akari-ripple-mode]')?.dataset.akariRippleMode??null,tag:row.querySelector('[data-akari-ripple-tag]')?.textContent??null,follow:row.querySelector('.akari-track-ripple-follow')?.textContent??null,switches:[...row.querySelectorAll('[data-akari-ripple-switch]')].map(e=>({field:e.dataset.akariRippleSwitch,on:e.getAttribute('aria-pressed')}))})))()`);
async function click(cdp, selector) {
    const point = await waitFor(`visible ${selector}`, () => evalOn(cdp, `(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`));
    await realClick(cdp, point.x, point.y);
}
async function keyUndo(cdp) {
    await keyPress(cdp, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
}
const modeOf = async id => (await edit()).tracks.find(track => track.id === id);
async function waitPair(id, target, sync) {
    return waitFor(`${id} target=${target} sync=${sync}`, async () => {
        const track = await modeOf(id);
        return track?.target === target && track?.sync === sync ? [track.target, track.sync] : null;
    });
}
async function waitUiMode(cdp, id, mode) {
    await waitFor(`${id} shows ${mode}`, async () => (await state(cdp)).find(row => row.id === id)?.mode === mode);
    await sleep(400);
}
async function waitSwitch(cdp, id, field, on) {
    return waitFor(`${id} ${field}=${on}`, async () => (await state(cdp)).find(row => row.id === id)
        ?.switches.find(toggle => toggle.field === field)?.on === String(on));
}
async function clickPreset(cdp, preset) {
    await click(cdp, '[data-akari-ripple-menu]');
    await click(cdp, `[data-akari-ripple-preset=${q(preset)}]`);
}
async function setPreference(cdp, value) {
    return evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const key=[...d._map.keys()].find(k=>String(k)==='Symbol(PreferenceService)');if(!key)throw Error('PreferenceService unavailable');const p=window.theia.container.get(key);await p.set('akari.timeline.trackRippleDisplay',${q(value)},1);return p.get('akari.timeline.trackRippleDisplay')})()`);
}
const widgetExpr = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const shell=window.theia.container.get(k);const w=[...shell.widgets].find(x=>x.node?.querySelector?.('[data-akari-ripple-menu]'));if(!w)throw Error('timeline widget unavailable');return {shell,w}})()`;
async function maximizeTimeline(cdp) {
    return evalOn(cdp, `(()=>{const {shell,w}=${widgetExpr};if(!w.node.closest('.theia-maximized')&&typeof shell.toggleMaximized==='function')shell.toggleMaximized(w);return Boolean(w.node.closest('.theia-maximized'))})()`);
}
async function layout(cdp) {
    return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]')].map(row=>{const ctl=row.querySelector('.akari-track-ripple-control,.akari-track-ripple-follow');const r=row.getBoundingClientRect();if(!ctl)return{id:row.dataset.akariTimelineTrackId,height:r.height,control:null,overlap:false,outside:false};const a=ctl.getBoundingClientRect();const others=[...row.querySelectorAll('button,.akari-track-header-button,[data-akari-paste-target],.akari-track-header-name')].filter(e=>!ctl.contains(e)&&e!==ctl&&!e.contains(ctl)).map(e=>e.getBoundingClientRect()).filter(b=>b.width&&b.height);const overlap=others.some(b=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5);let vp=row.parentElement;while(vp&&!/hidden|auto|scroll/.test(getComputedStyle(vp).overflowY))vp=vp.parentElement;const v=vp?vp.getBoundingClientRect():{top:0,bottom:innerHeight};const cy=a.top+a.height/2;const inView=cy>v.top&&cy<v.bottom&&cy<innerHeight;const hit=inView?document.elementFromPoint(a.left+a.width/2,cy):null;const hittable=inView?Boolean(hit&&(ctl.contains(hit)||hit===ctl)):null;const outside=a.left<r.left-0.5||a.right>r.right+0.5||a.top<r.top-0.5||a.bottom>r.bottom+0.5;return{id:row.dataset.akariTimelineTrackId,height:r.height,control:{x:a.x,y:a.y,width:a.width,height:a.height,text:ctl.textContent,iconWidth:ctl.querySelector('.codicon')?.getBoundingClientRect().width??null,hittable},overlap,outside}});const main=rows.find(r=>r.id==='v-main');return{height:main?.height,control:main?.control,overlap:rows.some(r=>r.overlap||r.outside||(r.control&&(r.control.hittable===false||!r.control.iconWidth))),rows}})()`);
}
async function screenshotLayout(cdp, name, baseHeight, scale) {
    await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const shell=window.theia.container.get(k);const w=[...shell.widgets].find(x=>x.node?.querySelector?.('[data-akari-ripple-menu]'));if(!w)throw Error('timeline widget unavailable');for(const id of [...w.trackHeights.keys()])w.trackHeights.set(id,w.clampTrackHeight(${baseHeight}));w.trackHeights.set('v-main',w.clampTrackHeight(${baseHeight}));w.setTrackHeightScale(${scale});w.renderStrip();return true})()`);
    await sleep(300);
    const geometry = await layout(cdp);
    const file = path.join(output, `${name}.png`);
    await screenshot(cdp, file);
    result.screenshots.push(file);
    result.geometry = { ...(result.geometry ?? {}), [name]: geometry };
    assert(geometry && !geometry.overlap, `${name}: control overlaps existing header buttons`);
    return geometry;
}

await mkdir(output, { recursive: true });
let cdp;
try {
    const target = await waitFor('CDP page', async () => (await listTargets(port)).find(item => item.type === 'page'), 120000);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitFor('Theia', () => evalOn(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`), 180000);
    const before = process.env.AKARI_TL_TRACK_TAGS_BEFORE ? await readFile(process.env.AKARI_TL_TRACK_TAGS_BEFORE) : await editBytes();
    if ((await state(cdp)).length < 6) await evalOn(cdp, command('akari.annotations.open'));
    await waitFor('six track headers', async () => (await state(cdp)).length >= 6, 120000);
    result.maximized = await maximizeTimeline(cdp);
    await sleep(500);
    await run('initial', async () => {
        const rows = await state(cdp);
        for (const id of ['v-main', 'v-broll', 'v-telop', 'a-sfx']) assert.equal(rows.find(row => row.id === id)?.mode, 'cut', id);
        assert.equal(rows.find(row => row.id === 'a-bgm')?.mode, 'fixed');
        assert.equal(rows.find(row => row.id === 'captions')?.mode, null);
        assert(rows.find(row => row.id === 'captions')?.follow);
        assert.deepEqual(await editBytes(), before, 'opening changed edit.json bytes');
        return rows;
    });
    await run('bgm_three_clicks_and_each_undo', async () => {
        const sequence = [];
        for (const [mode, pair, undoPair] of [
            ['cut', [true, true], [undefined, undefined]],
            ['shift', [false, true], [true, true]],
            ['fixed', [false, false], [false, true]]
        ]) {
            await click(cdp, tag('a-bgm'));
            await waitPair('a-bgm', ...pair);
            await waitFor(`BGM tag ${mode}`, async () => (await state(cdp)).find(row => row.id === 'a-bgm')?.mode === mode);
            sequence.push({ click: mode, pair });
            await keyUndo(cdp);
            await waitFor(`undo ${mode}`, async () => {
                const track = await modeOf('a-bgm');
                return track?.target === undoPair[0] && track?.sync === undoPair[1];
            });
            const undoMode = mode === 'cut' ? 'fixed' : mode === 'shift' ? 'cut' : 'shift';
            await waitFor(`undo tag ${undoMode}`, async () => (await state(cdp)).find(row => row.id === 'a-bgm')?.mode === undoMode);
            sequence.push({ undo: mode, pair: undoPair });
            if (mode === 'cut') { await click(cdp, tag('a-bgm')); await waitPair('a-bgm', true, true); await waitUiMode(cdp, 'a-bgm', 'cut'); }
            if (mode === 'shift') { await click(cdp, tag('a-bgm')); await waitPair('a-bgm', false, true); await waitUiMode(cdp, 'a-bgm', 'shift'); }
        }
        return sequence;
    });
    await run('batch_all_and_defaults', async () => {
        await clickPreset(cdp, 'all-cut');
        await waitFor('all cut', async () => (await edit()).tracks.filter(track => 'items' in track)
            .every(track => track.target === true && track.sync === true));
        await waitFor('all cut tags', async () => (await state(cdp)).filter(row => row.mode !== null)
            .every(row => row.mode === 'cut'));
        const all = (await edit()).tracks.filter(track => 'items' in track).map(track => track.id);
        await keyUndo(cdp);
        await waitFor('batch one-step undo', async () => (await modeOf('a-sfx'))?.target === undefined);
        await waitFor('batch undo BGM shift', async () => (await state(cdp)).find(row => row.id === 'a-bgm')?.mode === 'shift');
        await clickPreset(cdp, 'defaults');
        await waitFor('defaults removed', async () => (await edit()).tracks.every(track => !('target' in track) && !('sync' in track)));
        await waitUiMode(cdp, 'a-bgm', 'fixed');
        const rows = await state(cdp);
        assert.equal(rows.find(row => row.id === 'a-bgm')?.mode, 'fixed');
        return { all, modes: rows.map(row => [row.id, row.mode]) };
    });
    await run('switches_live_and_independent', async () => {
        assert.equal(await setPreference(cdp, 'switches'), 'switches');
        await waitFor('switches shown', async () => (await state(cdp)).find(row => row.id === 'v-main')?.switches.length === 2);
        await click(cdp, `${header('v-main')} [data-akari-ripple-switch="target"]`);
        await waitPair('v-main', false, true);
        await waitSwitch(cdp, 'v-main', 'target', false);
        await click(cdp, `${header('v-main')} [data-akari-ripple-switch="sync"]`);
        await waitPair('v-main', false, false);
        await waitSwitch(cdp, 'v-main', 'sync', false);
        await click(cdp, `${header('v-main')} [data-akari-ripple-switch="sync"]`);
        await waitPair('v-main', false, true);
        await waitSwitch(cdp, 'v-main', 'sync', true);
        assert.equal(await setPreference(cdp, 'tag'), 'tag');
        await waitFor('shift tag shown', async () => (await state(cdp)).find(row => row.id === 'v-main')?.mode === 'shift');
        return { track: await modeOf('v-main'), rows: await state(cdp) };
    });
    for (const [name, height, scale] of [
        ['height-20', 20, 1], ['height-240', 240, 1], ['zoom-0_6', 60, 0.6], ['zoom-3', 60, 3]
    ]) await run(name, () => screenshotLayout(cdp, name, height, scale));
    await run('mute_lock_visibility', async () => {
        const row = header('v-main');
        const status = [];
        for (const control of ['mute', 'lock', 'visibility']) {
            const selector = `${row} [data-akari-toggle=${q(control)}]`;
            const beforePressed = await evalOn(cdp, `document.querySelector(${q(selector)})?.getAttribute('aria-pressed')`);
            await click(cdp, selector);
            await waitFor(`${control} toggled`, async () => (await evalOn(cdp, `document.querySelector(${q(selector)})?.getAttribute('aria-pressed')`)) !== beforePressed);
            if (control === 'lock') assert.equal((await state(cdp)).find(item => item.id === 'v-main')?.mode, 'fixed');
            await click(cdp, selector);
            await waitFor(`${control} restored`, async () => (await evalOn(cdp, `document.querySelector(${q(selector)})?.getAttribute('aria-pressed')`)) === beforePressed);
            status.push(control);
        }
        return status;
    });
    await run('height_drag_and_track_dnd', async () => {
        await screenshotLayout(cdp, 'before-regress', 60, 1);
        const points = await evalOn(cdp, `(()=>{const h=document.querySelector(${q(header('v-main') + ' [data-akari-resize="height"]')});const s=document.querySelector(${q(header('v-telop'))});const t=document.querySelector(${q(header('v-broll'))});const a=h.getBoundingClientRect(),b=s.getBoundingClientRect(),c=t.getBoundingClientRect();return{resize:{x:a.left+12,y:a.top+2},source:{x:b.left+30,y:b.top+10},target:{x:c.left+30,y:c.top+c.height/2}}})()`);
        const initialHeight = (await layout(cdp)).height;
        await realDrag(cdp, [points.resize, { x: points.resize.x, y: points.resize.y + 30 }]);
        await waitFor('height changed', async () => Math.abs((await layout(cdp)).height - initialHeight) >= 10);
        await sleep(800);
        // rows re-render after the height change; measure the drag points again
        const moved = await evalOn(cdp, `(()=>{const s=document.querySelector(${q(header('v-telop'))}).getBoundingClientRect();const t=document.querySelector(${q(header('v-broll'))}).getBoundingClientRect();return{source:{x:s.left+30,y:s.top+10},target:{x:t.left+30,y:t.top+t.height/2}}})()`);
        const beforeIds = (await edit()).tracks.map(track => track.id);
        await realDrag(cdp, [moved.source, moved.target]);
        await waitFor('track reordered', async () => JSON.stringify((await edit()).tracks.map(track => track.id)) !== JSON.stringify(beforeIds));
        return { heightBefore: initialHeight, heightAfter: (await layout(cdp)).height,
            tracksBefore: beforeIds, tracksAfter: (await edit()).tracks.map(track => track.id) };
    });
} catch (error) {
    result.error = String(error?.stack ?? error);
    process.exitCode = 1;
} finally {
    cdp?.close();
    await writeFile(path.join(output, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ results: path.join(output, 'results.json'), pass: !result.error }));
}
