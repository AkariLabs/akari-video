// L1: インスペクターの色パネル（字幕の色の行から開く・検索・履歴・色を作る窓・ブランドキット・写真の色）と、
// akari.inspector.openColorPanel での item の色（グラデーション・透明）。暗い / 明るいの両テーマ。
// ブランドキットは同じ AKARI_HOME の別プロジェクトでも出ることを、2 回目の起動で確かめる。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from '../../apps/shell/extensions/akari-annotations/evidence/ai-tab-shell/scripts/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const shell = path.join(repo, 'apps/shell');
const scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'libcanvas-k1-l1-')));
const home = path.join(scratch, 'akari-home');
const port = 9552;
const checks = [];
const shots = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); };
const S = JSON.stringify;
const FIND = names => `[...window.theia.container._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&${names.map(n => `typeof k.prototype?.${n}==='function'`).join('&&')})`;
const THEME = `window.theia.container.get(${FIND(['setCurrentTheme', 'getCurrentTheme'])})`;
const WORKSPACE = `window.theia.container.get(${FIND(['tryGetRoots'])})`;
const command = (id, arg) => `(async () => { const C=${FIND(['executeCommand'])};
    const r = await window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `, ${S(arg)}`});
    return r === null || typeof r !== 'object' ? r : true; })()`;
const PANEL = '[data-akari-ui="panel:inspector-color"]';

