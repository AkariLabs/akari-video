// caption-export-fonts の L1（アプリ）共通部品。CDP の土台は textstyle-lab-crown の cdp-lib / l1-lib を読み取り専用で使う。
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const W = '<repo>';
const LIB = path.join(W, 'apps/shell/extensions/akari-project/evidence/textstyle-lab-crown/scripts');
export const { CDP, evalOn, listTargets, realClick, screenshot } = await import(path.join(LIB, 'cdp-lib.mjs'));
export const { launch, stop, waitEval, sleep } = await import(path.join(LIB, 'l1-lib.mjs'));
export const { setWindow } = await import(path.join(LIB, 'winsize.mjs'));
export const REPO = W, SHELL = path.join(W, 'apps/shell');
export const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
export const PORT = 9640;
export const S = JSON.stringify;
export const WORK = '<work>/app';
export const exec = (id, args) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${S(id)}${args === undefined ? '' : `,${S(args)}`});return true})()`;
export async function start(project) {
  process.chdir(REPO);
  const session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(WORK, 'iso-caption-export-fonts'),
    prepare: async iso => {
      // 専用の AKARI_HOME（iso/akari-home）のライブラリへ検証用の書体（Probe Hand）を置く
      const dest = path.join(iso, 'akari-home', 'assets', 'font', 'probe-hand');
      await mkdir(path.dirname(dest), { recursive: true });
      await cp('<work>/fx/akari-home-caption-export-fonts/assets/font/probe-hand', dest, { recursive: true });
    } });
  session.window = await setWindow(session.cdp, 1440, 900);
  return session;
}
export async function openProject(session, project, seek = 1) {
  const cdp = session.cdp;
  const chips = `document.querySelectorAll('.akari-annotations-strip-caption').length>0`;
  const has = await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 30_000 }).catch(() => false);
  if (!has) { await evalOn(cdp, exec('akari.annotations.open')); await waitEval(cdp, chips, { label: 'timeline chips', timeoutMs: 120_000 }); }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await evalOn(cdp, exec('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek }));
    await sleep(3000);
    if ((await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break;
  }
  await sleep(2000);
}
/** プレビューの webview（OOPIF）の CDP セッションを返す */
export async function previewFrame() {
  const t = (await listTargets(PORT)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
  const cdp = new CDP(t.at(-1).webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
  return cdp;
}
export async function resetProject(src, dest) {
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
}
