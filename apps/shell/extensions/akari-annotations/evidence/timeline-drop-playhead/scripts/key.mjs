// 実キー 1 回: node key.mjs Escape
import { connect } from './common.mjs';
import { keyPress } from './cdp-lib.mjs';
const cdp = await connect(); const key = process.argv[2];
await keyPress(cdp, { key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 }); cdp.close(); process.exit(0);
