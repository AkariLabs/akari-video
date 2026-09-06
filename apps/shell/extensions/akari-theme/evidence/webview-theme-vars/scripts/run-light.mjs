#!/usr/bin/env node
// 回帰 (γ): ライトテーマでも Codex パネルが正常表示（白地 + 濃い文字）で、
// 強制消失時は薄い面（LIGHT パレットの bg = #ffffff / 隣接パネルと同じ）に落ちること。
//   node run-light.mjs --port 9762 --out <dir> --phase before|after
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, findCodexWebview, iframeRect, decodePng, samplePanel, shot, runCommand,
  setTheme, themeServiceExpr, sleep, measure, innerExpr, sanitize
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const phase = args.get('--phase') ?? 'after';
if (!out) throw new Error('usage: run-light.mjs --port <p> --out <dir> --phase <p>');
await mkdir(out, { recursive: true });

const main = await connectMain(port);
const currentTheme = () => evalIn(main, `(() => { const C = ${themeServiceExpr}; return C ? window.theia.container.get(C).getCurrentTheme().id : null; })()`);
async function setThemeStable(id) {
  await setTheme(main, id);
  let stable = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await currentTheme() === id) { stable++; if (stable >= 5) return { id, settledAfterSec: i + 1 }; } else stable = 0;
  }
  return { id: await currentTheme(), settledAfterSec: null, warning: 'did not settle' };
}

const settle = await setThemeStable('light');
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus');
await sleep(3000);
const { target, view } = await findCodexWebview(port);
const rect = await iframeRect(main, target.url);

const capture = async id => {
  const png = path.join(out, `${phase}-light-${id}.png`);
  await shot(main, png);
  const decoded = await decodePng(png);
  const s = samplePanel(decoded, rect);
  // パネル内に「濃い文字」が実在するか（正常表示の裏取り）。
  let darkPixels = 0; let total = 0;
  for (let y = Math.ceil(rect.top) + 4; y < rect.top + rect.height - 4; y += 4) {
    for (let x = Math.ceil(rect.left) + 4; x < rect.left + rect.width - 4; x += 4) {
      const p = s.inside[0] && decoded ? (() => { const o = (Math.round(y) * decoded.width + Math.round(x)) * 3; return [decoded.raw[o], decoded.raw[o + 1], decoded.raw[o + 2]]; })() : null;
      if (!p) continue; total++; if (p[0] < 120) darkPixels++;
    }
  }
  return { png: path.basename(png), samples: s, darkPixelRatio: total ? Number((darkPixels / total).toFixed(4)) : null, sampled: total };
};

const healthy = await capture('healthy');
const healthyMeasure = await measure(view);
const stripped = await evalIn(view, innerExpr(`
  let removed = 0;
  for (const p of [...html.style]) if (p.startsWith('--vscode-')) { removed++; html.style.removeProperty(p); }
  return removed;
`));
await sleep(500);
const strippedShot = await capture('stripped');
const strippedMeasure = await measure(view);

const back = await setThemeStable('dark');

const payload = sanitize({
  phase, themeSettle: settle, restoredTheme: back, rect,
  healthy: { measurement: healthyMeasure, ...healthy },
  stripped: { removed: stripped, measurement: strippedMeasure, ...strippedShot }
}, [[out, '<evidence>']]);
await writeFile(path.join(out, `${phase}-light.json`), JSON.stringify(payload, null, 2) + '\n');
console.log('healthy inside', JSON.stringify(healthy.samples.inside.map(p => p.rgb)), 'panel', JSON.stringify(healthy.samples.panel.map(p => p.rgb)), 'darkRatio', healthy.darkPixelRatio);
console.log('stripped inside', JSON.stringify(strippedShot.samples.inside.map(p => p.rgb)), 'panel', JSON.stringify(strippedShot.samples.panel.map(p => p.rgb)), 'maxDeltaToPanel', strippedShot.samples.maxDeltaToPanel);
view.close(); main.close();
