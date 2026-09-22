#!/usr/bin/env node
// L1 追補（r1）: 左「メニュー」の「ひらく」行のアイコン（台本・カット候補・注釈）が、右レールと同じ線画
// （akari-rail-icon-*・codicon なし）で描かれることを実機（Electron + CDP・ダーク）で撮影して確かめる。
// 使い方: node l1-menu-icons.mjs [--port=9458]。一時ディレクトリは /tmp/right-rail-regroup-l1（専用）。
import { spawn } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const L1 = '/tmp/right-rail-regroup-l1';
const PROJECT = path.join(L1, 'project-menu');
const ISO = path.join(L1, 'iso-menu');
const RESULTS = path.join(ROOT, 'results-menu-icons.json');
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9458);
const out = { startedAt: new Date().toISOString(), port: PORT };

const run = (cmd, args) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args); let stdout = '';
    child.stdout.on('data', d => { stdout += d; }); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout }) : reject(new Error(`${cmd} exited ${code}`)));
});
async function waitEval(cdp, expression, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const v = await evalOn(cdp, expression); if (v) return v; } catch { /* retry */ }
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
        await sleep(300);
    }
    throw new Error(`not reached: ${expression.slice(0, 80)}`);
}

let pid;
try {
    await rm(PROJECT, { recursive: true, force: true }); await rm(ISO, { recursive: true, force: true });
    await mkdir(L1, { recursive: true });
    await cp(path.join(REPO, 'templates', 'project-default'), PROJECT, { recursive: true });
    const started = Date.now();
    const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), SHELL, PROJECT, String(PORT), ISO, path.join(L1, 'menu.log')]);
    pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
    let target;
    while (!target && Date.now() - started < 600_000) {
        try { target = (await listTargets(PORT)).find(t => t.type === 'page'); } catch { /* not up */ }
        if (!target) await sleep(500);
    }
    const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await waitEval(cdp, `!document.querySelector('.theia-preload')&&!!document.getElementById('theia-right-content-panel')&&!!window.theia`, 600_000);
    out.readyMs = Date.now() - started;
    await sleep(2500);
    await evalOn(cdp, `(async()=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(k=>{try{return typeof k==='function'&&k.prototype&&typeof k.prototype.activateWidget==='function'&&typeof k.prototype.revealWidget==='function'}catch{return false}});await c.get(k).activateWidget('akari-menu-widget');return true})()`);
    await waitEval(cdp, `!!document.querySelector('#akari-menu-widget [data-akari-menu-section="open"] button')`);
    await sleep(800);
    out.rows = await evalOn(cdp, `[...document.querySelectorAll('#akari-menu-widget [data-akari-menu-section="open"] button')].map(b=>{const i=b.querySelector('span[aria-hidden]');const s=getComputedStyle(i);const r=i.getBoundingClientRect();return {label:b.textContent.trim(),iconClass:i.className,mask:s.maskImage&&s.maskImage!=='none'||s.webkitMaskImage&&s.webkitMaskImage!=='none',bg:s.backgroundColor,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}})`);
    const want = { '台本': 'akari-rail-icon-daihon', 'カット候補': 'akari-rail-icon-cuts', '注釈': 'akari-rail-icon-review' };
    out.checks = Object.entries(want).map(([label, cls]) => {
        const row = out.rows.find(r => r.label === label);
        return { label, pass: !!row && row.iconClass.includes(cls) && !row.iconClass.includes('codicon') && row.mask && row.rect.w > 0 && row.rect.h > 0, row };
    });
    const panel = await evalOn(cdp, `(()=>{const r=document.querySelector('#akari-menu-widget').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,420)}})()`);
    await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...panel, scale: 2 } });
    await writeFile(path.join(ROOT, '12-menu-open-row-icons.png'), Buffer.from(data, 'base64'));
    out.screenshot = '12-menu-open-row-icons.png';
    out.pass = out.checks.every(c => c.pass);
    cdp.close();
} catch (error) {
    out.pass = false; out.error = String(error?.stack || error).replaceAll(REPO, '<worktree>');
} finally {
    if (pid) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
        for (let i = 0; i < 60; i++) { try { process.kill(pid, 0); await sleep(500); } catch { break; } }
        try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
    await writeFile(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify({ pass: out.pass, checks: out.checks?.map(c => [c.label, c.pass]), error: out.error }, null, 1));
}
