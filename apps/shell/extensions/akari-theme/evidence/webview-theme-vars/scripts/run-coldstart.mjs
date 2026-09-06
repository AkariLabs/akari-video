#!/usr/bin/env node
// 起動直後の追跡（トリガー狩りの本命）。
// 実測（BEFORE・トリガー狩りの baseline 行）: 起動直後の Codex webview は
// --vscode-* が 627 個しか無く（テーマ往復後は 629 個）、パネルは真っ白だった。
// 起動から一定時間、N・変数名・パネル画素を追いかけて、いつ揃うのかを記録する。
//   node run-coldstart.mjs --port 9762 --out <dir> --phase before|after [--seconds 120]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, findCodexWebview, iframeRect, decodePng, samplePanel, shot, runCommand,
  sleep, measure, innerExpr, sanitize
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const phase = args.get('--phase') ?? 'before';
const seconds = Number(args.get('--seconds') ?? 120);
if (!out) throw new Error('usage: run-coldstart.mjs --port <p> --out <dir> --phase <p> [--seconds N]');
await mkdir(out, { recursive: true });

const t0 = Date.now();
const main = await connectMain(port);
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus');
const { target, view } = await findCodexWebview(port);
const VAR_NAMES = innerExpr('return [...html.style].filter(p => p.startsWith("--vscode-"));');

const series = [];
let firstNames = null;
let whiteUntilSec = null;
let darkFromSec = null;
const deadline = t0 + seconds * 1000;
let i = 0;
while (Date.now() < deadline) {
  const elapsedSec = Math.round((Date.now() - t0) / 100) / 10;
  const m = await measure(view).catch(() => null);
  const names = await evalIn(view, VAR_NAMES).catch(() => null);
  firstNames ??= names;
  let inside = null; let panel = null; let delta = null;
  try {
    const rect = await iframeRect(main, target.url);
    if (rect && rect.width > 100) {
      const png = path.join(out, `${phase}-coldstart-${String(i).padStart(2, '0')}.png`);
      await shot(main, png);
      const s = samplePanel(await decodePng(png), rect);
      inside = s.inside.map(p => p.rgb); panel = s.panel.map(p => p.rgb); delta = s.maxDeltaToPanel;
    }
  } catch { /* noop */ }
  const isWhite = Boolean(inside && inside.every(p => p && p[0] > 200));
  if (isWhite) whiteUntilSec = elapsedSec; else if (inside && darkFromSec === null) darkFromSec = elapsedSec;
  series.push({
    elapsedSec, n: m?.n ?? null, bodyBackgroundColor: m?.bodyBackgroundColor ?? null,
    themeKindBody: m?.themeKindBody ?? null, inside, panel, maxDeltaToPanel: delta,
    missingVsFirst: names && firstNames ? firstNames.filter(x => !names.includes(x)) : null,
    addedVsFirst: names && firstNames ? names.filter(x => !firstNames.includes(x)) : null
  });
  console.log(elapsedSec + 's', 'n=' + (m?.n ?? 'null'), 'inside=' + JSON.stringify(inside), 'delta=' + delta);
  i++;
  await sleep(5000);
}

const payload = sanitize({ phase, seconds, firstVarNames: firstNames, whiteUntilSec, darkFromSec, series }, [[out, '<evidence>']]);
await writeFile(path.join(out, `${phase}-coldstart.json`), JSON.stringify(payload, null, 2) + '\n');
console.log('written', `${phase}-coldstart.json`, 'whiteUntilSec=', whiteUntilSec, 'darkFromSec=', darkFromSec);
view.close(); main.close();
