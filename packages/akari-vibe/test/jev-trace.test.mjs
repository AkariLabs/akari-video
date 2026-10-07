import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevTrace } from '../live/jev-trace.mjs';

test('marks, spans, first values, and first painted command', () => {
    let clock = 1000;
    const rows = [];
    const trace = createJevTrace({ now: () => clock, emit: row => rows.push(row) });
    for (const [stage, at] of Object.entries({ t0Onset:1000,t1VoiceEnd:1100,t2FirstPartial:1150,
        t3SttFinal:1200,t5GrammarDone:1220,t8PlanDone:1240 })) trace.mark('one',stage,{at});
    trace.mark('one','t0Onset',{at:9999});
    trace.attach('one',{path:'local-grammar',early:false,op:'seek',final:true,decision:true});
    trace.commandSent('one',{id:'a',kind:'command',command:{commandId:'first'}},1250);
    trace.commandResult('one',{id:'a',ok:false},1260);
    trace.commandSent('one',{id:'b',kind:'command',command:{commandId:'painted'}},1300);
    trace.commandResult('one',{id:'b',ok:true,timing:{recvAt:1302,doneAt:1312,paintedAt:1328}},1315);
    trace.commandSent('one',{id:'c',kind:'command',command:{commandId:'later'}},1400);
    trace.commandResult('one',{id:'c',ok:true,timing:{recvAt:1400,doneAt:1410,paintedAt:1420}},1412);
    trace.flush('one');
    assert.equal(rows.length,1);
    const row = rows[0];
    assert.equal(row.marks.t0Onset,1000);
    assert.equal(row.marks.t4EarlyDecision,null);
    assert.equal(row.marks.t9CommandSent,1300);
    assert.equal(row.marks.t10ResultRecv,1315);
    assert.equal(row.clock.skewMs,-0.5);
    assert.equal(row.clock.rttMs,5);
    assert.equal(row.marks.t11Painted,1328.5);
    assert.deepEqual(row.spans,{sttWaitMs:100,grammarMs:20,judgeMs:null,shellMs:28.5,endToEndMs:228.5});
    assert.equal(row.commands.length,2);
});

test('deadline and reset emit once; absent emitter is inert', () => {
    const rows = []; let timer;
    const trace = createJevTrace({now:()=>500,emit:row=>rows.push(row),
        setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{}});
    trace.attach('one',{decision:true}); timer(); trace.flush('one');
    trace.mark('two','t0Onset'); trace.reset();
    assert.equal(rows.length,2);
    assert.equal(rows[0].marks.t0Onset,null);
    assert.equal(rows[1].marks.t0Onset,500);
    const disabled=createJevTrace();
    disabled.mark('x','t0Onset'); disabled.attach('x',{decision:true}); disabled.flush('x'); disabled.reset();
});

test('all stage names accept injected epoch timestamps', () => {
    const rows=[];
    const trace=createJevTrace({emit:row=>rows.push(row)});
    const stages=['t0Onset','t1VoiceEnd','t2FirstPartial','t3SttFinal','t4EarlyDecision',
        't5GrammarDone','t6JudgeSent','t7JudgeRecv','t8PlanDone','t9CommandSent',
        't10ResultRecv','t11Painted'];
    stages.forEach((stage,index)=>trace.mark('all',stage,{at:1000+index*10}));
    trace.flush('all');
    assert.equal(rows.length,1);
    assert.deepEqual(Object.keys(rows[0].marks),stages);
    assert.equal(rows[0].spans.endToEndMs,100);
});
