import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
test('serve handshake, authenticated manifest, isolated home and stdin shutdown', {timeout:12000}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'vibe-public-serve-'));
    let child, exited;
    try {
        const home = path.join(directory,'account'), akari = path.join(directory,'akari');
        fs.mkdirSync(home); fs.mkdirSync(akari);
        const env = {...process.env,HOME:home,AKARI_HOME:akari};
        for (const name of Object.keys(env)) {
            if (/^(?:AKARI_|OPENROUTER_|NODE_OPTIONS$|PUBLIC_REPO$)/.test(name) && !['AKARI_HOME'].includes(name)) delete env[name];
        }
        const guard = path.join(directory,'offline.mjs');
        fs.writeFileSync(guard, `
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const deny = () => { throw new Error('outbound transport forbidden'); };
globalThis.fetch = deny;
for (const module of [http,https]) { module.request=deny; module.get=deny; }
net.connect=deny; net.createConnection=deny;
const listen=net.Server.prototype.listen;
let listeners=0;
net.Server.prototype.listen=function(port,host,...rest) {
    if (++listeners !== 1 || port !== 0 || host !== '127.0.0.1') throw new Error('unexpected listener');
    return listen.call(this,port,host,...rest);
};
for (const key of ['readFileSync','readdirSync','writeFileSync','appendFileSync','mkdirSync','existsSync','statSync']) {
    const original=fs[key];
    fs[key]=function(file,...args) {
        if (/(?:^|[/\\\\])(?:fixture|sessions)(?:[/\\\\]|$)/.test(String(file))) throw new Error('private data access');
        return original.call(this,file,...args);
    };
}
syncBuiltinESMExports();
`);
        child = spawn(process.execPath,['--import',guard,path.join(root,'bin/akari-vibe.mjs'),'--serve'],
            {cwd:root,env,stdio:['pipe','pipe','pipe']});
        exited = new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});
        let stdout = '', stderr = '';
        child.stdout.on('data',chunk=>stdout+=chunk); child.stderr.on('data',chunk=>stderr+=chunk);
        const token = crypto.randomBytes(32).toString('hex');
        child.stdin.write(JSON.stringify({token})+'\n');
        const deadline = Date.now()+5000;
        while (!stdout.includes('\n') && child.exitCode === null && Date.now()<deadline) await pause(10);
        assert.equal(child.exitCode,null,stderr); assert.ok(stdout.includes('\n'),'listening line timeout');
        const first = JSON.parse(stdout.split('\n')[0]);
        assert.deepEqual(Object.keys(first).sort(),['port','protocol','type']);
        assert.equal(first.type,'listening'); assert.equal(first.protocol,0);
        assert.ok(Number.isInteger(first.port) && first.port>0 && first.port<=65535);
        const base = `http://127.0.0.1:${first.port}`;
        const get = (url,options={}) => fetch(base+url,{...options,signal:AbortSignal.timeout(2000)});
        const nonce = crypto.randomBytes(16).toString('hex');
        const response = await get(`/companion/manifest?nonce=${nonce}`,{headers:{Authorization:'Bearer '+token}});
        assert.equal(response.status,200);
        const manifest = await response.json();
        assert.equal(manifest.proof,crypto.createHmac('sha256',token).update(nonce).digest('hex'));
        const key = new URL(manifest.panelPath,base).searchParams.get('k'); assert.ok(key);
        assert.equal(fs.existsSync(path.join(akari,'companion.json')),false);
        assert.equal(fs.existsSync(path.join(home,'.akari','companion.json')),false);
        for (const route of ['/panel','/events','/listen','/undo-entry','/undo','/status','/open-settings','/open-privacy']) {
            const method = ['/panel','/events','/status'].includes(route) ? 'GET' : 'POST';
            assert.equal((await get(route,{method})).status,403,route);
            assert.equal((await get(route+'?k=wrong',{method})).status,403,route);
        }
        assert.equal((await get(`/listen?k=${key}`,{method:'POST',body:'{"on":false}'})).status,200);
        assert.equal((await get(`/status?k=${key}`)).status,200);
        assert.equal((await get('/')).status,404);
        const start = Date.now(); child.stdin.end();
        const stopped = await Promise.race([exited,pause(1000).then(()=>{throw new Error('stdin shutdown timeout');})]);
        assert.equal(stopped.code,0); assert.ok(Date.now()-start<1000);
        assert.equal(stdout.trim().split('\n').length,1);
        assert.ok(!stdout.includes(token)); assert.ok(!stderr.includes(token));
    } finally {
        if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
        fs.rmSync(directory,{recursive:true,force:true});
    }
});
