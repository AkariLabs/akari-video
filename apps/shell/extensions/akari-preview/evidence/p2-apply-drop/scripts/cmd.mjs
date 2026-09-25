// コマンドを 1 つ実行して戻り値を出す: node cmd.mjs <command-id> [JSON 引数]
import { connect, evalOn } from './common.mjs';
import { command } from './l1-lib.mjs';
const cdp = await connect();
console.log(JSON.stringify(await evalOn(cdp, command(process.argv[2], process.argv[3] ? JSON.parse(process.argv[3]) : undefined))));
cdp.close(); process.exit(0);