async function project(name) {
    const workspace = path.join(scratch, name);
    await cp(path.join(repo, 'templates/project-default'), workspace, { recursive: true });
    await mkdir(path.join(workspace, 'assets/still'), { recursive: true });
    await cp(path.join(repo, 'templates/kaisetsu-short/sample-project/assets/dummy-shot.png'), path.join(workspace, 'assets/still/photo.png'));
    const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'photo', path: 'assets/still/photo.png' }],
        tracks: [
            { id: 'visual-main', lane: 'visual', items: [
                { id: 'photo-1', at: 0, duration: 180, source: { kind: 'media', src: 'photo', in: 0, out: 6 } }] },
            // 図形は group の中に置く（今の edit-lint は visual レーン直下の shape を受け付けない）。
            { id: 'visual-shape', lane: 'visual', items: [
                { id: 'group-1', at: 0, duration: 180, source: { kind: 'group' }, items: [
                    { id: 'shape-1', at: 0, duration: 180, source: { kind: 'shape', shape: 'rect', params: { width: 400, height: 240, fill: '#A6A6A6' } } }] }] },
            { id: 'captions-track', lane: 'visual', items: [
                { id: 'captions-bag', at: 0, duration: 180, source: { kind: 'captions', path: 'captions.json', exclude: [] }, items: [] }] }
        ], audio: { narration: [], sfx: [] } };
    await writeFile(path.join(workspace, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await writeFile(path.join(workspace, 'captions.json'), `${JSON.stringify([
        { id: 'c-0001', start: 0.2, end: 5.5, text: '色パネルの確認', speaker: null, sourceRef: null, edited: true, src: 'photo' }
    ], null, 2)}\n`);
    return workspace;
}

async function launch(workspace, profileName) {
    const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const env = { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: path.join(scratch, `theia-config-${profileName}`) };
    const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`,
        `--user-data-dir=${path.join(scratch, `user-data-${profileName}`)}`, '--no-sandbox'], { cwd: shell, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const state = { child, exited: false, output: '' };
    child.stdout.on('data', chunk => { state.output += chunk; });
    child.stderr.on('data', chunk => { state.output += chunk; });
    state.closed = new Promise(resolve => child.once('exit', () => { state.exited = true; resolve(); }));
    let cdp;
    for (let attempt = 0; attempt < 240 && !cdp; attempt++) {
        if (state.exited) throw new Error('Electron exited before UI appeared');
        try {
            const target = (await listTargets(port)).find(row => row.type === 'page');
            if (target) {
                cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
                if (!await evalOn(cdp, '!!window.theia?.container')) { cdp.close(); cdp = undefined; }
            }
        } catch { cdp = undefined; }
        if (!cdp) await sleep(500);
    }
    assert.ok(cdp, 'Electron UI did not load');
    state.cdp = cdp;
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
    await cdp.send('Page.bringToFront');
    return state;
}

async function stop(state) {
    state?.cdp?.close();
    if (!state || state.exited) return;
    state.child.kill('SIGTERM');
    await Promise.race([state.closed, sleep(15000)]);
    if (!state.exited) state.child.kill('SIGKILL');
    await Promise.race([state.closed, sleep(5000)]);
}

const wait = async (cdp, expression, label, ms = 60000) => {
    const until = Date.now() + ms;
    let last;
    while (Date.now() < until) {
        last = await evalOn(cdp, expression).catch(error => { last = String(error); return undefined; });
        if (last) return last;
        await sleep(250);
    }
    throw new Error(`Timed out: ${label}`);
};
const centerOf = (cdp, selector) => wait(cdp, `(() => { const e=document.querySelector(${S(selector)});
    if (!e) return null; e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect();
    return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,l:r.left,t:r.top} : null; })()`, selector);
const click = async (cdp, selector) => { const p = await centerOf(cdp, selector); await realClick(cdp, p.x, p.y); await sleep(250); };
const clickButtonText = async (cdp, scope, text) => {
    const p = await wait(cdp, `(() => { const s=document.querySelector(${S(scope)}); const b=s&&[...s.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(text)});
        if (!b) return null; b.scrollIntoView({block:'nearest'}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`, text);
    await realClick(cdp, p.x, p.y);
    await sleep(250);
};
const key = async (cdp, keyName, code, vk) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk });
};
const drag = async (cdp, from, to) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8, button: 'left', buttons: 1 });
        await sleep(30);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
};
// インスペクターの列だけを撮る（1 枚を小さく保つ）。
const shot = async (cdp, name, selector = '[data-akari-ui="panel:inspector"]') => {
    await sleep(400);
    const r = await evalOn(cdp, `(() => { const e=document.querySelector(${S(selector)}); if (!e) return null; const r=e.getBoundingClientRect();
        return {x:Math.max(0,r.left),y:Math.max(0,r.top),width:Math.min(r.width, innerWidth-r.left),height:Math.min(r.height, innerHeight-r.top)}; })()`);
    const params = { format: 'png', ...(r ? { clip: { ...r, scale: 1 } } : {}) };
    const { data } = await cdp.send('Page.captureScreenshot', params);
    await writeFile(path.join(here, name), Buffer.from(data, 'base64'));
    shots.push(name);
};
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const untilFile = async (fn, label, ms = 20000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const value = await fn().catch(() => undefined);
        if (value) return value;
        await sleep(250);
    }
    throw new Error(`Timed out: ${label}`);
};
const setTheme = async (cdp, id) => {
    await evalOn(cdp, `(()=>{${THEME}.setCurrentTheme(${S(id)},true);return true})()`);
    await wait(cdp, `${THEME}.getCurrentTheme().id===${S(id)}`, `theme ${id}`);
    await sleep(1500);
};
async function openTimelineAndSelectCaption(cdp) {
    await wait(cdp, `(() => { const e=document.querySelector('.theia-preload');
        return !e || getComputedStyle(e).display==='none' || Number(getComputedStyle(e).opacity)===0; })()`, 'workbench ready', 180000);
    await wait(cdp, `${command('akari.annotations.open')}.then(()=>true)`, 'timeline command', 300000);
    await wait(cdp, `!!document.querySelector('[data-akari-ui="timeline:cut:0"]')`, 'timeline cut', 120000);
    await evalOn(cdp, command('akari.inspector.open'));
    await wait(cdp, `!!document.querySelector('[data-akari-ui="panel:inspector"]')`, 'inspector');
    const editUri = await evalOn(cdp, `${WORKSPACE}.tryGetRoots()[0].resource.resolve('edit.json').toString()`);
    await wait(cdp, `(async () => { await ${command('akari.timeline.selectCaptions', { editUri: '__URI__', captionIds: ['c-0001'] }).replace('"__URI__"', S(editUri))};
        return !!document.querySelector('[data-akari-field="caption-color"]'); })()`, 'caption selected');
    await evalOn(cdp, command('akari.inspector.open', { tabId: 'text' }));
    await wait(cdp, `!!document.querySelector('[data-akari-field="caption-color"] [data-akari-color-open]')`, 'caption color swatch');
}
const panelText = cdp => evalOn(cdp, `(document.querySelector(${S(PANEL)})?.textContent||'').replace(/\\s+/g,' ')`);

let app;
const result = { checks, shots };
try {
    const workspaceA = await project('project-a');
    const workspaceB = await project('project-b');
    app = await launch(workspaceA, 'a');
    let cdp = app.cdp;
    await setTheme(cdp, 'dark');
    await openTimelineAndSelectCaption(cdp);

    // 1. 色の行の丸 → 列が色パネルに切り替わる
    await click(cdp, '[data-akari-field="caption-color"] [data-akari-color-open]');
    await wait(cdp, `!!document.querySelector(${S(PANEL)})`, 'color panel');
    const opened = await panelText(cdp);
    check('row swatch switches the inspector column to the color panel', opened.includes('文字の色') && opened.includes('デフォルトの単色'), opened.slice(0, 160));
    check('text panel has no gradient section', !opened.includes('デフォルトのグラデーション'), 'no gradient');
    check('text panel has no transparent dot', !await evalOn(cdp, `!!document.querySelector('${PANEL} [aria-label^="透明"]')`), 'no transparent');
    check('tabs and rows are hidden while the panel is open', !await evalOn(cdp, `!!document.querySelector('[data-akari-field="caption-color"]')`), 'rows hidden');
    const solidCount = await evalOn(cdp, `document.querySelectorAll('${PANEL} .akari-color-sec + .akari-color-grid').length`);
    await shot(cdp, '01-panel-dark.png');
    // すべて表示 → 42 色
    const solidSection = `[...document.querySelectorAll('${PANEL} .akari-color-sec')].find(s=>s.textContent.includes('デフォルトの単色'))`;
    const countSolids = `(${solidSection}).nextElementSibling.querySelectorAll('button').length`;
    const collapsed = await evalOn(cdp, countSolids);
    await clickButtonText(cdp, PANEL, 'すべて表示');
    const expanded = await evalOn(cdp, countSolids);
    check('default solids: 28 → 42 with すべて表示', collapsed === 28 && expanded === 42, { collapsed, expanded, solidCount });
    await clickButtonText(cdp, PANEL, 'たたむ');

    // 2. 検索「青」→ 青系 → 押すと反映・パネルは開いたまま
    await click(cdp, `${PANEL} input.akari-color-search`);
    await cdp.send('Input.insertText', { text: '青' });
    await wait(cdp, `document.querySelectorAll('${PANEL} .akari-color-grid button').length >= 6`, 'blue hits');
    const hits = await evalOn(cdp, `[...document.querySelectorAll('${PANEL} .akari-color-grid button')].map(b=>b.title)`);
    check('search 青 lists blue colors', hits.length >= 6, hits);
    await shot(cdp, '02-search-blue.png');
    const blueDot = `${PANEL} .akari-color-grid button[title="空色"]`;
    await click(cdp, blueDot);
    const captionsFile = path.join(workspaceA, 'captions.json');
    const blueWritten = await untilFile(async () => (await readFile(captionsFile, 'utf8')).includes('#38B6FF'), 'caption color written');
    check('clicking a found color writes the caption color', blueWritten, '#38B6FF');
    check('panel stays open after applying', await evalOn(cdp, `!!document.querySelector(${S(PANEL)})`), 'open');
    await wait(cdp, `!!document.querySelector('${blueDot}.is-current')`, 'current mark');
    check('applied color gets the current mark', true, '空色');
    // 色番号の検索
    await evalOn(cdp, `(() => { const i=document.querySelector('${PANEL} input.akari-color-search'); i.focus(); i.select(); return true; })()`);
    await cdp.send('Input.insertText', { text: '#00c4cc' });
    await wait(cdp, `(document.querySelector(${S(PANEL)})?.textContent||'').includes('この色')`, 'hex search');
    check('search #00c4cc shows that color', await evalOn(cdp, `!!document.querySelector('${PANEL} button[title="#00C4CC"]')`), '#00C4CC');
    await key(cdp, 'Escape', 'Escape', 27);
    await wait(cdp, `(document.querySelector(${S(PANEL)})?.textContent||'').includes('デフォルトの単色')`, 'search cleared');

    // 3. 虹の ＋ → 色の四角をドラッグ → 離したときに書く
    await click(cdp, `${PANEL} button.is-rainbow`);
    await wait(cdp, `!!document.querySelector('${PANEL} .akari-color-sv')`, 'picker');
    check('text picker has no gradient tab', !await evalOn(cdp, `!!document.querySelector('${PANEL} .akari-color-tabs')`), 'solid only');
    const sv = await centerOf(cdp, `${PANEL} .akari-color-sv`);
    const before = await readFile(captionsFile, 'utf8');
    await drag(cdp, { x: sv.l + sv.w * 0.2, y: sv.t + sv.h * 0.2 }, { x: sv.l + sv.w * 0.85, y: sv.t + sv.h * 0.3 });
    const afterDrag = await untilFile(async () => { const t = await readFile(captionsFile, 'utf8'); return t !== before ? t : undefined; }, 'drag write');
    const draggedColor = /"color":\s*"(#[0-9A-F]{6})"/u.exec(afterDrag)?.[1];
    check('dragging the color square writes one color on release', !!draggedColor && draggedColor !== '#38B6FF', draggedColor);
    const historyTitles = await evalOn(cdp, `[...document.querySelectorAll('${PANEL} .akari-color-grid')][0].querySelectorAll('button[title$="（履歴）"]').length`);
    check('history row shows used colors', historyTitles >= 2, historyTitles);
    await shot(cdp, '03-picker-dark.png');

    // 4. ブランドカラーを追加（AKARI_HOME/brand-kit.json）
    await clickButtonText(cdp, PANEL, '＋ ブランドカラーを追加');
    const brand = await untilFile(async () => { const doc = await readJson(path.join(home, 'brand-kit.json')); return doc.colors?.length ? doc : undefined; }, 'brand kit');
    check('brand color is saved to AKARI_HOME/brand-kit.json', brand.colors.includes(draggedColor), brand);

    // 5. 写真の色（置いた写真から 5 色）・このデザインの色
    await wait(cdp, `document.querySelectorAll('${PANEL} .akari-color-photo button').length === 5`, 'photo colors', 30000);
    const photo = await evalOn(cdp, `[...document.querySelectorAll('${PANEL} .akari-color-photo button')].map(b=>b.title)`);
    check('photo colors: 5 colors from the placed photo', photo.length === 5 && photo.every(t => /^#[0-9A-F]{6}$/u.test(t)), photo);
    const designText = await panelText(cdp);
    check('design colors section lists colors used in this video', designText.includes('このデザインの色'), 'このデザインの色');
    await evalOn(cdp, `document.querySelector('${PANEL} .akari-color-photo')?.scrollIntoView({block:'center'}), true`);
    await shot(cdp, '04-brand-photo-dark.png');

    // 6. 戻る → 元の列
    await click(cdp, `${PANEL} button.akari-color-back`);
    await wait(cdp, `!document.querySelector(${S(PANEL)}) && !!document.querySelector('[data-akari-field="caption-color"]')`, 'back');
    check('back returns to the inspector rows', true, 'rows');

    // 7a. item の色（図形の塗り）を openColorPanel で: 単色・透明は edit.json へ。
    //     グラデーションは今の図形の契約（v0 = 文字列）では保存できないので、edit.json を壊さずに断る。
    const opened2 = await evalOn(cdp, command('akari.inspector.openColorPanel', {
        target: { kind: 'item', itemId: 'shape-1', path: 'source.params.fill' }, allowGradient: true, allowTransparent: true, title: '塗りの色' }));
    check('openColorPanel command opens the panel for an item', opened2 === true, opened2);
    await wait(cdp, `(document.querySelector(${S(PANEL)})?.textContent||'').includes('デフォルトのグラデーション')`, 'gradient panel');
    check('item panel shows the transparent dot', await evalOn(cdp, `!!document.querySelector('${PANEL} button[aria-label^="透明"]')`), 'transparent');
    const editFile = path.join(workspaceA, 'edit.json');
    const fillOf = async () => (await readJson(editFile)).tracks[1].items[0].items[0].source.params.fill;
    await click(cdp, `${PANEL} button[title="赤"]`);
    await untilFile(async () => (await fillOf()) === '#FF3131', 'solid fill');
    check('solid color is written to the item fill', true, '#FF3131');
    await click(cdp, `${PANEL} button[aria-label^="透明"]`);
    await untilFile(async () => (await fillOf()) === 'none', 'transparent');
    check('transparent writes fill: none', true, 'none');
    await shot(cdp, '05-item-fill-dark.png');
    const firstGradient = `(() => { const s=[...document.querySelectorAll('${PANEL} .akari-color-sec')].find(x=>x.textContent.includes('デフォルトのグラデーション'));
        const b=s?.nextElementSibling?.querySelector('button'); if (!b) return null; b.scrollIntoView({block:'nearest'}); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`;
    const gp = await wait(cdp, firstGradient, 'default gradient');
    await realClick(cdp, gp.x, gp.y);
    const refusal = await wait(cdp, `(() => { const n=[...document.querySelectorAll('[data-akari-ui="panel:inspector"] > div')].find(d=>d.textContent.trim().startsWith('この項目には、まだグラデーション') && getComputedStyle(d).display!=='none'); return n ? n.textContent : null; })()`, 'refusal notice');
    const editStore = createRequire(import.meta.url)(path.join(repo, 'packages/edit-store/lib/index.js'));
    const docAfter = await readJson(editFile);
    let readable = true;
    try { editStore.readEditV2(docAfter); } catch { readable = false; }
    check('gradient on the v0 shape is refused with a notice and edit.json stays valid', docAfter.tracks[1].items[0].items[0].source.params.fill === 'none' && readable, refusal);
    const toggled = await evalOn(cdp, command('akari.inspector.openColorPanel', {
        target: { kind: 'item', itemId: 'shape-1', path: 'source.params.fill' }, allowGradient: true, allowTransparent: true, toggle: true }));
    await wait(cdp, `!document.querySelector(${S(PANEL)})`, 'toggle closes');
    check('toggle: the same target closes the panel', toggled === false, toggled);

    // 7b. 色を作る窓のグラデーション（同じ部品 ColorPanelView を、アプリの中に値をメモリで持つ検証用の枠で開く）。
    //     図形の契約がグラデーションを受け付けた後は 7a と同じ経路で edit.json へ書く。
    const bundle = path.join(scratch, 'color-panel.iife.js');
    await new Promise((resolve, reject) => {
        const esbuild = spawn(path.join(shell, 'node_modules/.bin/esbuild'), [
            path.join(shell, 'extensions/akari-annotations/lib/browser/inspector/color-panel.js'),
            '--bundle', '--format=iife', '--global-name=K1ColorPanel', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'inherit' });
        esbuild.once('exit', code => code === 0 ? resolve() : reject(new Error(`esbuild ${code}`)));
    });
    await evalOn(cdp, `${await readFile(bundle, 'utf8')}; true`);
    const HARNESS = '#k1-harness';
    await evalOn(cdp, `(() => { const { ColorPanelView } = K1ColorPanel; const r=document.querySelector('[data-akari-ui="panel:inspector"]').getBoundingClientRect();
        const host=document.createElement('div'); host.id='k1-harness'; host.className='akari-inspector-widget';
        Object.assign(host.style, { position:'fixed', left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px', zIndex:'9999', overflow:'auto',
            padding:'8px', boxSizing:'border-box', background:'var(--akari-bg)' });
        document.body.appendChild(host); const view=new ColorPanelView(); host.appendChild(view.element);
        const state=window.__k1h={ value:'#A6A6A6', writes:[], history:[] };
        const ctx=()=>({ title:'塗りの色', current:state.value, allowGradient:true, allowTransparent:true, history:state.history, designColors:[], brandColors:[], photos:[],
            onApply:(p,o)=>{ if(!o.final) return; state.value=p; state.writes.push(p); state.history=[p,...state.history.filter(x=>JSON.stringify(x)!==JSON.stringify(p))].slice(0,8); view.update(ctx()); },
            onClose(){}, onBrandAdd(){}, onBrandRemove(){}, notice(){} });
        view.update(ctx()); return true; })()`);
    const hv = () => evalOn(cdp, 'window.__k1h.value');
    await click(cdp, `${HARNESS} button.is-rainbow`);
    await clickButtonText(cdp, `${HARNESS} .akari-color-tabs`, 'グラデーション');
    await click(cdp, `${HARNESS} [data-cp-add-stop]`);
    const three = await hv();
    check('gradient: ＋ adds a color (3 stops)', three?.stops?.length === 3, three);
    check('gradient: the added color opens its small window', await evalOn(cdp, `!!document.querySelector('${HARNESS} .akari-color-stopbox')`), 'stopbox');
    await key(cdp, 'Escape', 'Escape', 27);
    await wait(cdp, `!document.querySelector('${HARNESS} .akari-color-stopbox')`, 'Esc');
    check('small window: Esc closes', true, 'closed');
    await click(cdp, `${HARNESS} [data-cp-stop="1"]`);
    await wait(cdp, `!!document.querySelector('${HARNESS} .akari-color-stopbox')`, 'open 1');
    await click(cdp, `${HARNESS} [data-cp-stop="1"]`);
    await wait(cdp, `!document.querySelector('${HARNESS} .akari-color-stopbox')`, 'same dot closes');
    check('small window: the same dot again closes', true, 'closed');
    await click(cdp, `${HARNESS} [data-cp-style="3"]`);
    const radial = await hv();
    check('style 放射 makes a 3-color radial gradient', radial?.type === 'radial' && radial.stops.length === 3, radial);
    await click(cdp, `${HARNESS} [data-cp-stop="1"]`);
    await wait(cdp, `!!document.querySelector('${HARNESS} .akari-color-stopbox')`, 'open 1 again');
    check('trash is enabled with 3 colors', await evalOn(cdp, `document.querySelector('${HARNESS} [data-cp-action="remove-stop"]').disabled === false`), 'enabled');
    const alpha = await centerOf(cdp, `${HARNESS} .akari-color-alpha`);
    await drag(cdp, { x: alpha.l + alpha.w * 0.95, y: alpha.y }, { x: alpha.l + alpha.w * 0.5, y: alpha.y });
    const alphaValue = await hv();
    check('alpha bar sets #RRGGBBAA on that color only', alphaValue.stops[1].color.length === 9 && alphaValue.stops[0].color.length === 7, alphaValue.stops);
    check('dragging inside keeps the small window open', await evalOn(cdp, `!!document.querySelector('${HARNESS} .akari-color-stopbox')`), 'open');
    const writesBefore = await evalOn(cdp, 'window.__k1h.writes.length');
    const stopSv = await centerOf(cdp, `${HARNESS} .akari-color-stopbox .akari-color-sv`);
    await drag(cdp, { x: stopSv.l + stopSv.w * 0.3, y: stopSv.t + stopSv.h * 0.3 }, { x: stopSv.l + stopSv.w * 0.8, y: stopSv.t + stopSv.h * 0.2 });
    check('a drag writes once on release', (await evalOn(cdp, 'window.__k1h.writes.length')) === writesBefore + 1, writesBefore);
    await shot(cdp, '06-gradient-window-dark.png', HARNESS);
    await click(cdp, `${HARNESS} .akari-color-head h3`);
    await wait(cdp, `!document.querySelector('${HARNESS} .akari-color-stopbox')`, 'outside');
    check('small window: clicking outside closes', true, 'closed');
    await click(cdp, `${HARNESS} [data-cp-stop="0"]`);
    await click(cdp, `${HARNESS} [data-cp-action="remove-stop"]`);
    const two = await hv();
    check('trash removes that color', two.stops.length === 2, two.stops);
    await click(cdp, `${HARNESS} [data-cp-stop="0"]`);
    check('trash is disabled with 2 colors', await evalOn(cdp, `document.querySelector('${HARNESS} [data-cp-action="remove-stop"]').disabled === true`), 'disabled');
    await key(cdp, 'Escape', 'Escape', 27);
    for (let i = 0; i < 4; i++) {
        if (!await evalOn(cdp, `!!document.querySelector('${HARNESS} [data-cp-add-stop]')`)) break;
        await click(cdp, `${HARNESS} [data-cp-add-stop]`);
        await key(cdp, 'Escape', 'Escape', 27);
    }
    const five = await hv();
    check('up to 5 colors (＋ disappears at 5)', five.stops.length === 5 && !await evalOn(cdp, `!!document.querySelector('${HARNESS} [data-cp-add-stop]')`), five.stops.length);
    const styleTitles = await evalOn(cdp, `[...document.querySelectorAll('${HARNESS} [data-cp-style]')].map(b=>b.title)`);
    check('5 styles: 横・縦・斜め ↘・放射・斜め ↗', JSON.stringify(styleTitles) === JSON.stringify(['横', '縦', '斜め ↘', '放射', '斜め ↗']), styleTitles);
    const histCount = await evalOn(cdp, `[...document.querySelectorAll('${HARNESS} .akari-color-grid')][0].querySelectorAll('button[title$="（履歴）"]').length`);
    check('history holds gradients as single dots (max 8)', histCount >= 1 && histCount <= 8, histCount);

    // 8. 明るいテーマ
    await setTheme(cdp, 'light');
    await click(cdp, `${HARNESS} [data-cp-stop="2"]`);
    await shot(cdp, '07-gradient-window-light.png', HARNESS);
    await evalOn(cdp, `document.getElementById('k1-harness')?.remove(), true`);
    await click(cdp, '[data-akari-field="caption-color"] [data-akari-color-open]');
    await wait(cdp, `!!document.querySelector(${S(PANEL)})`, 'panel light');
    await click(cdp, `${PANEL} button.is-rainbow`);
    await shot(cdp, '08-text-panel-light.png');
    const lightBg = await evalOn(cdp, `getComputedStyle(document.querySelector('${PANEL} .akari-color-picker')).backgroundColor`);
    const darkish = /rgb\((\d+), (\d+), (\d+)/u.exec(lightBg)?.slice(1).map(Number) ?? [0, 0, 0];
    check('light theme repaints the panel with theme tokens', darkish.reduce((a, b) => a + b, 0) / 3 > 180, lightBg);
    await setTheme(cdp, 'dark');
    await stop(app);
    app = undefined;

    // 9. 別のプロジェクト（同じ利用者）でもブランドキットが出る
    app = await launch(workspaceB, 'b');
    cdp = app.cdp;
    await openTimelineAndSelectCaption(cdp);
    await click(cdp, '[data-akari-field="caption-color"] [data-akari-color-open]');
    const brandDot = `(() => { const s=[...document.querySelectorAll('${PANEL} .akari-color-sec')].find(x=>x.textContent.includes('ブランドキット'));
        const g=s?.nextElementSibling; return g && g.classList.contains('akari-color-grid') ? [...g.querySelectorAll('button')].map(b=>b.title) : null; })()`;
    const brandInB = await wait(cdp, brandDot, 'brand kit in project B', 30000);
    check('brand color shows up in another project', brandInB.includes(draggedColor), brandInB);
    await evalOn(cdp, `[...document.querySelectorAll('${PANEL} .akari-color-sec')].find(x=>x.textContent.includes('ブランドキット'))?.scrollIntoView({block:'start'}), true`);
    await shot(cdp, '09-brand-other-project.png');
} catch (error) {
    checks.push({ name: 'L1 failure', pass: false, detail: String(error?.stack ?? error).replaceAll(repo, '<WORKTREE>').replaceAll(scratch, '<TMP>') });
    process.exitCode = 1;
} finally {
    await stop(app);
    const sanitized = JSON.parse(JSON.stringify(result).replaceAll(repo, '<WORKTREE>').replaceAll(scratch, '<TMP>'));
    await writeFile(path.join(here, 'results.json'), `${JSON.stringify({ ...sanitized, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length }, null, 2)}\n`);
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });
}
