import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';

const runtimeSource = await readFile(new URL('../src/overlay-runtime.js', import.meta.url), 'utf8');
const interactionSource = await readFile(new URL('../src/interaction.js', import.meta.url), 'utf8');
const interactionCss = await readFile(new URL('../src/interaction.css', import.meta.url), 'utf8');

test('remount keeps the caption host and selected overlay identity', { timeout: 180000 }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>
      body { margin: 0 }
      #overlay-stage { position: relative; width: 640px; height: 360px }
      #caption-host { position: absolute; inset: 0; pointer-events: none }
      #caption { animation: caption-in 1s linear both paused }
      @keyframes caption-in { from { opacity: 0 } to { opacity: 1 } }
      ${interactionCss}
    </style><div id="overlay-stage"><div id="caption-host"><div id="caption">Caption</div></div></div>`);
    await page.evaluate(() => {
      window.akari = { state: { summary: {
        output: { width: 640, height: 360 },
        overlays: [{ id: 'shape', start: 0, duration: 5,
          html: '<div style="position:absolute;left:80px;top:60px;width:100px;height:80px;background:red"></div>' }],
        tree: [{ id: 'shape', parentId: null, kind: 'leaf', label: 'Shape' }]
      } }, stageScale: () => 1 };
    });
    await page.addScriptTag({ content: runtimeSource });
    await page.addScriptTag({ content: interactionSource });
    const result = await page.evaluate(async () => {
      const { runtime, interaction, state } = window.akari;
      await runtime.mount(state.summary);
      runtime.tick(1, false);
      interaction.selectFromTimeline('shape');
      const firstContainer = document.querySelector('#overlay-stage > [data-overlay-id="shape"]');
      const captionHost = document.getElementById('caption-host');
      const caption = document.getElementById('caption');
      caption.getAnimations()[0].currentTime = 500;
      const beforeOpacity = Number(getComputedStyle(caption).opacity);
      await runtime.mount(state.summary);
      runtime.tick(1, false);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const replacement = document.querySelector('#overlay-stage > [data-overlay-id="shape"]');
      const stage = document.getElementById('overlay-stage');
      const frame = document.querySelector('.akari-interaction-selection-frame');
      return {
        sameHost: document.getElementById('caption-host') === captionHost,
        hostStillInStage: captionHost.parentElement === stage,
        containerBeforeHost: Boolean(captionHost.compareDocumentPosition(replacement)
          & Node.DOCUMENT_POSITION_PRECEDING),
        sameCaption: document.getElementById('caption') === caption,
        beforeOpacity, afterOpacity: Number(getComputedStyle(caption).opacity),
        newContainer: replacement !== firstContainer,
        selectedId: interaction.selectedId,
        selectedMarker: replacement.getAttribute('data-akari-interaction-selected'),
        frameWidth: frame?.getBoundingClientRect().width ?? 0,
      };
    });
    assert.equal(result.sameHost, true);
    assert.equal(result.hostStillInStage, true);
    assert.equal(result.containerBeforeHost, true);
    assert.equal(result.sameCaption, true);
    assert.ok(result.beforeOpacity > 0);
    assert.ok(result.afterOpacity > 0, JSON.stringify(result));
    assert.equal(result.newContainer, true);
    assert.equal(result.selectedId, 'shape');
    assert.equal(result.selectedMarker, 'true');
    assert.ok(result.frameWidth > 0, JSON.stringify(result));
  } finally { await browser.close(); }
});
