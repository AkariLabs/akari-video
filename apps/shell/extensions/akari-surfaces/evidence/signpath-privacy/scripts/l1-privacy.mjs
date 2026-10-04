#!/usr/bin/env node
// 実機検証（開発 Electron + CDP）: 初回に通信モーダルが出ず、設定の説明から自動確認を OFF にできること。
//
//   node l1-privacy.mjs --out=<証跡の出力先> [--iso=<隔離ディレクトリ>] [--port=22531] [--settle=25] [--path=full|minimal]
//
// --path=minimal は PATH を OS 既定（/usr/bin:/bin:/usr/sbin:/sbin）に絞り、外部のパートナー CLI が入っていない
// マシン相当にする。full（既定）は実行環境の PATH のまま。設定を開くと導入済みの外部 CLI を `--version` で
// 実行するため、CLI 自身が出す通信は「AKARI 自身のプロセス」と分けて記録する。
//
// 隔離: HOME / AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir をすべて --iso（既定は $TMPDIR 以下の
// 新規ディレクトリ）へ向ける。実環境の ~/.akari・~/Akari・~/.theia・インストール済みアプリには触れない。
// 終了させるのは自分が起動した Electron（とその子孫）だけ。
//
// 観測は 3 層:
//   1. Chromium の netlog（--log-net-log）      … レンダラの fetch・Electron の net
//   2. Node の接続フック（net-hook.cjs）        … Theia バックエンドと子プロセスの http / https / fetch
//   3. nettop（外部インターフェースのソケット） … 自分の PID の子孫だけを抜き出す
// 走行は 3 回: A = 初回（ホーム → 設定の説明とリンク → スイッチを OFF）/ B = OFF のまま再起動（本測定）/
//             C = ON に戻して再起動（対照。観測手段が接続を拾えることの確認）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, evalOn, listTargets, realClick } from '../../../../akari-annotations/evidence/gen-ux-polish-b/scripts/cdp-lib.mjs';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const outArg = arg('out');
if (!outArg) throw new Error('--out=<dir> is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(arg('repo') ?? path.resolve(here, '../../../../../../../'));
const shell = path.join(repo, 'apps/shell');
const out = path.resolve(outArg);
const iso = path.resolve(arg('iso') ?? await mkdtemp(path.join(os.tmpdir(), 'akari-signpath-privacy-')));
const port = Number(arg('port') ?? 22531);
const settleSeconds = Number(arg('settle') ?? 25);
const pathMode = arg('path') ?? 'full';
if (!['full', 'minimal'].includes(pathMode)) throw new Error('--path must be full or minimal');
if (iso === repo || iso.startsWith(`${repo}${path.sep}`)) throw new Error('--iso must be outside the repository');
if (iso === os.homedir() || !iso.startsWith(path.resolve(os.tmpdir()))) throw new Error('--iso must be under the temporary directory');

const dirs = { home: path.join(iso, 'home'), akariHome: path.join(iso, 'akari-home'), theia: path.join(iso, 'theia-config'),
    userData: path.join(iso, 'user-data'), logs: path.join(iso, 'logs') };
const S = JSON.stringify;
const results = { status: 'running', pathMode, checks: [], phases: {}, screenshots: [] };
const clean = value => {
    let text = String(value);
    for (const [source, replacement] of [[repo, '<REPO>'], [iso, '<ISO>'], [os.homedir(), '<HOME>']]) text = text.replaceAll(source, replacement);
    return text;
};
const save = () => writeFile(path.join(out, 'results.json'),
    `${JSON.stringify(results, (_key, value) => typeof value === 'string' ? clean(value) : value, 2)}\n`);
const check = (name, pass, observed) => {
    results.checks.push({ name, pass: Boolean(pass), observed });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};

// 開発ビルドは更新の UI が無効で、ホームは latest.json を取りに行かない（既存の挙動）。
// AKARI_UPDATE_FEED_URL を手元（127.0.0.1）の検証用サーバーへ向けると有効になるので、
// 「OFF なら 1 回も来ない / ON なら来る」をこのサーバーの受信数で数える。外へは出ない。
const feedHits = [];
const pageErrors = [];
const feedServer = createServer((request, response) => {
    feedHits.push({ t: Date.now(), path: request.url });
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify({ schema: 1, product: 'akari-video', channel: 'stable', shell: { version: '0.0.1' } }));
});
await new Promise(resolve => feedServer.listen(0, '127.0.0.1', resolve));
const feedUrl = `http://127.0.0.1:${feedServer.address().port}/latest.json`;
let child; let cdp; let nettop; let pidTimer;
const pids = new Set();
async function samplePids() {
    if (!child?.pid) return;
    const ps = spawn('ps', ['-axo', 'pid=,ppid='], { stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '';
    ps.stdout.on('data', chunk => { text += chunk; });
    await new Promise(resolve => ps.once('close', resolve));
    const rows = text.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    pids.add(child.pid);
    for (let changed = true; changed;) {
        changed = false;
        for (const [pid, ppid] of rows) if (pids.has(ppid) && !pids.has(pid)) { pids.add(pid); changed = true; }
    }
}
async function until(operation, label, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        try { const value = await operation(); if (value) return value; } catch (error) { last = error; }
        await sleep(200);
    }
    throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
}
const waitEval = (expression, label, timeout) => until(() => evalOn(cdp, expression), label, timeout);
const command = (id, value) => `(()=>{const c=window.theia.container,d=c._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  try { Promise.resolve(c.get(C).executeCommand(${S(id)}${value === undefined ? '' : `,${S(value)}`})).catch(()=>{}); } catch {}
  return true})()`;
async function clickPoint(expression, label) {
    const point = await waitEval(`(()=>{const e=${expression};if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});
      const r=e.getBoundingClientRect();if(!r.width||!r.height)return null;
      const x=r.left+r.width/2,y=r.top+r.height/2,front=document.elementFromPoint(x,y);
      return {x,y,hit:front===e||e.contains(front),front:front?.outerHTML.slice(0,300)??null,
        switchInert:e.inert,dialogInert:e.closest('[data-akari-settings-dialog]')?.inert??null}})()`, label, 20_000);
    check('設定スイッチのクリック点の最前面にスイッチがある', point.hit, point);
    if (!point.hit) throw new Error(`${label} is covered: ${point.front}`);
    await realClick(cdp, point.x, point.y);
}
async function suspendGuidePointerGuard() {
    const response = await cdp.send('Runtime.evaluate', { expression: `(()=>{
      const types=['pointerdown','mousedown','mouseup','click','dblclick','contextmenu'];
      const guards=types.flatMap(type=>(getEventListeners(document)[type]??[])
        .filter(row=>row.useCapture&&String(row.listener).includes('shouldBlockGuidePointer'))
        .map(row=>({type,listener:row.listener,passive:row.passive,once:row.once})));
      if(guards.length!==types.length)return {found:guards.map(row=>row.type)};
      window.__akariL1GuideGuards=guards;
      for(const row of guards)document.removeEventListener(row.type,row.listener,true);
      return {found:guards.map(row=>row.type)};})()`, includeCommandLineAPI: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(`guide pointer guard inspection failed: ${JSON.stringify(response.exceptionDetails)}`);
    const found = response.result.value?.found ?? [];
    if (found.length !== 6) throw new Error(`expected 6 guide pointer guards, found ${JSON.stringify(found)}`);
    return async () => {
        await evalOn(cdp, `(()=>{for(const row of window.__akariL1GuideGuards??[])
          document.addEventListener(row.type,row.listener,{capture:true,passive:row.passive,once:row.once});
          delete window.__akariL1GuideGuards;return true})()`);
    };
}
async function shot(name, clipExpression) {
    let clip;
    if (clipExpression) {
        const box = await evalOn(cdp, `(()=>{const r=${clipExpression}?.getBoundingClientRect();
          return r&&r.width&&r.height?{x:Math.max(0,r.left-16),y:Math.max(0,r.top-16),width:r.width+32,height:r.height+32}:null})()`).catch(() => null);
        if (box) clip = { ...box, scale: 1 };
    }
    const { data } = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    await writeFile(path.join(out, `${name}.png`), Buffer.from(data, 'base64'));
    results.screenshots.push(`${name}.png`);
}

async function launch(phase) {
    pids.clear();
    const netlog = path.join(dirs.logs, `${phase}-netlog.json`);
    const hookLog = path.join(dirs.logs, `${phase}-node.jsonl`);
    const nettopLog = path.join(dirs.logs, `${phase}-nettop.csv`);
    const env = { ...process.env, HOME: dirs.home, USERPROFILE: dirs.home, AKARI_HOME: dirs.akariHome, THEIA_CONFIG_DIR: dirs.theia,
        NODE_OPTIONS: `--require=${path.join(here, 'net-hook.cjs')}`, AKARI_NET_HOOK_LOG: hookLog };
    if (pathMode === 'minimal') env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    for (const name of Object.keys(env)) {
        if (/FAL|OPENAI|GEMINI|GOOGLE|GROQ|XAI|ANTHROPIC|OPENROUTER|AKARI_CREDENTIALS_FILE|AKARI_UPDATE_FEED_URL|AKARI_ASSETS_CATALOG|AKARI_STORE_API|_PROXY$/iu.test(name)
            || name === 'ELECTRON_RUN_AS_NODE') delete env[name];
    }
    env.AKARI_UPDATE_FEED_URL = feedUrl;
    feedHits.length = 0;
    const nettopOut = await (await import('node:fs/promises')).open(nettopLog, 'w');
    nettop = spawn('nettop', ['-n', '-x', '-L', '0', '-t', 'external', '-s', '1'], { stdio: ['ignore', nettopOut.fd, 'ignore'] });
    nettop.once('close', () => { void nettopOut.close(); });
    const electron = [path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        path.join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')].find(candidate => existsSync(candidate));
    if (!electron) throw new Error('Electron binary is missing');
    child = spawn(electron, [shell, `--remote-debugging-port=${port}`, `--user-data-dir=${dirs.userData}`, `--log-net-log=${netlog}`,
        '--window-size=1440,900', '--no-sandbox', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'],
    { cwd: repo, env, stdio: 'ignore', detached: true });
    const startedAt = Date.now();
    pidTimer = setInterval(() => { void samplePids(); }, 500);
    const target = await until(async () => (await listTargets(port)).find(row => row.type === 'page' && !row.url.startsWith('devtools:')), 'CDP page', 180_000);
    cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
    cdp.on('Runtime.exceptionThrown', event => {
        pageErrors.push({ phase, text: event.exceptionDetails?.text ?? '',
            description: event.exceptionDetails?.exception?.description ?? '' });
    });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia', 300_000);
    return { netlog, hookLog, nettopLog, startedAt, electronPid: child.pid };
}
async function quit() {
    clearInterval(pidTimer);
    await samplePids();
    cdp?.close(); cdp = undefined;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
        // 自分が起動した Electron だけを終わらせる。まず本体へ SIGTERM（netlog を書き切らせる）、残ればグループごと。
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* 既に終了 */ }
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(15_000)]);
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 子孫なし */ }
        await sleep(1500);
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 子孫なし */ }
    }
    nettop?.kill('SIGTERM');
    await sleep(1000);
}

