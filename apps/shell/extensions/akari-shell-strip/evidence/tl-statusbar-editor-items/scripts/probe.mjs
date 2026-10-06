// ステータスバー項目の採取（BEFORE / AFTER 共通）。usage: node probe.mjs <label> <outDir>
import path from 'node:path';
import { mkdir, cp, rm } from 'node:fs/promises';
import { launch, stop, evalOn, screenshot, sleep, saveJson, command, waitEval, sanitize } from './l1-lib.mjs';

const [label = 'run', outDir = path.resolve('out')] = process.argv.slice(2);
const repo = path.resolve(process.env.AKARI_REPO);
const shellDir = path.join(repo, 'apps/shell');
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const scratch = process.env.AKARI_SCRATCH;
const project = path.join(scratch, `ws-tl-statusbar-editor-items-${label}`);
const isoDir = path.join(scratch, `iso-tl-statusbar-editor-items-${label}`);
const port = 9479;
delete process.env.ELECTRON_RUN_AS_NODE;

const EDITOR_IDS = ['editor-status-cursor-position', 'editor-status-encoding', 'editor-status-eol', 'editor-status-tabbing-config', 'editor-status-language', 'editor-language-status-items', 'editor-formatter-status'];
const ENTRIES = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('#theia-statusBar .element')].map(e=>{const r=e.getBoundingClientRect();return{id:e.id,text:(e.textContent||'').trim().slice(0,60),aria:(e.getAttribute('aria-label')||'').slice(0,60),left:px(r.left),width:px(r.width),area:e.closest('.area')?.className||null}})})()`;
const ACTIVE = `(()=>{const shell=window.theia.container;const d=shell._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&k.name==='ApplicationShell');const s=K?shell.get(K):null;const w=s?.activeWidget||s?.currentWidget;return w?{id:w.id,title:w.title?.label,cls:w.constructor?.name,area:s.getAreaFor?.(w)}:null})()`;

const result = { label, steps: [] };
await mkdir(outDir, { recursive: true });
await rm(project, { recursive: true, force: true });
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
let session;
try {
    session = await launch({ shellDir, electron, project, port, isoDir });
    result.pid = session.pid;
    const { cdp } = session;
    const snap = async (name) => {
        await sleep(2500);
        const entries = await evalOn(cdp, ENTRIES);
        const active = await evalOn(cdp, ACTIVE).catch(e => ({ error: String(e.message) }));
        const editorItems = entries.filter(e => EDITOR_IDS.some(id => e.id === `status-bar-${id}`));
        await screenshot(cdp, path.join(outDir, `${label}-${name}.png`));
        result.steps.push({ name, active, editorItems, entries });
        console.log(name, JSON.stringify({ active, editorItems: editorItems.map(e => `${e.id}=${e.text}`), ids: entries.map(e => e.id) }));
    };
    await sleep(6000);
    await snap('01-startup');
    // 0: テキスト文書をアクティブにする（無題のテキスト文書 = Claude Code パネルが開く Untitled と同種）
    await evalOn(cdp, command('workbench.action.files.newUntitledFile'));
    await waitEval(cdp, `Boolean(document.querySelector('.monaco-editor'))`, { label: 'monaco editor', timeoutMs: 30_000 }).catch(() => {});
    await snap('02-untitled-text');
    // 案件の CLAUDE.md をテキストエディタで開く
    await evalOn(cdp, `(async()=>{const c=window.theia.container;const d=c._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&k.name==='EditorManager');const m=c.get(K);const U=[...d._map.keys()].find(k=>typeof k==='function'&&k.name==='WorkspaceService');const ws=c.get(U);const root=(await ws.roots)[0].resource;await m.open(root.resolve('CLAUDE.md'));return true})()`).catch(e => { result.openFileError = sanitize(e, repo); });
    await snap('03-file-editor');
    result.ok = true;
} catch (error) {
    result.error = sanitize(error, repo);
    console.error(result.error);
} finally {
    await stop(session);
    await saveJson(path.join(outDir, `results-${label}.json`), result);
    await rm(project, { recursive: true, force: true });
}
