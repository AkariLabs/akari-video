#!/usr/bin/env node
// 書き出しポップアップのエンジン理由 L1（実機 Electron + 生 CDP）。
// 使い方: node l1.mjs <fixture-root> <out-dir> [osr|gpu|lint ...]
//   fixture-root は gen-fixture.mjs の出力先。out-dir（リポの外）にスクショと results-<name>.json を書く。
// ポート・分離ディレクトリは AKARI_L1_PORT（既定 9477）と AKARI_L1_ISO（既定 OS の一時ディレクトリ配下）で変える。
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, launch, realClick, S, saveJson, sanitize, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const REPO = process.env.AKARI_REPO || fileURLToPath(new URL('../../../../../../../', import.meta.url)).replace(/\/$/u, '');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const PORT = Number(process.env.AKARI_L1_PORT || 9477);
const ISO_ROOT = process.env.AKARI_L1_ISO || path.join(os.tmpdir(), 'tl-export-engine-reason-l1');
const [fixtureRoot, outDir, ...names] = process.argv.slice(2);
if (!fixtureRoot || !outDir) throw new Error('usage: node l1.mjs <fixture-root> <out-dir> [osr|gpu|lint ...]');
delete process.env.ELECTRON_RUN_AS_NODE;

const STATE = `(()=>{const host=document.querySelector('.akari-export-dialog-host');if(!host||!host.isConnected)return{open:false};
const reason=host.querySelector('.akari-export-engine-reason');const summary=reason?.querySelector('summary');
const buttons=[...(reason?.querySelectorAll('button')??[])].map(b=>({text:b.textContent.trim(),disabled:b.disabled}));
return{open:true,title:host.querySelector('.ttl')?.textContent??null,sub:host.querySelector('.sub')?.textContent??null,
pill:host.querySelector('.ph .pill')?.textContent??null,
reason:reason?(summary?.textContent??reason.textContent).trim():null,reasonFull:reason?.textContent.trim()??null,
refused:Boolean(host.querySelector('.akari-export-refused')),buttons,
detailsOpen:Boolean(reason?.querySelector('details[open]')),
list:[...host.querySelectorAll('.akari-export-engine-reason-list li')].map(li=>li.textContent.trim()),
listUserSelect:(()=>{const l=host.querySelector('.akari-export-engine-reason-list');return l?getComputedStyle(l).userSelect:null})(),
engineMentions:(host.querySelector('.popup')?.textContent.match(/GPU|OSR/gu)??[]).length}})()`;

async function clickCenter(cdp, expression, label) {
    const point = await waitEval(cdp, `(()=>{const e=(${expression});if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, { label, timeoutMs: 30_000 });
    await realClick(cdp, point.x, point.y);
}

async function openDialog(cdp) {
    // 負荷の高い時間帯はシェルの組み立て（preload が消える）まで数分かかる。
    await waitEval(cdp, `document.getElementsByClassName('theia-preload').length===0&&[...document.querySelectorAll('.codicon-menu')].some(e=>e.getBoundingClientRect().width>0)`, { label: 'workbench attached', timeoutMs: 1_200_000 });
    await sleep(1500);
    await clickCenter(cdp, `[...document.querySelectorAll('.codicon-menu')].find(e=>e.getBoundingClientRect().width>0)`, 'menu icon');
    await sleep(600);
    await clickCenter(cdp, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='書き出し…'&&!b.disabled)`, 'export menu button');
    await waitEval(cdp, `Boolean(document.querySelector('.akari-export-dialog-host [data-akari-onboarding-target="export-submit"]'))`, { label: 'export dialog setup', timeoutMs: 30_000 });
    await sleep(500);
}

async function submit(cdp) {
    await clickCenter(cdp, `document.querySelector('.akari-export-dialog-host [data-akari-onboarding-target="export-submit"]')`, 'export submit');
    return Date.now();
}

