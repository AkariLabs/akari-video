// 出力プレビューを指定秒へシークし、出力の枠だけを撮る + 面と overlay の z を記録: node shot.mjs <project> <outPng> [sec=2]
import { writeFile } from 'node:fs/promises';
import { hostCdp, viewCdp, seek, shotStage, sleep, Z } from './pss.mjs';
const [project, out, sec = '2'] = process.argv.slice(2);
const host = await hostCdp();
const view = await viewCdp();
await seek(host, project, Number(sec));
await sleep(2500);
await seek(host, project, Number(sec));
await sleep(2500);
await host.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 895, button: 'none' });
await sleep(1200);
await shotStage(host, view, out);
const z = await view.eval(Z);
await writeFile(out.replace(/\.png$/, '-z.json'), `${JSON.stringify(z, null, 1)}\n`);
console.log(JSON.stringify({ out, planes: z.planes.map(p => [p.plane, p.z, p.display]), overlays: z.overlays.map(o => [o.id, o.z, o.vis]) }));
host.close(); view.cdp.close(); process.exit(0);
