#!/usr/bin/env node
// 手順 0（BEFORE）の実機記録（ラッパー作成の検証スクリプト。判定はしない）。
// (a) ライブラリのホームで T を押した結果（edit.json / captions.json の変化）
// (b) 「詳細」→「文字の見た目」のページ（段の並び）
// (c) 編集パネル（インスペクター）の「文字」欄
// 使い方: node gen-fixture.mjs <作業用>/fixture && node before.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9635）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, openProject, paths, shooter, start } from './common.mjs';

const p = paths(process.argv[2]);
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim() };
const shot = shooter(p, 'before');
const digest = async file => createHash('sha256').update(await readFile(path.join(p.PJ, file))).digest('hex').slice(0, 16);
const snapshot = async () => ({ edit: await digest('edit.json'), captions: await digest('captions.json') });
const exec = (id, args) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${S(id)}${args === undefined ? '' : `,${S(args)}`});return true})()`;
await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await dismissToasts(cdp);
    // (a) ライブラリのホーム → T を押す
    await clickSel(cdp, '[data-akari-panel-segment="catalog"]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-primary-tile="text"]'))`, { label: 'library home', timeoutMs: 30_000 });
    await sleep(800);
    rec.homeTiles = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-library-primary-tile]')].map(e=>e.getAttribute('data-akari-library-primary-tile')+' | '+e.innerText.replace(/\\s+/g,' ').trim())`);
    rec.shots = [await shot(cdp, '00-library-home')];
    const beforeT = await snapshot();
    const editBefore = JSON.parse(await readFile(path.join(p.PJ, 'edit.json'), 'utf8'));
    await clickSel(cdp, '[data-akari-library-primary-tile="text"]');
    await sleep(2500);
    const afterT = await snapshot();
    const editAfter = JSON.parse(await readFile(path.join(p.PJ, 'edit.json'), 'utf8'));
    const itemIds = edit => edit.tracks.flatMap(t => (t.items || []).map(i => `${t.id}/${i.id}`));
    rec.tPress = {
        before: beforeT, after: afterT, editChanged: beforeT.edit !== afterT.edit, captionsChanged: beforeT.captions !== afterT.captions,
        addedItems: itemIds(editAfter).filter(id => !itemIds(editBefore).includes(id)),
        libraryView: await evalOn(cdp, `({home:Boolean(document.querySelector('[data-akari-library-home]')),textLookPage:Boolean(document.querySelector('[data-akari-library-text-look-page]'))})`)
    };
    rec.shots.push(await shot(cdp, '01-after-t-press'));
    // 置いた文字を戻す（Cmd+Z は後続の観測を汚さないよう使わず、fixture を写し直す必要は無い — (b)(c) は置いた文字の有無に依存しない）
    // (b) 「詳細」→「文字の見た目」
    await clickSel(cdp, '[data-akari-library-details-toggle]');
    await sleep(600);
    rec.details = await evalOn(cdp, `(()=>{const d=document.querySelector('[data-akari-library-details]');return d?d.innerText.replace(/\\n+/g,' / ').slice(0,400):null})()`);
    rec.shots.push(await shot(cdp, '02-library-details'));
    await clickSel(cdp, '[data-akari-library-text-look-row]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-text-look-page]'))`, { label: 'text look page', timeoutMs: 20_000 });
    await sleep(1500);
    rec.textLookPage = await evalOn(cdp, `(()=>{const pg=document.querySelector('[data-akari-library-text-look-page]');return{sections:[...pg.querySelectorAll('[data-akari-text-look-section]')].map(s=>({key:s.getAttribute('data-akari-text-look-section'),top:Math.round(s.getBoundingClientRect().top),cards:s.querySelectorAll('button,[draggable=true]').length})),hasSwitch:Boolean(pg.querySelector('[role=tablist],[role=tab]')),header:pg.firstElementChild?.innerText.replace(/\\s+/g,' ').trim()}})()`);
    rec.shots.push(await shot(cdp, '03-text-look-page'));
    // (c) 編集パネルの「文字」欄（タイムラインの c-0001 のチップを実クリックで選ぶ）
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]');
    await evalOn(cdp, exec('akari.inspector.open'));
    await sleep(2000);
    rec.inspectorTextSection = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');if(!root)return null;const secs=[...root.querySelectorAll('.akari-inspector-section')];const s=secs.find(x=>/^\\s*文字/.test(x.querySelector('.akari-inspector-section-header')?.textContent||''));if(s)s.scrollIntoView({block:'start'});return{sections:secs.map(x=>(x.querySelector('.akari-inspector-section-header')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,30)),text:s?s.innerText.replace(/\\n+/g,' / ').slice(0,400):null,hasFontRow:s?/フォント/.test(s.innerText):null}})()`);
    await sleep(400);
    rec.shots.push(await shot(cdp, '04-inspector-text-section'));
    rec.status = 'ok';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(rec, null, 2)}\n`);
}
console.log(S({ status: rec.status, error: rec.error }));