const isLoopback = host => {
    const value = String(host).toLowerCase().replace(/^\[|\]$/g, '');
    return value === 'localhost' || value.endsWith('.localhost') || value === '::1' || value === '0.0.0.0' || /^127\./.test(value) || value === '';
};
async function analyze(run) {
    const chromiumHosts = new Map();
    const netlogText = await readFile(run.netlog, 'utf8').catch(() => '');
    for (const match of netlogText.matchAll(/"(?:url|original_url)":"((?:https?|wss?):\/\/[^"]+)"/g)) {
        let host; try { host = new URL(match[1]).hostname; } catch { continue; }
        if (!isLoopback(host)) chromiumHosts.set(host, (chromiumHosts.get(host) ?? 0) + 1);
    }
    for (const match of netlogText.matchAll(/"host":"([^"]+)"/g)) {
        const host = match[1].replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, '');
        if (!isLoopback(host)) chromiumHosts.set(host, (chromiumHosts.get(host) ?? 0) + 1);
    }
    const hookRows = (await readFile(run.hookLog, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return undefined; } }).filter(Boolean);
    const nodeHosts = new Map();
    const thirdPartyNode = new Map();
    let loopbackConnects = 0;
    // Electron 実行体（本体・ヘルパー）で動くものが AKARI 自身のプロセス。それ以外（PATH 上の node で動く外部 CLI や
    // そこから呼ばれる npm）は、AKARI が `--version` で起動した外部プログラム自身の通信として分けて数える。
    const argvByPid = new Map(hookRows.filter(row => row.kind === 'loaded').map(row => [row.pid, row.argv ?? []]));
    for (const row of hookRows.filter(row => row.kind === 'connect')) {
        if (isLoopback(row.host)) { loopbackConnects++; continue; }
        const key = `${row.host}:${row.port}`;
        const argv = argvByPid.get(row.pid) ?? [];
        if (/Electron/.test(String(argv[0] ?? ''))) nodeHosts.set(key, (nodeHosts.get(key) ?? 0) + 1);
        else thirdPartyNode.set(`${path.basename(String(argv[1] ?? argv[0] ?? 'unknown'))} -> ${key}`, true);
    }
    const hookedProcesses = hookRows.filter(row => row.kind === 'loaded').map(row => `${row.type}:${path.basename(String(row.argv?.[1] ?? row.argv?.[0] ?? ''))}`);
    const nettopFlows = new Map();
    const thirdPartyNettop = new Map();
    let owner;
    let ownerName = '';
    for (const line of (await readFile(run.nettopLog, 'utf8').catch(() => '')).split('\n')) {
        const cells = line.split(',');
        const second = cells[1] ?? '';
        const flow = second.match(/^(tcp|udp)[46] .*<->(.+)$/);
        if (!flow) { const pid = second.match(/^(.*)\.(\d+)$/); owner = pid ? Number(pid[2]) : undefined; ownerName = pid ? pid[1] : ''; continue; }
        if (owner === undefined || !pids.has(owner)) continue;
        const remote = flow[2];
        const host = remote.replace(/[:.]\d+$/, '');
        if (remote.startsWith('*') || isLoopback(host)) continue;
        if (ownerName.startsWith('Electron')) nettopFlows.set(remote, (nettopFlows.get(remote) ?? 0) + 1);
        else thirdPartyNettop.set(`${ownerName} -> ${remote}`, true);
    }
    return {
        netlogBytes: netlogText.length,
        chromiumExternalHosts: Object.fromEntries(chromiumHosts),
        nodeExternalConnects: Object.fromEntries(nodeHosts),
        nettopExternalFlows: [...nettopFlows.keys()],
        thirdPartyCliConnects: { node: [...thirdPartyNode.keys()], nettop: [...thirdPartyNettop.keys()] },
        nodeHookLoadedIn: hookedProcesses.length,
        nodeHookProcessKinds: [...new Set(hookedProcesses)],
        nodeLoopbackConnects: loopbackConnects,
        trackedPids: pids.size,
        localFeedHits: feedHits.map(hit => hit.path)
    };
}
const externalCount = analysis => Object.keys(analysis.chromiumExternalHosts).length + Object.keys(analysis.nodeExternalConnects).length + analysis.nettopExternalFlows.length;
const thirdPartyCount = analysis => analysis.thirdPartyCliConnects.node.length + analysis.thirdPartyCliConnects.nettop.length;
const noticePresent = `Boolean(document.querySelector('[data-akari-privacy-notice="true"]'))`;
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; } };

