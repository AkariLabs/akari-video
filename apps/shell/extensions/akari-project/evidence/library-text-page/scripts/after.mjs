#!/usr/bin/env node
// 手順 4（AFTER）の実機判定（ラッパー作成の検証スクリプト）。
// (a) T → テキストのページ（スタイル側）(b) フォント側 (c) カードを押して選択中の字幕に当たる
// (d) カードをプレビューへドラッグして置ける (e) 「＋ 文字を置く」・T のドラッグ (f) 編集パネルのフォントの行 → フォントパネル
// 使い方: node gen-fixture.mjs <作業用>/fixture && node after.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9635）
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, key, openProject, paths, shooter, start } from './common.mjs';

const p = paths(process.argv[2]);
const t0 = Date.now();
const rec = { phase: 'after', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: {} };
const shot = shooter(p, 'after');
const check = (name, pass, detail) => { rec.checks[name] = { pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }; };
const readCaptions = async () => JSON.parse(await readFile(path.join(p.PJ, 'captions.json'), 'utf8'));
const readEdit = async () => JSON.parse(await readFile(path.join(p.PJ, 'edit.json'), 'utf8'));
const exec = (id, args) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${S(id)}${args === undefined ? '' : `,${S(args)}`});return true})()`;
const PAGE = `(()=>{const pg=document.querySelector('[data-akari-library-text-look-page]');if(!pg)return{open:false,home:Boolean(document.querySelector('[data-akari-library-home]'))};
 const tabs=[...pg.querySelectorAll('[role=tab]')].map(t=>({label:t.textContent.trim(),selected:t.getAttribute('aria-selected')}));
 const sections=[...pg.querySelectorAll('[data-akari-text-look-section]')].map(s=>s.getAttribute('data-akari-text-look-section'));
 const styleSec=pg.querySelector('[data-akari-text-look-section="style"]');
 const headings=[...pg.querySelectorAll('[data-akari-text-look-section] > div')].filter(d=>/—/.test(d.textContent)&&d.children.length<=1).map(d=>d.textContent.replace(/\\s+/g,' ').trim());
 const sw=pg.querySelector('[role=tablist]');
 return{open:true,tab:pg.getAttribute('data-akari-library-text-tab'),header:pg.firstElementChild.querySelector('strong')?.textContent,back:Boolean(pg.querySelector('[data-akari-library-back]')),
  placeButton:pg.querySelector('[data-akari-library-place-text]')?.textContent.trim()??null,tabs,sections,headings,
  switchRadius:sw?getComputedStyle(sw).borderRadius:null,
  styleCards:styleSec?styleSec.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]').length:0,
  textanimCardsInStyle:styleSec?styleSec.querySelectorAll('[data-akari-catalog-preset-item^="textanim/"]').length:0,
  myStyleCards:styleSec?styleSec.querySelectorAll('[data-akari-my-style-card]').length:0,
  fontSpecimens:pg.querySelectorAll('[data-akari-text-look-section="font"] [data-akari-font-card]').length,
  motionSection:Boolean(pg.querySelector('[data-akari-text-look-section="motion"]'))}})()`;
const FONTS = `(async()=>{await document.fonts.ready;const out=[];for(const el of document.querySelectorAll('[data-akari-text-look-section="font"] [data-akari-font-card]')){const d=el.querySelector('[data-akari-font-name]');if(!d)continue;const fam=getComputedStyle(d).fontFamily;const first=fam.split(',')[0].replace(/["']/g,'').trim();
 const faces=[...document.fonts].filter(f=>f.family.replace(/["']/g,'')===first);const r=el.getBoundingClientRect();out.push({id:el.getAttribute('data-akari-font-card'),display:d.textContent,english:el.querySelector('[data-akari-font-english]')?.textContent??null,family:first,faces:faces.map(f=>f.status),previewImage:Boolean(el.querySelector('[data-akari-font-preview] img')),draggable:el.getAttribute('draggable'),w:Math.round(r.width),nameRepeats:(el.innerText.split(d.textContent).length-1)})}return out})()`;
const INSPECTOR_TEXT = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');if(!root)return null;const secs=[...root.querySelectorAll('.akari-inspector-section')];const s=secs.find(x=>/^\\s*文字/.test(x.querySelector('.akari-inspector-section-header')?.textContent||''));if(!s)return{sections:secs.map(x=>(x.querySelector('.akari-inspector-section-header')?.textContent||'').trim().slice(0,20))};s.scrollIntoView({block:'start'});
 const row=s.querySelector('[data-akari-field="caption-font-family"]');const btn=row?.querySelector('button');const fam=btn?getComputedStyle(btn).fontFamily:null;const first=fam?fam.split(',')[0].replace(/["']/g,'').trim():null;
 return{rows:[...s.querySelectorAll('[data-akari-field]')].map(r=>r.getAttribute('data-akari-field')),rowText:row?row.innerText.replace(/\\s+/g,' ').trim():null,buttonFont:fam,faces:first?[...document.fonts].filter(f=>f.family.replace(/["']/g,'')===first).map(f=>f.status):null}})()`;
const PANEL = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');const p=root?.querySelector('.akari-caption-panel');return{open:Boolean(p),switch:p?.querySelector('[data-akari-caption-panel-switch]')?.getAttribute('data-akari-caption-panel-switch')??null,text:p?p.innerText.replace(/\\s+/g,' ').slice(0,120):null}})()`;
async function realDrag(cdp, fromSel, drop) {
    const events = []; const handler = e => events.push(e); cdp.on('Input.dragIntercepted', handler);
    const card = await evalOn(cdp, `(()=>{const el=document.querySelector(${S(fromSel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(30,r.height/2))}})()`);
    if (!card) throw new Error(`drag source not found: ${fromSel}`);
    await cdp.send('Input.setInterceptDrags', { enabled: true });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
    await sleep(400);
    const out = { card, drop, intercepted: events.length > 0 };
    if (events.length) {
        const data = events[0].data;
        out.mimeTypes = data.items.map(i => i.mimeType);
        const at = (type, x, y) => cdp.send('Input.dispatchDragEvent', { type, x, y, data });
        await at('dragEnter', drop.x - 60, drop.y + 40); await sleep(150);
        for (const [x, y] of [[drop.x - 30, drop.y + 20], [drop.x, drop.y], [drop.x, drop.y], [drop.x, drop.y]]) { await at('dragOver', x, y); await sleep(200); }
        await sleep(500);
        await at('drop', drop.x, drop.y);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.setInterceptDrags', { enabled: false });
    cdp.off?.('Input.dragIntercepted', handler);
    return out;
}
async function waitChange(read, before, ms = 15_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { const now = S(await read()); if (now !== before) return true; await sleep(250); }
    return false;
}
async function ensurePage(cdp) {
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-library-text-look-page]'))`)) return;
    await clickSel(cdp, '[data-akari-library-primary-tile="text"]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-text-look-page]'))`, { label: 'text page', timeoutMs: 10_000 });
    await sleep(800);
}
const previewRect = `(()=>{const f=[...document.querySelectorAll('iframe')].map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width>200&&x.r.height>150).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0];return f?{x:Math.round(f.r.left+f.r.width/2),y:Math.round(f.r.top+f.r.height*0.35),w:Math.round(f.r.width),h:Math.round(f.r.height)}:null})()`;

await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await dismissToasts(cdp);
    await evalOn(cdp, `(()=>{window.__panelEvents=[];window.addEventListener('akari-caption-panel-changed',e=>window.__panelEvents.push(e.detail));return true})()`);
    // (a) ライブラリのホーム → T を押す → テキストのページ（文字は置かれない）
    await clickSel(cdp, '[data-akari-panel-segment="catalog"]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-primary-tile="text"]'))`, { label: 'library home', timeoutMs: 30_000 });
    await sleep(600);
    rec.tileHint = await evalOn(cdp, `document.querySelector('[data-akari-library-primary-tile="text"]').getAttribute('title')`);
    // 「詳細」の中に「文字の見た目」が無い
    await clickSel(cdp, '[data-akari-library-details-toggle]');
    await sleep(500);
    rec.details = await evalOn(cdp, `(()=>({toggle:document.querySelector('[data-akari-library-details-toggle]').textContent.trim(),body:document.querySelector('[data-akari-library-details]')?.innerText.replace(/\\n+/g,' / ')??null,textLookRow:Boolean(document.querySelector('[data-akari-library-text-look-row]'))}))()`);
    check('details-no-text-look', !rec.details.textLookRow && !/文字の見た目/.test(`${rec.details.toggle} ${rec.details.body}`), rec.details);
    rec.shots = [await shot(cdp, '00-library-home-details')];
    await clickSel(cdp, '[data-akari-library-details-toggle]');
    await sleep(300);
    const capsBeforeT = S(await readCaptions()); const editBeforeT = S(await readEdit());
    await clickSel(cdp, '[data-akari-library-primary-tile="text"]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-text-look-page]'))`, { label: 'text page', timeoutMs: 10_000 }).catch(() => false);
    await sleep(2500);
    rec.a = await evalOn(cdp, PAGE);
    rec.a.captionsUnchanged = S(await readCaptions()) === capsBeforeT; rec.a.editUnchanged = S(await readEdit()) === editBeforeT;
    check('a-t-enters-page-no-place', rec.a.open && rec.a.captionsUnchanged && rec.a.editUnchanged && rec.a.header === 'テキスト' && rec.a.back, rec.a);
    check('a-switch-style-font', rec.a.tabs.map(t => t.label).join('|') === 'スタイル|フォント' && rec.a.tab === 'style', rec.a.tabs);
    check('a-textanim-in-style-no-motion-section', rec.a.textanimCardsInStyle > 0 && !rec.a.motionSection && rec.a.sections.join() === 'style', { anim: rec.a.textanimCardsInStyle, sections: rec.a.sections, headings: rec.a.headings });
    check('a-style-cards', rec.a.styleCards > 0 && rec.a.myStyleCards > 0, { style: rec.a.styleCards, my: rec.a.myStyleCards });
    rec.shots.push(await shot(cdp, 'a-text-page-style'));
    // (b) フォント側
    await clickSel(cdp, '[data-akari-library-text-switch="font"]');
    await sleep(2500);
    rec.b = await evalOn(cdp, PAGE);
    rec.b.fonts = await evalOn(cdp, FONTS);
    const loaded = rec.b.fonts.filter(f => f.faces.includes('loaded'));
    const withImage = rec.b.fonts.filter(f => !f.faces.includes('loaded') && f.previewImage);
    rec.b.widths = [...new Set(rec.b.fonts.map(f => f.w))];
    check('b-one-row-per-font-no-dup-name', rec.b.fonts.length === rec.b.fontSpecimens && rec.b.widths.length === 1 && rec.b.fonts.every(f => f.nameRepeats === 1 && f.english !== f.display),
        { rows: rec.b.fonts.length, widths: rec.b.widths, dup: rec.b.fonts.filter(f => f.nameRepeats !== 1 || f.english === f.display).map(f => f.id) });
    check('b-unloaded-fonts-show-preview-image', loaded.length + withImage.length === rec.b.fonts.length,
        { loaded: loaded.length, image: withImage.length, neither: rec.b.fonts.filter(f => !f.faces.includes('loaded') && !f.previewImage).map(f => f.id) });
    check('b-font-side', rec.b.tab === 'font' && rec.b.sections.join() === 'font' && rec.b.fontSpecimens > 0, { specimens: rec.b.fontSpecimens, tabs: rec.b.tabs });
    rec.b.loadedCount = loaded.length;
    check('b-font-names-in-own-face', loaded.length > 0, { loaded: loaded.length, total: rec.b.fonts.length, sample: rec.b.fonts.slice(0, 12) });
    rec.shots.push(await shot(cdp, 'b-text-page-font'));
    // 出入りで切り替えの状態を保つ（← ライブラリ → T → フォントのまま）/ Esc で戻る
    await clickSel(cdp, '[data-akari-library-back]');
    await sleep(600);
    const home1 = await evalOn(cdp, PAGE);
    await clickSel(cdp, '[data-akari-library-primary-tile="text"]');
    await sleep(1200);
    const back1 = await evalOn(cdp, PAGE);
    await key(cdp, 'Escape', 'Escape', 27);
    await sleep(800);
    const esc = await evalOn(cdp, PAGE);
    check('ab-back-keeps-tab-esc-returns', !home1.open && home1.home && back1.open && back1.tab === 'font' && !esc.open && esc.home, { home1, backTab: back1.tab, esc });
    // 状態をスタイルへ戻す
    await clickSel(cdp, '[data-akari-library-primary-tile="text"]');
    await sleep(800);
    await clickSel(cdp, '[data-akari-library-text-switch="style"]');
    await sleep(1200);
    // (c) 字幕 c-0002 を選び、スタイルのカードを押す → c-0002 に当たる
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0002"]');
    await sleep(1200);
    const capsBeforeC = await readCaptions();
    const cardSel = '[data-akari-text-look-section="style"] [data-akari-catalog-preset-item^="textstyle/"]';
    rec.c = { card: await evalOn(cdp, `document.querySelector(${S(cardSel)})?.getAttribute('data-akari-catalog-preset-item')`) };
    await clickSel(cdp, cardSel);
    rec.c.changed = await waitChange(readCaptions, S(capsBeforeC));
    await sleep(1200);
    const capsAfterC = await readCaptions();
    const row = (caps, id) => caps.captions.find(c => c.id === id);
    rec.c.before = row(capsBeforeC, 'c-0002'); rec.c.after = row(capsAfterC, 'c-0002');
    rec.c.othersUnchanged = capsBeforeC.captions.filter(c => c.id !== 'c-0002').every(c => S(c) === S(row(capsAfterC, c.id)));
    rec.c.captionCount = [capsBeforeC.captions.length, capsAfterC.captions.length];
    check('c-card-press-applies-to-selected', rec.c.changed && S(rec.c.before) !== S(rec.c.after) && rec.c.othersUnchanged && rec.c.captionCount[0] === rec.c.captionCount[1],
        { card: rec.c.card, styleBefore: rec.c.before?.text_style ?? null, presetAfter: rec.c.after?.style_preset ?? null, styleAfter: rec.c.after?.text_style ?? null });
    rec.shots.push(await shot(cdp, 'c-card-applied'));
    // タイムラインのチップを押してもフォーカスはライブラリに残るため、Esc はタイムラインではなくページに届く（ページを出る）。
    // ここでは選択を外さず、ページに入り直してから (d) へ進む
    await ensurePage(cdp);
    // (d) カードをプレビューへドラッグ
    const pv = await evalOn(cdp, previewRect);
    const capsBeforeD = await readCaptions(); const editBeforeD = await readEdit();
    rec.d = await realDrag(cdp, cardSel, { x: pv.x, y: pv.y });
    rec.d.preview = pv;
    rec.d.changed = await waitChange(async () => [await readCaptions(), await readEdit()], S([capsBeforeD, editBeforeD]));
    await sleep(1500);
    const capsAfterD = await readCaptions();
    const idsD = new Set(capsBeforeD.captions.map(c => c.id));
    rec.d.newCaptions = capsAfterD.captions.filter(c => !idsD.has(c.id)).map(c => ({ id: c.id, text: c.text, start: c.start, style_preset: c.style_preset ?? null, position: c.text_style?.position ?? null }));
    check('d-card-drag-to-preview-places', rec.d.intercepted && rec.d.newCaptions.length === 1, { mime: rec.d.mimeTypes, newCaptions: rec.d.newCaptions });
    rec.shots.push(await shot(cdp, 'd-card-dropped-on-preview'));
    await ensurePage(cdp);
    // (e) 「＋ 文字を置く」
    const capsBeforeE = await readCaptions();
    await clickSel(cdp, '[data-akari-library-place-text]');
    rec.e = { changed: await waitChange(readCaptions, S(capsBeforeE)) };
    await sleep(1500);
    const capsAfterE = await readCaptions();
    const idsE = new Set(capsBeforeE.captions.map(c => c.id));
    rec.e.newCaptions = capsAfterE.captions.filter(c => !idsE.has(c.id)).map(c => ({ id: c.id, text: c.text, start: c.start, style_preset: c.style_preset ?? null }));
    check('e-place-button-places-plain-text', rec.e.newCaptions.length === 1 && rec.e.newCaptions[0].text === 'テキストを入力' && !rec.e.newCaptions[0].style_preset, rec.e.newCaptions);
    rec.e.stillOnPage = (await evalOn(cdp, PAGE)).open;
    rec.shots.push(await shot(cdp, 'e-place-text'));
    // (f-0) 置いた文字（今置いたものが選ばれている）の編集パネル
    await evalOn(cdp, exec('akari.inspector.open'));
    await sleep(2000);
    rec.f0 = await evalOn(cdp, INSPECTOR_TEXT);
    check('f-font-row-placed-text', rec.f0?.rows?.[0] === 'caption-font-family' && /フォント/.test(rec.f0?.rowText ?? ''), rec.f0);
    // (e-2) T タイルのドラッグで素の文字を置く（← ライブラリでホームへ）
    await clickSel(cdp, '[data-akari-library-back]');
    await sleep(600);
    const capsBeforeT2 = await readCaptions();
    const pv2 = await evalOn(cdp, previewRect);
    rec.e2 = await realDrag(cdp, '[data-akari-library-primary-tile="text"]', { x: pv2.x, y: pv2.y + 40 });
    rec.e2.changed = await waitChange(readCaptions, S(capsBeforeT2));
    await sleep(1500);
    const capsAfterT2 = await readCaptions();
    const idsT2 = new Set(capsBeforeT2.captions.map(c => c.id));
    rec.e2.newCaptions = capsAfterT2.captions.filter(c => !idsT2.has(c.id)).map(c => ({ id: c.id, text: c.text, start: c.start, style_preset: c.style_preset ?? null }));
    check('e-t-tile-drag-places', rec.e2.intercepted && rec.e2.newCaptions.length === 1 && rec.e2.newCaptions[0].text === 'テキストを入力', { mime: rec.e2.mimeTypes, newCaptions: rec.e2.newCaptions });
    rec.shots.push(await shot(cdp, 'e2-t-tile-dragged'));
    // (f) 字幕 c-0001 の編集パネル → フォントの行 → フォントパネル
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]');
    await evalOn(cdp, exec('akari.inspector.open'));
    await sleep(2500);
    rec.f1 = await evalOn(cdp, INSPECTOR_TEXT);
    check('f-font-row-caption', rec.f1?.rows?.[0] === 'caption-font-family' && /フォント/.test(rec.f1?.rowText ?? '')
        && ['caption-color', 'caption-size'].every(r => rec.f1.rows.includes(r)), rec.f1);
    check('f-font-row-in-own-face', rec.f1?.faces?.includes('loaded'), { buttonFont: rec.f1?.buttonFont, faces: rec.f1?.faces });
    rec.shots.push(await shot(cdp, 'f1-inspector-font-row'));
    await evalOn(cdp, `(window.__panelEvents.length=0,true)`);
    await clickSel(cdp, '[data-akari-ui="panel:inspector"] [data-akari-field="caption-font-family"] button');
    await sleep(1500);
    rec.f2 = { panel: await evalOn(cdp, PANEL), events: await evalOn(cdp, `window.__panelEvents`) };
    check('f-font-row-opens-font-panel', rec.f2.panel.open && rec.f2.panel.switch === 'font' && rec.f2.events.some(e => e?.panel === 'font'), rec.f2);
    rec.shots.push(await shot(cdp, 'f2-font-panel'));
    rec.git = execFileSync('/usr/bin/git', ['status', '--short'], { cwd: p.PJ, encoding: 'utf8' }).split('\n').filter(Boolean);
    rec.status = 'ok';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    rec.seconds = Math.round((Date.now() - t0) / 1000);
    const list = Object.values(rec.checks);
    rec.summary = `${list.filter(c => c.pass).length}/${list.length} pass`;
    await writeFile(path.join(OUT, 'results-after.json'), `${S(rec, null, 2)}\n`);
}
console.log(S({ status: rec.status, error: rec.error, summary: rec.summary, seconds: rec.seconds, fails: Object.entries(rec.checks).filter(([, c]) => !c.pass).map(([k]) => k) }));
