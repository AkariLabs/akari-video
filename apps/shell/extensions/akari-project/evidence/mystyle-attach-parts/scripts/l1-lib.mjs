// 文字をすぐ置く L1 の共通部品（daihon-placed-text-bars の写し）（Electron 起動・CDP 接続・待ち・クリック）。
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, rename } from 'node:fs/promises';
import { openSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

export { evalOn, realClick, screenshot, sleep };
export const S = value => JSON.stringify(value);

export function sanitize(value, repo) {
    return String(value?.stack || value?.message || value)
        .replaceAll(repo, '<worktree>')
        .replace(/\/Users\/[^\s)'"]+/g, '<machine-path>')
        .replace(/\/(private\/)?(tmp|var)\/[^\s)'"]+/g, '<machine-path>');
}

export async function saveJson(file, value) {
    const temporary = `${file}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, file);
}

export async function waitEval(cdp, expression, { timeoutMs = 90_000, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            const value = await evalOn(cdp, expression);
            if (value) return value;
        } catch (error) { last = error; }
        await sleep(200);
    }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

export async function launch({ shellDir, electron, project, port, isoDir, prepare, keep = false }) {
    if (!keep) await rm(isoDir, { recursive: true, force: true }); // keep: 起動し直し（ユーザー設定 = user-data-dir を残す）
    await mkdir(isoDir, { recursive: true });
    if (prepare) await prepare(isoDir); // マイスタイル v0: 起動前に AKARI_HOME へ library-location.json を置く
    const log = openSync(path.join(isoDir, 'electron.log'), 'a');
    const child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, `--user-data-dir=${isoDir}`, '--no-sandbox'], {
        env: { ...process.env, THEIA_CONFIG_DIR: isoDir, AKARI_HOME: path.join(isoDir, 'akari-home') },
        stdio: ['ignore', log, log], detached: true
    });
    child.unref();
    const pid = child.pid;
    let target;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !target) {
        try { target = (await listTargets(port)).find(item => item.type === 'page'); } catch {}
        if (!target) await sleep(400);
    }
    if (!target) { try { process.kill(pid, 'SIGTERM'); } catch {} throw new Error('CDP page target did not appear'); }
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => {});
    // 負荷の高い時間帯は起動に数分かかる（2026-09-24 実測: load average 150〜270 で 76 秒〜3 分超）。失敗時は起動した PID だけを止める
    try { await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 600_000 }); }
    catch (error) { cdp.close(); try { process.kill(pid, 'SIGTERM'); } catch {} throw error; }
    await settlePreload(cdp);
    return { pid, cdp };
}

async function settlePreload(cdp) {
    const deadline = Date.now() + 120_000;
    let hiddenSince = null;
    while (Date.now() < deadline) {
        const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
        if (!state.exists) return;
        if (state.hidden) {
            hiddenSince ??= Date.now();
            if (Date.now() - hiddenSince >= 5_000) {
                await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(el)el.style.pointerEvents='none';return true})()`);
                return;
            }
        } else hiddenSince = null;
        await sleep(250);
    }
}

export async function stop(session) {
    session?.cdp?.close();
    if (session?.pid) {
        try { process.kill(session.pid, 'SIGTERM'); } catch {}
        await sleep(2500);
        try { process.kill(session.pid, 0); process.kill(session.pid, 'SIGKILL'); } catch {}
    }
}

export const command = (id, arg) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});return r!==null&&typeof r==='object'?'[object]':r??null})()`;

export async function clickSelector(cdp, selector, modifiers = 0) {
    await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 30_000 });
    await sleep(200);
    const point = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realClick(cdp, point.x, point.y, { modifiers });
}

export async function pressKey(cdp, key, code, keyCode, modifiers) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

// 台本パネルの行ごとの寸法（行・時刻セル・本文・行番号セルがあればそれも）。
export const ROW_METRICS = `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const px=v=>Math.round(v*100)/100;return rows.map(row=>{const r=row.getBoundingClientRect();const text=row.querySelector('.akari-daihon-row-text');const tc=row.querySelector('.akari-daihon-tc');const num=row.querySelector('[data-daihon-rownum], .akari-daihon-rownum, .akari-daihon-row-num');const rel=e=>{if(!e)return null;const b=e.getBoundingClientRect();const cs=getComputedStyle(e);return{left:px(b.left-r.left),width:px(b.width),paddingLeft:cs.paddingLeft,paddingRight:cs.paddingRight,marginLeft:cs.marginLeft,marginRight:cs.marginRight}};return{id:row.dataset.captionId,text:(text?.textContent||'').slice(0,24),height:px(r.height),width:px(r.width),rowText:rel(text),timecode:rel(tc),rowNumber:rel(num),rowNumberText:num?.textContent??null}})})()`;