async function homeAndSettings(phase) {
    const run = await launch(phase);
    const homeReady = await waitEval(`Boolean(document.querySelector('[data-akari-home-ready="true"]'))`, 'home ready', 120_000).catch(() => false);
    // 通信モーダルが出ないことを、ホーム表示後もしばらく見続ける。
    let noticeSeen = false;
    for (let index = 0; index < 20; index++) { noticeSeen ||= await evalOn(cdp, noticePresent).catch(() => false); await sleep(250); }
    await sleep(settleSeconds * 1000);
    await shot(`${phase}-home`);
    await evalOn(cdp, command('akari.settings.open', { section: 'account' }));
    await waitEval(`Boolean(document.querySelector('[data-akari-settings-dialog="true"]'))`, 'settings dialog', 30_000);
    await sleep(6000);
    await evalOn(cdp, command('akari.settings.open', { section: 'about' }));
    const row = await waitEval(`(()=>{const d=document.querySelector('[data-akari-settings-dialog="true"]');if(!d)return null;
      const all=[...d.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.includes('更新と素材の自動確認'));
      if(!all.length)return null;const host=all[0].closest('[class*="row"],label,div');
      const input=d.querySelector('[aria-label="更新と素材の自動確認"],[data-label="更新と素材の自動確認"]')??host?.parentElement?.querySelector('input,[role="switch"]');
      return {label:all[0].textContent,rowText:(host?.parentElement?.textContent??'').slice(0,160),
        checked:input?(input.checked??input.getAttribute('aria-checked')):null}})()`, 'auto check row', 30_000).catch(error => ({ error: String(error.message) }));
    await sleep(1000);
    // 初回のガイドがウィンドウ全体を覆っているので、設定の行を写すあいだだけガイドを隠す（撮影のためだけ。すぐ戻す）。
    await evalOn(cdp, `(()=>{const g=document.getElementById('akari-onboarding-v1');if(g){g.dataset.l1Hidden='1';g.style.visibility='hidden';}return true})()`);
    await sleep(300);
    await shot(`${phase}-settings-about`);
    await evalOn(cdp, `(()=>{const g=document.getElementById('akari-onboarding-v1');if(g?.dataset.l1Hidden){g.style.visibility='';delete g.dataset.l1Hidden;}return true})()`);
    await sleep(Math.max(5, settleSeconds / 2) * 1000);
    await quit();
    const analysis = await analyze(run);
    results.phases[phase] = { homeReady: Boolean(homeReady), noticeSeen, settingsRow: row,
        preferences: readJson(path.join(dirs.akariHome, 'update-preferences.json')), secondsObserved: Math.round((Date.now() - run.startedAt) / 1000), ...analysis };
    await save();
    return results.phases[phase];
}

