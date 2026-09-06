#!/usr/bin/env node
// 回帰 (α): 出力プレビュー webview（akari-preview）の見た目が層 B 修正で変わらないことを撮る。
// 同じ fixture・同じウィンドウサイズ・同じシーク位置で BEFORE / AFTER を撮り、プレビュー領域の画素差を出す。
//   node run-preview.mjs --port 9762 --out <dir> --phase before|after --edit <edit.json の絶対パス>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, runCommand, shot, decodePng, pixelAt, sleep, waitFor, webviewTargets,
  attachWebview, measure, sanitize
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const phase = args.get('--phase') ?? 'before';
const editPath = args.get('--edit');
if (!out || !editPath) throw new Error('usage: run-preview.mjs --port <p> --out <dir> --phase <p> --edit <path>');
await mkdir(out, { recursive: true });

const main = await connectMain(port);
const opened = await runCommand(main, 'akari.preview.ensureVisible', { editUri: 'file://' + editPath });
console.log('ensureVisible', JSON.stringify(opened));
await sleep(4000);
const seek = await runCommand(main, 'akari.preview.seekOutput', { editUri: 'file://' + editPath, time: 1 });
console.log('seek', JSON.stringify(seek));
await sleep(2500);

// プレビューの webview（Codex ではない方）を特定する。
const previews = [];
for (const t of await webviewTargets(port)) {
  const view = await attachWebview(t);
  const m = await measure(view);
  const id = new URL(t.url).searchParams.get('id');
  const rect = await evalIn(main, `(() => {
    const el = [...document.querySelectorAll('iframe.webview')].find(e => (e.getAttribute('src') || '').includes(${JSON.stringify('id=' + id)}));
    if (!el) return null; const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  previews.push({ isCodex: Boolean(m?.codexMarker), title: m?.title ?? null, rect, colorScheme: m?.htmlColorScheme ?? null });
  view.close();
}
const preview = previews.find(p => !p.isCodex && p.rect && p.rect.width > 100);
console.log('webviews', JSON.stringify(previews));
if (!preview) throw new Error('preview webview not found: ' + JSON.stringify(previews));

const png = path.join(out, `${phase}-preview.png`);
await shot(main, png);
const decoded = await decodePng(png);
const { left, top, width, height } = preview.rect;
// 領域を 8px 格子で走査して RGB を全部残す（AFTER 側で BEFORE と突き合わせる）。
const grid = [];
for (let y = Math.ceil(top) + 2; y < top + height - 2; y += 8) {
  for (let x = Math.ceil(left) + 2; x < left + width - 2; x += 8) {
    grid.push(pixelAt(decoded, x, y));
  }
}
const mainScheme = await evalIn(main, 'getComputedStyle(document.documentElement).colorScheme');
const iframeSchemes = await evalIn(main, `[...document.querySelectorAll('iframe.webview')].map(e => getComputedStyle(e).colorScheme)`);
const payload = sanitize({
  phase, rect: preview.rect, gridStep: 8, gridCount: grid.length, grid,
  shell: { documentElementColorScheme: mainScheme, iframeWebviewColorSchemes: iframeSchemes },
  webviews: previews, png: path.basename(png)
}, [[out, '<evidence>']]);
await writeFile(path.join(out, `${phase}-preview.json`), JSON.stringify(payload) + '\n');
console.log('written', `${phase}-preview.json`, 'samples', grid.length, 'colorScheme', mainScheme, JSON.stringify(iframeSchemes));
main.close();
