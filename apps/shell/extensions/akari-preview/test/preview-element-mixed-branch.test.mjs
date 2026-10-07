import assert from 'node:assert/strict';
import test from 'node:test';
import { previewBootstrapScript } from '../lib/browser/preview-script-bootstrap.js';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';

test('mixed pointer handler focuses only one modifier-selected overlay and preserves reporting', async t => {
  const script = previewBootstrapScript();
  const marker = script.indexOf('const mixedSelectionHit = event =>');
  const start = script.indexOf("window.addEventListener('pointerdown', event => {", marker);
  const end = script.indexOf('}, true);', start) + '}, true);'.length;
  assert.ok(marker >= 0 && start > marker && end > start);
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div data-overlay-id="bars"></div>');
  await page.addScriptTag({ content: `window.calls=[];
    window.akari={ interaction: { selectedId:null,
      focusElementAtPoint:(id,x,y)=>window.calls.push(['focus',id,x,y]),
      clearElementFocus:()=>window.calls.push(['clear']) },
      reportMixedSelection:items=>window.calls.push(['report',items.map(item=>item.id)]) };
    let selectedMixedGroup=[],selectedCaptionId=null,selectedLayerId=null,suppressMixedClick=false;
    const mixedSelectionHit=event=>({kind:'overlay',id:event.target.dataset.overlayId});
    const applyMixedSelection=items=>{ selectedMixedGroup=items;
      window.akari.interaction.selectedId=items.find(item=>item.kind==='overlay')?.id??null;
      window.calls.push(['apply',items.map(item=>item.id)]); };
    ${script.slice(start, end)}` });
  const run = (modifier, current) => page.evaluate(({ modifier, current }) => {
    selectedMixedGroup = current.map(id => ({ kind: 'overlay', id }));
    window.akari.interaction.selectedId = current[0] ?? null;
    window.calls = [];
    document.querySelector('[data-overlay-id="bars"]').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 100, clientY: 120,
      metaKey: modifier === 'meta', ctrlKey: modifier === 'ctrl', shiftKey: modifier === 'shift'
    }));
    return window.calls;
  }, { modifier, current });
  assert.deepEqual(await run('meta', []), [['apply', ['bars']], ['focus', 'bars', 100, 120], ['report', ['bars']]]);
  assert.deepEqual(await run('ctrl', []), [['apply', ['bars']], ['focus', 'bars', 100, 120], ['report', ['bars']]]);
  assert.deepEqual(await run('meta', ['other']), [['apply', ['other', 'bars']], ['clear'], ['report', ['other', 'bars']]]);
  assert.deepEqual(await run('shift', []), [['apply', ['bars']], ['clear'], ['report', ['bars']]]);
  assert.deepEqual(await run('meta', ['bars']), [['apply', []], ['clear'], ['report', []]]);
});
