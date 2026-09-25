// 出力プレビューの「出力の枠」だけを出力 px の倍率で撮る（CDP の clip + scale）。使い方: node stageshot.mjs <project> <out.png>
import { S, connect, readEditText } from './common.mjs';
import { writeFile } from 'node:fs/promises';
import { stageGeometry } from './stage.mjs';
const [project, out] = process.argv.slice(2);
const cdp = await connect(); await cdp.send('Page.enable');
const output = JSON.parse(await readEditText(project)).output;
const geo = await stageGeometry(cdp, output);
const dpr = await (await import('./cdp-lib.mjs')).evalOn(cdp, 'window.devicePixelRatio');
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...{ x: geo.host.x, y: geo.host.y, width: geo.host.w, height: geo.host.h }, scale: output.width / geo.host.w / dpr } });
await writeFile(out, Buffer.from(data, 'base64'));
console.log(JSON.stringify({ out, stageHost: geo.host, output, dpr }));
cdp.close(); process.exit(0);
