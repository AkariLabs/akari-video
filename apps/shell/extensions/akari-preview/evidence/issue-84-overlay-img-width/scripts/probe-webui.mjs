#!/usr/bin/env node
// issue #84 Web UI L1 探針: preview-server + Chrome で同じ計測をする。usage: probe-webui.mjs <url> <outDir> <label> [cdpPort]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';
import { decodePng } from './png-lib.mjs';
import { MEASURE_EXPR, SAMPLE_POINTS } from './measure.mjs';
const [, , url, outDir, label, portArg] = process.argv;
const port = Number(portArg || 9487);
await mkdir(outDir, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const udd = `/tmp/issue84-overlay-img-width-chrome-${port}`;
const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--window-size=1200,1200', url], { stdio: 'ignore' });
try {
  const t = await waitFor('target', async () => { try { return (await listTargets(port)).find(x => x.type === 'page' && !x.url.startsWith('chrome://')) || null; } catch { return null; } }, 60000);
  const cdp = new CDP(t.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.bringToFront');
  await waitFor('ready', () => evalOn(cdp, `document.readyState==='complete'`), 60000);
  await waitFor('img mounted', () => evalOn(cdp, `Boolean(document.querySelector('#overlay-stage .i84-img') && document.querySelector('#overlay-stage .i84-img').complete)`), 120000);
  await evalOn(cdp, `(() => { const v=document.getElementById('preview-video'); const t=document.getElementById('play-toggle'); if (v && !v.paused) t?.click(); return true; })()`);
  await sleep(400);
  await evalOn(cdp, `(() => { const s=document.getElementById('seek'); s.value='1'; s.dispatchEvent(new Event('input',{bubbles:true})); return s.value; })()`);
  await sleep(2500);
  const measure = await evalOn(cdp, MEASURE_EXPR);
  const frames = [];
  cdp.on('Page.screencastFrame', p => { frames.push(p); cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await waitFor('frame', async () => frames.length > 0, 15000, 100);
  await sleep(700); await cdp.send('Page.stopScreencast');
  const buf = Buffer.from(frames[frames.length - 1].data, 'base64');
  await writeFile(path.join(outDir, `${label}-web.png`), buf);
  const png = decodePng(buf); const sf = png.width / 1200;
  const st = measure.overlayStage; const sc = measure.scale;
  const pixels = Object.fromEntries(Object.entries(SAMPLE_POINTS).map(([k, [x, y]]) => [k, png.pixel((st.left + x * sc) * sf, (st.top + y * sc) * sf)]));
  await writeFile(path.join(outDir, `${label}-web.json`), JSON.stringify({ label, surface: 'webui', measure, pixels }, null, 2) + '\n');
  const m = measure;
  console.log(JSON.stringify({ img: m.img && { logical: m.img.logical, relToFrame: m.img.relToFrame, maxWidth: m.img.computed['max-width'] }, frame: m.frame && m.frame.logical, capImg: m.capImg, kbd: m.kbd, code: m.code, capRoot: m.capRoot, vwBox: m.vwBox, pxBox: m.pxBox, pixels }));
  cdp.close();
} finally { try { proc.kill('SIGTERM'); } catch {} await sleep(1000); await rm(udd, { recursive: true, force: true }).catch(() => {}); }
