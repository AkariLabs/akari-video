import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SwapTrialPlayback, initialSwapPlaybackState, reduceSwapPlayback, swapPlaybackDecision, logSwapTrial } from '../lib/common/swap-trial-playback.js';
const identity = { token: 'candidate-1', startedAt: 0 };
function fixture() {
 let now = 0;
 const trial = new SwapTrialPlayback(identity, now), calls = [];
 const io = { now: () => now, wait: async ms => { now += ms; },
  prepare: async seek => calls.push(['prepare', seek, now]),
  fallbackSeek: async () => calls.push(['fallback', now]),
  play: async () => calls.push(['play', now]), query: async () => ({ playing: false }),
  log: (event, detail) => calls.push([event, detail, now]) };
 return { trial, calls, io, advance: ms => { now += ms; } };
}
test('reload quiet period restarts at each change and stale readiness cannot release it', () => {
 let s = initialSwapPlaybackState(0);
 s = reduceSwapPlayback(s, { type: 'reload-start', now: 100 });
 s = reduceSwapPlayback(s, { type: 'reload-complete', now: 200 });
 assert.equal(swapPlaybackDecision(s, 399), 'wait');
 assert.equal(swapPlaybackDecision(s, 400), 'prepare');
 s = reduceSwapPlayback(s, { type: 'queued', now: 400 });
 s = reduceSwapPlayback(s, { type: 'ready', revision: 1, now: 500 });
 assert.equal(swapPlaybackDecision(s, 700), 'prepare');
 s = reduceSwapPlayback(s, { type: 'ready', revision: 2, now: 700 });
 assert.equal(swapPlaybackDecision(s, 700), 'send');
});
test('three retries at 400ms intervals, no repeated seek, bounded failure', async () => {
 const { trial, calls, io } = fixture();
 assert.equal(await trial.run(io), 'failed');
 assert.deepEqual(calls.filter(c => c[0] === 'play').map(c => c[1]), [200,600,1000,1400]);
 assert.equal(calls.filter(c => c[0] === 'play_retry').length, 3);
 assert.deepEqual(calls.filter(c => c[0] === 'prepare').map(c => c[1]), [true]);
});
test('a lost first request recovers, then stops retrying as soon as playback is observed', async () => {
 const { trial, calls, io } = fixture();
 io.query = async () => ({ playing: trial.state.sends >= 2 });
 assert.equal(await trial.run(io), 'playing');
 assert.equal(calls.filter(c => c[0] === 'play').length, 2);
 assert.equal(calls.filter(c => c[0] === 'prepare').length, 1);
});
test('reload after a request waits for readiness again without seeking again', async () => {
 const { trial, calls, io } = fixture();
 io.play = async () => {
  calls.push(['play', io.now()]);
  if (trial.state.sends === 1) {
   trial.event({type:'reload-start',now:io.now()});
   trial.event({type:'reload-complete',now:io.now() + 100});
  }
 };
 io.query = async () => ({playing: trial.state.sends === 2});
 assert.equal(await trial.run(io), 'playing');
 assert.deepEqual(calls.filter(c => c[0] === 'prepare').map(c => c[1]), [true,false]);
});
test('observed playback latches even if a short clip has already stopped by the first poll', async () => {
 const { trial, calls, io } = fixture();
 io.play = async () => { trial.event({type:'observed',playing:true}); trial.event({type:'observed',playing:false}); };
 assert.equal(await trial.run(io), 'playing');
 assert.equal(calls.filter(c => c[0] === 'play_retry').length, 0);
});
for (const reason of ['user stop', 'candidate switch', 'trial end']) test(`${reason} cancels pending startup without a late send`, async () => {
 const { trial, calls, io } = fixture();
 let started;
 const entered = new Promise(resolve => { started = resolve; });
 io.prepare = () => { started(); return new Promise(() => {}); };
 const operation = trial.run(io); await entered; trial.cancel();
 assert.equal(await operation, 'cancelled'); assert.equal(calls.some(c => c[0] === 'play'), false);
});
test('manual stop during query is not mistaken for a dropped request', async () => {
 const { trial, calls, io } = fixture(); io.query = async () => ({ playing:false, userStopped:true });
 assert.equal(await trial.run(io), 'cancelled'); assert.equal(calls.filter(c => c[0] === 'play').length, 1);
});
test('fallback success is observable through the same state checks and needs no toast', async () => {
 const { trial, calls, io } = fixture(); io.prepare = async () => { throw Error('ready missed'); };
 io.query = async () => ({ playing:true });
 assert.equal(await trial.run(io), 'playing'); assert.equal(calls.filter(c => c[0] === 'fallback').length, 1);
});
test('trial logs are silent by default and opt-in records remain one-line INFO for Theia stdout forwarding', () => {
 const oldInfo=console.info,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),rows=[];
 let flag=null;console.info=(...args)=>rows.push(args);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>{assert.equal(key,'akari.swapTrial.log');return flag;}}});
 try {
  const identity={token:'test',startedAt:Date.now()-20};
  logSwapTrial(identity,'play_request');assert.equal(rows.length,0);
  flag='1';logSwapTrial(identity,'play_request',{attempt:1});
  assert.equal(rows[0][0],'[akari-swap-trial]');const row=JSON.parse(rows[0][1]);
  assert.equal(row.token,'test');assert.equal(row.event,'play_request');assert.ok(row.t>=20);assert.equal(row.attempt,1);
  flag='0';logSwapTrial(identity,'play_request');assert.equal(rows.length,1);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('storage denied');}});
  assert.doesNotThrow(()=>logSwapTrial(identity,'play_request'));assert.equal(rows.length,1);
 } finally {
  console.info=oldInfo;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
 }
});

test('enabled logs reach stdout through the installed Theia INFO logger/server; default logs do not',()=>{
 const stdout=execFileSync(process.execPath,['-e',`
  require('reflect-metadata');
  const {Logger,setRootLogger,unsetRootLogger}=require('@theia/core/lib/common/logger');
  const {LogLevel}=require('@theia/core/lib/common/logger-protocol');
  const {ConsoleLoggerServer}=require('@theia/core/lib/node/console-logger-server');
  const {logSwapTrial}=require('./lib/common/swap-trial-playback');
  const server=new ConsoleLoggerServer();server.cli={logLevelFor:()=>LogLevel.INFO};
  const logger=new Logger();Object.assign(logger,{name:'root',server,created:Promise.resolve(),_logLevel:Promise.resolve(LogLevel.INFO)});
  let enabled=false;Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>enabled?'1':null}});
  setRootLogger(logger);logSwapTrial({token:'off',startedAt:Date.now()},'play_request');
  enabled=true;logSwapTrial({token:'on',startedAt:Date.now()},'play_request');
  setImmediate(()=>unsetRootLogger());
 `],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
 assert.equal(stdout.split('\n').filter(line=>line.includes('[akari-swap-trial]')).length,1);
 assert.match(stdout,/"token":"on"/);assert.doesNotMatch(stdout,/"token":"off"/);
});
