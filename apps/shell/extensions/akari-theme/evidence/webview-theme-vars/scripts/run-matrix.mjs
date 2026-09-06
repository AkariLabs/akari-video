#!/usr/bin/env node
// 二層（層 A = --vscode-* 変数消失 / 層 B = color-scheme 不一致で不透明キャンバス）の行列を実機で撮る。
//   node run-matrix.mjs --port 9762 --out <dir> --phase before|after
// 行列 = {変数あり / 強制消失} × {root color-scheme dark / なし} → Codex パネルの画素。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, findCodexWebview, iframeRect, decodePng, samplePanel, shot,
  runCommand, sleep, waitFor, measure, innerExpr, sanitize
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const phase = args.get('--phase') ?? 'before';
if (!out) throw new Error('usage: run-matrix.mjs --port <p> --out <dir> --phase before|after');
await mkdir(out, { recursive: true });

const records = [];
const record = (step, data = {}) => { records.push({ t: new Date().toISOString(), step, ...data }); console.log(step, JSON.stringify(data).slice(0, 400)); };

const main = await connectMain(port);
record('main-connected');

// 起動時ダイアログ（「開くだけ」）が出ていれば閉じる。
await evalIn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b){b.click(); return true;} return false; })()`);
await sleep(600);

// akari-partner の openExtension と同じ順で試し、実機に登録されている ID へ落とす
// （実測: 上 2 つは「no active handlers」で、Codex 拡張が実際に登録するのは chatgpt.* 側）。
for (const id of [
  'workbench.view.extension.codexSecondaryViewContainer',
  'workbench.view.extension.codexViewContainer',
  'chatgpt.sidebarSecondaryView.focus',
  'chatgpt.sidebarView.focus',
  'chatgpt.openSidebar'
]) {
  const r = await runCommand(main, id);
  record('open-codex-view', { id, result: r });
  if (r && r.ok) break;
}
await sleep(2500);

const { target, view } = await findCodexWebview(port);
record('codex-webview-found', { url: target.url.replace(/id=[^&]*/u, 'id=<id>') });

const rect = await waitFor('codex iframe rect', async () => { const r = await iframeRect(main, target.url); return r && r.width > 100 ? r : null; }, 60000);
record('codex-iframe-rect', { rect });

const saved = await evalIn(view, innerExpr('return html.style.cssText;'));
record('saved-css-text', { length: saved ? saved.length : 0 });

const setRootScheme = value => evalIn(main, value === null
  ? `(() => { document.documentElement.style.removeProperty('color-scheme'); return getComputedStyle(document.documentElement).colorScheme; })()`
  : `(() => { document.documentElement.style.setProperty('color-scheme', ${JSON.stringify(value)}); return getComputedStyle(document.documentElement).colorScheme; })()`);

const restoreVars = () => evalIn(view, innerExpr(`html.style.cssText = ${JSON.stringify(saved ?? '')}; return [...html.style].filter(p=>p.startsWith('--vscode-')).length;`));
const stripVars = () => evalIn(view, innerExpr(`
  const removed = [];
  for (const p of [...html.style]) if (p.startsWith('--vscode-')) { removed.push(p); html.style.removeProperty(p); }
  return removed.length;
`));

const cells = [];
async function cell(id, { vars, rootScheme }) {
  const scheme = await setRootScheme(rootScheme);
  const applied = vars === 'present' ? await restoreVars() : await stripVars();
  await sleep(500);
  const m = await measure(view);
  const png = path.join(out, `${phase}-${id}.png`);
  await shot(main, png);
  const decoded = await decodePng(png);
  const samples = samplePanel(decoded, rect);
  const entry = {
    id, vars, rootColorScheme: rootScheme ?? '(removed)', usedRootColorScheme: scheme,
    varsApplied: applied, measurement: m, png: path.basename(png), samples
  };
  cells.push(entry);
  record('cell', { id, n: m?.n, bodyBackgroundColor: m?.bodyBackgroundColor, inside: samples.inside.map(p => p.rgb), panel: samples.panel.map(p => p.rgb), maxDeltaToPanel: samples.maxDeltaToPanel });
  return entry;
}

await cell('vars-present_root-dark', { vars: 'present', rootScheme: 'dark' });
await cell('vars-stripped_root-dark', { vars: 'stripped', rootScheme: 'dark' });
await cell('vars-present_root-none', { vars: 'present', rootScheme: null });
await cell('vars-stripped_root-none', { vars: 'stripped', rootScheme: null });

// 後片付け: root は dark に戻し、変数も戻す。
await setRootScheme('dark');
await restoreVars();
await sleep(300);
const restored = await measure(view);
record('restored', { n: restored?.n, bodyBackgroundColor: restored?.bodyBackgroundColor });

const mainScheme = await evalIn(main, `getComputedStyle(document.documentElement).colorScheme`);
const iframeScheme = await evalIn(main, `(() => { const el=document.querySelector('iframe.webview'); return el ? getComputedStyle(el).colorScheme : null; })()`);
record('shell-color-scheme', { documentElement: mainScheme, iframeWebview: iframeScheme });

const payload = sanitize({ phase, port, rect, cells, records, shell: { documentElementColorScheme: mainScheme, iframeWebviewColorScheme: iframeScheme } }, [[out, '<evidence>']]);
await writeFile(path.join(out, `${phase}-matrix.json`), JSON.stringify(payload, null, 2) + '\n');
console.log('written', path.join(out, `${phase}-matrix.json`));
view.close(); main.close();
