// tl-caption-motion-clear の L1 の共通部品（ラッパー作成の検証スクリプト。caption-karaoke-settings の common.mjs の写しを改変・既定ポート 9474）。
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick, screenshot } from './cdp-lib.mjs';
import { command, launch, sleep, waitEval } from './l1-lib.mjs';
import { prepareLibrary } from './library-home.mjs';
import { setWindow } from './winsize.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.dirname(HERE);
export const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
export const SHELL = path.join(REPO, 'apps', 'shell');
export const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
export const PORT = Number(process.env.CDP_PORT || 9474);
export const S = JSON.stringify;

export function paths(work, name) {
    return { WORK: work, NAME: name, PJ: path.join(work, `ws-tl-caption-motion-clear-${name}`), ISO: path.join(work, `iso-tl-caption-motion-clear-${name}`), LIBRARY: path.join(work, 'fixture', 'library') };
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
export async function key(cdp, key, code, keyCode, modifiers = 0) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
export async function dismissToasts(cdp) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
}
export async function openTimeline(session) {
    const cdp = session.cdp;
    const chips = `document.querySelectorAll('.akari-annotations-strip-caption').length>0`;
    const has = await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 30_000 }).catch(() => false);
    if (!has) {
        await evalOn(cdp, command('akari.annotations.open'));
        await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 120_000 });
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
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
export const captionsOf = async project => { const p = await readJson(path.join(project, 'captions.json')); return Array.isArray(p) ? p : p.captions; };
export { command, sleep, waitEval };
