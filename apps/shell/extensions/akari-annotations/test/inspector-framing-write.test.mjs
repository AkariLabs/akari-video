import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readEditV2 } from '@akari-video/edit-store/lib/edit-v2.js';
import { updateItem } from '../lib/common/edit-v2-mutations.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';

import {
  addCutFramingKeyframe,
  createCutFramingCropWriteRequest,
  normalizeCutFramingKeyframes,
  removeCutFramingKeyframe,
  updateCutFraming
} from '../lib/browser/inspector/framing-fields.js';

const inspectorSource = readFileSync(
  new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8'
);
const timelineSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
);
const selectionModelSource = readFileSync(
  new URL('../src/browser/timeline-selection-model.ts', import.meta.url), 'utf8'
);

test('フレーミング窓 4 行は index ベースの専用 write kind へ対応する', () => {
  assert.deepEqual(
    ['x', 'y', 'w', 'h'].map(axis => createCutFramingCropWriteRequest(3, axis, 0.25)),
    [
      { kind: 'cut-framing-crop-x', index: 3, value: 0.25 },
      { kind: 'cut-framing-crop-y', index: 3, value: 0.25 },
      { kind: 'cut-framing-crop-w', index: 3, value: 0.25 },
      { kind: 'cut-framing-crop-h', index: 3, value: 0.25 }
    ]
  );
  for (const kind of [
    'cut-framing-crop-x', 'cut-framing-crop-y',
    'cut-framing-crop-w', 'cut-framing-crop-h', 'cut-framing-keyframes'
  ]) {
    assert.match(selectionModelSource, new RegExp(`kind: '${kind}'`, 'u'));
  }
});

test('窓は % 表示と 0..1 内部値を往復し、x+w>1 を動的に clamp する', () => {
  assert.equal(80 / 100, 0.8);
  assert.equal(0.8 * 100, 80);
  const framing = updateCutFraming(
    { crop: { x: 0.2, y: 0.1, w: 0.8, h: 0.9 } },
    { kind: 'cut-framing-crop-w', index: 0, value: 0.95 }
  );
  assert.deepEqual(framing.crop, { x: 0.2, y: 0.1, w: 0.8, h: 0.9 });
  assert.match(inspectorSource, /displayScale: INSPECTOR_CROP_DISPLAY_SCALE/u);
  assert.match(inspectorSource, /scrubStep: INSPECTOR_CROP_SCRUB_STEP/u);
});

test('窓 4 値を既定へ戻すと crop が消え、空 framing も消える', () => {
  let framing = { crop: { x: 0, y: 0, w: 0.8, h: 1 } };
  framing = updateCutFraming(framing, {
    kind: 'cut-framing-crop-w', index: 0, value: null
  });
  assert.equal(framing, null);

  const withKeyframes = {
    keyframes: [{ t: 0, scale: 1 }, { t: 2, scale: 1.5 }]
  };
  assert.equal(updateCutFraming(withKeyframes, {
    kind: 'cut-framing-keyframes', index: 0, value: null
  }), null);
  assert.deepEqual(updateCutFraming({
    crop: { x: 0, y: 0, w: 0.8, h: 1 },
    ...withKeyframes
  }, {
    kind: 'cut-framing-keyframes', index: 0, value: null
  }), { crop: { x: 0, y: 0, w: 0.8, h: 1 } });
});

test('KF 配列は時刻順へ正規化し、重複時刻・不正倍率を拒否する', () => {
  assert.deepEqual(normalizeCutFramingKeyframes([
    { t: 2, scale: 2, cx: 0.4 },
    { t: 0, scale: 1 }
  ]), [
    { t: 0, scale: 1 },
    { t: 2, scale: 2, cx: 0.4 }
  ]);
  assert.throws(() => normalizeCutFramingKeyframes([
    { t: 1, scale: 1 }, { t: 1, scale: 2 }
  ]), /時刻は重複できません/u);
  assert.throws(() => normalizeCutFramingKeyframes([
    { t: 0, scale: 0 }, { t: 1, scale: 2 }
  ]), /倍率は 0 より大きい/u);
});

test('KF 削除で残り 1 点なら配列全体を除去する', () => {
  const points = [{ t: 0, scale: 1 }, { t: 2, scale: 1.5 }];
  assert.equal(removeCutFramingKeyframe(points, 0), null);
  const three = [...points, { t: 3, scale: 2 }];
  assert.deepEqual(removeCutFramingKeyframe(three, 1), [
    { t: 0, scale: 1 }, { t: 3, scale: 2 }
  ]);
});

