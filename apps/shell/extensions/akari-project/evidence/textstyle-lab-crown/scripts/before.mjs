#!/usr/bin/env node
// 手順 0（BEFORE）の実機記録（ラッパー作成の検証スクリプト。判定はしない）。
// (1) テキストのページ（スタイル | フォント）のスクリーンショットと、スタイルのカードの件数
// (2) glitch / neon / emphasis-red を既存の字幕（c-0002 / c-0003 / c-0004）に当てたとき captions.json に残る値
// 使い方: node gen-fixture.mjs <作業用>/fixture && node before.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9637）
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, exec, openProject, openTextPage, paths, shooter, start } from './common.mjs';

const p = paths(process.argv[2]);
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim() };
const shot = shooter(p, 'before');
const readCaptions = async () => JSON.parse(await readFile(path.join(p.PJ, 'captions.json'), 'utf8'));
const preset = async id => JSON.parse(await readFile(path.join(REPO, 'presets', 'textstyle', `${id}.json`), 'utf8')).style;
async function waitChange(before, ms = 15_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (S(await readCaptions()) !== before) return true; await sleep(250); }
    return false;
}
await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await openTextPage(cdp);
    await waitEval(cdp, `document.querySelectorAll('[data-akari-library-text-look-page] [data-akari-catalog-preset-item^="textstyle/"]').length>0`, { label: 'textstyle cards', timeoutMs: 60_000 });
    await sleep(1000);
    rec.stylePage = await evalOn(cdp, `(()=>{const pg=document.querySelector('[data-akari-library-text-look-page]');return{tabs:[...pg.querySelectorAll('[role=tab]')].map(t=>t.textContent.trim()),textstyleCards:[...pg.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]')].map(e=>e.getAttribute('data-akari-catalog-preset-item')),telopShelf:Boolean(pg.querySelector('[data-akari-library-text-switch="telop"]'))}})()`);
    rec.stylePage.textstyleCount = rec.stylePage.textstyleCards.length;
    rec.shots = [await shot(cdp, '00-text-page-style')];
    await clickSel(cdp, '[data-akari-library-text-switch="font"]');
    await sleep(2000);
    rec.shots.push(await shot(cdp, '01-text-page-font'));
    await clickSel(cdp, '[data-akari-library-text-switch="style"]');
    await sleep(1500);
    rec.apply = [];
    for (const [captionId, styleId] of [['c-0002', 'glitch'], ['c-0003', 'neon'], ['c-0004', 'emphasis-red']]) {
        await dismissToasts(cdp);
        await evalOn(cdp, exec('akari.timeline.selectCaptions', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, captionIds: [captionId] }));
        await sleep(1200);
        const before = await readCaptions();
        await clickSel(cdp, `[data-akari-text-look-section="style"] [data-akari-catalog-preset-item="textstyle/${styleId}"]`);
        const changed = await waitChange(S(before));
        await sleep(1000);
        const after = (await readCaptions()).captions.find(c => c.id === captionId);
        const style = await preset(styleId);
        const kept = after.text_style ?? {};
        rec.apply.push({ captionId, styleId, changed, presetStyle: style, captionRowAfter: after,
            missingKeys: Object.keys(style).filter(k => !(k in kept)),
            text_transform: { preset: style.text_transform ?? null, captions: kept.text_transform ?? null },
            animation: { preset: style.animation ?? null, captions: kept.animation ?? null } });
    }
    rec.shots.push(await shot(cdp, '02-after-apply'));
    rec.status = 'ok';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(rec, null, 2)}\n`);
}
console.log(S({ status: rec.status, error: rec.error, count: rec.stylePage?.textstyleCount, missing: rec.apply?.map(a => [a.styleId, a.missingKeys]) }));
