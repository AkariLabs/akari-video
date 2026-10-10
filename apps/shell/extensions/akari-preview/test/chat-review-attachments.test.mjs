import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeReviewPoint, reviewBoxFromPoints, reviewCaptionLabelsAt, reviewElementsAt, REVIEW_PENDING_PATH,
  parseReviewPending, serializeReviewPending, reviewAttachArgument
} from '../lib/common/chat-review-attachments.js';

test('動画矩形から 0〜1 の座標とペン外接矩形を得る', () => {
  assert.deepEqual(normalizeReviewPoint(300, 150, { left: 100, top: 50, width: 400, height: 200 }), { x: .5, y: .5 });
  assert.deepEqual(normalizeReviewPoint(0, 999, { left: 100, top: 50, width: 400, height: 200 }), { x: 0, y: 1 });
  const box = reviewBoxFromPoints([{ x: .2, y: .4 }, { x: .8, y: .6 }]);
  assert.equal(box.x, .2);
  assert.equal(box.y, .4);
  assert.ok(Math.abs(box.w - .6) < 1e-10);
  assert.ok(Math.abs(box.h - .2) < 1e-10);
});

test('文字行の矩形だけで点とペンの重なりを判定する', () => {
  const lines = [{ text: 'え、こんなに軽いの？', rect: { left: 100, top: 300, right: 300, bottom: 340 } }];
  assert.deepEqual(reviewCaptionLabelsAt(lines, { kind: 'point', x: 180, y: 320 }),
    ['テロップ「え、こんなに軽いの？」']);
  assert.deepEqual(reviewCaptionLabelsAt(lines, { kind: 'point', x: 180, y: 120 }), []);
  assert.deepEqual(reviewCaptionLabelsAt(lines, { kind: 'rect', left: 80, top: 280, right: 120, bottom: 310 }),
    ['テロップ「え、こんなに軽いの？」']);
  assert.deepEqual(reviewCaptionLabelsAt(lines, { kind: 'rect', left: 80, top: 80, right: 120, bottom: 120 }), []);
});

test('編集内容と点からテロップと映像を引き当てる', () => {
  const edit = JSON.parse(readFileSync(new URL('./fixtures/chat-review/edit.json', import.meta.url), 'utf8'));
  assert.deepEqual(reviewElementsAt(edit, 12, { x: .5, y: .75 }),
    ['テロップ「え、こんなに軽いの？」', '映像 assets/talk_01.mp4']);
  assert.deepEqual(reviewElementsAt(edit, 12, { x: .5, y: .2 }), ['映像 assets/talk_01.mp4']);
});

test('pending.json の保存と再読込、チャットへの引数形', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-review-'));
  try {
    const path = join(root, REVIEW_PENDING_PATH);
    await mkdir(join(root, '.akari', 'review'), { recursive: true });
    const attachment = { kind: 'review', label: '下書き 12.0秒', review: {
      tool: 'pin', source: 'edit.json', sourceLabel: '下書き', time: 12,
      shape: { x: .5, y: .4 }, elements: ['映像 talk_01.mp4'], text: 'ここを直す'
    } };
    await writeFile(path, serializeReviewPending([attachment]));
    const restored = parseReviewPending(await readFile(path, 'utf8'));
    assert.deepEqual(restored, [attachment]);
    assert.deepEqual(reviewAttachArgument(restored), { attachments: [attachment] });
    await writeFile(path, serializeReviewPending([]));
    assert.deepEqual(parseReviewPending(await readFile(path, 'utf8')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