test('空からの追加はアンカーと playhead 点の 2 点を作る', () => {
  assert.deepEqual(addCutFramingKeyframe([], 2, 5), [
    { t: 0, scale: 1 }, { t: 2, scale: 1.5 }
  ]);
  assert.deepEqual(addCutFramingKeyframe([], 0.05, 5), [
    { t: 0, scale: 1 }, { t: 5, scale: 1.5 }
  ]);
});

test('既存 KF への追加は直近倍率を継承し、衝突を +0.1 秒ずらす', () => {
  assert.deepEqual(addCutFramingKeyframe([
    { t: 0, scale: 1 }, { t: 2, scale: 1.5 }
  ], 2, 5), [
    { t: 0, scale: 1 }, { t: 2, scale: 1.5 }, { t: 2.1, scale: 1.5 }
  ]);
  assert.throws(() => addCutFramingKeyframe([
    { t: 0, scale: 1 }, { t: 5, scale: 1.5 }
  ], 5, 5), /0\.1 秒ずらしても追加できません/u);
});

test('UI は KF 配列丸ごと write・削除メニュー・無効窓タイトルを配線する', () => {
  assert.match(inspectorSource, /kind: 'cut-framing-keyframes'/u);
  assert.match(inspectorSource, /label: 'この KF を削除'/u);
  assert.match(inspectorSource, /ズーム KF があるときは窓は無視されます/u);
  assert.match(inspectorSource, /actionLabel: '＋ ズーム KF を追加'/u);
  for (const label of ['時刻', '倍率']) {
    assert.equal(inspectorSource.includes(`label: \`KF \${index + 1} ${label}\``), true, label);
  }
  assert.match(inspectorSource, /label: `KF \$\{index \+ 1\} 中心 \$\{axis === 'cx' \? 'X' : 'Y'\}`/u);
  assert.match(inspectorSource, /scrubStep: 0\.01, min: 0, max: duration/u);
  assert.match(inspectorSource, /scrubStep: 0\.01, min: 1, max: 10/u);
  assert.match(inspectorSource, /scrubStep: 0\.005, min: 0, max: 1/u);
  assert.match(timelineSource, /raw\?\.source\?\.framing/u);
  assert.match(timelineSource, /delete cut\.framing/u);
});

test('v2 は media item の source.framing を更新し、空なら field ごと除去する', () => {
  const document = toV2Edit({ cuts: [{ in: 0, out: 5 }] });
  const item = document.tracks.flatMap(track => track.items)
    .find(candidate => candidate.source?.kind === 'media');
  const framing = updateCutFraming(null, {
    kind: 'cut-framing-crop-w', index: 0, value: 0.8
  });
  const written = updateItem(document, { itemId: item.id, patch: { source: { framing } } });
  assert.deepEqual(readEditV2(written).tracks.flatMap(track => track.items)
    .find(candidate => candidate.id === item.id).source.framing, {
    crop: { x: 0, y: 0, w: 0.8, h: 1 }
  });

  const removed = updateItem(written, { itemId: item.id, patch: { source: { framing: null } } });
  assert.equal(Object.hasOwn(readEditV2(removed).tracks.flatMap(track => track.items)
    .find(candidate => candidate.id === item.id).source, 'framing'), false);
});

test('生成した v1 framing は packages/schemas validate-edit を通る', t => {
  const schemaRoot = dirname(fileURLToPath(
    new URL('../../../../../packages/schemas/package.json', import.meta.url)
  ));
  const value = JSON.parse(readFileSync(
    join(schemaRoot, 'examples', 'edit-v0-sample', 'edit.json'), 'utf8'
  ));
  value.cuts[0].framing = {
    crop: { x: 0, y: 0, w: 0.8, h: 1 },
    keyframes: addCutFramingKeyframe([], 2, 5)
  };
  const directory = mkdtempSync(join(tmpdir(), 'akari-inspector-framing-'));
  const editPath = join(directory, 'edit.json');
  writeFileSync(editPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const executed = spawnSync(process.execPath, [join(schemaRoot, 'bin', 'validate-edit.mjs'), editPath], {
    encoding: 'utf8'
  });
  if (executed.error?.code === 'EPERM') {
    t.skip('この Windows sandbox はテスト内の子プロセス起動を許可しない');
    return;
  }
  assert.equal(executed.status, 0, executed.stderr);
});
