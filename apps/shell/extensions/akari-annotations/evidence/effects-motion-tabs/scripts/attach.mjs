// 調査用: 起動済みの Electron（CDP_PORT）に繋ぎ、引数の .mjs 断片（default export async ({cdp, v, h}) => any）を実行して JSON を出す。
import { CDP, listTargets } from './cdp-lib.mjs';
import * as h from './common.mjs';
import * as l1 from './l1-lib.mjs';
import { view } from './view.mjs';
import path from 'node:path';
const port = Number(process.env.CDP_PORT || 9636);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
await cdp.send('Runtime.enable');
let v = null;
const getView = async () => (v ??= await view(port));
const mod = await import(path.resolve(process.argv[2]));
try { console.log(JSON.stringify(await mod.default({ cdp, getView, h, l1, args: process.argv.slice(3) }), null, 1)); }
finally { v?.close(); cdp.close(); }
process.exit(0);
