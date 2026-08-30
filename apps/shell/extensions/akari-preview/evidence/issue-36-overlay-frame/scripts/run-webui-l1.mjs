#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';
const run = promisify(execFile);
const [, , url, outDir, label, portArg] = process.argv;
const port = Number(portArg || 9750);
await mkdir(outDir, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=/tmp/i36-chrome-${port}`,
  '--no-first-run','--no-default-browser-check','--hide-scrollbars','--force-device-scale-factor=1',
  '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required','--window-size=1200,900', url], { stdio: 'ignore' });
try {
  const t = await waitFor('target', async () => { try { return (await listTargets(port)).find(x => x.type === 'page' && !x.url.startsWith('chrome://')) || null; } catch { return null; } }, 40000);
  const cdp = new CDP(t.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.bringToFront');
  await waitFor('ready', () => evalOn(cdp, `document.readyState==='complete'`), 60000);
  await waitFor('overlay mounted', () => evalOn(cdp, `Boolean(document.querySelector('#overlay-stage [data-overlay-id]'))`), 90000);
  await evalOn(cdp, `(() => { const v=document.getElementById('preview-video'); const t=document.getElementById('play-toggle'); if (v && !v.paused) t?.click(); return true; })()`);
  await sleep(400);
  await evalOn(cdp, `(() => { const s=document.getElementById('seek'); s.value='2'; s.dispatchEvent(new Event('input',{bubbles:true})); return s.value; })()`);
  await sleep(2500);
  const geo = await evalOn(cdp, `(() => { const q=s=>document.querySelector(s);
    const pick=e=>{ if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    const c=q('#overlay-stage [data-overlay-id]'); const root=c&&c.firstElementChild;
    const cs=e=>e?{clipPath:getComputedStyle(e).clipPath, transform:getComputedStyle(e).transform, visibility:getComputedStyle(e).visibility, bg:getComputedStyle(e).backgroundImage.slice(0,60), w:getComputedStyle(e).width, h:getComputedStyle(e).height}:null;
    return { pane: pick(q('.preview-pane')), stage: pick(q('#preview-stage')), overlayStage: pick(q('#overlay-stage')),
      container: pick(c), root: pick(root), containerStyle: cs(c), rootStyle: cs(root),
      containerInline: c?c.getAttribute('style'):null, seek: q('#seek')?.value, time: q('#time-label')?.textContent }; })()`);
  let pending = [];
  cdp.on('Page.screencastFrame', p => { pending.push(p); cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(()=>{}); });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await waitFor('frame', async () => pending.length > 0, 15000, 100);
  await sleep(700); await cdp.send('Page.stopScreencast');
  const png = path.join(outDir, `${label}-web.png`);
  await writeFile(png, Buffer.from(pending[pending.length-1].data, 'base64'));
  const rgb = png.replace(/\.png$/, '.rgb');
  await run('ffmpeg', ['-y','-loglevel','error','-i',png,'-f','rawvideo','-pix_fmt','rgb24',rgb]);
  const [W,H] = (await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',png])).stdout.trim().split(',').map(Number);
  const sf = W / 1200; const raw = await readFile(rgb);
  const px=(x,y)=>{const xi=Math.round(x*sf),yi=Math.round(y*sf);if(xi<0||yi<0||xi>=W||yi>=H)return null;const o=(yi*W+xi)*3;return [raw[o],raw[o+1],raw[o+2]];};
  const r = geo.root || geo.stage;
  const anchors = [['top-mid',(r.left+r.right)/2,r.top,0,-1],['bottom-mid',(r.left+r.right)/2,r.bottom,0,1],
    ['left-mid',r.left,(r.top+r.bottom)/2,-1,0],['right-mid',r.right,(r.top+r.bottom)/2,1,0],
    ['tl',r.left,r.top,-1,-1],['tr',r.right,r.top,1,-1],['bl',r.left,r.bottom,-1,1],['br',r.right,r.bottom,1,1]];
  const points = [];
  for (const [n,ax,ay,dx,dy] of anchors) for (const [on,d] of [['in2',-2],['out2',2],['out6',6]])
    points.push({ id:`${n}:${on}`, rgb: px(ax+dx*d, ay+dy*d) });
  const st = geo.stage; const sc = st.width/1920; const at=(ox,oy)=>px(st.left+ox*sc, st.top+oy*sc);
  const payload = { label, url, geo, screenshot:[W,H], points,
    stageSamples: { corner: at(8,8), tr: at(1910,8), bl: at(8,1070), br: at(1910,1070), center: at(960,900), inText: at(1350,455) } };
  await writeFile(path.join(outDir, `${label}-web.json`), JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify({ geo: { stage: geo.stage, container: geo.container, root: geo.root, containerStyle: geo.containerStyle, seek: geo.seek, time: geo.time }, stageSamples: payload.stageSamples }, null, 1));
  cdp.close();
} finally { try { proc.kill('SIGTERM'); } catch {} }
