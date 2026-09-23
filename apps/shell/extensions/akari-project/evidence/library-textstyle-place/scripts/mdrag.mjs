// 素のマウスドラッグ（スプリッター用）: node mdrag.mjs x1 y1 x2 y2
import { connect } from './common.mjs';
import { realDrag } from './cdp-lib.mjs';
const [x1, y1, x2, y2] = process.argv.slice(2).map(Number);
const cdp = await connect(); await realDrag(cdp, [{ x: x1, y: y1 }, { x: x2, y: y2 }], { steps: 10 }); cdp.close(); process.exit(0);
