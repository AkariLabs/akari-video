import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clampDockHeight, readDockHeight, dockTabs, dockActions, dockLookState, rowDockTitle,
  lookPatch, currentLookSwatch, currentLookFit, hasLookCushion,
  shouldCloseDockOnEscape, shouldRefreshLookDock } = require('../lib/common/daihon-dock.js');

test('高さの記憶値を読み、140px からパネル 80% へ収める', () => {
  assert.equal(clampDockHeight(50, 500), 140);
  assert.equal(clampDockHeight(900, 500), 400);
  assert.equal(readDockHeight('272px', 500), 272);
  assert.equal(readDockHeight('900px', 500), 400);
  assert.equal(clampDockHeight(900, 500, 320), 320);
  assert.equal(readDockHeight('900px', 500, 320), 320);
  for (const invalid of [null, '', '50%', '-1px', 'NaNpx', '12evil']) {
    assert.equal(readDockHeight(invalid, 500), null);
  }
});

test('Esc は開いているドックの範囲でだけ処理する', () => {
  assert.equal(shouldCloseDockOnEscape('Escape', true, true, false), true);
  assert.equal(shouldCloseDockOnEscape('Escape', true, false, true), true);
  assert.equal(shouldCloseDockOnEscape('Escape', true, false, false), false);
  assert.equal(shouldCloseDockOnEscape('Escape', false, true, false), false);
  assert.equal(shouldCloseDockOnEscape('Enter', true, true, false), false);
});

test('選択の種類でドックのタブが決まる', () => {
  assert.deepEqual(dockTabs('row'), ['template', 'look', 'anim', 'emphasis', 'time']);
  assert.deepEqual(dockTabs('placed'), ['text', 'template', 'look', 'anim']);
});

test('右クリックは利用できる操作だけ', () => {
  assert.deepEqual(dockActions('row', { cut: true, split: true, 'merge-next': false,
    'speech-tight': true, 'insert-below': true, delete: true }),
  ['cut', 'split', 'speech-tight', 'insert-below', 'delete']);
  assert.deepEqual(dockActions('row', { cut: true, 'merge-selected': true, 'speech-tight': true }),
    ['cut', 'merge-selected', 'speech-tight']);
  assert.deepEqual(dockActions('placed', { all: true, delete: true }), ['all', 'delete']);
  assert.deepEqual(dockActions('placed', { all: true, duplicate: true, delete: true }),
    ['all', 'duplicate', 'delete']);
});

test('行ドックのタイトルは複数選択の数か単一行の文言', () => {
  assert.equal(rowDockTitle(3, '発話1'), '3 行を選択中');
  assert.equal(rowDockTitle(1, '発話1'), '発話1');
});

test('見た目の書き込み引数は setCaptionTextStyle の camelCase patch', () => {
  assert.deepEqual(lookPatch('color', '#ffffff'), { color: '#ffffff' });
  assert.deepEqual(lookPatch('background', 'none'), { background: { opacity: 0 } });
  assert.deepEqual(lookPatch('background', '#000000'), { background: { color: '#000000', opacity: 1 } });
  assert.deepEqual(lookPatch('fit', 'frame'), { background: { fit: 'frame' } });
  assert.deepEqual(lookPatch('fit', 'text'), { background: { fit: null } });
  assert.deepEqual(lookPatch('size', 38), { sizePx: 38 });
  assert.deepEqual(lookPatch('spacing', .12), { letterSpacingEm: .12 });
  assert.deepEqual(lookPatch('stroke', 3), { stroke: { widthPx: 3, color: '#000000' } });
});

test('座布団の幅は継承値と選択値の 4 通りで削除か明示値を決める', () => {
  const textDefault = { background: { fit: 'text' } };
  const frameDefault = { background: { fit: 'frame' } };
  assert.deepEqual(lookPatch('fit', 'text', undefined, textDefault), { background: { fit: null } });
  assert.deepEqual(lookPatch('fit', 'frame', undefined, textDefault), { background: { fit: 'frame' } });
  assert.deepEqual(lookPatch('fit', 'text', undefined, frameDefault), { background: { fit: 'text' } });
  assert.deepEqual(lookPatch('fit', 'frame', undefined, frameDefault), { background: { fit: null } });
  assert.deepEqual(lookPatch('fit', 'text', { background: { fit: 'frame' } }, textDefault),
    { background: { fit: 'text' } });
  const selectedRows = [
    { presetStyle: undefined, defaultStyle: frameDefault },
    { presetStyle: { background: { fit: 'text' } }, defaultStyle: frameDefault }
  ];
  assert.deepEqual(selectedRows.map(row => lookPatch('fit', 'text', row.presetStyle, row.defaultStyle)), [
    { background: { fit: 'text' } }, { background: { fit: null } }
  ]);
});

