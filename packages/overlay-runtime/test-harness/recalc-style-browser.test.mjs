import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import test from 'node:test';
import {launchBrowser} from './fixtures/browser.mjs';

const runtimeSource = process.env.AKARI_OVERLAY_RUNTIME_SOURCE
  ? readFileSync(process.env.AKARI_OVERLAY_RUNTIME_SOURCE, 'utf8')
  : readFileSync(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');

test('playback and pause keep forced style recalculation bounded with 300 CSS animations', {timeout: 300000}, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>@keyframes drift { from { transform:translateX(0) } to { transform:translateX(100px) } } [data-akari-active] .motion { animation: drift 20s linear both }</style><div id="overlay-stage"></div>');
    await page.addScriptTag({content: runtimeSource});
    const setup = await page.evaluate(async () => {
      const staticNodes = '<span>static</span>'.repeat(8000);
      const motionNodes = '<i class="motion">motion</i>'.repeat(300);
      await window.akari.runtime.mount({overlays:[{id:'stress',start:0,duration:100,html:staticNodes+motionNodes}]});
      window.akari.runtime.tick(0, true);
      return {elements: document.querySelector('#overlay-stage').querySelectorAll('*').length,
        animations: document.querySelector('[data-overlay-id="stress"]').getAnimations({subtree:true}).length};
    });
    assert.ok(setup.elements >= 8000);
    assert.equal(setup.animations, 300);

    const session = await page.target().createCDPSession();
    await session.send('Performance.enable');
    const count = async () => {
      const {metrics} = await session.send('Performance.getMetrics');
      return metrics.find(metric => metric.name === 'RecalcStyleCount')?.value;
    };
    const before = await count();
    await page.evaluate(() => {
      for (let i=1;i<=60;i++) window.akari.runtime.tick(i/60,true);
    });
    const afterPlayback = await count();
    await page.evaluate(() => {
      for (let i=0;i<60;i++) window.akari.runtime.tick(1,false);
    });
    const afterPause = await count();
    const result = {elements:setup.elements,animations:setup.animations,playbackTicks:60,pauseTicks:60,
      playbackRecalcs:afterPlayback-before,pauseRecalcs:afterPause-afterPlayback,
      totalRecalcs:afterPause-before,limit:240};
    console.log(JSON.stringify(result));
    if (process.env.AKARI_RECALC_EVIDENCE_FILE) {
      writeFileSync(process.env.AKARI_RECALC_EVIDENCE_FILE, JSON.stringify(result,null,2)+'\n');
    }
    assert.ok(result.totalRecalcs <= result.limit, 'forced style recalculations exceed two per tick');
  } finally {
    await browser.close();
  }
});
