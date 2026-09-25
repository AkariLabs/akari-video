// プレビューを出力時刻へシーク: node seek.mjs <project> <秒>
import path from 'node:path';
import { connect, evalOn, sleep } from './common.mjs';
import { command } from './l1-lib.mjs';
const [project, t] = process.argv.slice(2);
const cdp = await connect();
console.log(await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.resolve(project)}/edit.json`, time: Number(t) })));
await sleep(2000); cdp.close(); process.exit(0);