test('座布団の幅の実効値は行、プリセット、既定の順に解決する', () => {
  assert.equal(currentLookFit({}, {}), 'text');
  assert.equal(currentLookFit({}, { background: { fit: 'frame' } }), 'frame');
  assert.equal(currentLookFit({ background: { fit: 'text' } }, { background: { fit: 'frame' } }), 'text');
  assert.equal(currentLookFit({}, {}, { background: { fit: 'frame' } }), 'frame');
  assert.equal(currentLookFit({ background: { fit: 'text' } }, {}, { background: { fit: 'frame' } }), 'text');
  assert.equal(currentLookFit({ background: { fit: 'frame' } }, {}, { background: { fit: 'text' } }), 'frame');
  assert.equal(hasLookCushion({}, {}), false);
  assert.equal(hasLookCushion({ background: { opacity: 1 } }, {}), true);
  assert.equal(hasLookCushion({ background: { opacity: 0 } }, { background: { color: '#111111' } }), false);
  assert.equal(hasLookCushion({}, {}, { background: { color: '#111111' } }), true);
});

test('見た目タブの選択印と無効判定は再読込した字幕に追随する', () => {
  const frame = [{ textStyle: { background: { color: '#111111', fit: 'frame' } } }];
  const none = [{ textStyle: { background: { color: '#111111', opacity: 0, fit: 'frame' } } }];
  const restored = [{ textStyle: { background: { color: '#111111' } } }];
  assert.deepEqual(dockLookState(frame), {
    textColor: undefined, backgroundColor: '#111111', fit: 'frame', fitDisabled: false
  });
  assert.deepEqual(dockLookState(none), {
    textColor: undefined, backgroundColor: 'none', fit: 'frame', fitDisabled: true
  });
  assert.deepEqual(dockLookState(restored), {
    textColor: undefined, backgroundColor: '#111111', fit: 'text', fitDisabled: false
  });
  assert.deepEqual(dockLookState([{ textStyle: {} }], {
    color: '#ffffff', background: { color: '#facc15', fit: 'frame' }
  }), {
    textColor: '#ffffff', backgroundColor: '#facc15', fit: 'frame', fitDisabled: false
  });
  assert.equal(shouldRefreshLookDock('row', 'look', true), true);
  assert.equal(shouldRefreshLookDock('row', 'look', false), false);
  assert.equal(shouldRefreshLookDock('row', 'template', true), false);
  assert.equal(shouldRefreshLookDock('row', 'anim', true), false);
  assert.equal(shouldRefreshLookDock('row', 'emphasis', true), false);
  assert.equal(shouldRefreshLookDock('row', 'time', true), false);
  assert.equal(shouldRefreshLookDock('placed', 'look', true), false);
});

test('色の選択印は行固有値、プリセット値、既定値の順に読む', () => {
  assert.equal(currentLookSwatch({ color: '#ffffff' }, { color: '#111111' }, 'color'), '#ffffff');
  assert.equal(currentLookSwatch({}, { color: '#111111' }, 'color'), '#111111');
  assert.equal(currentLookSwatch({ background: { opacity: 0 } },
    { background: { color: '#facc15' } }, 'background'), 'none');
  assert.equal(currentLookSwatch({}, { background: { color: '#facc15' } }, 'background'), '#facc15');
  assert.equal(currentLookSwatch({}, {}, 'background'), 'none');
  assert.equal(currentLookSwatch({}, {}, 'background', { background: { color: '#38bdf8' } }), '#38bdf8');
  assert.equal(currentLookSwatch({}, {}, 'color', { color: '#ffffff' }), '#ffffff');
  assert.equal(currentLookSwatch({ background: { color: '#facc15' } }, {}, 'background',
    { background: { opacity: 0 } }), 'none');
});
