import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createJudgeClient,credentialStatus} from '../live/companion/judge-client.mjs';

function fixture(extra = {}) {
    const home = path.resolve('fake-account');
    const env = {AKARI_HOME:path.join(home,'akari'),AKARI_CREDENTIALS_FILE:path.join(home,'custom.env'),...extra.env};
    const files = new Map([
        [path.join(env.AKARI_HOME,'store-credentials.json'),JSON.stringify({token:'lab-stored-value'})],
        [env.AKARI_CREDENTIALS_FILE,'OPENROUTER_API_KEY=provider-custom-value'],
        [path.join(home,'.config/akari-video/credentials.env'),'OPENROUTER_API_KEY=provider-current-value'],
        [path.join(home,'.config/akari/openrouter.env'),'OPENROUTER_API_KEY=provider-legacy-value'],
    ]);
    const calls = [];
    const readFile = file => { if (!files.has(file)) throw new Error('missing'); return files.get(file); };
    const client = createJudgeClient({env,home,readFile,serve:true,
        fetch:async (url,options) => { calls.push({url,options}); return new Response('{"ok":true}'); },...extra,env});
    return {home,env,files,calls,readFile,client};
}
test('credential precedence and file reload happen on each request',async () => {
    const f = fixture();
    f.env.OPENROUTER_API_KEY = 'provider-environment-value';
    f.env.AKARI_VOICE_JUDGE_TOKEN = 'lab-environment-value';
    await f.client.judge({});
    assert.equal(f.calls.at(-1).options.headers['x-akari-provider-key'],f.env.OPENROUTER_API_KEY);
    assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+f.env.AKARI_VOICE_JUDGE_TOKEN);
    delete f.env.OPENROUTER_API_KEY; delete f.env.AKARI_VOICE_JUDGE_TOKEN;
    for (const [file,expected] of [[f.env.AKARI_CREDENTIALS_FILE,'provider-custom-value'],
        [path.join(f.home,'.config/akari-video/credentials.env'),'provider-current-value'],
        [path.join(f.home,'.config/akari/openrouter.env'),'provider-legacy-value']]) {
        await f.client.judge({});
        assert.equal(f.calls.at(-1).options.headers['x-akari-provider-key'],expected);
        assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer lab-stored-value');
        f.files.delete(file);
    }
    assert.deepEqual(credentialStatus(f),{lab:'connected',providerKey:'missing'});
    const count = f.calls.length;
    await assert.rejects(f.client.judge({})); assert.equal(f.calls.length,count);
    f.files.set(f.env.AKARI_CREDENTIALS_FILE,'OPENROUTER_API_KEY=provider-replaced-value');
    f.files.set(path.join(f.env.AKARI_HOME,'store-credentials.json'),JSON.stringify({token:'lab-replaced-value'}));
    await f.client.judge({});
    assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer lab-replaced-value');
    assert.equal(f.calls.at(-1).options.headers['x-akari-provider-key'],'provider-replaced-value');
    const stored = f.files.get(path.join(f.env.AKARI_HOME,'store-credentials.json'));
    f.files.delete(path.join(f.env.AKARI_HOME,'store-credentials.json'));
    delete f.env.AKARI_HOME;
    f.files.set(path.join(f.home,'.akari/store-credentials.json'),stored);
    await f.client.judge({});
    assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer lab-replaced-value');
    for (const call of f.calls) {
        assert.equal(call.url,'https://akari.video/api/vibe/judge');
        assert.equal(call.options.redirect,'error');
    }
});
test('untrusted hosts are refused and local targets receive no stored credentials',async () => {
    let fetched = 0;
    const fetch = async () => { fetched++; return new Response('{}'); };
    for (const host of ['https://example.invalid/vibe','https://akari.video.example.invalid/vibe','http://akari.video/vibe']) {
        assert.throws(()=>createJudgeClient({env:{AKARI_VOICE_JUDGE_URL:host},fetch,serve:true}));
    }
    assert.equal(fetched,0);
    const f = fixture({env:{AKARI_VOICE_JUDGE_URL:'http://127.0.0.1:1'}});
    await f.client.judge({});
    assert.equal(f.calls[0].options.headers.Authorization,undefined);
    assert.equal(f.calls[0].options.headers['x-akari-provider-key'],undefined);
});
test('response keys and nested values redact both credentials',async () => {
    const secrets = ['lab-stored-value','provider-custom-value'];
    const f = fixture({fetch:async()=>new Response(JSON.stringify({[secrets[0]]:[secrets[1],{value:secrets.join(' ')}]}))});
    const result = JSON.stringify(await f.client.judge({}));
    for (const secret of secrets) assert.ok(!result.includes(secret));
    assert.match(result,/REDACTED/);
});
test('transport, status and JSON errors never expose credentials',async () => {
    const secret = 'lab-stored-value provider-custom-value';
    for (const fetch of [async()=>{throw new Error(secret);},
        ...[401,402,429,500].map(status=>async()=>new Response(JSON.stringify({error:secret}),{status})),
        async()=>({ok:true,status:200,json:async()=>{throw new Error(secret);}})]) {
        const messages = [], f = fixture({fetch,onUserMessage:value=>messages.push(value)});
        await assert.rejects(f.client.judge({}),error=> {
            for (const value of ['lab-stored-value','provider-custom-value']) {
                assert.ok(!error.message.includes(value)); assert.ok(!messages.join().includes(value));
            }
            return true;
        });
    }
});
