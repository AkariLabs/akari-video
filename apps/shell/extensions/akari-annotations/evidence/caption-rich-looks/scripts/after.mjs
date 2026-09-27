#!/usr/bin/env node
// 手順 5（AFTER）。ラッパー作成の検証スクリプト。変更後のビルド（apps/shell を build 済み）で実行する。
// 編集パネルのテキストタブの効果カード（28 種・新しい 7 枚）を実機で操作する:
//   カードの数・段・画像 / ホバーで出力プレビューに仮に当たり Esc で戻る / クリックで確定 / undo 1 回 / 調整欄の出し分けと調整の書き込み。
// 7 枚を c-0001〜c-0007 に 1 枚ずつ UI から当て（c-0008 は既存の「袋文字 太」）、出力プレビューの同じ時刻を撮る。
// 続けて同じプロジェクトを render-cut --engine osr（worktree の Electron = tier 2）で書き出して同じ時刻のフレームを抜き、
// 上 = プレビュー・下 = 書き出しの比較画像と PSNR（参考値）を残す。最後に --engine auto / gpu の振る舞い（OSR へ回る / 拒否）を記録する。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node after.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9638）
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, PORT, REPO, S, clickSel, dismissToasts, hoverSel, key, openProject, paths, selectCaption, shooter, start } from './common.mjs';
import { view } from './view.mjs';
import { LOOKS, midTime } from './gen-fixture.mjs';

