#!/usr/bin/env node
// インスペクターの書き込み先の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [--shell=<apps/shell の絶対パス>] [--fixtures=<dir>] [--port=9483] [--only=two,one,zero-missing,zero-empty,zero-two,zero-cold,notify]
// before = 変更前ビルドの観測記録（判定はしない。文言と書き換わったファイルを記録）
// after  = 同じ操作 + 受け入れ条件の判定
// 実機の Electron を専用のポート・一時ディレクトリ（名前に inspector-write-owner を含む）で起動し、自分の PID だけを止める。
// 操作はすべて CDP の実マウス・実キーボード（字幕の札のクリック・タブのクリック・欄への入力）。
// 読み取りだけ DI コンテナから（選択のスナップショット・書き込みの口の持ち主の確認）。
import { cp, rm, mkdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { realClick } from './cdp-lib.mjs';
import { S, command, evalOn, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const EVIDENCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(EVIDENCE, '..', '..', '..', '..', '..', '..');
const SHELL = path.resolve(arg('shell') ?? path.join(REPO, 'apps', 'shell'));
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = Number(arg('port') ?? 9483);
const TMP = path.join(os.tmpdir(), 'inspector-write-owner-l1');
const FIXTURES = path.resolve(arg('fixtures') ?? path.join(TMP, 'fixtures'));
const ONLY = (arg('only') ?? 'two,one,zero-missing,zero-empty,zero-two,zero-cold,notify').split(',');
const RESULTS = path.join(EVIDENCE, `results-${PHASE}.json`);
const out = { phase: PHASE, status: 'running', port: PORT, scenarios: {}, checks: [], screenshots: [] };
const SANITIZE_ROOTS = [REPO, SHELL, TMP, os.tmpdir(), os.homedir()];
const clean = value => {
    if (typeof value === 'string') {
        let text = value;
        for (const root of SANITIZE_ROOTS) text = text.replaceAll(root, '<local>');
        return text.replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<local>').replace(/file:\/\/<local>[^\s)'"]*/g, '<local>');
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    return value;
};
const save = () => saveJson(RESULTS, clean(out));
const INSPECTOR = '[data-akari-ui="panel:inspector"]';
const ROW = name => `${INSPECTOR} [data-akari-field="${name}"]`;
const TIMELINE = slug => slug ? `[id="akari-annotations-widget:${slug}"]` : '[id="akari-annotations-widget"]';
const CHIP = (slug, id) => `${TIMELINE(slug)} .akari-annotations-strip-caption[data-akari-item-id="${id}"]`;
const NOT_AVAILABLE = '書き込み機能が利用できません。';

function check(name, pass, detail) {
    out.checks.push({ name, pass: Boolean(pass), detail });
    return pass;
}

// ---- ページ内の小道具（読み取り + 通知の記録） ----
const SETUP = `(async()=>{const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];const service=(...m)=>{const k=keys.find(k=>typeof k==='function'&&m.every(n=>typeof k.prototype?.[n]==='function'));if(!k)throw new Error('missing '+m.join(','));return c.get(k)};
const I=window.__iwo={shell:service('resize','getWidgets','activateWidget'),commands:service('executeCommand','getCommand'),notices:[]};
const seen=new WeakSet();
const scan=()=>{for(const e of document.querySelectorAll('.theia-notification-message, .theia-notification-list-item')){if(seen.has(e))continue;seen.add(e);const text=(e.textContent||'').replace(/\\s+/g,' ').trim();if(text)I.notices.push({where:'toast',text,at:Date.now()})}};
new MutationObserver(scan).observe(document.body,{childList:true,subtree:true,characterData:true});
return true})()`;
// 欄の通知（インスペクター内の 4 秒で消える帯）を記録する。showFieldNotice を覆う（観測だけ。挙動は元の関数に渡す）。
const HOOK_INSPECTOR = `(()=>{const I=window.__iwo;const w=I.shell.getWidgets('right').find(w=>w.id==='akari-inspector-widget');if(!w)return false;if(!w.__iwoHooked){const orig=w.showFieldNotice.bind(w);w.showFieldNotice=m=>{I.notices.push({where:'field',text:String(m),at:Date.now()});return orig(m)};w.__iwoHooked=true}I.inspector=w;return true})()`;
const MODEL = `(window.__iwo.inspector?.model)`;
// 書き込みの口の持ち主を確かめる: 各タイムラインの handleInspectorWrite を一時的に目印へ差し替えて口を呼ぶ（ファイルは書かない）。
const OWNER = `(async()=>{const I=window.__iwo;const m=${MODEL};const tl=I.shell.getWidgets('bottom').filter(w=>w.id.startsWith('akari-annotations-widget'));if(!m.requestWrite)return{owner:null,timelines:tl.map(w=>w.id)};const kind=m.snapshot?.kind;for(const w of tl)w.handleInspectorWrite=async()=>({ok:true,owner:w.id});let r;try{r=await m.requestWrite({kind:'caption-text',id:'__iwo_probe__',value:'x'})}catch(e){r={owner:'error:'+e.message}}finally{for(const w of tl)delete w.handleInspectorWrite}return{owner:r?.owner??null,timelines:tl.map(w=>w.id),snapshotKind:kind??null}})()`;
const SNAPSHOT = `(()=>{const s=${MODEL}?.snapshot;if(!s)return null;return s.kind==='multi'?{kind:'multi',ids:s.items.map(i=>i.id)}:{kind:s.kind,id:s.id??null,text:s.text??null}})()`;

const sha = async file => existsSync(file) ? createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 12) : null;
const captionsOf = async file => existsSync(file) ? JSON.parse(await readFile(file, 'utf8')).captions : null;

let session;
let PROJECT;
let cdp;

async function pointOf(selector) {
    await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return false;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`, { label: `${selector} visible`, timeoutMs: 30_000 });
    await sleep(250);
    return evalOn(cdp, `(()=>{const r=document.querySelector(${S(selector)}).getBoundingClientRect();return{x:r.left+Math.min(r.width/2,20),y:r.top+r.height/2}})()`);
}
async function click(selector, modifiers = 0) { const p = await pointOf(selector); await realClick(cdp, p.x, p.y, { modifiers }); await sleep(700); }
async function key(keyName, code, keyCode, modifiers = 0, commands) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers, ...(commands ? { commands } : {}) });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function typeInto(selector, text) {
    const p = await pointOf(selector);
    await realClick(cdp, p.x, p.y); await sleep(150);
    await key('a', 'KeyA', 65, 4, ['selectAll']);
    await cdp.send('Input.insertText', { text: String(text) });
    await sleep(100);
    await key('Enter', 'Enter', 13);
    await sleep(150);
    await key('Tab', 'Tab', 9);
    await sleep(300);
}
async function openInspector() {
    await evalOn(cdp, command('akari.inspector.open'));
    await waitEval(cdp, `Boolean(document.querySelector(${S(INSPECTOR)}))`, { label: 'inspector', timeoutMs: 60_000 });
    await waitEval(cdp, HOOK_INSPECTOR, { label: 'inspector hook', timeoutMs: 30_000 });
}
/** 欄へ書く。field = color / size / text。 */
async function writeField(field, value) {
    await openInspector();
    if (field === 'text') {
        const row = ROW('caption-text');
        await waitEval(cdp, `Boolean(document.querySelector(${S(row)}))`, { label: 'caption-text row', timeoutMs: 30_000 });
        let input = await evalOn(cdp, `Boolean(document.querySelector(${S(row)}).querySelector('textarea, input[type="text"], input:not([type])'))`);
        if (!input) { await click(`${row} .akari-inspector-row-value`); }
        const sel = await evalOn(cdp, `(()=>{const r=document.querySelector(${S(row)});const e=r.querySelector('textarea')?'textarea':r.querySelector('input[type="text"]')?'input[type="text"]':r.querySelector('input:not([type])')?'input:not([type])':null;return e})()`);
        if (!sel) throw new Error('caption-text の入力欄が見つからない');
        await typeInto(`${row} ${sel}`, value);
        return;
    }
    const map = { color: ['caption-color', 'input[type="text"]'], size: ['caption-size', 'input[type="number"]'] };
    const [name, input] = map[field];
    await waitEval(cdp, `Boolean(document.querySelector(${S(`${ROW(name)} ${input}`)}))`, { label: `${name} row`, timeoutMs: 30_000 });
    await typeInto(`${ROW(name)} ${input}`, value);
}

async function files() {
    const names = ['captions.json', 'captions.short.json'];
    return Object.fromEntries(await Promise.all(names.map(async n => [n, await sha(path.join(PROJECT, n))])));
}
async function rowIn(file, id) { return (await captionsOf(path.join(PROJECT, file)))?.find(c => c.id === id) ?? null; }

/** 1 回の操作を記録する: 前後のファイルのハッシュ・通知・スナップショット・持ち主。 */
async function operate(scenario, label, target, field, value, readBack, beforeWrite) {
    const beforeFiles = await files();
    await evalOn(cdp, `(()=>{window.__iwo.notices=[];return true})()`);
    const snapshot = await evalOn(cdp, SNAPSHOT);
    const owner = await evalOn(cdp, OWNER);
    if (beforeWrite) await beforeWrite();
    let error;
    try { await writeField(field, value); } catch (e) { error = sanitize(e, REPO); }
    await sleep(1800);
    const afterFiles = await files();
    const notices = await evalOn(cdp, `window.__iwo.notices.map(n=>({where:n.where,text:n.text}))`);
    const changed = Object.keys(afterFiles).filter(k => afterFiles[k] !== beforeFiles[k]);
    const record = { label, target, field, value, snapshot, owner: owner.owner, changed, notices, ...(error ? { error } : {}) };
    if (readBack) record.readBack = await readBack();
    scenario.ops.push(record);
    await save();
    return record;
}

async function prepare(name) {
    PROJECT = path.join(TMP, `project-${PHASE}-${name}`);
    await rm(PROJECT, { recursive: true, force: true });
    await mkdir(TMP, { recursive: true });
    await cp(path.join(FIXTURES, name), PROJECT, { recursive: true });
    PROJECT = await realpath(PROJECT);
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: path.join(TMP, `iso-inspector-write-owner-${PHASE}-${name}`) });
    cdp = session.cdp;
    await evalOn(cdp, SETUP);
    await evalOn(cdp, `(async()=>{await window.__iwo.shell.collapsePanel('left');return true})()`).catch(() => {});
}
async function layout() {
    await evalOn(cdp, `(async()=>{const I=window.__iwo;I.shell.resize(420,'bottom');await new Promise(r=>setTimeout(r,800));return true})()`).catch(() => {});
    await openInspector();
    await evalOn(cdp, command('notifications.commands.clearAll')).catch(() => {});
}
async function finish() { await stop(session); session = undefined; cdp = undefined; }
async function shot(name) {
    await sleep(500);
    // ホームのプロジェクトカード等に出る一時ディレクトリの絶対パスを画面上だけ伏せる（証跡にローカルパスを残さない）
    await evalOn(cdp, `(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(/\\/(private|var|Users|tmp)\\//.test(n.nodeValue))n.nodeValue=n.nodeValue.replace(/\\/(private|var|Users|tmp)\\/\\S*/g,'<local>')}return true})()`).catch(() => {});
    const file = `${PHASE}-${name}.png`;
    await screenshot(cdp, path.join(EVIDENCE, file));
    out.screenshots.push(file);
    return file;
}
const timelines = () => evalOn(cdp, `window.__iwo.shell.getWidgets('bottom').filter(w=>w.id.startsWith('akari-annotations-widget')).map(w=>w.id)`);
async function waitChips(slug, ids) {
    await waitEval(cdp, `(${S(ids)}).every(id=>{const e=document.querySelector(${S(TIMELINE(slug))}+' .akari-annotations-strip-caption[data-akari-item-id="'+id+'"]');return e&&e.getBoundingClientRect().width>0})`, { label: `chips ${slug ?? 'main'} ${ids}`, timeoutMs: 60_000 });
}
async function clickTab(label) {
    // タブ（Lumino）の見出しを実マウスでクリックする。label = タブの表示名
    const selector = await evalOn(cdp, `(()=>{const tabs=[...document.querySelectorAll('.lm-TabBar-tab, .p-TabBar-tab')];const t=tabs.find(t=>(t.querySelector('.lm-TabBar-tabLabel, .p-TabBar-tabLabel')?.textContent||'').trim()===${S(label)});if(!t)return null;t.setAttribute('data-iwo-tab',${S(label)});return '[data-iwo-tab='+JSON.stringify(${S(label)})+'] .lm-TabBar-tabLabel, [data-iwo-tab='+JSON.stringify(${S(label)})+'] .p-TabBar-tabLabel'})()`);
    if (!selector) throw new Error(`tab ${label} not found: ${await evalOn(cdp, `[...document.querySelectorAll('.lm-TabBar-tab, .p-TabBar-tab')].map(t=>t.textContent.trim()).join('|')`)}`);
    await click(selector);
    await sleep(800);
}

// ---- シナリオ: タイムライン 2 本 ----
async function scenarioTwo() {
    const sc = out.scenarios.two = { ops: [], notes: [] };
    await prepare('two');
    await evalOn(cdp, command('akari.annotations.attachPassive'));
    await waitChips(undefined, ['c-0001', 'c-0002', 'c-0101']);
    await layout();
    sc.timelinesOpened = await timelines();
    sc.ownerAfterOpen = (await evalOn(cdp, OWNER)).owner;
    await save();
    // (a) 両方開いた状態で edit.json 側の字幕の色を変える
    await click(CHIP(undefined, 'c-0002'));
    await operate(sc, '(a) edit.json 側 c-0002 の色', 'captions.json', 'color', '#FF0000', async () => ({
        main: (await rowIn('captions.json', 'c-0002'))?.text_style?.color ?? null }));
    await click(CHIP(undefined, 'c-0001'));
    await operate(sc, '(a) edit.json 側 c-0001 の色（同じ id が captions.short.json にもある）', 'captions.json', 'color', '#00AA00', async () => ({
        main: (await rowIn('captions.json', 'c-0001'))?.text_style?.color ?? null,
        short: (await rowIn('captions.short.json', 'c-0001'))?.text_style?.color ?? null }));
    await shot('two-a');
    // (c) タブを切り替えて交互に選んで変える
    await clickTab('short');
    await waitChips('short', ['c-0001', 's-0002']);
    await click(CHIP('short', 's-0002'));
    await operate(sc, '(c) short 側 s-0002 の色', 'captions.short.json', 'color', '#0000FF', async () => ({
        short: (await rowIn('captions.short.json', 's-0002'))?.text_style?.color ?? null }));
    await clickTab('タイムライン');
    await waitChips(undefined, ['c-0002']);
    await click(CHIP(undefined, 'c-0002'));
    await operate(sc, '(c) edit.json 側 c-0002 の色（切り替えて戻った後）', 'captions.json', 'color', '#123456', async () => ({
        main: (await rowIn('captions.json', 'c-0002'))?.text_style?.color ?? null }));
    await clickTab('short');
    await waitChips('short', ['c-0001']);
    await click(CHIP('short', 'c-0001'));
    await operate(sc, '(c) short 側 c-0001 の色', 'captions.short.json', 'color', '#AA00AA', async () => ({
        main: (await rowIn('captions.json', 'c-0001'))?.text_style?.color ?? null,
        short: (await rowIn('captions.short.json', 'c-0001'))?.text_style?.color ?? null }));
    await shot('two-c');
    // 手順 2: short 側で選んだまま short を閉じる → インスペクターの選択
    await click(CHIP('short', 's-0002'));
    sc.snapshotBeforeCloseShort = await evalOn(cdp, SNAPSHOT);
    await click(`[data-iwo-tab="short"] .lm-TabBar-tabCloseIcon`).catch(async () => {
        await evalOn(cdp, `(()=>{window.__iwo.shell.getWidgets('bottom').find(w=>w.id==='akari-annotations-widget:short').close();return true})()`);
    });
    await sleep(1500);
    sc.timelinesAfterClose = await timelines();
    sc.snapshotAfterCloseShort = await evalOn(cdp, SNAPSHOT);
    sc.ownerAfterClose = (await evalOn(cdp, OWNER)).owner;
    await shot('two-b-closed');
    // (b) short を閉じた後、edit.json 側で色・文字・置いた文字・複数選択
    await waitChips(undefined, ['c-0002']);
    await click(CHIP(undefined, 'c-0002'));
    await operate(sc, '(b) 閉じた後 edit.json 側 c-0002 の色', 'captions.json', 'color', '#FF8800', async () => ({
        main: (await rowIn('captions.json', 'c-0002'))?.text_style?.color ?? null }));
    await operate(sc, '(b) 閉じた後 edit.json 側 c-0002 の文字', 'captions.json', 'text', '本編の二本目（直した）', async () => ({
        main: (await rowIn('captions.json', 'c-0002'))?.text ?? null }));
    await click(CHIP(undefined, 'c-0101'));
    await operate(sc, '(b) 閉じた後 置いた文字 c-0101 の色', 'captions.json', 'color', '#22CC22', async () => ({
        main: (await rowIn('captions.json', 'c-0101'))?.text_style?.color ?? null }));
    await operate(sc, '(b) 閉じた後 置いた文字 c-0101 の文字', 'captions.json', 'text', '置いた文字（直した）', async () => ({
        main: (await rowIn('captions.json', 'c-0101'))?.text ?? null }));
    await click(CHIP(undefined, 'c-0001'));
    await click(CHIP(undefined, 'c-0002'), 4);
    await operate(sc, '(b) 閉じた後 複数選択 c-0001 + c-0002 の色', 'captions.json', 'color', '#3344FF', async () => ({
        c0001: (await rowIn('captions.json', 'c-0001'))?.text_style?.color ?? null,
        c0002: (await rowIn('captions.json', 'c-0002'))?.text_style?.color ?? null }));
    await shot('two-b');
    await finish();
}

// ---- シナリオ: タイムライン 1 本（回帰の基準） ----
async function scenarioOne() {
    const sc = out.scenarios.one = { ops: [] };
    await prepare('one');
    await evalOn(cdp, command('akari.annotations.attachPassive'));
    await waitChips(undefined, ['c-0001', 'c-0002', 'c-0101']);
    await layout();
    sc.timelinesOpened = await timelines();
    await click(CHIP(undefined, 'c-0002'));
    await operate(sc, '(d) c-0002 の色', 'captions.json', 'color', '#FF0000', async () => ({
        main: (await rowIn('captions.json', 'c-0002'))?.text_style?.color ?? null }));
    await operate(sc, '(d) c-0002 の文字', 'captions.json', 'text', '本編の二本目（直した）', async () => ({
        main: (await rowIn('captions.json', 'c-0002'))?.text ?? null }));
    await click(CHIP(undefined, 'c-0101'));
    await operate(sc, '(d) 置いた文字 c-0101 の色', 'captions.json', 'color', '#22CC22', async () => ({
        main: (await rowIn('captions.json', 'c-0101'))?.text_style?.color ?? null }));
    await click(CHIP(undefined, 'c-0001'));
    await click(CHIP(undefined, 'c-0002'), 4);
    await operate(sc, '(d) 複数選択 c-0001 + c-0002 の色', 'captions.json', 'color', '#3344FF', async () => ({
        c0001: (await rowIn('captions.json', 'c-0001'))?.text_style?.color ?? null,
        c0002: (await rowIn('captions.json', 'c-0002'))?.text_style?.color ?? null }));
    await shot('one');
    await finish();
}

// ---- シナリオ: 0 行（captions.json 無し / 空）→ 台本の「この行から文字を置く」→ インスペクターで大きさ・色・文字 ----
// key = 結果の名前 / name = fixture / cold = タイムラインを先に開かない（台本の「置く」がタイムラインを開く）
async function scenarioZero(key, name = key, cold = false) {
    const sc = out.scenarios[key] = { ops: [] };
    await prepare(name);
    if (!cold) {
        await evalOn(cdp, command('akari.annotations.attachPassive'));
        await waitEval(cdp, `Boolean(document.querySelector(${S(TIMELINE())}))`, { label: 'timeline', timeoutMs: 120_000 });
        sc.timelinesOpened = await timelines();
    }
    await layout();
    if (!cold) sc.ownerAfterOpen = (await evalOn(cdp, OWNER)).owner ?? null;
    sc.captionsBefore = await captionsOf(path.join(PROJECT, 'captions.json'));
    await evalOn(cdp, command('akari.daihon.open'));
    await waitEval(cdp, `(()=>{const b=document.querySelector('.akari-daihon-place-text');return b&&!b.disabled&&b.getBoundingClientRect().width>0})()`, { label: 'place-text button', timeoutMs: 90_000 });
    await evalOn(cdp, `(()=>{window.__iwo.notices=[];return true})()`);
    await click('.akari-daihon-place-text');
    await waitEval(cdp, `Boolean(${MODEL}?.snapshot)`, { label: 'placed selection', timeoutMs: 30_000 }).catch(() => null);
    await sleep(1500);
    const placed = await captionsOf(path.join(PROJECT, 'captions.json'));
    sc.placedRows = placed?.map(c => ({ id: c.id, text: c.text, time_domain: c.time_domain ?? null })) ?? null;
    sc.noticesOnPlace = await evalOn(cdp, `window.__iwo.notices.map(n=>({where:n.where,text:n.text}))`);
    sc.snapshotAfterPlace = await evalOn(cdp, SNAPSHOT);
    sc.timelineChipsAfterPlace = await evalOn(cdp, `[...document.querySelectorAll(${S(TIMELINE() + ' .akari-annotations-strip-caption')})].map(e=>e.dataset.akariItemId)`);
    const id = placed?.[0]?.id;
    sc.placedId = id ?? null;
    sc.timelinesAfterPlace = await timelines();
    await shot(`${key}-placed`);
    if (id) {
        await operate(sc, `0 行（${key}）置いた直後 ${id} の大きさ`, 'captions.json', 'size', '60', async () => ({
            size: (await rowIn('captions.json', id))?.text_style?.size_px ?? null }));
        await operate(sc, `0 行（${key}）置いた直後 ${id} の色`, 'captions.json', 'color', '#FF0000', async () => ({
            color: (await rowIn('captions.json', id))?.text_style?.color ?? null }));
        await operate(sc, `0 行（${key}）置いた直後 ${id} の文字`, 'captions.json', 'text', '最初に置いた文字', async () => ({
            text: (await rowIn('captions.json', id))?.text ?? null }));
        await shot(`${key}-after-writes`);
    }
    await finish();
}

// ---- シナリオ: 書き込み失敗の右下の通知（AFTER のみ意味がある。BEFORE も同じ操作で記録） ----
async function scenarioNotify() {
    const sc = out.scenarios.notify = { ops: [] };
    await prepare('one');
    await evalOn(cdp, command('akari.annotations.attachPassive'));
    await waitChips(undefined, ['c-0002']);
    await layout();
    await click(CHIP(undefined, 'c-0002'));
    // 書き込み先を故意に外す: 選択を出したタイムラインの書き込み処理を例外にする（テスト環境の細工。製品コードは変えない）
    const sabotage = async () => { sc.sabotage = await evalOn(cdp, `(()=>{const w=window.__iwo.shell.getWidgets('bottom').find(w=>w.id==='akari-annotations-widget');w.handleInspectorWrite=async()=>{throw new Error('テスト: 書き込み先を外しました')};return true})()`); };
    await operate(sc, '書き込み失敗（例外）', 'captions.json', 'color', '#FF0000', undefined, sabotage);
    await shot('notify-throw');
    await sleep(500);
    // 同じ失敗を続けて 2 回 → 右下の通知が 1 つにまとまるか
    await operate(sc, '書き込み失敗（例外・2 回目）', 'captions.json', 'color', '#00FF00', undefined, sabotage);
    // 画面に見えている右下のトースト（通知センターの中の同じ項目は非表示なので数えない）+ ステータスバーのベルの件数
    sc.toastsVisible = await evalOn(cdp, `[...document.querySelectorAll('.theia-notification-list-item')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).map(e=>(e.textContent||'').replace(/\\s+/g,' ').trim())`);
    sc.bellCount = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('#theia-statusBar .element, #theia-statusBar [id*="notification"]')].find(e=>/notification|bell/i.test(e.id+' '+e.className+' '+e.innerHTML));return e?(e.textContent||'').trim():null})()`);
    await shot('notify-throw-twice');
    await finish();
}

try {
    if (!existsSync(ELECTRON)) throw new Error('Electron not found under --shell');
    for (const [name, run] of [['two', scenarioTwo], ['one', scenarioOne], ['zero-missing', () => scenarioZero('zero-missing')], ['zero-empty', () => scenarioZero('zero-empty')], ['zero-two', () => scenarioZero('zero-two')], ['zero-cold', () => scenarioZero('zero-cold', 'zero-missing', true)], ['notify', scenarioNotify]]) {
        if (!ONLY.includes(name)) continue;
        try { await run(); }
        catch (error) {
            (out.scenarios[name] ??= {}).error = sanitize(error, REPO);
            if (cdp) await screenshot(cdp, path.join(TMP, `failure-${PHASE}-${name}.png`)).catch(() => {});
            await finish().catch(() => {});
        }
        await save();
    }
    if (PHASE === 'after') {
        const { judge } = await import('./judge.mjs');
        judge(out, check);
    }
    out.status = Object.values(out.scenarios).some(s => s.error) ? 'error'
        : PHASE === 'before' ? 'observed' : (out.checks.every(c => c.pass) ? 'pass' : 'fail');
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
} finally {
    await save();
    if (session) await stop(session);
    console.log(JSON.stringify({ status: out.status, errors: Object.fromEntries(Object.entries(out.scenarios).filter(([, s]) => s.error).map(([k, s]) => [k, s.error.slice(0, 300)])), checks: out.checks.map(c => [c.name, c.pass]) }, null, 1));
}
