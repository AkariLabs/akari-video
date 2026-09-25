// 出力プレビューの内側の文書（#preview-stage のある文書）で式を評価: node wv.mjs '<expr>'
import { view } from './l1-common.mjs';
const v = await view(Number(process.env.CDP_PORT || 9562));
console.log(JSON.stringify(await v.eval(process.argv[2]), null, 1));
process.exit(0);
