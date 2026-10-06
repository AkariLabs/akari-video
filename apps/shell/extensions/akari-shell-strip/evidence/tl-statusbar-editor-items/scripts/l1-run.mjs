// テキスト文書がアクティブなときの最下段バーを採る（課題チップ・報告つき）。
// usage: AKARI_REPO=<リポ> AKARI_SCRATCH=<一時ディレクトリ> node l1-run.mjs <label> <記録先> [claude-code 拡張の展開済みディレクトリ]
import path from 'node:path';
import { mkdir, cp, rm, writeFile, readFile, copyFile } from 'node:fs/promises';
import { launch, stop, evalOn, screenshot, sleep, saveJson, command, waitEval, sanitize } from './l1-lib.mjs';
import { realClick, realDrag } from './cdp-lib.mjs';

const [label = 'run', outDir = path.resolve('out'), claudeExt] = process.argv.slice(2);
const repo = path.resolve(process.env.AKARI_REPO);
const shellDir = path.join(repo, 'apps/shell');
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const scratch = process.env.AKARI_SCRATCH;
const project = path.join(scratch, `ws-tl-statusbar-editor-items-${label}`);
const isoDir = path.join(scratch, `iso-tl-statusbar-editor-items-${label}`);
const port = 9479;
delete process.env.ELECTRON_RUN_AS_NODE;

