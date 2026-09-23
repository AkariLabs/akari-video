// Execute a Theia command via the DI CommandService: node cmd.mjs <commandId> [jsonArg]
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
const [id, arg] = process.argv.slice(2);
const CMD = `(() => { const d=window.theia.container._bindingDictionary; const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'); return window.theia.container.get(C); })()`;
console.log(JSON.stringify(await evalMain(cdp, `${CMD}.executeCommand(${JSON.stringify(id)}${arg ? ', ' + arg : ''})`, 60000)));
process.exit(0);
