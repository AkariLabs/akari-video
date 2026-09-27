// textstyle-lab-crown の L1 の共通部品（ラッパー作成の検証スクリプト。library-text-page の common.mjs の写しを改変）。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick, screenshot } from './cdp-lib.mjs';
import { launch, sleep, waitEval } from './l1-lib.mjs';
import { prepareLibrary } from './library-home.mjs';
import { setWindow } from './winsize.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.dirname(HERE);
export const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
export const SHELL = path.join(REPO, 'apps', 'shell');
export const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
export const PORT = Number(process.env.CDP_PORT || 9637);
export const S = JSON.stringify;

export function paths(work) {
    return { WORK: work, PJ: path.join(work, 'ws-textstyle-lab-crown'), ISO: path.join(work, 'iso-textstyle-lab-crown'), LIBRARY: path.join(work, 'fixture', 'library') };
}
/** extraPrepare(iso) は AKARI_HOME（iso/akari-home）へ entitlements の資格情報などを置くために使う。 */
export async function start(p, extraPrepare) {
    process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
    const session = await launch({ shellDir: SHELL, electron: ELECTRON, project: p.PJ, port: PORT, isoDir: p.ISO,
        prepare: async iso => { await prepareLibrary(iso, p.LIBRARY); if (extraPrepare) await extraPrepare(iso); } });
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
export const center = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
export async function clickSel(cdp, sel, timeoutMs = 20_000) {
    const pt = await waitEval(cdp, center(sel), { label: `${sel} visible`, timeoutMs });
    await realClick(cdp, pt.x, pt.y); return pt;
}
export async function key(cdp, key, code, keyCode, modifiers = 0) {
    const text = key === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {};
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...text });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
export async function dismissToasts(cdp) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
}
export const exec = (id, args) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${S(id)}${args === undefined ? '' : `,${S(args)}`});return true})()`;
// プロジェクトを開いた状態にする（library-text-page と同じ手順）。
export async function openProject(session, project, seek = 1) {
    const cdp = session.cdp;
    const chips = `document.querySelectorAll('.akari-annotations-strip-caption').length>0`;
    const has = await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 30_000 }).catch(() => false);
    if (!has) {
        await evalOn(cdp, exec('akari.annotations.open'));
        await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 120_000 });
    }
    const { listTargets } = await import('./cdp-lib.mjs');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await evalOn(cdp, exec('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek }));
        await sleep(3000);
        if ((await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break;
    }
    await sleep(2000);
    await dismissToasts(cdp);
}
export async function openTextPage(cdp) {
    if (await evalOn(cdp, `Boolean(document.querySelector('[data-akari-library-text-look-page]'))`)) return;
    if (!await evalOn(cdp, `Boolean(document.querySelector('[data-akari-library-primary-tile="text"]'))`)) {
        await clickSel(cdp, '[data-akari-panel-segment="catalog"]');
        await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-primary-tile="text"]'))`, { label: 'library home', timeoutMs: 30_000 });
        await sleep(600);
    }
    await clickSel(cdp, '[data-akari-library-primary-tile="text"]');
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-library-text-look-page]'))`, { label: 'text page', timeoutMs: 20_000 });
    await sleep(1500);
}
