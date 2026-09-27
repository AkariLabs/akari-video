#!/usr/bin/env node
// 手順 5（AFTER）の実機判定（ラッパー作成の検証スクリプト）。ストアはローカルのスタブ（store-stub.mjs・中身はダミー）。
//  走行 1（未購入）: テキストのページ = スタイル 36 件 + 「テロップ」の棚 / glitch・neon・emphasis-red を既存の字幕に当てて
//    captions.json に大文字化と動きが残る / 有料テロップに王冠 1 つ・価格はカードに出ない / 押す・ドロップ → 促しのシートで置かない /
//    ⋯ に価格 / 無料テロップは置ける
//  走行 2（購入済み = スタブの entitlements に telop-rich-pack-01）: 有料テロップを押す → パックの zip から 1 件だけ取り出して置ける
//    → OSR 書き出しでそのテロップが描かれる
// 使い方: node gen-fixture.mjs <作業用>/fixture && node after-crown.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9637）
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, exec, key, openProject, openTextPage, paths, shooter, start } from './common.mjs';
import { FREE, OTHER, PACK, PAID, buildStub, serveStub } from './store-stub.mjs';

const work = process.argv[2];
const p = paths(work);
const STUB_PORT = 47637;
const rec = { phase: 'after-crown', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: {} };
const check = (name, pass, detail) => { rec.checks[name] = { pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }; };
const shot = shooter(p, 'after');
const readCaptions = async () => JSON.parse(await readFile(path.join(p.PJ, 'captions.json'), 'utf8'));
const readEdit = async () => JSON.parse(await readFile(path.join(p.PJ, 'edit.json'), 'utf8'));
const editItems = edit => edit.tracks.flatMap(t => (t.items || []).map(i => ({ track: t.id, ...i })));
const preset = async id => JSON.parse(await readFile(path.join(REPO, 'presets', 'textstyle', `${id}.json`), 'utf8')).style;
async function waitChange(read, before, ms = 20_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (S(await read()) !== before) return true; await sleep(250); }
    return false;
}
const SHEET = `(()=>{const s=document.querySelector('[data-akari-premium-prompt]');return s?{text:s.innerText.replace(/\\s+/g,' ').trim(),lab:Boolean(s.querySelector('[data-akari-premium-lab]')),close:Boolean(s.querySelector('[data-akari-premium-close]'))}:null})()`;
const TELOPS = `(()=>{const sec=document.querySelector('[data-akari-text-look-section="telop"]');if(!sec)return null;return [...sec.querySelectorAll('[data-akari-library-card]')].map(c=>({key:c.getAttribute('data-akari-catalog-item'),state:c.getAttribute('data-akari-catalog-item-state'),premium:c.getAttribute('data-akari-premium'),crowns:c.querySelectorAll('[data-akari-premium-crown]').length,text:c.innerText.replace(/\\s+/g,' ').trim(),hasYen:/[¥￥]/.test(c.innerText),draggable:c.getAttribute('draggable')}))})()`;
const cardSel = id => `[data-akari-text-look-section="telop"] [data-akari-catalog-item="overlay/${id}"]`;
async function realDrag(cdp, fromSel, drop) {
    const events = []; const handler = e => events.push(e); cdp.on('Input.dragIntercepted', handler);
    const card = await evalOn(cdp, `(()=>{const el=document.querySelector(${S(fromSel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(30,r.height/2))}})()`);
    if (!card) throw new Error(`drag source not found: ${fromSel}`);
    await cdp.send('Input.setInterceptDrags', { enabled: true });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
    await sleep(400);
    const out = { intercepted: events.length > 0 };
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
    return out;
}
const previewRect = `(()=>{const f=[...document.querySelectorAll('iframe')].map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width>200&&x.r.height>150).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0];return f?{x:Math.round(f.r.left+f.r.width/2),y:Math.round(f.r.top+f.r.height*0.35)}:null})()`;
async function closeSheet(cdp) {
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-premium-close]'))`)) await clickSel(cdp, '[data-akari-premium-close]');
    await sleep(500);
}
async function openTelopTab(cdp) {
    await openTextPage(cdp);
    await clickSel(cdp, '[data-akari-library-text-switch="telop"]');
    await waitEval(cdp, `document.querySelectorAll('[data-akari-text-look-section="telop"] [data-akari-library-card]').length>0`, { label: 'telop cards', timeoutMs: 60_000 });
    await sleep(1500);
}