const EDITOR_IDS = ['editor-status-cursor-position', 'editor-status-encoding', 'editor-status-eol', 'editor-status-tabbing-config', 'editor-status-language', 'editor-language-status-items', 'editor-formatter-status'];
const ENTRIES = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('#theia-statusBar .element')].map(e=>{const r=e.getBoundingClientRect();return{id:e.id,text:(e.textContent||'').trim().slice(0,60),left:px(r.left),width:px(r.width),area:e.parentElement?.className||null}})})()`;
const SERVICE = `((...m)=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&m.every(n=>typeof k.prototype?.[n]==='function'));return c.get(k)})`;
const SHELL = `${SERVICE}('collapsePanel','revealWidget')`;
const WGT = `${SHELL}.getWidgets('bottom').find(w=>w.id==='akari-annotations-widget')`;
const ACTIVE = `(()=>{const s=${SHELL};const w=s.activeWidget;const e=${SERVICE}('getOrCreateByUri','openToSide');const cur=e.currentEditor;return{active:w?{id:w.id,title:w.title?.label,area:s.getAreaFor?.(w)??null}:null,currentEditor:cur?{id:cur.id,title:cur.title?.label,uri:String(cur.editor?.uri?.path?.base??'')}:null,statusBarClass:${SERVICE}('setElement','removeElement').constructor.name}})()`;

const result = { label, steps: [] };
await mkdir(outDir, { recursive: true });
await rm(project, { recursive: true, force: true });
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
await copyFile(path.join(shellDir, 'extensions/akari-preview/evidence/preview-audio-wiring/fixture/fixture-video.mp4'), path.join(project, 'assets/clip.mp4'));
const editPath = path.join(project, 'edit.json');
// 課題 1 件の fixture（存在しない静止画を sources[0] に持つ）
await writeFile(editPath, `${JSON.stringify({
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'bg', path: 'assets/still/xxx/bg.png' }, { id: 'clip', path: 'assets/clip.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [0, 180, 360, 540].map((at, i) => ({ id: `cut-${i + 1}`, at, duration: 180, source: { kind: 'media', src: 'clip', in: 0, out: 6 } })) }]
}, null, 2)}\n`);
let session;
try {
    session = await launch({ shellDir, electron, project, port, isoDir, beforeSpawn: claudeExt ? async () => { await mkdir(path.join(isoDir, 'deployedPlugins'), { recursive: true }); await cp(claudeExt, path.join(isoDir, 'deployedPlugins', path.basename(claudeExt)), { recursive: true }); } : undefined });
    result.pid = session.pid;
    const { cdp } = session;
    const ev = expr => evalOn(cdp, expr);
    const snap = async (name, wait = 2500) => {
        await sleep(wait);
        const entries = await ev(ENTRIES);
        const active = await ev(ACTIVE).catch(e => ({ error: String(e.message) }));
        const editorItems = entries.filter(e => EDITOR_IDS.some(id => e.id === `status-bar-${id}`));
        await screenshot(cdp, path.join(outDir, `${label}-${name}.png`));
        const bar = await ev(`(()=>{const r=document.getElementById('theia-statusBar').getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: bar.left, y: bar.top - 4, width: bar.width, height: bar.height + 8, scale: 2 } });
        await writeFile(path.join(outDir, `${label}-${name}-statusbar.png`), Buffer.from(data, 'base64'));
        const step = { name, active, editorItems, entries };
        result.steps.push(step);
        console.log(name, JSON.stringify({ active, editorItems: editorItems.map(e => `${e.id}=${e.text}`), entries: entries.map(e => `${e.id.replace('status-bar-', '')}=${e.text}@${e.left}w${e.width}`) }));
        await saveJson(path.join(outDir, `results-${label}.json`), result);
        return step;
    };
    // 拡張（Claude Code）の項目が出るまで待つ（出なければ記録して先へ）
    if (claudeExt) result.claudeItem = await waitEval(cdp, `[...document.querySelectorAll('#theia-statusBar .element')].map(e=>({id:e.id,text:(e.textContent||'').trim()})).find(e=>/claude/i.test(e.id+e.text))||null`, { label: 'claude code item', timeoutMs: 90_000 }).catch(e => ({ error: sanitize(e, repo) }));
    await sleep(4000);
    await ev(`(()=>{document.querySelectorAll('.akari-guide-announcement .close,.theia-notification-list-item .codicon-close').forEach(e=>e.click());return true})()`);
    // タイムラインを開く
    if (!await ev(`!!document.getElementById('akari-annotations-widget')`)) {
        await ev(command('akari.annotations.open')).catch(() => null);
    }
    if (!await ev(`!!document.getElementById('akari-annotations-widget')`)) {
        const ids = await ev(`(()=>{const r=${SERVICE}('registerCommand','executeCommand','getCommand');return r.commands.filter(c=>/annotation|timeline/i.test(c.id)&&/open|show|toggle/i.test(c.id)).map(c=>c.id)})()`);
        result.timelineCommandCandidates = ids;
        for (const id of ids) { await ev(command(id)).catch(() => null); await sleep(800); if (await ev(`!!document.getElementById('akari-annotations-widget')`)) { result.timelineCommand = id; break; } }
    }
    await waitEval(cdp, `document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind]').length >= 4`, { label: 'timeline clips', timeoutMs: 90_000 });
    await sleep(1500);
    await snap('01-timeline');
    // クリップを動かして保存 → 課題チップ
    const editBefore = await readFile(editPath, 'utf8');
    const clip = await ev(`(()=>{const e=[...document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind]')].at(-1);const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realDrag(cdp, [clip, { x: clip.x + 40, y: clip.y }]);
    await waitEval(cdp, `true`);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && (await readFile(editPath, 'utf8')) === editBefore) await sleep(200);
    await waitEval(cdp, `!!document.getElementById('status-bar-akari-timeline-issue')`, { label: 'issue chip', timeoutMs: 20_000 }).catch(e => { result.issueChipError = sanitize(e, repo); });
    await snap('02-issue-chip', 5000);
    // 0: テキスト文書をアクティブにする（無題のテキスト文書）
    await ev(command('workbench.action.files.newUntitledFile'));
    await waitEval(cdp, `Boolean(document.querySelector('.monaco-editor'))`, { label: 'monaco editor', timeoutMs: 30_000 }).catch(() => {});
    await snap('03-untitled-text');
    // 案件の CLAUDE.md をテキストエディタで開き、カーソルを動かす
    await ev(`(async()=>{const m=${SERVICE}('getOrCreateByUri','openToSide');const ws=${SERVICE}('addRoot','removeRoots');const root=(await ws.roots)[0].resource;await m.open(root.resolve('CLAUDE.md'),{mode:'activate'});return true})()`).catch(e => { result.openFileError = sanitize(e, repo); });
    await sleep(1500);
    const ed = await ev(`(()=>{const e=[...document.querySelectorAll('.monaco-editor')].find(e=>e.getBoundingClientRect().width>0);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+120,y:r.top+60}})()`);
    if (ed) await realClick(cdp, ed.x, ed.y);
    await snap('04-file-editor');
    // 一過性の報告（ルーラーをクリック）→ 報告が出ている間にテキストエディタへ戻す
    await ev(`(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close').forEach(e=>e.click());return true})()`);
    for (const frac of [0.3, 0.5, 0.7]) {
        const ruler = await ev(`(()=>{const r=${WGT}.rulerBar.getBoundingClientRect();return{x:r.left+r.width*${frac},y:r.top+r.height/2}})()`);
        await realClick(cdp, ruler.x, ruler.y);
        const shown = await waitEval(cdp, `!!document.getElementById('status-bar-akari-timeline-message')`, { label: 'timeline message', timeoutMs: 3_000 }).catch(e => { result.messageError = sanitize(e, repo); return false; });
        result.rulerClicks = (result.rulerClicks ?? 0) + 1;
        if (shown) { delete result.messageError; break; }
    }
    if (ed) await realClick(cdp, ed.x, ed.y);
    await snap('05-report-with-editor', 300);
    result.ok = true;
} catch (error) {
    result.error = sanitize(error, repo);
    console.error(result.error);
} finally {
    await stop(session);
    await saveJson(path.join(outDir, `results-${label}.json`), result);
    await rm(project, { recursive: true, force: true });
}