const WORK = process.argv[2];
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const rec = { phase: 'after', head: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), obs: {}, checks: {} };
const check = (name, ok, detail) => { rec.checks[name] = { ok: !!ok, ...(detail === undefined ? {} : { detail }) }; console.log(ok ? 'PASS' : 'FAIL', name); };
async function observe(name, fn) {
    try { rec.obs[name] = await fn(); console.log('OK', name); }
    catch (error) { rec.obs[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
const EFFECT = '[data-akari-ui="section:inspector-style:effect"]';
const tab = id => `(()=>{document.querySelector('[data-akari-ui="tab:inspector-${id}"]')?.click();return true})()`;
const scrollTo = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return false;e.scrollIntoView({block:'start'});return true})()`;
const cardSel = id => `${EFFECT} .akari-effect-card[data-value="${id}"]`;
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
// 出力プレビューの字幕の行（描画に効く計算済みスタイル）
const LINE = captionText => `(()=>{const host=[...document.querySelectorAll('.caption-row-plate')].find(e=>(e.innerText||'').replace(/\\s+/g,'')===${S(captionText.replace(/\s+/g, ''))});if(!host)return null;const l=host.querySelector('.akari-caption__line')||host;const cs=getComputedStyle(l);return{stroke:cs.webkitTextStroke||cs.getPropertyValue('-webkit-text-stroke-width')+' '+cs.getPropertyValue('-webkit-text-stroke-color'),textShadow:cs.textShadow.slice(0,120),textShadowLayers:cs.textShadow==='none'?0:cs.textShadow.split(/,(?![^(]*\\))/).length,filter:cs.filter.slice(0,120),filterSteps:cs.filter==='none'?0:(cs.filter.match(/drop-shadow/g)||[]).length,bgImage:cs.backgroundImage.slice(0,120),fill:cs.webkitTextFillColor}})()`;
const fieldsOf = `[...document.querySelectorAll(${S(EFFECT + ' [data-akari-field]')})].map(e=>e.dataset.akariField).filter(f=>f!=='caption-style-effect')`;

let session, cdp, v;
const p = paths(WORK, 'plain');
const shot = shooter(p, 'after');
const capOf = async id => (await readJson(path.join(p.PJ, 'captions.json'))).captions.find(c => c.id === id);
const EXPECT_FIELD = { 'ol-double-black': 'strokeInner', 'ol-double-color': 'strokeInner', 'fill-sunset': 'fillGradient', 'fill-ocean': 'fillGradient', 'fill-rainbow': 'fillGradient', 'ex-gold': 'extrude', 'ex-silver': 'extrude' };
const JSON_KEY = { strokeInner: 'stroke_inner', fillGradient: 'fill_gradient', extrude: 'extrude' };
const frames = path.join(WORK, 'frames');

try {
    await rm(frames, { recursive: true, force: true }); await mkdir(frames, { recursive: true });
    session = await start(p); cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    v = await view(PORT);
    const fixture = await readJson(path.join(p.PJ, 'captions.json'));
    await selectCaption(cdp, 'c-0001');
    await dismissToasts(cdp);

    await observe('effect-cards', async () => {
        await evalOn(cdp, tab('text')); await sleep(1000);
        await evalOn(cdp, scrollTo(EFFECT)); await sleep(1500);
        const state = await evalOn(cdp, `(()=>{const cards=[...document.querySelectorAll(${S(EFFECT + ' .akari-effect-card')})];const groups=[...document.querySelectorAll(${S(EFFECT + ' .akari-effect-group-title')})].map(e=>e.textContent);const img=c=>c.querySelector('img');return{n:cards.length,groups,ids:cards.map(c=>c.dataset.value),labels:cards.map(c=>c.innerText.trim()),distinctImages:new Set(cards.map(c=>img(c)?.src)).size,imagesReady:cards.filter(c=>{const i=img(c);return i&&i.complete&&i.naturalWidth>0}).length}})()`);
        const newIds = Object.keys(EXPECT_FIELD);
        check('effect: 28 枚・7 段（塗り・立体が増える）・画像が全部違う', state.n === 28 && state.groups.join() === '影,光,縁,塗り,立体,帯,組み合わせ' && state.distinctImages === 28 && state.imagesReady === 28, state);
        check('effect: 新しい 7 枚が並ぶ', newIds.every(id => state.ids.includes(id)), state.ids);
        await evalOn(cdp, scrollTo(`${EFFECT} .akari-effect-card[data-value="ol-double-black"]`)); await sleep(800);
        return { state, shot: await shot(cdp, '01-effect-cards-new') };
    });

    // 7 枚を 1 枚ずつ: ホバー → Esc → クリックで確定（c-0001 は undo 1 回も）
    await observe('effect-new-cards', async () => {
        const out = {};
        for (const [index, look] of LOOKS.entries()) {
            const id = `c-000${index + 1}`;
            const text = fixture.captions[index].text;
            // 先にシークしてから選ぶ（選んだあとにシークすると出力プレビュー側の選択が外れ、ホバーの仮当てが効かない）
            await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: midTime(index) })); await sleep(1800);
            // 同じ字幕を選び直しても選択の通知が出ないので、いったん別の字幕を選んでから選ぶ
            await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${index === 7 ? 'c-0001' : 'c-0008'}"]`); await sleep(900);
            await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${id}"]`); await sleep(1400);
            await evalOn(cdp, tab('text')); await sleep(600);
            const base = await v.eval(LINE(text));
            await hoverSel(cdp, cardSel(look.id)); await sleep(1500);
            const hover = await v.eval(LINE(text));
            const hoverShot = index === 0 || index === 2 || index === 5 ? await shot(cdp, `02-hover-${look.id}`) : null;
            const hoverFile = await capOf(id);
            await key(cdp, 'Escape', 'Escape', 27); await sleep(1400);
            const esc = await v.eval(LINE(text));
            await clickSel(cdp, cardSel(look.id)); await sleep(2500);
            const written = (await capOf(id)).text_style ?? null;
            const pressed = await evalOn(cdp, `[...document.querySelectorAll(${S(EFFECT + ' .akari-effect-card[aria-pressed="true"]')})].map(c=>c.dataset.value)`);
            const fields = await evalOn(cdp, fieldsOf);
            const confirmed = await v.eval(LINE(text));
            out[look.id] = { base, hover, esc, confirmed, written, pressed, fields, hoverShot, hoverWroteFile: !isDeepStrictEqual(hoverFile, fixture.captions[index]) };
            if (index === 0) {
                await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${id}"]`); await sleep(1200);
                await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
                out[look.id].undone = (await capOf(id)).text_style ?? null;
                await clickSel(cdp, cardSel(look.id)); await sleep(2500);
                out[look.id].reapplied = (await capOf(id)).text_style ?? null;
            }
        }
        for (const look of LOOKS) {
            const r = out[look.id]; const field = EXPECT_FIELD[look.id];
            if (!field) continue;
            check(`${look.id}: ホバーで出力プレビューに仮に当たり（ファイルは書かない）、Esc で戻る`, !isDeepStrictEqual(r.hover, r.base) && isDeepStrictEqual(r.esc, r.base) && !r.hoverWroteFile, { base: r.base, hover: r.hover, esc: r.esc });
            check(`${look.id}: クリックで確定（captions.json に ${JSON_KEY[field]}）・カードが選択表示`, r.written?.[JSON_KEY[field]] != null && S(r.pressed) === S([look.id]), { written: r.written, pressed: r.pressed });
            const own = r.fields.filter(f => f.startsWith('caption-effect-adjust-'));
            const expectedPrefix = { strokeInner: /stroke/, fillGradient: /fillGradient/, extrude: /extrude/ }[field];
            check(`${look.id}: 調整欄はその見た目の項目だけ`, own.length > 0 && own.every(f => expectedPrefix.test(f)), own);
        }
        const first = out['ol-double-black'];
        check('undo 1 回で元に戻る（c-0001）', isDeepStrictEqual(first.undone ?? null, fixture.captions[0].text_style ?? null), { undone: first.undone });
        const lines = LOOKS.slice(0, 7).map(l => S(out[l.id].confirmed));
        check('新しい 7 種はプレビューで全部違う描き方になる', new Set(lines).size === 7, Object.fromEntries(LOOKS.slice(0, 7).map(l => [l.id, out[l.id].confirmed])));
        return out;
    });

    // 調整: 3D 金（c-0006）の奥行きを 8 → 14 に変えて書き込まれることを確かめ、undo で戻す
    await observe('effect-adjust', async () => {
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0006"]'); await sleep(1400);
        await evalOn(cdp, tab('text')); await sleep(600);
        const before = (await capOf('c-0006')).text_style;
        const sel = `${EFFECT} [data-akari-field="caption-effect-adjust-extrude-depthPx"] input`;
        const pt = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,value:e.value}})()`);
        if (!pt) throw new Error('depth input not found');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 2 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 2 });
        await sleep(300);
        await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});e.focus();e.select?.();return true})()`);
        await cdp.send('Input.insertText', { text: '14' }); await sleep(200);
        await key(cdp, 'Enter', 'Enter', 13); await sleep(2500);
        const after = (await capOf('c-0006')).text_style;
        const adjustShot = await shot(cdp, '03-adjust-ex-gold-depth14');
        // 入力欄にフォーカスがあるとタイムラインの undo が効かないので、字幕のチップを押してから undo
        await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
        await key(cdp, 'Escape', 'Escape', 27); await sleep(400);
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0007"]'); await sleep(1200);
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0006"]'); await sleep(1500);
        rec.adjustUndoVia = await evalOn(cdp, command('akari.timeline.undo')).then(() => 'command', async () => {
            await key(cdp, 'z', 'KeyZ', 90, 4); return 'cmd+z';
        });
        await sleep(2500);
        const undone = (await capOf('c-0006')).text_style;
        check('調整: 3D の奥行きを変えると extrude.depth_px に書かれ、undo で戻る', after?.extrude?.depth_px === 14 && isDeepStrictEqual(undone, before), { before: before?.extrude, after: after?.extrude, undone: undone?.extrude, inputValue: pt.value });
        return { adjustShot };
    });

    // c-0008 は既存の「袋文字 太」
    await observe('legacy-card', async () => {
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0008"]'); await sleep(1400);
        await evalOn(cdp, tab('text')); await sleep(600);
        await clickSel(cdp, cardSel('ol-thick')); await sleep(2500);
        return (await capOf('c-0008')).text_style;
    });

    rec.writes = Object.fromEntries((await readJson(path.join(p.PJ, 'captions.json'))).captions.map(c => [c.id, c.text_style ?? null]));
    // 選択の枠・道具を消して、字幕の段だけを同じ時刻で撮る
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await evalOn(cdp, command('akari.timeline.clearSelection')).catch(() => {});
    await v.eval(`(()=>{const s=document.createElement('style');s.textContent='.akari-caption-select-tools,.akari-caption-handle-box,.akari-caption-handle,[class*="select-box"],[class*="selection"]{display:none!important}';document.head.appendChild(s);return true})()`);
    const frameRect = await evalOn(cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top}})()`);
    for (const [index] of LOOKS.entries()) {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: midTime(index) }));
        await sleep(2500);
        const stage = await v.eval(`(()=>{const r=document.getElementById('preview-stage').getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
        rec.previewStage = stage;
        const clip = { x: frameRect.left + stage.x, y: frameRect.top + stage.y, width: stage.width, height: stage.height, scale: 1 };
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
        await writeFile(path.join(frames, `preview-${index}.png`), Buffer.from(data, 'base64'));
    }
    v.close();
    await stop(session); session = null;
    try { execFileSync('/usr/bin/pkill', ['-f', p.ISO]); } catch {}

    // 書き出し（OSR・tier 2）と比較
    const renders = {};
    const renderWith = async (engine, name) => {
        const project = path.join(WORK, `export-${name}`);
        await rm(project, { recursive: true, force: true });
        await cp(p.PJ, project, { recursive: true });
        const outFile = path.join(project, 'exports', `${name}.mp4`);
        const started = Date.now();
        const r = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', engine, '--out', outFile],
            { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0', AKARI_HOME: path.join(WORK, 'akari-home-caption-rich-looks') } });
        let renderJson = null; try { renderJson = await readJson(path.join(project, '.akari', 'render.json')); } catch {}
        const tiers = {};
        const walk = (value, trail) => { if (!value || typeof value !== 'object') return; for (const [k, val] of Object.entries(value)) { if (k === 'launcher_tier') tiers[trail.concat(k).join('.')] = val; else walk(val, trail.concat(k)); } };
        walk(renderJson?.provenance ?? {}, ['provenance']);
        const log = `${r.stdout}\n${r.stderr}`;
        renders[name] = { engineRequested: engine, exit: r.status, seconds: Math.round((Date.now() - started) / 1000), engine: renderJson?.provenance?.engine ?? null, launcherTiers: tiers,
            ineligibleWarning: (log.match(/GPU export is ineligible[^\n]*/u) ?? [null])[0], refusal: r.status === 0 ? null : log.split('\n').filter(Boolean).slice(-3).join(' | '), osrFallbackToLegacy: /フォールバック/u.test(log) };
        return outFile;
    };
    const osrFile = await renderWith('osr', 'osr');
    await renderWith('auto', 'auto');
    await renderWith('gpu', 'gpu');
    rec.renders = renders;
    check('OSR 書き出しは tier 2 の Electron（legacy へ落ちていない）', renders.osr.exit === 0 && Object.values(renders.osr.launcherTiers).includes(2) && !renders.osr.osrFallbackToLegacy, renders.osr);
    check('auto: GPU 不適格として OSR へ回り、理由に新しい見た目が出る', renders.auto.exit === 0 && renders.auto.engine === 'osr' && /caption-rich-look-/u.test(renders.auto.ineligibleWarning ?? ''), renders.auto);
    check('gpu を明示: 黙って違う見た目を出さず、理由つきで拒否する', renders.gpu.exit !== 0 && /caption-rich-look-/u.test(renders.gpu.refusal ?? ''), renders.gpu);

    const psnr = {};
    for (const [index, look] of LOOKS.entries()) {
        const t = midTime(index);
        const osrPng = path.join(frames, `osr-${index}.png`);
        const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(t), '-i', osrFile, '-frames:v', '1', osrPng]);
        if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
        // 字幕の段（下 40%）を 1280 幅で上下に並べる
        const cmp = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(frames, `preview-${index}.png`), '-i', osrPng,
            '-filter_complex', '[0:v]scale=1280:720,crop=1280:230:0:470[a];[1:v]scale=1280:720,crop=1280:230:0:470[b];[a][b]vstack', '-frames:v', '1', path.join(OUT, `osr-compare-${index + 1}-${look.id}.png`)]);
        if (cmp.status !== 0) throw new Error(`compare failed: ${cmp.stderr}`);
        const q = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-i', path.join(frames, `preview-${index}.png`), '-i', osrPng,
            '-filter_complex', '[0:v]scale=1280:720,crop=1280:230:0:470,format=rgb24[a];[1:v]scale=1280:720,crop=1280:230:0:470,format=rgb24[b];[a][b]psnr', '-f', 'null', '-'], { encoding: 'utf8' });
        psnr[look.id] = Number((q.stderr.match(/average:([0-9.inf]+)/u) ?? [])[1]) || (q.stderr.match(/average:([0-9.inf]+)/u) ?? [])[1] || null;
    }
    rec.psnrCaptionBand = psnr;
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-after.json'), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, fails: Object.entries(rec.checks).filter(([, c]) => !c.ok).map(([k]) => k), psnr: rec.psnrCaptionBand }));
process.exit(0);
