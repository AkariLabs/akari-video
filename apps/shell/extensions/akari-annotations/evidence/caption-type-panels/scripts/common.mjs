// caption-type-panels の L1 の共通部品（ラッパー作成の検証スクリプト）。
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
export const PORT = Number(process.env.CDP_PORT || 9631);
export const S = JSON.stringify;

export function paths(work) {
    return { WORK: work, PJ: path.join(work, 'ws-caption-type-panels'), ISO: path.join(work, 'iso-caption-type-panels'), LIBRARY: path.join(work, 'fixture', 'library') };
}
export async function start(p) {
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
export const center = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
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
    const text = key === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {}; // 実キーと同じく keypress（ボタンの押下）を起こす
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...text });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
export async function dismissToasts(cdp) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
}
export async function openTextstyleShelf(cdp) {
    await dismissToasts(cdp);
    // ライブラリの「テキストスタイル」の棚を既存のコマンドで開く（ホームのタイルは 2026-09-27 に改訂され、テキストスタイルは「詳細」の中）
    await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.catalog.open',{category:'textstyle'});return true})()`);
    await waitEval(cdp, `document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]').length>0`, { label: 'textstyle shelf', timeoutMs: 30_000 });
    await sleep(1500);
}
// ライブラリのテキストスタイル / マイスタイルのカードの見本（見本の要素の computed style）
export const LIB_CARDS = `(()=>{const out=[];const cards=[...document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"], [data-akari-my-style-card]')];for(const c of cards){const id=c.getAttribute('data-akari-catalog-preset-item')||('mystyle/'+c.getAttribute('data-akari-my-style-card'));const leaves=[...c.querySelectorAll('*')].filter(e=>e.children.length===0&&(e.textContent||'').trim()&&e.getBoundingClientRect().width>0);const t=leaves.find(e=>/Abc|あいう|漢字/.test(e.textContent))||leaves[0];let s=null;if(t){const chain=[];let n=t;while(n&&n!==c){const cs=getComputedStyle(n);chain.push({bg:cs.backgroundColor,shadow:cs.textShadow,stroke:cs.webkitTextStrokeWidth+' '+cs.webkitTextStrokeColor,paintOrder:cs.paintOrder});n=n.parentElement}const cs=getComputedStyle(t);s={text:t.textContent.trim().slice(0,30),color:cs.color,font:cs.fontFamily.slice(0,80),weight:cs.fontWeight,letterSpacing:cs.letterSpacing,shadow:cs.textShadow.slice(0,160),stroke:cs.webkitTextStrokeWidth+' '+cs.webkitTextStrokeColor,chainBg:chain.map(x=>x.bg).filter(b=>b&&b!=='rgba(0, 0, 0, 0)').slice(0,3),filter:cs.filter}}out.push({id,sample:s})}return out})()`;
// プロジェクトを開いた状態にする: タイムラインは起動で開くので、無いときだけ開く（コマンドの完了は待たない — 確認ダイアログで止まるため）。
// そのあと出力プレビューを開いて webview が出るまで待つ。
export async function openProject(session, project, seek = 1) {
    const cdp = session.cdp;
    const chips = `document.querySelectorAll('.akari-annotations-strip-caption').length>0`;
    const has = await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 30_000 }).catch(() => false);
    if (!has) {
        await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.annotations.open');return true})()`);
        await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 120_000 });
    }
    const { listTargets } = await import('./cdp-lib.mjs');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.preview.seekOutput',${S({ editUri: `file://${path.join(project, 'edit.json')}`, time: seek })});return true})()`);
        await sleep(3000);
        if ((await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break;
    }
    await sleep(2000);
    await dismissToasts(cdp);
}
