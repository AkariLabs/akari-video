import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async relativePath => readFile(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');

test('指示の分岐と表示切替コマンドを配線する', async () => {
  const contribution = await source('browser/akari-companion-contribution.ts');
  assert.match(contribution, /instruction\.kind === 'flyTo'/);
  assert.match(contribution, /instruction\.kind === 'panel'/);
  assert.match(contribution, /isFlyToTargetKind\(/);
  assert.match(contribution, /error: 'not-supported'/);
  assert.match(contribution, /COMPANION_TOGGLE_COMMAND_ID/);
  const toolbar = await source('browser/companion-toolbar-contribution.ts');
  assert.match(toolbar, /COMPANION_TOGGLE_COMMAND_ID = 'akari\.companion\.togglePanel'/);
});

test('呼び出しボタンは「変更を見る」より左に出て、枠の既定位置になる', async () => {
  const toolbar = await source('browser/companion-toolbar-contribution.ts');
  const frame = await source('browser/companion-panel-frame.ts');
  const contribution = await source('browser/akari-companion-contribution.ts');
  // 「変更を見る」は同じ group の priority 100。Theia は sort().reverse() で
  // priority の降順に左から並べるので、100 より大きい値でないと左に出ない。
  const priority = Number(toolbar.match(/COMPANION_TOGGLE_PRIORITY = (\d+)/)?.[1]);
  assert.ok(Number.isInteger(priority) && priority > 100, `priority=${priority}`);
  assert.match(toolbar, /group: 'navigation'/);
  assert.match(toolbar, /toolbarAnchorRect/);
  // 既定の置き場所はボタンの真下。利用者が動かしたときだけ自由な位置を覚える。
  assert.match(frame, /anchoredPanelPosition/);
  assert.match(frame, /setAnchorProvider/);
  assert.match(frame, /resetPlacement/);
  assert.match(frame, /userMoved/);
  assert.match(contribution, /setAnchorProvider\(\(\) => toolbarAnchorRect\(document\)\)/);
});

test('枠は安全な iframe と局所的な操作面だけを持つ', async () => {
  const frame = await source('browser/companion-panel-frame.ts');
  const style = await source('browser/companion-panel-pulse-style.ts');
  assert.match(frame, /setAttribute\('sandbox', 'allow-scripts allow-same-origin'\)/);
  assert.doesNotMatch(frame, /allow-popups|allow-top-navigation/);
  assert.match(frame, /setAttribute\('tabindex', '-1'\)/);
  assert.match(frame, /addEventListener\('blur'/);
  assert.match(frame, /localStorage/);
  assert.match(frame, /event\.source !== this\.iframeEl\.contentWindow/);
  assert.match(frame, /DRAG_THRESHOLD_PX = 4/);
  assert.match(frame, /aria-label/);
  assert.match(frame, /setAttribute\('title'/);
  assert.match(frame, /akari-companion-root/);
  assert.match(frame, /akari-companion-panel/);
  assert.match(frame, /pointer-events:none/);
  assert.match(frame, /pointer-events:auto/);
  assert.match(frame, /z-index:4000/);
  assert.match(style, /\.akari-companion-panel/);
});

test('光の点は動きを減らす設定とプレビューの箱に対応する', async () => {
  const fly = await source('browser/companion-fly-to.ts');
  assert.match(fly, /akariPreviewConfigured/);
  assert.match(fly, /shell-tab-plugin-webview:akari-output-preview/);
  assert.doesNotMatch(fly, /akari\.preview\.pulseItem/);
  assert.match(fly, /prefers-reduced-motion/);
  assert.doesNotMatch(fly, /\bcursor\b/);
  assert.match(fly, /overlayRoot\(\)/);
});
