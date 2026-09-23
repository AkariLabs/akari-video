#!/usr/bin/env node
// インスペクターの字幕スタイル面の L1（ラッパー作成の検証スクリプト）。fixture は gen-fixture.mjs で作る。
// 使い方: node l1.mjs <before|after> [--shell=<apps/shell の絶対パス>] [--fixture=<dir>] [--port=9475]
// before = 変更前ビルドの観測記録（字幕の種類ごとのスタイル欄・スクリーンショット。判定はしない）
// after  = 受け入れ条件の実測（l1-after.mjs の関数を呼ぶ）
// 実機の Electron を専用のポート・一時ディレクトリ（名前に inspector-caption-style-panel を含む）で起動し、自分の PID だけを止める。
import { cp, rm, mkdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { listTargets } from './cdp-lib.mjs';
import { S, command, evalOn, launch, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const PHASE = process.argv[2];
if (!['before', 'after'].includes(PHASE)) throw new Error('phase must be before|after');
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const EVIDENCE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(EVIDENCE, '..', '..', '..', '..', '..', '..');
const SHELL = path.resolve(arg('shell') ?? path.join(REPO, 'apps', 'shell'));
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = Number(arg('port') ?? 9475);
const TMP = path.join(os.tmpdir(), 'inspector-caption-style-panel-l1');
const FIXTURE_SRC = path.resolve(arg('fixture') ?? path.join(TMP, 'fixture'));
let PROJECT = path.join(TMP, `project-${PHASE}`);
const ISO = path.join(TMP, `iso-${PHASE}`);
const RESULTS = path.join(EVIDENCE, `results-${PHASE}.json`);
const out = { phase: PHASE, status: 'running', port: PORT, cases: [], checks: [], screenshots: [], writes: [] };
const SANITIZE_ROOTS = [REPO, SHELL, TMP, os.tmpdir(), os.homedir()];
const clean = value => {
    if (typeof value === 'string') {
        let text = value;
        for (const root of SANITIZE_ROOTS) text = text.replaceAll(root, '<local>');
        return text.replace(/\/(Users|private|var|tmp)\/[^\s)'"]+/g, '<local>');
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    return value;
};
const save = () => saveJson(RESULTS, clean(out));

export const ctx = { PHASE, PORT, PROJECT, EVIDENCE, out, save };

async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = record.detail?.pass !== false; }
    catch (error) { record.error = sanitize(error, REPO); }
    finally { await save(); }
    return record;
}
ctx.check = check;

async function shotInspector(cdp, name) {
    await sleep(600);
    const rect = await evalOn(cdp, `(()=>{const r=document.querySelector('[data-akari-ui="panel:inspector"]').getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
    const file = `${PHASE}-${name}.png`;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(EVIDENCE, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
    return file;
}
async function shotFull(cdp, name) {
    await sleep(600);
    const file = `${PHASE}-${name}.png`;
    await screenshot(cdp, path.join(EVIDENCE, file));
    out.screenshots.push(file);
    return file;
}
ctx.shotInspector = shotInspector;
ctx.shotFull = shotFull;

const P = body => `(async()=>{const I=window.__icsp;${body}})()`;
ctx.P = P;

async function setup(cdp) {
    await evalOn(cdp, `(()=>{const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];const service=(...m)=>{const k=keys.find(k=>typeof k==='function'&&m.every(n=>typeof k.prototype?.[n]==='function'));if(!k)throw new Error('missing '+m.join(','));return c.get(k)};window.__icsp={shell:service('resize','getWidgets','activateWidget'),commands:service('executeCommand','getCommand'),themes:service('setCurrentTheme','getCurrentTheme','getThemes')};return true})()`);
}

export async function setTheme(cdp, type) {
    await evalOn(cdp, P(`await I.themes.initialized;const t=I.themes.getThemes().find(t=>t.type===${S(type)});I.themes.setCurrentTheme(t.id,true);return t.id`));
    await waitEval(cdp, P(`return I.themes.getCurrentTheme().type===${S(type)}`), { label: `theme ${type}` });
    await sleep(800);
}
export async function setRightWidth(cdp, width) {
    return evalOn(cdp, P(`I.shell.resize(${width},'right');await I.shell.rightPanelHandler.state.pendingUpdate;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{panel:I.shell.rightPanelHandler.getPanelSize(),inspector:document.querySelector('[data-akari-ui="panel:inspector"]').getBoundingClientRect().width}`));
}
export async function selectCaptions(cdp, ids) {
    const editUri = `file://${path.join(PROJECT, 'edit.json')}`;
    await evalOn(cdp, command('akari.timeline.selectCaptions', { editUri, captionIds: ids }));
    await evalOn(cdp, command('akari.inspector.open'));
    await sleep(900);
}
ctx.setTheme = setTheme; ctx.setRightWidth = setRightWidth; ctx.selectCaptions = selectCaptions;

// インスペクターの今の中身（タブ・セクション・スタイル欄）を読む。
export const INSPECTOR_STATE = `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');if(!root)return null;const txt=e=>(e?.textContent||'').replace(/\\s+/g,' ').trim();const tabs=[...root.querySelectorAll('[data-akari-ui^="tab:inspector-"]')].map(t=>({id:t.getAttribute('data-akari-ui').slice(14),label:txt(t),active:t.classList.contains('is-active'),disabled:t.disabled}));const sections=[...root.querySelectorAll('[data-akari-ui^="section:inspector-"]')].map(s=>({id:s.getAttribute('data-akari-ui').slice(18),label:txt(s.querySelector('.akari-inspector-section-toggle, .akari-inspector-section-header')),hidden:s.getBoundingClientRect().height===0,fields:[...s.querySelectorAll('[data-akari-field]')].map(f=>({name:f.getAttribute('data-akari-field'),label:txt(f.querySelector('.akari-inspector-row-label')),value:txt(f).slice(0,80)}))}));return{header:txt(root.querySelector('.akari-inspector-selection-header, [class*="selection-header"]')).slice(0,120),tabs,sections,scrollWidth:root.scrollWidth,clientWidth:root.clientWidth}})()`;
ctx.INSPECTOR_STATE = INSPECTOR_STATE;

async function openAll(cdp) {
    await evalOn(cdp, command('akari.annotations.open'));
    await waitEval(cdp, `document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 180_000 });
    const editUri = `file://${path.join(PROJECT, 'edit.json')}`;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri, time: 5 })).catch(() => {});
        await sleep(3000);
        if ((await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break;
    }
    await evalOn(cdp, command('akari.inspector.open'));
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`, { label: 'inspector', timeoutMs: 60_000 });
    await setup(cdp);
    await evalOn(cdp, P(`I.shell.resize(300,'bottom');await I.shell.bottomPanelState?.pendingUpdate;return true`)).catch(() => {});
    await setRightWidth(cdp, 360);
}

export const CASES = [
    { name: 'spoken', label: '話した言葉の字幕（スタイルなし）', ids: ['c-0001'] },
    { name: 'spoken-2line-bg', label: '話した言葉の字幕 2 行 + 座布団あり', ids: ['c-0002'] },
    { name: 'preset', label: 'スタイルプリセット付きの字幕（subtitle-variety）', ids: ['c-0003'] },
    { name: 'placed', label: '置いた文字', ids: ['c-0101'] },
    { name: 'multi', label: '複数選択（話した言葉 3 本）', ids: ['c-0001', 'c-0004', 'c-0005'] },
    { name: 'multi-mixed', label: '複数選択（話した言葉 + 置いた文字 + プリセット）', ids: ['c-0001', 'c-0101', 'c-0003'] }
];

async function observeCases(cdp) {
    for (const item of CASES) {
        await check(`case:${item.name}`, async () => {
            await selectCaptions(cdp, item.ids);
            await waitEval(cdp, `(()=>{const r=document.querySelector('[data-akari-ui="panel:inspector"]');return r&&r.querySelector('[data-akari-ui^="section:inspector-"], [data-akari-ui^="tab:inspector-"]')})()!=null`, { label: `inspector for ${item.name}`, timeoutMs: 30_000 }).catch(() => null);
            // スタイルのセクション（あれば）を先頭へ。
            await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-style"], [data-akari-ui^="section:inspector-style"]');if(s){const t=s.querySelector('.akari-inspector-section-toggle');if(t&&t.getAttribute('aria-expanded')==='false')t.click();s.scrollIntoView({block:'start'})}return Boolean(s)})()`);
            await sleep(500);
            const state = await evalOn(cdp, INSPECTOR_STATE);
            const file = await shotInspector(cdp, `case-${item.name}`);
            const style = state?.sections.filter(s => s.id.startsWith('style')) ?? [];
            const record = { ...item, screenshot: file, hasStyleSection: style.length > 0, styleFields: style.flatMap(s => s.fields.map(f => f.name)), state };
            out.cases.push(record);
            return { pass: true, hasStyleSection: record.hasStyleSection, styleFieldCount: record.styleFields.length };
        });
    }
}

