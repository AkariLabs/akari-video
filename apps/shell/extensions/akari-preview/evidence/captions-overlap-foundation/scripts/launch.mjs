import { spawn } from 'node:child_process';
import { openSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const label = process.argv[2] || 'after';
const base = '/tmp/cof-l1';
const port = 9437;
await new Promise((ok, fail) => { const server = net.createServer(); server.once('error',fail);server.listen(port,'127.0.0.1',()=>server.close(ok)); });
mkdirSync(base,{recursive:true});
const env = {...process.env, AKARI_HOME:resolve(base,'home-'+label), THEIA_CONFIG_DIR:resolve(base,'config-'+label)};
if (label.includes('legacy')) env.AKARI_FRAME_ENGINE='0'; else delete env.AKARI_FRAME_ENGINE;
const log = openSync(resolve(base,'shell-'+label+'.log'),'w');
const child=spawn(resolve(repo,'apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[
 resolve(repo,'apps/shell'),realpathSync(resolve(base,'project')), '--remote-debugging-port='+port,
 '--user-data-dir='+resolve(base,'user-'+label),'--no-sandbox',
 '--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'
],{env,detached:true,stdio:['ignore',log,log]});
writeFileSync(resolve(base,'pid-'+label),String(child.pid));child.unref();console.log(child.pid);
