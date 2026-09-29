import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {launchBrowser} from './fixtures/browser.mjs';

const source = process.env.AKARI_OVERLAY_RUNTIME_SOURCE
  ? readFileSync(process.env.AKARI_OVERLAY_RUNTIME_SOURCE, 'utf8')
  : readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
test('hidden overlays release CSS animations and seek restores the first pose', {timeout:300000}, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>@keyframes move { from { transform:translateX(0) } to { transform:translateX(100px) } } .motion { animation: move 1s linear both }</style><div id="overlay-stage"></div>');
    await page.addScriptTag({content:source});
    const result = await page.evaluate(async () => {
      await window.akari.runtime.mount({overlays:[
        {id:'first',start:0,duration:1,html:'<div class="motion">one</div>'},
        {id:'second',start:1,duration:1,html:'<div class="motion">two</div>'},
        {id:'third',start:2,duration:1,html:'<div class="motion">three</div>'},
      ]});
      const nodes = [...document.querySelectorAll('#overlay-stage > [data-overlay-id]')];
      const snapshot = () => ({
        counts:nodes.map(node=>node.getAnimations({subtree:true}).length),
        displays:nodes.map(node=>getComputedStyle(node).display),
        total:document.getAnimations().length,
      });
      const mounted=snapshot();
      const showAndPause = async time => {
        window.akari.runtime.tick(time,true);
        const active = nodes[Math.floor(time)].getAnimations({subtree:true});
        await Promise.all(active.map(animation => animation.ready));
        window.akari.runtime.tick(time,false);
        await Promise.all(active.map(animation => animation.ready));
        for (const animation of active) animation.persist?.();
        return snapshot();
      };
      const first=await showAndPause(0.5);
      const second=await showAndPause(1.5);
      const third=await showAndPause(2.5);
      const returned=await showAndPause(0.5);
      const firstMotion=nodes[0].querySelector('.motion');
      return {mounted,first,second,third,returned,
        currentTime:nodes[0].getAnimations({subtree:true})[0]?.currentTime,
        translateX:new DOMMatrixReadOnly(getComputedStyle(firstMotion).transform).m41};
    });
    assert.deepEqual(result.second.counts,[0,1,0], 'paused animations from the first scene must be released');
    assert.equal(result.second.total,1);
    assert.deepEqual(result.mounted,{counts:[0,0,0],displays:['none','none','none'],total:0});
    assert.deepEqual(result.first,{counts:[1,0,0],displays:['block','none','none'],total:1});
    assert.deepEqual(result.second,{counts:[0,1,0],displays:['none','block','none'],total:1});
    assert.deepEqual(result.third,{counts:[0,0,1],displays:['none','none','block'],total:1});
    assert.deepEqual(result.returned,{counts:[1,0,0],displays:['block','none','none'],total:1});
    assert.equal(result.currentTime,500);
    assert.ok(Math.abs(result.translateX-50)<1, `seek pose translateX=${result.translateX}`);
  } finally { await browser.close(); }
});

test('premount 3D runtime keeps hidden layout until premount is disabled', {timeout:300000}, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="overlay-stage"></div>');
    await page.addScriptTag({content:source});
    const result = await page.evaluate(async () => {
      window.akari.runtimes.register({id:'premount-test',selector:'[data-premount-test]',
        render(){},inspect(){return {status:'idle'}},dispose(){},premountTick(){}});
      await window.akari.runtime.mount({overlays:[{id:'scene',start:10,duration:2,
        html:'<div data-premount-test style="width:100px;height:50px"></div>'}]});
      const node=document.querySelector('[data-overlay-id="scene"]');
      window.akari.runtime.tick(0,false);
      const read=()=>({display:getComputedStyle(node).display,visibility:node.style.visibility,
        width:node.querySelector('[data-premount-test]').getBoundingClientRect().width});
      const enabled=read();
      window.akari.runtime.configure({premount:false}); const disabled=read();
      window.akari.runtime.configure({premount:true}); const restored=read();
      return {enabled,disabled,restored};
    });
    assert.deepEqual(result,{
      enabled:{display:'block',visibility:'hidden',width:100},
      disabled:{display:'none',visibility:'hidden',width:0},
      restored:{display:'block',visibility:'hidden',width:100},
    });
  } finally { await browser.close(); }
});

