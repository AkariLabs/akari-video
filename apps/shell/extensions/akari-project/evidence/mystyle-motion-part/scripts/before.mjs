#!/usr/bin/env node
// 手順 0（BEFORE）の実機記録: 保存ダイアログ（動きのある字幕 c-0001）・棚（見た目だけ / 見た目 + 動き のスタイル）・当てる。
// ラッパー作成の検証スクリプト。判定はしない。基点のビルドで実行する。
// 使い方: node before.mjs <作業用ディレクトリ（実体パス）>   （fixture = <作業用>/fixture/spoken。CDP_PORT 既定 9489）
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn } from './cdp-lib.mjs';
import { command, launch, sanitize, sleep, stop } from './l1-lib.mjs';
import { openProject } from './l1-common.mjs';
import { prepareLibrary } from './library-home.mjs';
import { DIALOG, NOTICE, S, SHELF, clickSel, key, openShelf, setupWindow, shotTo, styleFiles, typeInto, waitFor } from './common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
const WORK = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9489);
const PJ = path.join(WORK, 'ws');
const ISO = path.join(WORK, 'iso');
const LIBRARY = path.join(WORK, 'creator', 'library');
const STYLES = path.join(LIBRARY, 'styles');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim() };
const scrub = value => JSON.parse(S(value).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>'));
const shot = (cdp, name) => shotTo(cdp, WORK, path.join(OUT, `before-${name}.png`));
const captions = async () => JSON.parse(await readFile(path.join(PJ, 'captions.json'), 'utf8')).captions;
const select = (cdp, ids) => evalOn(cdp, command('akari.timeline.selectCaptions', { editUri: `file://${path.join(PJ, 'edit.json')}`, captionIds: ids }));

await rm(PJ, { recursive: true, force: true });
await rm(path.join(WORK, 'creator'), { recursive: true, force: true });
await mkdir(LIBRARY, { recursive: true });
await cp(path.join(WORK, 'fixture', 'spoken'), PJ, { recursive: true });
process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
// 見た目 + 動き の style.json を起動前に手で置く（v0 の保存形 + motion 部品。棚は起動時に一覧を読む）
const HAND_MOTION = { schema: 'akari-style', version: 1, revision: 1, uid: '01K5ZXY123ABCDEFGHJKMNPQRS', id: 'hand-motion',
    name: '手で足した動き入り', when_to_use: '登場で持ち上がり、ふわふわ浮かせたいとき', sample_text: '今日は朝のルーティンを紹介します',
    created_at: '2026-09-24T00:00:00.000Z', updated_at: '2026-09-24T00:00:00.000Z', tags: [], visibility: 'private', price: null,
    requires: [], provenance: {}, license: { spdx: 'LicenseRef-user-owned', scope: 'private-owned', attribution_required: false, ai_training_allowed: false },
    parts: [{ kind: 'look', scope: 'caption', mode: 'modify', text_style: { color: '#00E5FF', size_px: 48, reference_height_px: 720,
        stroke: { color: '#002233', width_px: 4 }, background: { opacity: 0 }, shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } } },
    { kind: 'motion', scope: 'caption', mode: 'modify', animation: { in: { id: 'fade-up', duration_sec: 0.6 }, loop: { id: 'float' } } }] };
await mkdir(path.join(STYLES, 'hand-motion'), { recursive: true });
await writeFile(path.join(STYLES, 'hand-motion', 'style.json'), `${S(HAND_MOTION, null, 2)}\n`);
const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PJ, port: PORT, isoDir: ISO, prepare: iso => prepareLibrary(iso, LIBRARY) });
const cdp = session.cdp;
try {
    await openProject(session, PJ, 1, PORT);
    await setupWindow(cdp);
    // 1. 保存ダイアログ（動きのある c-0001）
    await select(cdp, ['c-0001']);
    await evalOn(cdp, command('akari.inspector.open'));
    await sleep(1200);
    await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
    await clickSel(cdp, '[data-akari-my-style-inspector-save]');
    rec.saveDialogWithMotion = await waitFor('dialog', () => evalOn(cdp, DIALOG));
    await typeInto(cdp, '[data-akari-my-style-name]', '強調テロップ');
    await typeInto(cdp, '[data-akari-my-style-when]', '驚きや大事な一言を目立たせたいとき');
    await shot(cdp, '01-save-dialog');
    await clickSel(cdp, '[data-akari-my-style-save]');
    const files = await waitFor('style.json written', async () => { const f = await styleFiles(STYLES); return Object.keys(f).length > 1 ? f : null; });
    const savedId = Object.keys(files).find(id => id !== 'hand-motion');
    const saved = JSON.parse(files[savedId]);
    rec.savedStyle = { id: savedId, parts: saved.parts.map(p => ({ kind: p.kind, keys: Object.keys(p), hasAnimation: S(p).includes('animation') })) };
    // 3. 棚
    await openShelf(cdp);
    await sleep(1000);
    rec.shelf = await evalOn(cdp, SHELF);
    await shot(cdp, '02-shelf');
    // 見本にマウスを乗せたときに動くか（Web Animations / CSS animation の数）
    const sample = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-my-style-card="hand-motion"] [data-akari-my-style-preview]');if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (sample) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sample.x, y: sample.y, button: 'none' });
        await sleep(150);
        rec.sampleHover = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-my-style-card="hand-motion"] [data-akari-my-style-preview]');return{animations:e.getAnimations({subtree:true}).length,cssAnimation:getComputedStyle(e).animationName}})()`);
    }
    // 4. 当てる（見た目 + 動き のスタイルを c-0002〜c-0004 に）
    const before = Object.fromEntries((await captions()).map(c => [c.id, { text_style: c.text_style ?? null, style_preset: c.style_preset ?? null }]));
    await select(cdp, ['c-0002', 'c-0003', 'c-0004']);
    await sleep(800);
    await clickSel(cdp, '[data-akari-my-style-apply="hand-motion"]');
    await sleep(1500);
    rec.applyPopover = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-my-style-apply-popover],[role="dialog"][aria-label*="当て"]');return e?e.innerText.replace(/\\n+/g,' / '):null})()`);
    const after = Object.fromEntries((await captions()).map(c => [c.id, { text_style: c.text_style ?? null, style_preset: c.style_preset ?? null }]));
    rec.applyResult = Object.fromEntries(['c-0002', 'c-0003', 'c-0004'].map(id => [id, {
        before: before[id], after: after[id], animationBefore: before[id].text_style?.animation ?? null, animationAfter: after[id].text_style?.animation ?? null
    }]));
    rec.applyNotices = await evalOn(cdp, NOTICE);
    try { rec.usage = JSON.parse(await readFile(path.join(PJ, '.akari', 'style-usage.json'), 'utf8')); } catch { rec.usage = null; }
    await shot(cdp, '03-apply-notice');
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    await sleep(1500);
    rec.undoOnceEqualsFixture = (await readFile(path.join(PJ, 'captions.json'), 'utf8')) === (await readFile(path.join(WORK, 'fixture', 'spoken', 'captions.json'), 'utf8'));
    // 5. 動きの無い c-0005 の保存ダイアログ
    await select(cdp, ['c-0005']);
    await sleep(1000);
    await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
    await clickSel(cdp, '[data-akari-my-style-inspector-save]');
    rec.saveDialogWithoutMotion = await waitFor('dialog', () => evalOn(cdp, DIALOG));
    await key(cdp, 'Escape', 'Escape', 27);
    rec.status = 'ok';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(scrub(rec), null, 2)}\n`);
}
console.log(S({ status: rec.status, error: rec.error }));
