// Execute a Theia command via the DI CommandService: node cmd.mjs <commandId> [jsonArg]
import { connectMain, evalMain } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const [id, arg] = process.argv.slice(2);
const expr = `(async () => { const d=window.theia.container._bindingDictionary; const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'); const s=window.theia.container.get(C); const t0=performance.now(); const r = await Promise.race([s.executeCommand(${JSON.stringify(id)}${arg ? ', ' + arg : ''}), new Promise(res=>setTimeout(()=>res('__timeout__'),15000))]); return { result: r === undefined ? null : r, ms: Math.round(performance.now()-t0) }; })()`;
console.log(JSON.stringify(await evalMain(cdp, expr, 30000))); process.exit(0);
