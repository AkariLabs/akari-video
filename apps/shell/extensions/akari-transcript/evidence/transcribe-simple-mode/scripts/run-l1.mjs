#!/usr/bin/env node
// L1 harness (wrapper-authored, verification-only; not product source).
// 契約 2026-09-09-transcribe-simple-advanced-mode 指示 8:
//  (a) 既定 = 簡単のポップアップ（部品が 3 つだけ）
//  (b) 「起こす」→ 進捗 → 自動で閉じて台本に行が入る（whisper・dogfood 先頭 30 秒）
//  (c) 切替リンク → アドバンス（従来の DOM が揃う）
//  (d) 設定「文字起こし」節（簡単 / アドバンスの 2 状態）
// HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME / AKARI_CREDENTIALS_FILE は
// すべて一時ディレクトリへ向ける。Electron は detached にせず PID 指名で kill する。
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'simple-mode');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.env.AKARI_L1_PORT ?? 21993);
const WHISPER_MODEL = process.env.WHISPER_CPP_MODEL;
const DIALOG = '[data-akari-transcribe-dialog]';
const S = value => JSON.stringify(value);

const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-'));
const akariHome = path.join(profile, '.akari');
mkdirSync(akariHome, { recursive: true });
// ホームの初回セットアップ自動起動を止める（隔離 AKARI_HOME 内だけに書く）。
writeFileSync(path.join(akariHome, 'first-run-onboarding-v0.json'), `${JSON.stringify({ schema: 1, shownAt: new Date().toISOString() })}\n`);
rmSync(path.join(PROJECT, '.akari'), { recursive: true, force: true });
mkdirSync(path.join(PROJECT, '.akari/events'), { recursive: true });
writeFileSync(path.join(PROJECT, 'captions.json'), '[]\n'); // 台本 0 行から測り直す
// 取り込み済み素材の通常状態（analyze-footage L0 の probe だけ記録済み・文字起こしは未実施）へ戻す。
// analysis.transcript が無いので transcriptStates は 'none' のまま = alreadyTranscribed false。
execFileSync(process.execPath, [path.join(REPO, 'packages/akari-tools/bin/media.mjs'), 'probe', 'assets/base.mp4'], {
    cwd: PROJECT, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, HOME: profile, AKARI_HOME: akariHome }
});

