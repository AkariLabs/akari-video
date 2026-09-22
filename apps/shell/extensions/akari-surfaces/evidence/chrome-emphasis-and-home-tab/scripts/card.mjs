// できたものの先頭カード群の computed を記録し、カード領域を切り抜いたスクショを保存する。usage: node card.mjs <outPrefix>
import { connectMain, evalMain } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const [prefix] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const cards = await evalMain(cdp, `(() => { const els = [...document.querySelectorAll('[data-akari-output-path]')].slice(0, 3); els[0].scrollIntoView({ block: 'center' });
  return els.map(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { path: e.dataset.akariOutputPath, emphasis: e.dataset.akariOutputEmphasis || null, borderLeftWidth: cs.borderLeftWidth, borderLeftColor: cs.borderLeftColor, borderTopWidth: cs.borderTopWidth, borderRightWidth: cs.borderRightWidth, borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, labelWeight: getComputedStyle(e.querySelector('span:not(.codicon)')).fontWeight, rect: [r.left, r.top, r.width, r.height] }; }); })()`);
const theme = await evalMain(cdp, `document.body.className.match(/theia-(dark|light)/)?.[0]`);
const r0 = cards[0].rect, r2 = cards[cards.length - 1].rect;
const clip = { x: r0[0] - 8, y: r0[1] - 30, width: r0[2] + 16, height: r2[1] + r2[3] - r0[1] + 38, scale: 2 };
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip }, 240000);
await writeFile(`${prefix}.png`, Buffer.from(data, 'base64'));
await writeFile(`${prefix}.json`, JSON.stringify({ theme, cards }, null, 1));
for (const c of cards) console.log(theme, c.path, c.emphasis, 'bl=' + c.borderLeftWidth, c.borderLeftColor, 'bg=' + c.backgroundColor, 'w=' + c.labelWeight);
cdp.close(); process.exit(0);
