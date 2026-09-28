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
