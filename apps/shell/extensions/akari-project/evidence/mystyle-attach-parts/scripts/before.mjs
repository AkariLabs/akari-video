#!/usr/bin/env node
// 手順 0（BEFORE）の実機記録: html 装飾にアンカーを手で書いた案件で字幕を動かす / 消す、効果音にアンカーを書いた場合。
// ラッパー作成の検証スクリプト。判定はしない。基点のビルドで実行する。
// 使い方: node before.mjs <作業用ディレクトリ（実体パス）>   （fixture = <作業用>/fixture/anchored と anchored-sfx。CDP_PORT 既定 9491）
// 2 案件を順に開く: anchored（html 装飾だけにアンカー）/ anchored-sfx（効果音にもアンカー）。どちらも c-0002 を 1 秒右へ → undo → c-0003 を削除 → undo
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick } from './cdp-lib.mjs';
import { realDragMod } from './cdp-lib.mjs';
import { command, launch, sanitize, sleep, stop } from './l1-lib.mjs';
import { openProject } from './l1-common.mjs';
import { prepareLibrary } from './library-home.mjs';
import { S, key, setupWindow, shotTo, waitFor, widenTimeline } from './common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
const WORK = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9491);
let PJ, FIXTURE;
const ISO = path.join(WORK, 'iso-before');
const LIBRARY = path.join(WORK, 'creator-before', 'library');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), scenarios: {} };
const scrub = value => JSON.parse(S(value).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>'));
let TAG = '';
const shot = (cdp, name) => shotTo(cdp, WORK, path.join(OUT, `before-${TAG}-${name}.png`));
const readText = async (dir, file) => readFile(path.join(dir, file), 'utf8');
const itemsOf = edit => Object.fromEntries(edit.tracks.flatMap(t => t.items.map(i => [i.id, { track: t.id, at: i.at, duration: i.duration, anchor: i.anchor ?? null }])));
async function snapshot(label) {
    const captions = JSON.parse(await readText(PJ, 'captions.json')).captions;
    const edit = JSON.parse(await readText(PJ, 'edit.json'));
    const items = itemsOf(edit);
    return {
        label,
        captions: Object.fromEntries(captions.map(c => [c.id, [c.start, c.end]])),
        items: { 'deco-c2': items['deco-c2'] ?? null, 'deco-c3': items['deco-c3'] ?? null, 'sfx-c2': items['sfx-c2'] ?? null },
        editChangedLines: (await readText(PJ, 'edit.json')).split('\n').filter((line, i) => line !== (FIXTURE_EDIT[i] ?? null)).slice(0, 12),
        notices: await NOTICES_NOW(),
        captionsEqualsFixture: (await readText(PJ, 'captions.json')) === (await readText(FIXTURE, 'captions.json')),
        editEqualsFixture: (await readText(PJ, 'edit.json')) === (await readText(FIXTURE, 'edit.json'))
    };
}
// タイムラインの字幕チップ・クリップ・音声の矩形
let FIXTURE_EDIT = [];
let NOTICES_NOW = async () => [];
const TIMELINE = `(()=>{const px=v=>Math.round(v*10)/10;const pick=sel=>[...document.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.akariItemId??null,kind:e.dataset.akariItemKind??null,text:(e.textContent||'').trim().slice(0,24),left:px(r.left),top:px(r.top),width:px(r.width),height:px(r.height),cls:String(e.className).slice(0,120)}}).filter(x=>x.width>0);return{items:pick('[data-akari-item-id]').map(x=>x),kinds:[...document.querySelectorAll('[data-akari-item-id]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[e.dataset.akariItemId,e.dataset.akariItemKind??null,e.dataset.akariLane??null]),footer:document.querySelector('.akari-annotations-footer, [class*=footer]')?.textContent?.trim().slice(0,160)??null}})()`;
const chipOf = async (cdp, text) => evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-annotations-strip-caption[data-akari-item-id]')].find(e=>(e.textContent||'').includes(${S(text)}));if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{id:e.dataset.akariItemId,x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,width:r.width}})()`);
async function undo(cdp) {
    const before = (await readText(PJ, 'captions.json')) + (await readText(PJ, 'edit.json'));
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    await sleep(2500);
    let via = 'Cmd+Z';
    if ((await readText(PJ, 'captions.json')) + (await readText(PJ, 'edit.json')) === before) {
        await evalOn(cdp, command('akari.timeline.undo'));
        await sleep(2500);
        via = 'akari.timeline.undo';
    }
    return via;
}

process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
await rm(path.dirname(LIBRARY), { recursive: true, force: true });
await mkdir(LIBRARY, { recursive: true });
for (const name of ['anchored', 'anchored-sfx']) {
    TAG = name;
    FIXTURE = path.join(WORK, 'fixture', name);
    PJ = path.join(WORK, `ws-before-${name}`);
    FIXTURE_EDIT = (await readText(FIXTURE, 'edit.json')).split('\n');
    await rm(PJ, { recursive: true, force: true });
    await cp(FIXTURE, PJ, { recursive: true });
    const sc = rec.scenarios[name] = { steps: [] };
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PJ, port: PORT, isoDir: ISO, prepare: iso => prepareLibrary(iso, LIBRARY) });
    const cdp = session.cdp;
    NOTICES_NOW = () => evalOn(cdp, `[...document.querySelectorAll('.theia-notification-list-item')].map(e=>e.textContent.trim().slice(0,240))`).catch(() => []);
    try {
        await openProject(session, PJ, 1, PORT);
        await setupWindow(cdp);
        await widenTimeline(cdp);
        await sleep(1500);
        sc.steps.push(await snapshot('opened'));
        sc.timelineOpened = await evalOn(cdp, TIMELINE);
        await shot(cdp, '01-opened');
        // A. 字幕 c-0002 をタイムラインで 1 秒右へドラッグ
        const c2 = await waitFor('c-0002 chip', () => chipOf(cdp, 'まずはコーヒー'));
        const pxPerSec = c2.width / 2.5;
        sc.pxPerSec = pxPerSec;
        await realClick(cdp, c2.x, c2.y);
        await sleep(600);
        // 高負荷時はドラッグが空振りすることがあるので、書き込まれるまで最大 3 回（同じ位置から 1 秒ぶん）
        sc.dragAttempts = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
            sc.dragAttempts++;
            const chip = await chipOf(cdp, 'まずはコーヒー');
            await realDragMod(cdp, [{ x: chip.x, y: chip.y }, { x: chip.x + 6, y: chip.y }, { x: chip.x + pxPerSec, y: chip.y }], { steps: 16, stepDelayMs: 45 });
            const moved = await waitFor('captions.json changed', async () => (await readText(PJ, 'captions.json')) !== (await readText(FIXTURE, 'captions.json')), 20_000).catch(() => null);
            if (moved) break;
        }
        await sleep(2500);
        sc.steps.push(await snapshot('after-move-c-0002'));
        sc.timelineAfterMove = await evalOn(cdp, TIMELINE);
        await shot(cdp, '02-moved-c-0002');
        sc.undoMoveVia = await undo(cdp);
        sc.steps.push(await snapshot('after-undo-move'));
        // B. 字幕 c-0003 をタイムラインで選んで Delete
        const c3 = await waitFor('c-0003 chip', () => chipOf(cdp, '豆は挽きたて'));
        await realClick(cdp, c3.x, c3.y);
        await sleep(800);
        await key(cdp, 'Delete', 'Delete', 46);
        await waitFor('c-0003 removed', async () => !JSON.parse(await readText(PJ, 'captions.json')).captions.some(c => c.id === 'c-0003'), 30_000).catch(() => null);
        await sleep(2500);
        sc.steps.push(await snapshot('after-delete-c-0003'));
        sc.timelineAfterDelete = await evalOn(cdp, TIMELINE);
        await shot(cdp, '03-deleted-c-0003');
        sc.undoDeleteVia = await undo(cdp);
        sc.steps.push(await snapshot('after-undo-delete'));
        sc.captionsAfterUndoDelete = await readText(PJ, 'captions.json');
        sc.status = 'ok';
    } catch (error) {
        sc.status = 'error'; sc.error = sanitize(error, REPO);
        try { await shot(cdp, '99-error'); } catch {}
    } finally {
        await stop(session);
    }
}
rec.status = Object.values(rec.scenarios).every(s => s.status === 'ok') ? 'ok' : 'error';
await writeFile(path.join(OUT, 'results-before.json'), `${S(scrub(rec), null, 2)}\n`);
console.log(S({ status: rec.status, errors: Object.fromEntries(Object.entries(rec.scenarios).map(([k, v]) => [k, v.error ?? null])) }));
