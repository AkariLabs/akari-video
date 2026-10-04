import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captionWrapHeightDrag, updateCaptionTransformSource } from '../lib/common/caption-plate-handles.js';

const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const captionVars = readFileSync(new URL('../src/browser/akari-preview-captions.ts', import.meta.url), 'utf8');

test('vertical selection has only top and bottom wrap handles with vertical cursors', () => {
  assert.match(bootstrap, /caption\.textStyle\?\.vertical[\s\S]*?handleKinds\.filter\(kind => kind !== 'e' && kind !== 'w'\), 'n', 's'/u);
  assert.match(bootstrap, /handle\.style\.cursor = 'ns-resize'/u);
  assert.match(bootstrap, /handle\.style\[kind === 'n' \? 'top' : 'bottom'\] =/u);
  assert.match(bootstrap, /--akari-caption-vertical-edge-outset/u);
  assert.match(bootstrap, /handle\.style\.background = 'transparent'/u);
  assert.match(bootstrap, /grip\.style\.width = '14px'/u);
  assert.match(bootstrap, /grip\.style\.height = '5px'/u);
  assert.match(bootstrap, /captionPlate\.style\.removeProperty\('--caption-wrap-width'\)/u);
});

test('shortening a vertical line writes height percent and preserves its top', () => {
  const start = { top: 108, bottom: 648 };
  const shortened = captionWrapHeightDrag('s', start, { x: 0, y: -216 }, 0, 1, 1080);
  assert.deepEqual(shortened, { heightPct: 30, top: 108, bottom: 432 });
  const source = JSON.stringify([{ id: 'c1', text_style: { vertical: true } }]);
  const saved = JSON.parse(updateCaptionTransformSource(source, ['c1'],
    { wrapWidthPct: shortened.heightPct }));
  assert.equal(saved[0].text_style.wrap_width_pct, 30);
  assert.match(bootstrap, /captionPlate\.style\.setProperty\('--caption-vertical-wrap-height', wrapHeight\)/u);
  assert.match(bootstrap, /const candidateLeft = layoutRect\.right - \(nextLayout\.right - nextLayout\.left\)/u);
  assert.match(bootstrap, /const fixedCorner = kind === 's' \? 1 : 2/u);
  assert.match(captionVars, /!style\?\.vertical && typeof style\?\.wrap_width_pct/u);
});