const out = { status: 'running', steps: [], screenshots: [] };
const sanitize = value => String(value?.stack || value?.message || value)
    .replaceAll(REPO, '<WORKTREE>').replaceAll(profile, '<TMP>').replaceAll(tmpdir(), '<TMP>')
    .replace(/\/private\/var\/folders\/[^\s"')]*/g, '<TMP>').replace(/\/var\/folders\/[^\s"')]*/g, '<TMP>')
    .replace(/\/Users\/[^\s"')]*/g, '<HOME>');
const save = () => writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];

const args = [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'];
const child = spawn(ELECTRON, args, {
    cwd: SHELL, // akari-tools の CLI 候補 resolve(cwd, '../../packages', ...) を成立させる
    env: {
        ...process.env,
        HOME: profile,
        THEIA_CONFIG_DIR: path.join(profile, '.theia'),
        AKARI_HOME: akariHome,
        AKARI_CREDENTIALS_FILE: path.join(profile, 'credentials.env'),
        ...(WHISPER_MODEL ? { WHISPER_CPP_MODEL: WHISPER_MODEL } : {}),
        ELECTRON_ENABLE_LOGGING: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => log.push(String(chunk)));
child.stderr.on('data', chunk => log.push(String(chunk)));

let browser, page, cdp;
const consoleMessages = [];

async function step(name, operation) {
    const record = { name, pass: false };
    out.steps.push(record);
    const started = Date.now();
    try {
        record.detail = await operation();
        record.pass = true;
        record.elapsedMs = Date.now() - started;
        save();
        return record.detail;
    } catch (error) {
        record.error = sanitize(error);
        record.elapsedMs = Date.now() - started;
        save();
        throw error;
    }
}
async function waitFor(expression, { timeoutMs = 60000, intervalMs = 250, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try { const value = await page.evaluate(expression); if (value) return value; }
        catch (error) { last = error; }
        await sleep(intervalMs);
    }
    throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
// 隠れ/占有された Electron ウィンドウは rAF を回さないため、fromSurface:false で
// 描画を進めつつプリロード解除を待つ（transcribe-popup-always の流儀）。
async function pump({ timeoutMs = 120000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
        if (await page.evaluate(`!document.querySelector('.theia-preload')`).catch(() => false)) return true;
        await sleep(250);
    }
    throw new Error('preload overlay never detached');
}
async function shot(file) {
    await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
    writeFileSync(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
    save();
}
// 実マウスで押す（合成 click() は使わない）。finder は要素を返す式。
async function clickElement(finder, label) {
    const box = await waitFor(`(()=>{const e=${finder};if(!e)return null;const r=e.getBoundingClientRect();
        if(!r.width||!r.height)return null;return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, { label: `hit box for ${label}` });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.up();
    return box;
}
const byText = (scope, text) => `[...document.querySelectorAll(${S(scope)}+' button')].find(b=>b.textContent===${S(text)})`;
const dialogCensus = `(()=>{const n=document.querySelector(${S(DIALOG)});if(!n)return null;
    const buttons=[...n.querySelectorAll('button')];
    return {
        mode:n.dataset.akariTranscribeMode??null, step:n.dataset.step??null,
        nav:n.querySelectorAll('nav').length,
        navButtons:n.querySelectorAll('nav button').length,
        badges:[...n.querySelectorAll('[data-akari-engine-availability]')]
            .map(e=>[e.dataset.akariEngineAvailability,e.tagName,e.getAttribute('role')]),
        checkboxes:n.querySelectorAll('input[type=checkbox]').length,
        radars:n.querySelectorAll('svg').length,
        cards:n.querySelectorAll('section[data-backend]').length,
        engineRadios:n.querySelectorAll('input[type=radio]').length,
        availabilityBadges:n.querySelectorAll('[data-akari-engine-availability]').length,
        availabilityButtons:[...n.querySelectorAll('[data-akari-engine-availability]')].filter(e=>e.tagName==='BUTTON').length,
        switchLinks:n.querySelectorAll('[data-akari-transcribe-mode-switch]').length,
        switchLabel:n.querySelector('[data-akari-transcribe-mode-switch]')?.textContent??null,
        actionButtons:buttons.filter(b=>b.dataset.akariTranscribeModeSwitch===undefined
            && b.dataset.akariEngineAvailability===undefined).map(b=>b.textContent),
        allButtons:buttons.map(b=>b.textContent),
        progress:n.querySelector('[data-akari-transcribe-progress]')?.textContent??null,
        title:n.querySelector('.dialogTitle')?.textContent??null
    }})()`;
const settingsCensus = `(()=>{const n=document.querySelector('[data-akari-settings-section="transcribe"]');if(!n)return null;
    return {
        modeRadios:[...n.querySelectorAll('input[name="akari-transcribe-mode"]')].map(i=>[i.value,i.checked]),
        checkboxes:n.querySelectorAll('input[type=checkbox]').length,
        advancedNotice:[...n.querySelectorAll('p,div,span,label')]
            .filter(e=>e.textContent==='比較・カット候補の自動作成: アドバンスで使います').length,
        heading:n.querySelector('h2')?.textContent??null,
        hidden:n.hidden
    }})()`;
// モーダルを開くコマンドは閉じるまで解決しないので await しない（fire = true で戻す）。
const command = (id, arg, fire = false) => `(()=>{
  const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  if(!C)throw new Error('CommandService binding unavailable');
  const p=window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});
  ${fire ? "p.catch(()=>undefined); return 'fired';"
        : "return p.then(r=>r!==null&&typeof r==='object'?'[object]':r??null);"}
})()`;

try {
    for (let i = 0; i < 120 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { /* not up yet */ }
    }
    assert(browser, 'CDP connect failed');
    const context = browser.contexts()[0];
    for (let i = 0; i < 60 && !page; i++) {
        page = context.pages().find(item => !item.url().startsWith('devtools://'));
        if (!page) await sleep(1000);
    }
    assert(page, 'renderer page not found');
    page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.message}`));
    cdp = await context.newCDPSession(page);
    await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
    await pump();

    await step('0. 台本パネルを開き、未文字起こしの素材が 1 件ある', async () => {
        await page.evaluate(command('akari.daihon.open'));
        const state = await waitFor(`(()=>{const b=document.querySelector('.akari-daihon-captions');
            return b&&!b.disabled?{label:b.textContent,rows:document.querySelectorAll('.akari-daihon-row').length}:null})()`,
            { label: 'daihon captions button', timeoutMs: 120000 });
        assert(state.rows === 0, `expected an empty daihon, saw ${state.rows} rows`);
        return state;
    });

    const simpleCensus = await step('1-a. 既定は簡単モード: ステップ・比較チェック・radar が無く、操作部品は 3 つだけ', async () => {
        await clickElement(`document.querySelector('.akari-daihon-captions')`, 'captions button');
        // 4 枚とも可用性の判定が届いてから数える（確認中… のままだと札の形を測れない）。
        const census = await waitFor(`(()=>{const v=${dialogCensus};return v&&v.cards===4&&v.badges.length===4?v:null})()`,
            { label: 'transcribe dialog', timeoutMs: 120000 });
        assert(census.mode === 'simple', `mode was ${census.mode}`);
        assert(census.step === '1', `step was ${census.step}`);
        assert(census.nav === 0, `step bar present: ${census.nav}`);
        assert(census.checkboxes === 0, `compare checkboxes present: ${census.checkboxes}`);
        assert(census.radars === 0, `radar svg present: ${census.radars}`);
        assert(census.switchLinks === 1 && census.switchLabel === 'アドバンス（比較・差分）に切り替える', `switch link: ${census.switchLabel}`);
        assert(census.title === '文字起こし', `dialog title: ${census.title}`);
        assert(JSON.stringify(census.actionButtons) === JSON.stringify(['起こす']), `action buttons: ${census.actionButtons}`);
        // 操作部品 = エンジン選択（おまかせ + 4 カードのラジオ）/ 起こす / 切替リンク の 3 つだけ。
        // 可用性は 4 枚とも非対話の札（span + role=status）で、押せる部品を増やさない。
        assert(census.engineRadios === 5, `engine radios: ${census.engineRadios}`);
        assert(census.availabilityButtons === 0, `availability badges were buttons: ${JSON.stringify(census.badges)}`);
        assert(census.badges.every(([, tag, role]) => tag === 'SPAN' && role === 'status'), `badges: ${JSON.stringify(census.badges)}`);
        assert(JSON.stringify(census.allButtons) === JSON.stringify(['起こす', census.switchLabel]),
            `unexpected buttons: ${JSON.stringify(census.allButtons)}`);
        return census;
    });
    await shot('01-simple-default-popup.png');

    await step('1-b. whisper のカードを選び「起こす」を押すと、同じ画面に進捗 1 行が出る', async () => {
        await clickElement(`document.querySelector(${S(DIALOG)}+' section[data-backend="whisper-cpp"] input[type=radio]')`, 'whisper radio');
        await clickElement(byText(DIALOG, '起こす'), 'start button');
        const running = await waitFor(`(()=>{const v=${dialogCensus};return v&&v.progress?v:null})()`,
            { label: 'simple progress line', timeoutMs: 90000 });
        assert(running.nav === 0 && running.step === '1', `left the single screen: step=${running.step} nav=${running.nav}`);
        assert(/^起こしています… \d+:\d{2} \/ 0:30$/.test(running.progress), `progress line: ${running.progress}`);
        return running;
    });
    await shot('02-simple-progress.png');

    const finished = await step('1-c. 完了すると人の操作 0 回で閉じ、台本に行が入る', async () => {
        const closed = await waitFor(`document.querySelector(${S(DIALOG)})?null:true`, { label: 'dialog auto-close', timeoutMs: 300000 });
        const settled = await waitFor(`(()=>{const b=document.querySelector('.akari-daihon-captions');
            const rows=document.querySelectorAll('.akari-daihon-row').length;
            const footer=document.querySelector('.akari-daihon-footer')?.textContent??null;
            return b&&b.textContent!=='字幕を作成中…'&&rows>0?{label:b.textContent,rows,footer}:null})()`,
            { label: 'daihon rows', timeoutMs: 300000 });
        assert(!settled.footer?.startsWith('字幕を作れません'), `buildCaptions failed: ${settled.footer}`);
        const events = await readdir(path.join(PROJECT, '.akari/events')).catch(() => []);
        const captions = JSON.parse(await readFile(path.join(PROJECT, 'captions.json'), 'utf8'));
        return { closed, ...settled, transcriptEvents: events.length, captionCount: Array.isArray(captions) ? captions.length : captions.captions?.length };
    });
    await shot('03-daihon-rows-after-simple.png');

    await step('2-a. 済みの素材でも簡単モードは 2 ボタン（台本へ / 起こし直す）', async () => {
        await clickElement(`document.querySelector('.akari-daihon-captions')`, 'captions button (2nd)');
        const census = await waitFor(`(()=>{const v=${dialogCensus};return v&&v.cards===4?v:null})()`, { label: 'transcribe dialog (2nd)' });
        assert(census.mode === 'simple', `mode was ${census.mode}`);
        assert(JSON.stringify(census.actionButtons) === JSON.stringify(['台本へ', '起こし直す']), `action buttons: ${census.actionButtons}`);
        assert(census.nav === 0 && census.checkboxes === 0 && census.radars === 0, 'advanced parts leaked into simple mode');
        assert(census.title === '文字起こし', `dialog title: ${census.title}`);
        return census;
    });
    await shot('04-simple-already-transcribed.png');

    const advanced = await step('2-b. 切替リンクでアドバンスへ（ダイアログは閉じず、従来の DOM が揃う）', async () => {
        await clickElement(`document.querySelector(${S(DIALOG)}+' [data-akari-transcribe-mode-switch]')`, 'switch link');
        const census = await waitFor(`(()=>{const v=${dialogCensus};return v&&v.mode==='advanced'&&v.badges.length===4?v:null})()`, { label: 'advanced mode' });
        assert(census.nav === 1 && census.navButtons === 6, `step bar: nav=${census.nav} buttons=${census.navButtons}`);
        assert(census.checkboxes === 4, `compare checkboxes: ${census.checkboxes}`);
        assert(census.radars === 4, `radar svg: ${census.radars}`);
        // 従来どおり 3 出口が末尾に並び、可用性の札は設定へ飛ぶボタンに戻る。
        assert(JSON.stringify(census.actionButtons.slice(-3)) === JSON.stringify(['このまま字幕へ', '起こし直す', '比べる']),
            `exits: ${JSON.stringify(census.actionButtons)}`);
        assert(census.availabilityButtons === census.badges.filter(([state]) => state === 'needs' || state === 'unconfigured').length,
            `advanced badges lost their action: ${JSON.stringify(census.badges)}`);
        assert(census.switchLabel === '簡単モードに戻す', `switch link: ${census.switchLabel}`);
        assert(census.title === '文字起こしして字幕を作る', `advanced dialog title: ${census.title}`);
        return census;
    });
    await shot('05-advanced-after-switch.png');

    await step('2-c. もう一度押すと簡単に戻り、ダイアログは開いたまま', async () => {
        await clickElement(`document.querySelector(${S(DIALOG)}+' [data-akari-transcribe-mode-switch]')`, 'switch link (back)');
        const census = await waitFor(`(()=>{const v=${dialogCensus};return v&&v.mode==='simple'?v:null})()`, { label: 'back to simple' });
        assert(census.nav === 0 && census.checkboxes === 0 && census.radars === 0, 'advanced parts remained');
        assert(census.title === '文字起こし', `dialog title after switching back: ${census.title}`);
        await page.keyboard.press('Escape');
        await waitFor(`document.querySelector(${S(DIALOG)})?null:true`, { label: 'dialog closed' });
        return census;
    });

    await step('3-a. 設定「文字起こし」節: 簡単のとき比較・カットの行は畳まれる', async () => {
        await page.evaluate(command('akari.settings.open', { section: 'transcribe' }, true));
        const census = await waitFor(`(()=>{const v=${settingsCensus};return v&&!v.hidden?v:null})()`, { label: 'settings transcribe section' });
        assert(JSON.stringify(census.modeRadios) === JSON.stringify([['simple', true], ['advanced', false]]), `mode radios: ${JSON.stringify(census.modeRadios)}`);
        assert(census.checkboxes === 0, `compare/autoCuts rows still present: ${census.checkboxes}`);
        assert(census.advancedNotice === 1, `missing single placeholder line: ${census.advancedNotice}`);
        assert(census.heading === '文字起こし', `heading: ${census.heading}`);
        return census;
    });
    await shot('06-settings-simple.png');

    await step('3-b. アドバンスを選ぶと比較の組とカット候補の行が戻る', async () => {
        await clickElement(`[...document.querySelectorAll('input[name="akari-transcribe-mode"]')].find(i=>i.value==='advanced')`, 'advanced radio');
        // 設定の再描画は preferences.onPreferenceChanged 経由（保存の完了待ち）。
        const census = await waitFor(`(()=>{const v=${settingsCensus};return v&&v.modeRadios[1][1]&&v.checkboxes>0?v:null})()`,
            { label: 'settings advanced', timeoutMs: 30000 });
        assert(census.checkboxes === 6, `expected compare toggle + 4 engines + autoCuts, saw ${census.checkboxes}`);
        assert(census.advancedNotice === 0, 'placeholder line remained in advanced');
        return census;
    });
    await shot('07-settings-advanced.png');

    out.simpleCensus = simpleCensus;
    out.advancedCensus = advanced;
    out.finished = finished;
    out.status = 'pass';
} catch (error) {
    out.status = 'fail';
    out.error = sanitize(error);
    process.exitCode = 1;
} finally {
    out.consoleErrors = consoleMessages.filter(message => message.startsWith('error:') || message.startsWith('pageerror:')).slice(0, 40).map(sanitize);
    try { await browser?.close(); } catch { /* ignore */ }
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    await sleep(2000);
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(1000);
    writeFileSync(path.join(ROOT, 'launch-log.txt'), sanitize(log.join('')));
    out.electronPid = child.pid;
    out.pass = out.status === 'pass' && out.steps.length === 9 && out.steps.every(item => item.pass);
    save();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log(JSON.stringify({ status: out.status, pass: out.pass, error: out.error }, null, 2));
}
