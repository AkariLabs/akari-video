#!/usr/bin/env node
// l1.mjs の続き（同じ起動済み Electron・CDP 9466）。新しく起動した直後の fixture で実行する。
// まとめ切替の「本編だけ切る」/「選んだトラックだけ切る」、見出しの右クリック、2 スイッチの低い行、設定画面を測る。
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const port = 9466;
const tmpRoot = process.env.AKARI_TL_TRACK_TAGS_TMP ?? path.join(path.parse(os.tmpdir()).root, 'tmp');
const project = path.resolve(process.env.AKARI_TL_TRACK_TAGS_PROJECT ?? path.join(tmpRoot, 'akari-tl-track-tags-fixture'));
const output = path.resolve(process.env.AKARI_TL_TRACK_TAGS_RESULTS ?? path.join(tmpRoot, 'akari-tl-track-tags-l1'));
const editPath = path.join(project, 'edit.json');
const q = JSON.stringify;
const result = { port, checks: {}, screenshots: [] };
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const pairs = async () => Object.fromEntries((await edit()).tracks.map(track => [track.id, [track.target ?? null, track.sync ?? null]]));
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
    try { const value = await fn(); result.checks[name] = { pass: true, value }; return value; } catch (error) {
        result.checks[name] = { pass: false, error: String(error?.message ?? error) }; throw error;
    }
};
const header = id => `.akari-track-header-row[data-akari-timeline-track-id=${q(id)}]`;
const widgetExpr = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const shell=window.theia.container.get(k);const w=[...shell.widgets].find(x=>x.node?.querySelector?.('[data-akari-ripple-menu]'));if(!w)throw Error('timeline widget unavailable');return {shell,w}})()`;
async function point(cdp, selector) {
    return waitFor(`visible ${selector}`, () => evalOn(cdp, `(()=>{const e=document.querySelector(${q(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`));
}
async function click(cdp, selector, opts) { const p = await point(cdp, selector); await realClick(cdp, p.x, p.y, opts); }
async function rightClick(cdp, selector) {
    const p = await point(cdp, selector);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', clickCount: 1 });
}
const undo = cdp => keyPress(cdp, { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
async function setPreference(cdp, value) {
    return evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const key=[...d._map.keys()].find(k=>String(k)==='Symbol(PreferenceService)');const p=window.theia.container.get(key);await p.set('akari.timeline.trackRippleDisplay',${q(value)},1);return p.get('akari.timeline.trackRippleDisplay')})()`);
}
async function setHeights(cdp, height, scale) {
    await evalOn(cdp, `(()=>{const {w}=${widgetExpr};for(const id of [...w.trackHeights.keys()])w.trackHeights.set(id,w.clampTrackHeight(${height}));w.setTrackHeightScale(${scale});w.renderStrip();w.stripScroll.scrollTop=0;return true})()`);
    await sleep(500);
}
const switchGeometry = cdp => evalOn(cdp, `(()=>[...document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]')].map(row=>{const name=row.querySelector('.akari-track-header-name')?.getBoundingClientRect();const sw=[...row.querySelectorAll('[data-akari-ripple-switch]')].map(e=>{const r=e.getBoundingClientRect();const i=e.querySelector('.codicon')?.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;const h=cy<innerHeight?document.elementFromPoint(cx,cy):null;const rr=row.getBoundingClientRect();return{field:e.dataset.akariRippleSwitch,x:r.left,y:r.top,w:r.width,h:r.height,icon:i?.width??0,hit:h?e.contains(h):null,clipped:r.right>rr.right+0.5||r.left<rr.left-0.5||e.scrollWidth>e.clientWidth+1}});const others=[...row.querySelectorAll('.akari-track-header-button')].map(e=>e.getBoundingClientRect());const overlap=sw.some(a=>others.some(b=>a.x<b.right-0.5&&b.left<a.x+a.w-0.5&&a.y<b.bottom-0.5&&b.top<a.y+a.h-0.5));return{id:row.dataset.akariTimelineTrackId,height:row.getBoundingClientRect().height,nameWidth:name?.width??null,switches:sw,overlap}}))()`);
async function shot(cdp, name) { const file = path.join(output, `${name}.png`); await screenshot(cdp, file); result.screenshots.push(file); }

await mkdir(output, { recursive: true });
let cdp;
try {
    const target = (await listTargets(port)).find(item => item.type === 'page');
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await waitFor('headers', () => evalOn(cdp, `document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]').length>=6`), 120000);
    await evalOn(cdp, `(()=>{const {shell,w}=${widgetExpr};if(!w.node.closest('.theia-maximized'))shell.toggleMaximized(w);return true})()`);
    await sleep(500);
    await run('main_only_without_selection', async () => {
        const before = await pairs();
        await click(cdp, '[data-akari-ripple-menu]');
        const label = await waitFor('preset popup', () => evalOn(cdp, `document.querySelector('[data-akari-ripple-preset="selected-cut"]')?.textContent`));
        await click(cdp, '[data-akari-ripple-preset="selected-cut"]');
        const after = await waitFor('main-only written', async () => { const p = await pairs(); return p['v-main'][0] !== null ? p : null; });
        await undo(cdp);
        await waitFor('main-only undone in one step', async () => q(await pairs()) === q(before));
        return { label, after };
    });
    await run('selected_track_only', async () => {
        await sleep(600);
        await click(cdp, `${header('a-sfx')} .akari-track-header-name`);
        await sleep(300);
        await click(cdp, '[data-akari-ripple-menu]');
        const label = await waitFor('preset popup', () => evalOn(cdp, `document.querySelector('[data-akari-ripple-preset="selected-cut"]')?.textContent`));
        await click(cdp, '[data-akari-ripple-preset="selected-cut"]');
        const after = await waitFor('selected written', async () => { const p = await pairs(); return p['a-sfx'][0] !== null ? p : null; });
        assert.deepEqual(after['a-sfx'], [true, true]);
        for (const id of ['a-bgm', 'v-main', 'v-broll', 'v-telop']) assert.deepEqual(after[id], [false, false], id);
        assert.deepEqual(after.captions, [null, null]);
        await undo(cdp);
        await waitFor('selected undone', async () => (await pairs())['a-sfx'][0] === null);
        return { label, after };
    });
    await run('header_context_menu', async () => {
        await sleep(600);
        await rightClick(cdp, `${header('v-broll')} .akari-track-header-name`);
        const items = await waitFor('context items', () => evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('button')].filter(e=>e.textContent.startsWith('このトラック: '));return b.length?b.map(e=>e.textContent):null})()`));
        await shot(cdp, 'header-context-menu');
        await evalOn(cdp, `[...document.querySelectorAll('button')].find(e=>e.textContent==='このトラック: ずらす').click()`);
        const after = await waitFor('context wrote shift', async () => { const p = await pairs(); return p['v-broll'][0] === false && p['v-broll'][1] === true ? p['v-broll'] : null; });
        await undo(cdp);
        await waitFor('context undone', async () => (await pairs())['v-broll'][0] === null);
        await rightClick(cdp, `${header('captions')} .akari-track-header-name`);
        await sleep(800);
        const captionItems = await evalOn(cdp, `[...document.querySelectorAll('button')].filter(e=>e.textContent.startsWith('このトラック: ')).length`);
        await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await evalOn(cdp, `document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
        return { items, after, captionItems };
    });
    await run('switches_layout', async () => {
        assert.equal(await setPreference(cdp, 'switches'), 'switches');
        const out = {};
        for (const [name, height, scale] of [['switches-20', 20, 1], ['switches-60', 60, 1], ['switches-zoom-3', 60, 3]]) {
            await setHeights(cdp, height, scale);
            const rows = await switchGeometry(cdp);
            await shot(cdp, name);
            for (const row of rows.filter(r => r.switches.length)) {
                assert(!row.overlap, `${name} ${row.id} overlaps`);
                assert(row.nameWidth >= 20, `${name} ${row.id} name ${row.nameWidth}`);
                for (const sw of row.switches) {
                    assert(sw.icon > 0, `${name} ${row.id} ${sw.field} icon collapsed`);
                    assert(sw.hit !== false, `${name} ${row.id} ${sw.field} not hittable`);
                    assert(!sw.clipped, `${name} ${row.id} ${sw.field} clipped by the header column`);
                }
            }
            out[name] = rows;
        }
        assert.equal(await setPreference(cdp, 'tag'), 'tag');
        await setHeights(cdp, 60, 1);
        return out;
    });
    await run('settings_screen', async () => {
        const schema = await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;for(const k of d._map.keys()){let s;try{s=window.theia.container.get(k)}catch{continue}const props=s?.getSchemaProperties?.()??s?.getCombinedSchema?.()?.properties;const p=props?.['akari.timeline.trackRippleDisplay']??(props instanceof Map?props.get('akari.timeline.trackRippleDisplay'):undefined);if(p)return{description:p.description,enum:p.enum,default:p.default}}return null})()`);
        assert(schema && /トラックの詰め方/.test(schema.description), 'schema description missing');
        await evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const key=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');await window.theia.container.get(key).executeCommand('preferences:open');return true})()`);
        const shown = await waitFor('preferences view shows the setting', async () => {
            await evalOn(cdp, `(()=>{const i=document.querySelector('.settings-search-input, .preferences-search-input input, input[placeholder*="設定"], input[placeholder*="Search"]');if(!i)return false;i.focus();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'trackRippleDisplay');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
            await sleep(800);
            return evalOn(cdp, `(()=>{const t=[...document.querySelectorAll('.theia-settings-container, .preferences-editor-widget, [id*="preferences"]')].map(e=>e.innerText).join('\\n');return /詰め方/.test(t)?t.split('\\n').filter(l=>/詰め方|Track Ripple|tag|switches/i.test(l)).slice(0,6):null})()`);
        }, 30000);
        await shot(cdp, 'settings-preferences');
        return { schema, shown };
    });
} catch (error) {
    result.error = String(error?.stack ?? error);
    process.exitCode = 1;
} finally {
    cdp?.close();
    await writeFile(path.join(output, 'results-extra.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ results: path.join(output, 'results-extra.json'), pass: !result.error }));
}
