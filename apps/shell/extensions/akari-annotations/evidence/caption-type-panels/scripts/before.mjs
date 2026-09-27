#!/usr/bin/env node
// 手順 0（BEFORE）の実機記録（ラッパー作成の検証スクリプト。判定はしない）。
// (a) 上のメニューのフォントの窓・スタイルの窓・インスペクターの「文字」欄 (b) ライブラリのテキストスタイルのカード、
// および Theia 側 document に書体が @font-face として登録されているか（document.fonts）を記録する。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node before.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9631）
import { execFileSync } from 'node:child_process';
import { cp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { LIB_CARDS, OUT, PORT, REPO, S, clickSel, dismissToasts, openProject, openTextstyleShelf, paths, shooter, start } from './common.mjs';

const p = paths(process.argv[2]);
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim() };
const shot = shooter(p, 'before');
await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await dismissToasts(cdp);
    // Theia 側 document の書体（同梱 8 書体が @font-face で読めるか）
    rec.theiaDocumentFonts = await evalOn(cdp, `(async()=>{const fams=['Dela Gothic One','BIZ UDGothic','DotGothic16','Klee One','M PLUS Rounded 1c','Noto Serif JP','Shippori Mincho','Zen Maru Gothic','Noto Sans JP','Reggae One'];const faces=[...document.fonts].map(f=>f.family.replace(/"/g,''));return{fontFaceCount:faces.length,families:[...new Set(faces)].slice(0,40),check:Object.fromEntries(fams.map(f=>[f,{declared:faces.includes(f),check:document.fonts.check('20px "'+f+'"')}]))}})()`);
    // (a-1) インスペクターの「文字」欄（タイムラインの c-0001 のチップを実クリックで選ぶ = 上のメニューも出る）
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]');
    await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.inspector.open');return true})()`);
    await sleep(2000);
    rec.inspectorStyleSection = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');if(!root)return null;const secs=[...root.querySelectorAll('.akari-inspector-section')];const s=secs.find(x=>/^\\s*文字/.test(x.querySelector('.akari-inspector-section-header')?.textContent||''));if(s)s.scrollIntoView({block:'start'});return{sections:secs.map(x=>(x.querySelector('.akari-inspector-section-header')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,30)),styleText:s?s.innerText.replace(/\\n+/g,' / ').slice(0,400):null,fontControls:s?[...s.querySelectorAll('select, input[list], [role=combobox]')].map(x=>({tag:x.tagName,aria:x.getAttribute('aria-label'),options:x.options?[...x.options].map(o=>o.textContent).slice(0,50):null})):null}})()`);
    await sleep(400);
    rec.shots = [await shot(cdp, '01-inspector-text-section')];
    // (a-2) 上のメニュー
    rec.contextBarItems = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-bar-item]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getAttribute('data-akari-bar-item')+' | '+(e.getAttribute('aria-label')||''))`);
    await clickSel(cdp, '[data-akari-bar-item="captionFont"]');
    await sleep(900);
    rec.fontWindow = await evalOn(cdp, `(()=>{const w=document.querySelector('[data-akari-ui="preview-context-window"]');return{window:w?.dataset.akariWindow??null,choices:[...document.querySelectorAll('[data-caption-font]')].map(b=>({family:b.dataset.captionFont,renderedFont:getComputedStyle(b).fontFamily.slice(0,60)}))}})()`);
    rec.shots.push(await shot(cdp, '02-font-window'));
    await clickSel(cdp, '[data-akari-bar-item="captionPreset"]');
    await sleep(900);
    rec.styleWindow = await evalOn(cdp, `(()=>{const w=document.querySelector('[data-akari-ui="preview-context-window"]');return{window:w?.dataset.akariWindow??null,choices:[...document.querySelectorAll('[data-caption-preset]')].map(b=>({key:b.dataset.captionPreset,label:b.textContent.trim(),color:getComputedStyle(b).color,bg:getComputedStyle(b).backgroundColor}))}})()`);
    rec.shots.push(await shot(cdp, '03-style-window'));
    // (b) ライブラリのテキストスタイルのカード
    await openTextstyleShelf(cdp);
    rec.libraryCards = await evalOn(cdp, LIB_CARDS);
    rec.shots.push(await shot(cdp, '04-library-textstyle-cards'));
    rec.status = 'ok';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(rec, null, 2)}\n`);
}
console.log(S({ status: rec.status, error: rec.error }));
