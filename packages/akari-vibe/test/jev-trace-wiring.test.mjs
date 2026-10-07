import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CompanionLink, createInstructionSenders } from '../live/companion/link.mjs';

const live = fs.readFileSync(new URL('../live/live.mjs',import.meta.url),'utf8');
const link = fs.readFileSync(new URL('../live/companion/link.mjs',import.meta.url),'utf8');

test('trace is wired without another judge call', () => {
    for (const stage of ['t0Onset','t1VoiceEnd','t2FirstPartial','t3SttFinal','t4EarlyDecision',
        't5GrammarDone','t6JudgeSent','t7JudgeRecv','t8PlanDone']) assert.ok(live.includes(stage),stage);
    assert.match(link,/onSent/); assert.match(link,/onResult/);
    for (const [token, count] of Object.entries({ 'judgeClient.judge(': 1, '.judge(': 1 })) {
        assert.equal(live.split(token).length - 1,count,token);
    }
});

test('command trace flag and hooks are opt in', async () => {
    const sent=[]; const results=[]; const writes=[];
    const linkInstance=new CompanionLink({randomId:(()=>{let id=0;return()=>String(++id);})(),
        onSent:(...args)=>sent.push(args),onResult:(...args)=>results.push(args)});
    linkInstance.addClient({write:value=>writes.push(value),end(){}});
    const plain=createInstructionSenders(linkInstance,()=>null);
    const p=plain.sendCommand('plain');
    assert.equal(JSON.parse(writes[0].split('data: ')[1]).trace,undefined);
    linkInstance.receiveResult({id:'1',ok:true}); await p;
    assert.equal(sent.length,0); assert.equal(results.length,0);
    const traced=createInstructionSenders(linkInstance,()=>null,'op');
    const q=traced.sendCommand('traced');
    assert.equal(JSON.parse(writes[1].split('data: ')[1]).trace,true);
    linkInstance.receiveResult({id:'2',ok:true}); await q;
    assert.equal(sent.length,1); assert.equal(results.length,1);
    assert.equal(sent[0][2],'op');
    linkInstance.close();
});