async function openListAndCopy(cdp, result, shotPrefix) {
    await clickCenter(cdp, `document.querySelector('.akari-export-engine-reason summary')`, 'reason summary');
    await sleep(400);
    result[`${shotPrefix}Expanded`] = await evalOn(cdp, STATE);
    await screenshot(cdp, path.join(outDir, `${shotPrefix}-expanded.png`));
    const copyButton = await evalOn(cdp, `Boolean(document.querySelector('.akari-export-engine-reason-copy'))`);
    if (copyButton) {
        await clickCenter(cdp, `document.querySelector('.akari-export-engine-reason-copy')`, 'copy button');
        await sleep(400);
        result[`${shotPrefix}Copied`] = await evalOn(cdp, `navigator.clipboard.readText().catch(e=>'ERR '+e.message)`);
    } else {
        // コピーボタンが無い版: 一覧の文字が選択してコピーできるか（選択範囲の文字列）を測る。
        result[`${shotPrefix}Copied`] = await evalOn(cdp, `(()=>{const l=document.querySelector('.akari-export-engine-reason-list');const r=document.createRange();r.selectNodeContents(l);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
    }
}

async function runRender(cdp, name, result) {
    await openDialog(cdp);
    await screenshot(cdp, path.join(outDir, `${name}-00-setup.png`));
    const t0 = await submit(cdp);
    const first = await waitEval(cdp, `(()=>{const s=${STATE};return s.reason?s:null})()`, { label: 'engine reason line', timeoutMs: 180_000 });
    result.firstReasonMs = Date.now() - t0;
    result.running = first;
    await screenshot(cdp, path.join(outDir, `${name}-01-running.png`));
    if (name === 'osr' && first.title !== '書き出し完了') await openListAndCopy(cdp, result, `${name}-02-running`);
    const done = await waitEval(cdp, `(()=>{const s=${STATE};return s.title==='書き出し完了'||s.refused?s:null})()`, { label: 'export done', timeoutMs: 600_000 });
    await sleep(500);
    result.done = await evalOn(cdp, STATE);
    result.doneSeen = done;
    await screenshot(cdp, path.join(outDir, `${name}-03-done.png`));
    if (name === 'osr' && result.done.reason) await openListAndCopy(cdp, result, `${name}-04-done`);
}

async function runLint(cdp, result) {
    await openDialog(cdp);
    await submit(cdp);
    result.lintFailed = await waitEval(cdp, `(()=>{const s=${STATE};return s.refused?s:null})()`, { label: 'lint refusal', timeoutMs: 180_000 });
    await screenshot(cdp, path.join(outDir, 'lint-01-lint-failed.png'));
    // 2 本目: 「lint を再実行」を外して render-cut 自身の拒否（REFUSED 行）を通す。
    // 右下の案内トーストがボタンに重なることがあるので、押す前に閉じる。
    await evalOn(cdp, `(()=>{for(const b of document.querySelectorAll('.theia-notification-list-item .codicon-close, .akari-onboarding-toast [aria-label="閉じる"], .akari-toast-close'))b.click();return true})()`).catch(() => {});
    await sleep(300);
    await evalOn(cdp, `[...document.querySelectorAll('.akari-export-dialog-host .pf button')].find(b=>b.textContent.trim()==='設定に戻る').click()`);
    await waitEval(cdp, `Boolean(document.querySelector('.akari-export-dialog-host [data-akari-onboarding-target="export-submit"]'))`, { label: 'back to setup', timeoutMs: 30_000 });
    await sleep(400);
    await evalOn(cdp, `[...document.querySelectorAll('.akari-export-dialog-host .lb')].find(e=>e.textContent.trim()==='詳細設定').closest('button,[role=button],div').click()`);
    await waitEval(cdp, `Boolean([...document.querySelectorAll('.akari-export-dialog-host .chk')].find(b=>b.textContent.includes('lint を再実行')))`, { label: 'details open', timeoutMs: 30_000 });
    await evalOn(cdp, `[...document.querySelectorAll('.akari-export-dialog-host .chk')].find(b=>b.textContent.includes('lint を再実行')).click()`);
    await sleep(400);
    result.rerunLintOff = await evalOn(cdp, `![...document.querySelectorAll('.akari-export-dialog-host .chk')].find(b=>b.textContent.includes('lint を再実行'))?.querySelector('i.on')`);
    await screenshot(cdp, path.join(outDir, 'lint-02a-rerun-lint-off.png'));
    await submit(cdp);
    result.renderRefused = await waitEval(cdp, `(()=>{const s=${STATE};return s.refused&&s.sub==='書き出しを停止しました'?s:null})()`, { label: 'render-cut refusal', timeoutMs: 180_000 });
    await sleep(800);
    result.renderRefused = await evalOn(cdp, STATE);
    await screenshot(cdp, path.join(outDir, 'lint-02-render-refused.png'));
    const lintButton = result.renderRefused.buttons.find(b => b.text === 'Lint を開く');
    if (lintButton && !lintButton.disabled) {
        await clickCenter(cdp, `[...document.querySelectorAll('.akari-export-engine-reason button')].find(b=>b.textContent.trim()==='Lint を開く')`, 'open lint');
        await sleep(1500);
        result.afterOpenLint = await evalOn(cdp, `(()=>({dialogOpen:Boolean(document.querySelector('.akari-export-dialog-host')?.isConnected),activeTab:document.querySelector('.p-TabBar-tab.p-mod-current .p-TabBar-tabLabel, .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabLabel')?.textContent??null}))()`);
        await screenshot(cdp, path.join(outDir, 'lint-03-open-lint.png'));
    }
}

await mkdir(outDir, { recursive: true });
for (const name of names.length ? names : ['osr', 'gpu', 'lint']) {
    const result = { name, startedAt: new Date().toISOString() };
    let session;
    try {
        session = await launch({ shellDir: SHELL, electron: ELECTRON, project: path.join(fixtureRoot, name), port: PORT, isoDir: path.join(ISO_ROOT, name) });
        result.pid = session.pid;
        await sleep(3000);
        if (name === 'lint') await runLint(session.cdp, result);
        else await runRender(session.cdp, name, result);
        result.ok = true;
    } catch (error) {
        result.ok = false;
        result.error = sanitize(error, REPO);
        if (session) await screenshot(session.cdp, path.join(outDir, `${name}-error.png`)).catch(() => {});
        if (session) result.stateAtError = await evalOn(session.cdp, STATE).catch(() => null);
    } finally {
        await stop(session);
    }
    await saveJson(path.join(outDir, `results-${name}.json`), result);
    console.log(S({ name, ok: result.ok, error: result.error }));
}