let session;
try {
    if (!existsSync(ELECTRON)) throw new Error('Electron not found under --shell');
    await rm(PROJECT, { recursive: true, force: true });
    await mkdir(TMP, { recursive: true });
    await cp(FIXTURE_SRC, PROJECT, { recursive: true });
    PROJECT = await realpath(PROJECT);
    ctx.PROJECT = PROJECT;
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: ISO });
    out.pid = session.pid;
    ctx.session = session;
    await openAll(session.cdp);
    await setTheme(session.cdp, 'dark');
    await observeCases(session.cdp);
    await shotFull(session.cdp, 'full-dark');
    await setTheme(session.cdp, 'light');
    await selectCaptions(session.cdp, ['c-0002']);
    await shotInspector(session.cdp, 'case-spoken-2line-bg-light');
    if (PHASE === 'after') {
        const { runAfter } = await import('./l1-after.mjs');
        await runAfter(ctx);
    }
    out.status = out.checks.every(c => c.pass) ? (PHASE === 'before' ? 'observed' : 'pass') : 'fail';
} catch (error) {
    out.status = 'error';
    out.error = sanitize(error, REPO);
    if (session?.cdp) await screenshot(session.cdp, path.join(TMP, `failure-${PHASE}.png`)).catch(() => {});
} finally {
    await save();
    await stop(session);
    console.log(JSON.stringify({ status: out.status, checks: out.checks.map(c => [c.name, c.pass]), error: out.error }, null, 1));
}
