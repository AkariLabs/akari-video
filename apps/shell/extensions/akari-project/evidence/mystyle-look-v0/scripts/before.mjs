#!/usr/bin/env node
// 手順 0（BEFORE）の実機記録: ライブラリのテキストスタイルの棚・インスペクターの字幕の見出し帯（⋯）・プレビューのミニパネル・
// ライブラリの置き場の解決。ラッパー作成の検証スクリプト。判定はしない。
// 使い方: node before.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9485）
import { execFileSync } from 'node:child_process';
import { cp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evalOn, realClick, screenshot } from './cdp-lib.mjs';
import { command, launch, sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { openProject } from './l1-common.mjs';
import { PLATE_CENTER, TOOLS, calibrate, toPage, view } from './view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
const WORK = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9485);
const PJ = path.join(WORK, 'ws');
const ISO = path.join(WORK, 'iso');
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim() };
const shot = async (cdp, name) => { const f = path.join(WORK, `${name}.png`); await screenshot(cdp, f); execFileSync('sips', ['-Z', '1120', f, '--out', path.join(OUT, `before-${name}.png`)], { stdio: 'ignore' }); };
const S = JSON.stringify;

await rm(PJ, { recursive: true, force: true });
await cp(path.join(WORK, 'fixture', 'spoken'), PJ, { recursive: true });
process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
const shellDir = path.join(REPO, 'apps', 'shell');
const session = await launch({ shellDir, electron: path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), project: PJ, port: PORT, isoDir: ISO });
const cdp = session.cdp;
try {
    await openProject(session, PJ, 1, PORT);
    // 1. ライブラリの置き場（アプリと同じ env で creator-root の解決関数を呼ぶ）
    const creator = await import(pathToFileURL(path.join(REPO, 'packages', 'creator-root', 'src', 'index.mjs')).href);
    const env = { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home') }; delete env.AKARI_LIBRARY_ROOT; delete env.AKARI_CREATOR_ROOT;
    const roots = creator.resolveAssetLibraryRoots(env);
    rec.libraryRoots = { isolatedEnv: { write: roots.write.replace(ISO, '<iso>'), read: roots.read.map(r => r.replace(ISO, '<iso>')) },
        rule: 'AKARI_LIBRARY_ROOT → $AKARI_HOME/library-location.json の root（state migrating|done）→ previousRoot → $AKARI_HOME/assets' };
    // 2. インスペクターの字幕の見出し帯（c-0001 を選ぶ）
    await evalOn(cdp, command('akari.timeline.selectCaptions', { editUri: `file://${path.join(PJ, 'edit.json')}`, captionIds: ['c-0001'] }));
    await evalOn(cdp, command('akari.inspector.open'));
    await sleep(1500);
    rec.inspectorHeader = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');if(!root)return null;const h=root.querySelector('.akari-inspector-selection-header, [class*="selection-header"]');const vis=e=>e.getBoundingClientRect().width>0;const r=(h||root).getBoundingClientRect();return{headerText:(h?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,160),headerRect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},buttons:[...(h||root).querySelectorAll('button, [role="button"]')].filter(vis).slice(0,20).map(b=>({text:(b.textContent||'').trim().slice(0,30),title:b.getAttribute('title'),aria:b.getAttribute('aria-label'),ui:b.getAttribute('data-akari-ui')})),moreButtons:[...root.querySelectorAll('button, [role="button"]')].filter(b=>vis(b)&&/⋯|…|その他|more/i.test((b.textContent||'')+(b.getAttribute('title')||'')+(b.getAttribute('aria-label')||''))).map(b=>({text:(b.textContent||'').trim().slice(0,30),title:b.getAttribute('title'),aria:b.getAttribute('aria-label'),ui:b.getAttribute('data-akari-ui'),cls:String(b.className).slice(0,80)}))}})()`);
    await shot(cdp, '01-inspector-header');
    // ⋯ があれば開いて中身を記録
    const more = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');const b=[...root.querySelectorAll('button, [role="button"]')].find(b=>b.getBoundingClientRect().width>0&&/⋯|…|その他|more/i.test((b.textContent||'')+(b.getAttribute('title')||'')+(b.getAttribute('aria-label')||'')));if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (more) {
        await realClick(cdp, more.x, more.y); await sleep(900);
        rec.inspectorMoreMenu = await evalOn(cdp, `[...document.querySelectorAll('.lm-Menu .lm-Menu-itemLabel, [role="menu"] [role="menuitem"], .akari-menu-item')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())`);
        await shot(cdp, '02-inspector-more-menu');
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(500);
    } else rec.inspectorMoreMenu = null;
    // 3. プレビューのミニパネル（字幕をプレビュー上で実クリックして選ぶ）
    const v = await view(PORT);
    await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(PJ, 'edit.json')}`, time: 4 }));
    await sleep(1500);
    rec.toolsAfterTimelineSelect = await v.eval(TOOLS);
    const off = await calibrate(cdp, v);
    const center = await waitEval(v.cdp, PLATE_CENTER('c-0002'), { label: 'plate c-0002' }).catch(() => null) ?? await v.eval(PLATE_CENTER('c-0002'));
    if (center) { const p = toPage(off, center); await realClick(cdp, p.x, p.y); await sleep(1200); }
    rec.previewTools = await v.eval(TOOLS);
    await shot(cdp, '03-preview-mini-panel');
    v.close();
    // 4. ライブラリのテキストスタイルの棚
    const libTab = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ライブラリ'&&e.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realClick(cdp, libTab.x, libTab.y); await sleep(2500);
    await shot(cdp, '04-library-home');
    const det = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-library-details-toggle]');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,expanded:b.getAttribute('aria-expanded')}})()`);
    if (det && det.expanded !== 'true') { await realClick(cdp, det.x, det.y); await sleep(1200); }
    rec.libraryCategories = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-library-category]')].map(e=>e.getAttribute('data-akari-library-category')+' | '+e.textContent.replace(/\\s+/g,' ').trim().slice(0,60))`);
    const cat = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-library-category=textstyle]');if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,text:b.textContent.trim().slice(0,120)}})()`);
    rec.libraryHomeTextstyleTile = cat?.text ?? null;
    await shot(cdp, '04b-library-details');
    if (cat) { await realClick(cdp, cat.x, cat.y); await sleep(2500); }
    rec.textstyleShelf = await evalOn(cdp, `(()=>{const cards=[...document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]')];const txt=e=>(e?.textContent||'').replace(/\\s+/g,' ').trim();return{count:cards.length,ids:cards.map(c=>c.getAttribute('data-akari-catalog-preset-item')),sections:[...document.querySelectorAll('h1,h2,h3,h4,[class*="section-title"],[class*="heading"]')].filter(e=>e.getBoundingClientRect().width>0).map(txt).filter(Boolean).slice(0,12),myStyle:/マイスタイル/.test(document.body.innerText)}})()`);
    await shot(cdp, '05-library-textstyle-shelf');
    rec.status = 'ok';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(rec, null, 2)}\n`);
}
console.log(S({ status: rec.status, error: rec.error }));
