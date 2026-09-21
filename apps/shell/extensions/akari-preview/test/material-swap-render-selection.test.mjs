import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../src/browser/akari-preview-open-handler.ts',import.meta.url),'utf8');
function renderSelectionHarness(requestedId, selected = true) {
 const applyStart = source.indexOf('            const applyCutVisual = segment => {');
 const applyEnd = source.indexOf('                const transform = segment.transform;', applyStart);
 const deselectStart = source.indexOf('            const deselectCut = options => {');
 const deselectEnd = source.indexOf('            for (const handle of cutHandleElements)', deselectStart);
 const layerStart = source.indexOf('            const selectLayer = (layerId, options) => {');
 const layerEnd = source.indexOf('            // ㉒ スナップ統一:', layerStart);
 const reports = [];
 const window = { akari: {
  reportCutSelection: id => reports.push(['cut', id]),
  reportLayerSelection: id => reports.push(['layer', id])
 } };
 const controls = new Function('window', 'requestedCutId', 'cutSelected', `
  const video = { dataset: {}, style: {} }, stillImage = { style: {} };
  const selectionGestureProtects = () => false;
  const writeCutLayerStyleBase = () => {}, clearAdjustBaseFilter = () => {};
  const updateCutSelectBox = () => {}, updateLayerSelectBox = () => {};
  const findLayerEntry = id => id === 'broll-1' ? { id } : undefined;
  let requestedOverlayId, selectedLayerId = null, activePerspectivePreset;
  const cropModeActive = false, perspectivePanelOpen = false, layerPerspectivePresetButtons = [];
  ${source.slice(deselectStart, deselectEnd)}
  ${source.slice(layerStart, layerEnd)}
  ${source.slice(applyStart, applyEnd)} };
  return { applyCutVisual, selectLayer };
 `)(window, requestedId, selected);
 return { ...controls, reports };
}

test('ordinary gap rendering reports cut deselection when no selection id is requested', () => {
 const h = renderSelectionHarness(undefined);
 h.applyCutVisual(undefined);
 assert.deepEqual(h.reports, [['cut', null]]);
});

test('rendering a gap while the selected item id is retained does not report deselection', () => {
 const h = renderSelectionHarness('broll-1');
 h.applyCutVisual(undefined);
 assert.deepEqual(h.reports, []);
});

test('cut-to-layer selection handoff and subsequent gap rendering do not report deselection', () => {
 const h = renderSelectionHarness('broll-1');
 h.selectLayer('broll-1', { report: false });
 h.applyCutVisual(undefined);
 assert.deepEqual(h.reports, []);
});

test('a freshly reloaded preview without a selected cut does not report deselection', () => {
 const h = renderSelectionHarness(undefined, false);
 h.applyCutVisual(undefined);
 assert.deepEqual(h.reports, []);
});
test('user click outside and Escape retain their explicit deselection notifications',()=>{
 const body=source.match(/const releasePreviewSelection = \(\) => \{([\s\S]*?)\n            \};/)[1];
 const calls=[];
 new Function('selectedCaptionId','selectedLayerId','cutSelected','deselectCaption','selectLayer','deselectCut',body)(
  null,'broll-1',true,()=>{},(...args)=>calls.push(['layer',...args]),(...args)=>calls.push(['cut',...args]));
 assert.deepEqual(calls,[['layer',null],['cut']]);
 assert.match(source,/else if \(cutSelected\) deselectCut\(\);/);
});