// 前の走行で取得した素材を消して、fixture の状態（素材なし・マイスタイル 1 件）から始める
await rm(path.join(p.LIBRARY, 'overlay'), { recursive: true, force: true });
const stub = await buildStub(path.join(work, 'store-stub'), STUB_PORT);
const mode = { value: 'none' };
const { server, log } = await serveStub({ port: STUB_PORT, ...stub, mode });
process.env.AKARI_ASSETS_CATALOG = stub.catalogFile;
process.env.AKARI_STORE_API = `http://127.0.0.1:${STUB_PORT}`;
const credentials = async iso => { await mkdir(path.join(iso, 'akari-home'), { recursive: true }); await writeFile(path.join(iso, 'akari-home', 'store-credentials.json'), `${S({ token: 'fixture-token' })}\n`); };
const home = path.join(p.ISO, 'akari-home');
let session;
try {
    // ---- 走行 1: 未購入 ----
    await rm(p.PJ, { recursive: true, force: true });
    await cp(path.join(work, 'fixture', 'spoken'), p.PJ, { recursive: true });
    session = await start(p, credentials);
    let cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    await openTextPage(cdp);
    await waitEval(cdp, `document.querySelectorAll('[data-akari-text-look-section="style"] [data-akari-catalog-preset-item^="textstyle/"]').length>0`, { label: 'textstyle cards', timeoutMs: 60_000 });
    await sleep(1000);
    rec.page = await evalOn(cdp, `(()=>{const pg=document.querySelector('[data-akari-library-text-look-page]');return{tabs:[...pg.querySelectorAll('[role=tab]')].map(t=>t.textContent.trim()),styles:pg.querySelectorAll('[data-akari-text-look-section="style"] [data-akari-catalog-preset-item^="textstyle/"]').length}})()`);
    check('page-tabs-and-36-styles', rec.page.tabs.join('|') === 'スタイル|フォント|テロップ' && rec.page.styles === 36, rec.page);
    rec.shots = [await shot(cdp, 'crown-00-text-page-style')];
    // 目的 2: 既存の字幕に当てる → 大文字化と動きが captions.json に残る
    rec.apply = [];
    for (const [captionId, styleId] of [['c-0002', 'glitch'], ['c-0003', 'neon'], ['c-0004', 'emphasis-red']]) {
        await dismissToasts(cdp);
        await evalOn(cdp, exec('akari.timeline.selectCaptions', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, captionIds: [captionId] }));
        await sleep(1200);
        const before = await readCaptions();
        await clickSel(cdp, `[data-akari-text-look-section="style"] [data-akari-catalog-preset-item="textstyle/${styleId}"]`);
        const changed = await waitChange(readCaptions, S(before));
        await sleep(1000);
        const row = (await readCaptions()).captions.find(c => c.id === captionId);
        const style = await preset(styleId);
        const kept = row.text_style ?? {};
        const { animation, ...look } = style;
        rec.apply.push({ captionId, styleId, changed, text_style: kept,
            lookKept: Object.entries(look).every(([k, v]) => S(kept[k]) === S(v)),
            animationKept: animation === undefined || S(kept.animation) === S(animation) });
    }
    check('apply-keeps-text-transform-and-animation', rec.apply.every(a => a.changed && a.lookKept && a.animationKept),
        rec.apply.map(a => ({ id: a.styleId, lookKept: a.lookKept, animationKept: a.animationKept, text_transform: a.text_style.text_transform ?? null, animation: a.text_style.animation ?? null })));
    // テロップの棚
    await openTelopTab(cdp);
    rec.telops1 = await evalOn(cdp, TELOPS);
    const paidCards = rec.telops1.filter(c => PAID.some(a => c.key === `overlay/${a.id}`));
    const freeCard = rec.telops1.find(c => c.key === `overlay/${FREE.id}`);
    check('telop-shelf-paid-and-free-same-shelf', paidCards.length === PAID.length && Boolean(freeCard) && !rec.telops1.some(c => c.key === `overlay/${OTHER.id}`),
        rec.telops1.map(c => c.key));
    check('telop-paid-one-crown-no-price-on-card', paidCards.every(c => c.crowns === 1 && !c.hasYen) && freeCard?.crowns === 0 && !freeCard?.hasYen,
        rec.telops1.map(c => ({ key: c.key, state: c.state, crowns: c.crowns, hasYen: c.hasYen })));
    rec.shots.push(await shot(cdp, 'crown-01-telop-shelf-locked'));
    // 未購入を押す → 促しのシート・置かない
    const editBefore = S(await readEdit());
    await clickSel(cdp, cardSel(PAID[0].id));
    rec.sheetOnPress = await waitEval(cdp, SHEET, { label: 'premium sheet', timeoutMs: 15_000 }).catch(() => null);
    await sleep(1500);
    check('locked-press-shows-sheet-no-place', rec.sheetOnPress && /¥1,980/.test(rec.sheetOnPress.text) && rec.sheetOnPress.lab && rec.sheetOnPress.close && S(await readEdit()) === editBefore, rec.sheetOnPress);
    rec.shots.push(await shot(cdp, 'crown-02-premium-sheet-on-press'));
    await closeSheet(cdp);
    // ⋯ に価格
    await evalOn(cdp, `(()=>{const c=document.querySelector(${S(cardSel(PAID[1].id))});c.scrollIntoView({block:'center'});return true})()`);
    await clickSel(cdp, `${cardSel(PAID[1].id)} [data-akari-library-dots]`);
    await sleep(1200);
    rec.dots = await evalOn(cdp, `(()=>{const t=[...document.querySelectorAll('[data-akari-info-price],[data-akari-info-actions]')].map(e=>e.innerText.replace(/\\s+/g,' ').trim());return{texts:t,body:document.body.innerText.includes('Lab で見る（¥1,980）')}})()`);
    check('dots-shows-price', rec.dots.body || rec.dots.texts.some(t => /¥1,980/.test(t)), rec.dots);
    rec.shots.push(await shot(cdp, 'crown-03-dots-price'));
    await key(cdp, 'Escape', 'Escape', 27);
    await sleep(600);
    await openTelopTab(cdp);
    // 未購入をプレビューへドロップ → 促しのシート・置かない
    const drop = await evalOn(cdp, previewRect);
    rec.drag = await realDrag(cdp, cardSel(PAID[2].id), drop);
    rec.sheetOnDrop = await waitEval(cdp, SHEET, { label: 'premium sheet on drop', timeoutMs: 15_000 }).catch(() => null);
    await sleep(1500);
    check('locked-drop-shows-sheet-no-place', rec.drag.intercepted && rec.sheetOnDrop && S(await readEdit()) === editBefore, { drag: rec.drag, sheet: rec.sheetOnDrop });
    rec.shots.push(await shot(cdp, 'crown-04-premium-sheet-on-drop'));
    await closeSheet(cdp);
    // 無料テロップは押すと置ける
    await openTelopTab(cdp);
    await evalOn(cdp, exec('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: 1 }));
    await sleep(1500);
    const itemsBeforeFree = editItems(await readEdit()).map(i => i.id);
    await clickSel(cdp, cardSel(FREE.id));
    await waitChange(readEdit, editBefore, 60_000);
    await sleep(1500);
    const addedFree = editItems(await readEdit()).filter(i => !itemsBeforeFree.includes(i.id));
    check('free-telop-places', addedFree.length === 1, addedFree);
    rec.shots.push(await shot(cdp, 'crown-05-free-telop-placed'));
    await stop(session); session = undefined;
    rec.stubLog1 = [...new Set(log.splice(0))];

    // ---- 走行 2: 購入済み ----
    mode.value = 'owned';
    session = await start(p, credentials);
    cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    await openTelopTab(cdp);
    rec.telops2 = await evalOn(cdp, TELOPS);
    check('owned-telops-not-locked', rec.telops2.filter(c => PAID.some(a => c.key === `overlay/${a.id}`)).every(c => c.state !== 'locked'),
        rec.telops2.map(c => ({ key: c.key, state: c.state, crowns: c.crowns })));
    rec.shots.push(await shot(cdp, 'crown-06-telop-shelf-owned'));
    await evalOn(cdp, exec('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: 7 }));
    await sleep(1500);
    const beforeOwned = S(await readEdit());
    const itemsBeforeOwned = editItems(JSON.parse(beforeOwned)).map(i => i.id);
    await clickSel(cdp, cardSel(PAID[0].id));
    await waitChange(readEdit, beforeOwned, 90_000);
    await sleep(2000);
    rec.sheetOwned = await evalOn(cdp, SHEET);
    const addedOwned = editItems(await readEdit()).filter(i => !itemsBeforeOwned.includes(i.id));
    // 取得した素材はライブラリ（library-location.json の場所）の overlay/<id>/ に入る
    const listDir = async dir => existsSync(dir) ? (await readdir(dir)).sort() : [];
    rec.libraryOverlay = [...new Set([...await listDir(path.join(p.PJ, 'assets', 'overlay')), ...await listDir(path.join(p.LIBRARY, 'overlay')), ...await listDir(path.join(home, 'assets', 'overlay'))])].sort();
    rec.ownedFiles = await listDir(path.join(p.LIBRARY, 'overlay', PAID[0].id));
    check('owned-telop-places-one-asset-from-pack', addedOwned.length === 1 && !rec.sheetOwned && rec.libraryOverlay.includes(PAID[0].id)
        && !rec.libraryOverlay.includes(PAID[1].id) && rec.ownedFiles.includes('fragment.html'),
        { added: addedOwned, libraryOverlay: rec.libraryOverlay, files: rec.ownedFiles });
    rec.ownedItem = addedOwned[0] ?? null;
    await sleep(2500);
    rec.shots.push(await shot(cdp, 'crown-07-owned-telop-placed'));
    rec.stubLog2 = [...new Set(log.splice(0))];
} catch (error) {
    rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
}
// 書き出し（OSR・tier 2）で置いたテロップと当てたスタイルが描かれる
try {
    const exportFile = path.join(p.PJ, 'exports', 'crown-osr.mp4');
    const env = { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0', AKARI_HOME: home };
    delete env.ELECTRON_RUN_AS_NODE;
    const t1 = Date.now();
    const render = spawnSync(process.execPath, [path.join(REPO, 'packages/render-cut/bin/render-cut.mjs'), p.PJ, '--engine', 'osr', '--out', exportFile, '--force'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 << 20 });
    rec.export = { exit: render.status, secs: Math.round((Date.now() - t1) / 1000), tail: sanitize(String(render.stdout + render.stderr).split('\n').slice(-5).join('\n'), REPO) };
    const receipt = JSON.parse(await readFile(path.join(p.PJ, '.akari', 'render.json'), 'utf8'));
    rec.export.engine = receipt.provenance?.engine ?? null;
    rec.export.launcher_tier = receipt.provenance?.osr?.provenance?.launcher_tier ?? null;
    const at = rec.ownedItem ? (rec.ownedItem.at ?? 0) / 30 + 0.5 : 7.5;
    const frames = {};
    for (const [name, t] of [['owned-telop', at], ['glitch-c0002', 4], ['neon-c0003', 7.2], ['emphasis-c0004', 10]]) {
        const f = path.join(OUT, `after-crown-export-${name}.png`);
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', exportFile, '-frames:v', '1', f]);
        frames[name] = path.basename(f);
    }
    rec.export.frames = frames;
    // 置いたテロップの色（金 #f4c542）の画素数
    const count = spawnSync('magick', [path.join(OUT, frames['owned-telop']), '-fuzz', '12%', '-fill', 'white', '-opaque', PAID[0].color, '-fill', 'black', '+opaque', 'white', '-format', '%[fx:mean*w*h]', 'info:'], { encoding: 'utf8' });
    rec.export.goldPixels = Number.parseFloat(count.stdout);
    check('export-draws-owned-telop', render.status === 0 && rec.export.launcher_tier === 2 && rec.export.goldPixels > 2000, { exit: render.status, tier: rec.export.launcher_tier, goldPixels: rec.export.goldPixels, at });
} catch (error) {
    rec.exportError = sanitize(error, REPO);
}
server.close();
rec.pass = Object.values(rec.checks).filter(c => c.pass).length;
rec.total = Object.keys(rec.checks).length;
await writeFile(path.join(OUT, 'results-after-crown.json'), `${S(rec, null, 2)}\n`);
console.log(S({ error: rec.error, exportError: rec.exportError, pass: `${rec.pass}/${rec.total}`, failed: Object.entries(rec.checks).filter(([, c]) => !c.pass).map(([k]) => k) }));
process.exit(0);
