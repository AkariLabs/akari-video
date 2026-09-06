#!/usr/bin/env node
// 回帰 (α): 出力プレビュー webview（akari-preview）の見た目が層 B 修正で変わらないことを撮る。
// 同じ fixture・同じウィンドウサイズ・同じシーク位置で BEFORE / AFTER を撮り、プレビュー領域の画素差を出す。
//   node run-preview.mjs --port 9762 --out <dir> --phase before|after --edit <edit.json の絶対パス>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, runCommand, shot, decodePng, pixelAt, sleep, waitFor, webviewTargets,
  attachWebview, measure, sanitize, shellExpr
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
// レイアウトを既定へ戻してから測る。ワークスペース状態が前の run を引きずると
// プレビューの矩形が BEFORE / AFTER で変わって画素の突き合わせが成立しない
// （実測: 1021x543 と 1486x935）。reset.layout は @theia/core の shell-layout-restorer。
console.log('resetLayout', JSON.stringify(await runCommand(main, 'reset.layout')));
await sleep(3000);
// 左右パネルを畳んでからプレビューを開く。右パネル幅は起動ごとに数 px 変わるので
// （実測: 444 / 451 / 458）、畳まないとプレビューの矩形が BEFORE / AFTER で一致せず
// 画素の突き合わせが成立しない。
const collapsed = await evalIn(main, `(() => {
  const S = ${shellExpr};
  if (!S) return 'no-shell';
  const shell = window.theia.container.get(S);
  const done = [];
  for (const area of ['right', 'left', 'bottom']) {
    try { shell.collapsePanel(area); done.push(area); } catch (e) { /* 既に畳まれている */ }
  }
  return done.join(',');
})()`);
console.log('collapsePanel', collapsed);
await sleep(1500);
// akari-preview の activate 前は「no active handlers」で落ちるので、通るまで待つ。
let opened = null;
for (let i = 0; i < 30; i++) {
  opened = await runCommand(main, 'akari.preview.ensureVisible', { editUri: 'file://' + editPath });
  if (opened && opened.ok) break;
  await sleep(2000);
}
console.log('ensureVisible', JSON.stringify(opened));
await sleep(4000);
// メイン領域をプレビュー 1 枚だけにする。タブが 1 枚でもあると矩形が
// 起動ごとに変わり（実測 588x935 / 574x557 / 1021x543）、画素の突き合わせが成立しない。
const soloed = await evalIn(main, `(() => {
  const S = ${shellExpr};
  if (!S) return 'no-shell';
  const shell = window.theia.container.get(S);
  const closed = [];
  for (const w of shell.getWidgets('main')) {
    if (!/akari-output-preview/u.test(String(w.id))) { closed.push(String(w.id).slice(0, 60)); w.close(); }
  }
  for (const area of ['right', 'left', 'bottom']) { try { shell.collapsePanel(area); } catch (e) { /* noop */ } }
  return closed;
})()`);
console.log('solo', JSON.stringify(soloed));
await sleep(3000);
// プレビュー webview の矩形を実測用に固定する。
// レイアウトを揃えても左右のバー幅が run ごとに 7px 変わり（実測 left 57/width 1486 と
// left 50/width 1500）、矩形が違うと画素の対応が取れない。iframe を fixed で
// 0,0 / 1200x800 に釘付けにしてから撮る（計測のための DOM 操作。製品コードは変えない）。
const FIXED = { left: 0, top: 0, width: 1200, height: 800 };
const pinned = await evalIn(main, `(() => {
  const el = [...document.querySelectorAll('iframe.webview')]
    .find(e => (e.getAttribute('src') || '').includes('id=akari-output-preview'));
  if (!el) return 'no-preview-iframe';
  for (const [k, v] of Object.entries({ position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
    width: ${FIXED.width} + 'px', height: ${FIXED.height} + 'px', 'z-index': '99999', margin: '0', transform: 'none' })) {
    el.style.setProperty(k, v, 'important');
  }
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
})()`);
console.log('pinned', JSON.stringify(pinned));
await sleep(2500);

const seek = await runCommand(main, 'akari.preview.seekOutput', { editUri: 'file://' + editPath, time: 1 });
console.log('seek', JSON.stringify(seek));
await sleep(4000);

// プレビューの webview を特定する。
// 中身や title では見分けない（Codex が起動途中だと title も codexMarker も落ちる／
// プレビューは中身が空状態カードのこともある）。メイン frame 側の widget id
// （akari-preview が付ける plugin-webview:akari-output-preview-*）で引くのが唯一確実。
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
  const isPreview = /^akari-output-preview-/u.test(String(id));
  previews.push({ webviewId: isPreview ? id : '<id>', isCodex: Boolean(m?.codexMarker), isPreview, title: m?.title ?? null, rect, colorScheme: m?.htmlColorScheme ?? null });
  view.close();
}
const preview = previews.find(p => p.isPreview && p.rect && p.rect.width > 100);
console.log('webviews', JSON.stringify(previews));
if (!preview) throw new Error('preview webview not found: ' + JSON.stringify(previews));

const png = path.join(out, `${phase}-preview.png`);
await shot(main, png);
const decoded = await decodePng(png);
const { left, top, width, height } = FIXED;
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
  phase, rect: FIXED, measuredRect: preview.rect, pinned, gridStep: 8, gridCount: grid.length, grid,
  shell: { documentElementColorScheme: mainScheme, iframeWebviewColorSchemes: iframeSchemes },
  webviews: previews, png: path.basename(png)
}, [[out, '<evidence>']]);
await writeFile(path.join(out, `${phase}-preview.json`), JSON.stringify(payload) + '\n');
console.log('written', `${phase}-preview.json`, 'samples', grid.length, 'colorScheme', mainScheme, JSON.stringify(iframeSchemes));
main.close();
