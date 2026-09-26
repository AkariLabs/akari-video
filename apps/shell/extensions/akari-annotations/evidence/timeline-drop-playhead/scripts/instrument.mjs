// 記録用フックの差し込み / 読み出し: node instrument.mjs install | state | log [--since=<ms>] | clear
import { connect, evalOn } from './common.mjs';
import { INSTALL, STATE } from './tdp-lib.mjs';
const cdp = await connect();
const cmd = process.argv[2];
const out = cmd === 'install' ? await evalOn(cdp, INSTALL)
  : cmd === 'state' ? await evalOn(cdp, STATE)
  : cmd === 'clear' ? await evalOn(cdp, `(window.__tdp.log.length=0,true)`)
  : await evalOn(cdp, `window.__tdp.log`);
console.log(JSON.stringify(out));
cdp.close(); process.exit(0);