await mkdir(out, { recursive: true });
for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
try {
    // ---- A: 初回起動。通信モーダルなし → 設定の説明を確認 → スイッチを OFF ----
    {
        const run = await launch('a-first-run');
        const homeReady = await waitEval(`Boolean(document.querySelector('[data-akari-home-ready="true"]'))`, 'home ready', 120_000);
        let noticeSeen = false;
        for (let index = 0; index < 20; index++) { noticeSeen ||= await evalOn(cdp, noticePresent); await sleep(250); }
        check('新規ユーザーの初回起動で通信についてのモーダルが出ない', homeReady && !noticeSeen, { homeReady, noticeSeen });
        await shot('a-00-first-run-home');
        await evalOn(cdp, command('akari.settings.open', { section: 'about' }));
        const settings = await waitEval(`(()=>{const d=document.querySelector('[data-akari-settings-dialog="true"]');
          const n=d?.querySelector('[data-akari-network-explanation="true"]');
          const c=d?.querySelector('[role="switch"][aria-label="更新と素材の自動確認"]');
          const linkRow=[...(n?.querySelectorAll('.akari-set-row')??[])].find(e=>
            e.querySelector('.akari-set-row-label')?.textContent.trim()==='プライバシーポリシー');
          const linkButton=linkRow?.querySelector('button');
          return n&&c?{label:c.getAttribute('aria-label'),checked:c.getAttribute('aria-checked'),
            description:n.textContent,linkRowText:linkRow?.textContent.trim()??null,
            linkButtonText:linkButton?.textContent.trim()??null}:null})()`, 'about auto check and explanation', 30_000);
        const explanationLines = [
            'AKARI Video は利用状況を送りません。',
            '新しい版と素材の一覧を自動で確認します。何も送らず、取得するだけです。',
            'AI 機能は使ったときだけ、あなたの API キーで各社に送ります。'
        ];
        check('設定に自動確認のスイッチ・説明 3 行・プライバシーポリシーへのリンクがある',
            settings.label === '更新と素材の自動確認' && settings.checked === 'true'
                && explanationLines.every(line => settings.description.includes(line))
                && settings.linkRowText?.includes('プライバシーポリシー')
                && settings.linkRowText?.includes('https://akari.video/privacy')
                && settings.linkButtonText === '開く', settings);
        // 初回ガイドは表示を隠しても document の capture リスナーがガイド外への実クリックを遮断する。
        // 表示とリスナーをこの操作の間だけ退避し、ガイドの状態と保存マーカーは変えない。
        await evalOn(cdp, `(()=>{window.__akariL1HiddenNodes=[document.getElementById('akari-onboarding-v1'),
          document.querySelector('[data-akari-first-run-dialog="true"]')].filter(Boolean).map(node=>({node,
          style:node.getAttribute('style'),marker:node.getAttribute('data-l1-hidden')}));
          for(const {node} of window.__akariL1HiddenNodes){node.dataset.l1Hidden='1';node.style.visibility='hidden';}return true})()`);
        let afterToggle;
        let restoreGuard;
        try {
            await shot('a-01-settings-about');
            restoreGuard = await suspendGuidePointerGuard();
            await clickPoint(`document.querySelector('[data-akari-settings-dialog="true"] [role="switch"][aria-label="更新と素材の自動確認"]')`, 'auto check switch');
            afterToggle = await waitEval(`(()=>{const c=document.querySelector('[data-akari-settings-dialog="true"] [role="switch"][aria-label="更新と素材の自動確認"]');
              return c?.getAttribute('aria-checked')==='false'?{checked:false}:null})()`, 'switch off', 10_000);
            await shot('a-02-settings-auto-check-off');
        } finally {
            try { await restoreGuard?.(); }
            finally {
                await evalOn(cdp, `(()=>{for(const {node,style,marker} of window.__akariL1HiddenNodes??[]){
                  if(style===null)node.removeAttribute('style');else node.setAttribute('style',style);
                  if(marker===null)node.removeAttribute('data-l1-hidden');
                  else node.setAttribute('data-l1-hidden',marker);}delete window.__akariL1HiddenNodes;return true})()`);
            }
        }
        const persisted = await until(async () => {
            const preferences = readJson(path.join(dirs.akariHome, 'update-preferences.json'));
            const settingsFile = await readFile(path.join(dirs.theia, 'settings.json'), 'utf8').catch(() => '');
            return preferences?.autoCheck === false && /"akari\.update\.autoCheck"\s*:\s*false/.test(settingsFile)
                ? { preferences, theiaSetting: settingsFile.match(/"akari\.update\.autoCheck"\s*:\s*\w+/)?.[0] ?? null } : null;
        }, 'auto check persisted off', 20_000).catch(() => null);
        check('スイッチが autoCheck を書く（update-preferences.json と設定の両方）',
            Boolean(persisted), { afterToggle, ...persisted });
        await quit();
        results.phases['a-first-run'] = { note: '設定で OFF にするまでは既定（ON）のまま動く走行。外部接続は合否に使わず、記録だけ残す。',
            secondsObserved: Math.round((Date.now() - run.startedAt) / 1000), ...await analyze(run) };
        await save();
    }
    // ---- B: OFF のまま再起動（本測定） ----
    const off = await homeAndSettings('b-auto-check-off');
    check('再起動しても通信についてのモーダルが出ない', off.noticeSeen === false && off.homeReady, { noticeSeen: off.noticeSeen, homeReady: off.homeReady });
    check('設定の行が「更新と素材の自動確認」になっている', off.settingsRow?.label?.includes('更新と素材の自動確認'), off.settingsRow);
    check('観測手段が Node 側の全プロセスで動いている（フック読み込み 1 件以上）', off.nodeHookLoadedIn >= 1 && off.netlogBytes > 0,
        { nodeHookLoadedIn: off.nodeHookLoadedIn, kinds: off.nodeHookProcessKinds, netlogBytes: off.netlogBytes, nodeLoopbackConnects: off.nodeLoopbackConnects });
    check('自動確認 OFF: 起動〜ホーム表示〜設定を開くまで、AKARI 自身のプロセスから外部ホストへの接続が 0 件', off.preferences?.autoCheck === false && externalCount(off) === 0,
        { chromium: off.chromiumExternalHosts, node: off.nodeExternalConnects, nettop: off.nettopExternalFlows, secondsObserved: off.secondsObserved });
    check('自動確認 OFF: ホームの更新フィード（latest.json）を 1 回も取りに行かない（手元の検証用サーバーの受信 0 回）',
        off.localFeedHits.length === 0, { localFeedHits: off.localFeedHits });
    if (pathMode === 'minimal') {
        check('自動確認 OFF（外部のパートナー CLI が無いマシン相当）: 起動した全プロセスを合わせても外部ホストへの接続が 0 件',
            externalCount(off) + thirdPartyCount(off) === 0, { thirdPartyCliConnects: off.thirdPartyCliConnects, trackedPids: off.trackedPids });
    } else {
        results.phases['b-auto-check-off'].thirdPartyNote = '設定を開くと導入済みの外部パートナー CLI を --version で実行する。ここに出るのはその CLI 自身の通信（合否には数えない）。';
    }
    // ---- C: ON に戻して再起動（対照） ----
    const current = readJson(path.join(dirs.akariHome, 'update-preferences.json')) ?? {};
    await writeFile(path.join(dirs.akariHome, 'update-preferences.json'), `${JSON.stringify({ ...current, autoCheck: true })}\n`);
    const on = await homeAndSettings('c-auto-check-on');
    check('対照（自動確認 ON）: 同じ観測で外部ホストへの接続が拾える', on.preferences?.autoCheck === true && externalCount(on) > 0,
        { chromium: on.chromiumExternalHosts, node: on.nodeExternalConnects, nettop: on.nettopExternalFlows, secondsObserved: on.secondsObserved });
    check('対照（自動確認 ON）: ホームが更新フィード（latest.json）を取りに来る（手元の検証用サーバーの受信 1 回以上）',
        on.localFeedHits.some(hit => hit.startsWith('/latest.json')), { localFeedHits: on.localFeedHits });
    check('A・B・C を通して pageerror が 0 件', pageErrors.length === 0, { count: pageErrors.length, errors: pageErrors });
    results.status = results.checks.every(row => row.pass) ? 'PASS' : 'FAIL';
} catch (error) {
    results.status = 'FAIL';
    results.error = clean(error?.stack ?? error);
    if (cdp) await shot('error').catch(() => undefined);
    await quit().catch(() => undefined);
} finally {
    results.iso = '<ISO>';
    feedServer.close();
    await save();
    console.log(`status=${results.status} iso=${iso}`);
}
process.exit(results.status === 'PASS' ? 0 : 1);
