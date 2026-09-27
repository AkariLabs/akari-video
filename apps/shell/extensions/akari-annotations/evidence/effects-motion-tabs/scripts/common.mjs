// effects-motion-tabs の L1 の共通部品（ラッパー作成の検証スクリプト。caption-panels-followups の common.mjs の写しを改変・既定ポート 9636）。
import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';
import { command, launch, sleep, waitEval } from './l1-lib.mjs';
import { prepareLibrary } from './library-home.mjs';
import { setWindow } from './winsize.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.dirname(HERE);
export const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
export const SHELL = path.join(REPO, 'apps', 'shell');
export const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
export const PORT = Number(process.env.CDP_PORT || 9636);
export const S = JSON.stringify;

export function paths(work, name = 'bag') {
    return { WORK: work, NAME: name, PJ: path.join(work, `ws-effects-motion-tabs-${name}`), ISO: path.join(work, 'iso-effects-motion-tabs'), LIBRARY: path.join(work, 'fixture', 'library') };
}
export async function start(p) {
    await rm(p.PJ, { recursive: true, force: true });
    await cp(path.join(p.WORK, 'fixture', p.NAME), p.PJ, { recursive: true });
    process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: p.PJ, port: PORT, isoDir: p.ISO, prepare: iso => prepareLibrary(iso, p.LIBRARY) });
    session.window = await setWindow(session.cdp, 1440, 900);
    return session;
}
export function shooter(p, prefix) {
    return async (cdp, name) => {
        const f = path.join(p.WORK, `${prefix}-${name}.png`);
        await screenshot(cdp, f);
        execFileSync('sips', ['-Z', '1440', f, '--out', path.join(OUT, `${prefix}-${name}.png`)], { stdio: 'ignore' });
        return `${prefix}-${name}.png`;
    };
}
export const center = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
export async function clickSel(cdp, sel, timeoutMs = 20_000) {
    const pt = await waitEval(cdp, center(sel), { label: `${sel} visible`, timeoutMs });
    await realClick(cdp, pt.x, pt.y); return pt;
}
export async function hoverSel(cdp, sel) {
    const pt = await waitEval(cdp, center(sel), { label: `${sel} visible`, timeoutMs: 20_000 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x - 2, y: pt.y - 2, button: 'none' }); await sleep(40);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
    return pt;
}
export async function key(cdp, key, code, keyCode, modifiers = 0) {
    const text = key === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {};
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...text });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
export async function dismissToasts(cdp) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
}
// プロジェクトを開いた状態にする（タイムライン → 出力プレビューの webview が出るまで）。
export async function openProject(session, project, seek = 1) {
    const cdp = session.cdp;
    const chips = `document.querySelectorAll('.akari-annotations-strip-caption').length>0`;
    const has = await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 30_000 }).catch(() => false);
    if (!has) {
        await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.annotations.open');return true})()`);
        await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 120_000 });
    }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.preview.seekOutput',${S({ editUri: `file://${path.join(project, 'edit.json')}`, time: seek })});return true})()`);
        await sleep(3000);
        if ((await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break;
    }
    await sleep(2000);
    await dismissToasts(cdp);
}
export async function selectCaption(cdp, id) {
    await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${id}"]`);
    await sleep(1200);
    await evalOn(cdp, command('akari.inspector.open'));
    await sleep(1200);
}
export { command, sleep, waitEval };