test('paused CSS animations are released when a premount overlay becomes hidden', {timeout:300000}, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>@keyframes move { from { transform:translateX(0) } to { transform:translateX(100px) } } [data-akari-active] .motion { animation:move 1s linear both }</style><div id="overlay-stage"></div>');
    await page.addScriptTag({content:source});
    const result = await page.evaluate(async () => {
      window.akari.runtimes.register({id:'premount-animation-test',selector:'[data-premount-test]',
        render(){},inspect(){return {status:'idle'}},dispose(){},premountTick(){}});
      window.akari.runtime.configure({premount:true});
      await window.akari.runtime.mount({overlays:[{id:'scene',start:0,duration:2,
        html:'<div data-premount-test style="width:100px;height:50px"><div class="motion">scene</div></div>'}]});
      const node=document.querySelector('[data-overlay-id="scene"]');
      const target=node.querySelector('.motion');
      window.akari.runtime.tick(0.5,true);
      await Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.ready));
      await new Promise(resolve=>setTimeout(resolve,60));
      window.akari.runtime.tick(0.5,true); // playing=true のまま 50ms 以上据え置く
      const paused=node.getAnimations({subtree:true}).map(animation=>animation.playState);
      window.akari.runtime.tick(3,true); // premount のレイアウトを残して不可視化
      const hidden={
        count:document.getAnimations().filter(animation=>node.contains(animation.effect?.target)).length,
        display:getComputedStyle(node).display,
        visibility:node.style.visibility,
        width:node.querySelector('[data-premount-test]').getBoundingClientRect().width,
      };
      window.akari.runtime.tick(0.5,false); // シークして再表示
      const animations=node.getAnimations({subtree:true});
      return {paused,hidden,returned:{count:document.getAnimations().length,
        localTime:animations[0]?.currentTime,
        translateX:new DOMMatrixReadOnly(getComputedStyle(target).transform).m41}};
    });
    assert.deepEqual(result.paused,['paused']);
    assert.deepEqual(result.hidden,{count:0,display:'block',visibility:'hidden',width:100});
    assert.equal(result.returned.count,1);
    assert.equal(result.returned.localTime,500);
    assert.ok(Math.abs(result.returned.translateX-50)<1,
      `seek pose translateX=${result.returned.translateX}`);
  } finally { await browser.close(); }
});

test('ungated premount CSS animation survives hiding, seeks, and resumes', {timeout:300000}, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>@keyframes move { from { transform:translateX(0) } to { transform:translateX(100px) } } .motion { animation:move 1s linear infinite }</style><div id="overlay-stage"></div>');
    await page.addScriptTag({content:source});
    const result = await page.evaluate(async () => {
      window.akari.runtimes.register({id:'premount-ungated-test',selector:'[data-premount-test]',
        render(){},inspect(){return {status:'idle'}},dispose(){},premountTick(){}});
      window.akari.runtime.configure({premount:true});
      await window.akari.runtime.mount({overlays:[{id:'scene',start:0,duration:2,
        html:'<div data-premount-test><div class="motion">scene</div></div>'}]});
      const node=document.querySelector('[data-overlay-id="scene"]');
      const target=node.querySelector('.motion');
      window.akari.runtime.tick(0.5,true);
      window.akari.runtime.tick(3,true);
      const hidden=node.getAnimations({subtree:true}).length;
      window.akari.runtime.tick(0.25,false);
      window.akari.runtime.tick(0.25,false);
      const returned={count:node.getAnimations({subtree:true}).length,
        translateX:new DOMMatrixReadOnly(getComputedStyle(target).transform).m41};
      window.akari.runtime.tick(0.25,true);
      const startedAt=performance.now();
      for (let frame=0;frame<20;frame++) {
        const frameTime=await new Promise(resolve=>requestAnimationFrame(resolve));
        window.akari.runtime.tick(0.25+(frameTime-startedAt)/1000,true);
      }
      const resumed=node.getAnimations({subtree:true});
      return {hidden,returned,resumed:{count:resumed.length,playState:resumed[0]?.playState,
        translateX:new DOMMatrixReadOnly(getComputedStyle(target).transform).m41}};
    });
    assert.equal(result.hidden,1);
    assert.equal(result.returned.count,1);
    assert.ok(Math.abs(result.returned.translateX-25)<1,
      `seek pose translateX=${result.returned.translateX}`);
    assert.equal(result.resumed.count,1);
    assert.equal(result.resumed.playState,'running');
    assert.ok(result.resumed.translateX>result.returned.translateX+1,
      `resumed pose did not advance: ${result.resumed.translateX}`);
  } finally { await browser.close(); }
});
