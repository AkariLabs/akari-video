import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import {
  normalizeReviewPoint, reviewBoxFromPoints, reviewCaptionLabelsAt, reviewElementsAt, REVIEW_PENDING_PATH,
  parseReviewPending, serializeReviewPending, reviewAttachArgument, reviewAnnotationRequest,
  ReviewAnnotationFailureGate, reviewEscapeStep,
  reviewMemoEnterAction, updateReviewPending
} from '../lib/common/chat-review-attachments.js';
import { reviewThumbnailEviction, previewChatReviewScript } from '../lib/browser/preview-chat-review.js';

test('動画矩形から 0〜1 の座標とペン外接矩形を得る', () => {
  assert.deepEqual(normalizeReviewPoint(300, 150, { left: 100, top: 50, width: 400, height: 200 }), { x: .5, y: .5 });
  assert.deepEqual(normalizeReviewPoint(0, 999, { left: 100, top: 50, width: 400, height: 200 }), { x: 0, y: 1 });
  const box = reviewBoxFromPoints([{ x: .2, y: .4 }, { x: .8, y: .6 }]);
  assert.equal(box.x, .2);
  assert.equal(box.y, .4);
  assert.ok(Math.abs(box.w - .6) < 1e-10);
  assert.ok(Math.abs(box.h - .2) < 1e-10);
});

test('annotation request keeps source frames, ranges and content-rect strokes without sessionRef', () => {
  const base = { tool: 'pen', source: 'edit.json', sourceLabel: 'edit', time: 12,
    sourceT: 3.25, cutIndex: 2, src: 'clip-a', text: '',
    points: [[.1, .2], [.8, .9]] };
  assert.deepEqual(reviewAnnotationRequest('file:///project', base), {
    projectRootUri: 'file:///project', src: 'clip-a', sourceT: 3.25,
    strokes: [{ tool: 'pen', space: 'content-rect', frame: { sourceT: 3.25, cutIndex: 2 },
      points: [[.1, .2], [.8, .9]] }], text: ''
  });
  assert.deepEqual(reviewAnnotationRequest('file:///project', { ...base, tool: 'pin',
    shape: { x: .5, y: .4 }, text: 'Fix this' }), {
    projectRootUri: 'file:///project', src: 'clip-a', sourceT: 3.25, point: [.5, .4], text: 'Fix this'
  });
  assert.deepEqual(reviewAnnotationRequest('file:///project', { ...base, tool: 'range',
    sourceRange: [3.25, 4.5], text: 'Shorten' }), {
    projectRootUri: 'file:///project', src: 'clip-a', sourceT: 3.25,
    sourceRange: [3.25, 4.5], text: 'Shorten'
  });
});

test('only finite pin shapes produce clamped annotation points', () => {
  const base = { source: 'edit.json', sourceLabel: 'edit', time: 1, text: 'Fix this' };
  const request = mark => reviewAnnotationRequest('file:///project', { ...base, ...mark });
  assert.deepEqual(request({ tool: 'pin', shape: { x: -2, y: 3 } }).point, [0, 1]);
  for (const shape of [undefined, { x: NaN, y: .5 }, { x: .5, y: Infinity }]) {
    assert.equal(Object.hasOwn(request({ tool: 'pin', shape }), 'point'), false);
  }
  for (const tool of ['pen', 'range']) {
    assert.equal(Object.hasOwn(request({ tool, shape: { x: .2, y: .8 } }), 'point'), false);
  }
});

test('one failed mark update notifies once, while handoff retries and can notify again', () => {
  const gate = new ReviewAnnotationFailureGate();
  const key = 'project:mark-1';
  assert.equal(gate.shouldAttempt(key, 'memo A'), true);
  assert.equal(gate.recordFailure(key, 'memo A'), true);
  assert.equal(gate.shouldAttempt(key, 'memo A'), false);
  assert.equal(gate.recordFailure(key, 'memo A'), false);
  assert.equal(gate.shouldAttempt(key, 'memo A', true), true);
  assert.equal(gate.shouldAttempt(key, 'memo B'), true);
  assert.equal(gate.recordFailure(key, 'memo B'), true);
  gate.clear(key);
  assert.equal(gate.shouldAttempt(key, 'memo B'), true);
});

test('review thumbnails keep each pending item below 64KB and retain only 50 images', async () => {
  const mark = index => ({ kind: 'review', label: `review ${index}`, review: {
    tool: 'pin', source: 'edit.json', sourceLabel: 'review', time: index,
    text: 'fix', thumbnail: `data:image/jpeg;base64,${'a'.repeat(100)}`
  } });
  const pending = Array.from({ length: 51 }, (_, index) => mark(index));
  assert.equal(reviewThumbnailEviction(pending), 0);
  pending[0].review.thumbnail = undefined;
  assert.equal(reviewThumbnailEviction(pending), -1);
  pending[12].review.thumbnail = `data:image/jpeg;base64,${'a'.repeat(64 * 1024)}`;
  assert.equal(reviewThumbnailEviction(pending), 12);
  while (reviewThumbnailEviction(pending) >= 0) {
    const index = reviewThumbnailEviction(pending);
    const [item] = pending.splice(index, 1);
    item.review.thumbnail = undefined;
    pending.push(item);
  }
  const root = await mkdtemp(join(tmpdir(), 'akari-review-limit-'));
  try {
    const path = join(root, 'pending.json');
    await writeFile(path, serializeReviewPending(pending));
    const saved = parseReviewPending(await readFile(path, 'utf8'));
    assert.equal(saved.length, 51);
    assert.equal(saved.filter(item => item.review.thumbnail).length, 49);
    assert.ok(saved.every(item => !item.review.thumbnail ||
      new TextEncoder().encode(JSON.stringify(item)).byteLength <= 64 * 1024));
  } finally { await rm(root, { recursive: true, force: true }); }
  const script = previewChatReviewScript();
  assert.ok(new Script(script));
  assert.match(script, /thumbnailEviction\(marks, limit\)/);
  assert.match(script, /akari-preview-chat-review-remove/);
  assert.match(script, /akari-preview-chat-review-add/);
  assert.match(script, /void trim\(50\)/);
  assert.match(script, /akari-preview-chat-review-update/);
  const stateHandler = script.slice(script.indexOf("window.addEventListener('message'"), script.indexOf('setInterval', script.indexOf("window.addEventListener('message'")));
  assert.doesNotMatch(stateHandler, /trim\(/);
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

test('空のメモを含む pending.json を読み書きし、書き換えても番号と件数を保つ', () => {
  const oldMark = { kind: 'review', label: '既存 2.0秒', review: {
    tool: 'pin', source: 'edit.json', sourceLabel: '既存', time: 2, text: '前からあるメモ'
  } };
  const emptyMark = { kind: 'review', label: '新規 3.0秒', review: {
    id: 'mark-2', tool: 'pin', source: 'edit.json', sourceLabel: '新規', time: 3, text: ''
  } };
  const restored = parseReviewPending(serializeReviewPending([oldMark, emptyMark]));
  assert.deepEqual(restored, [oldMark, emptyMark]);
  assert.deepEqual(reviewAttachArgument(restored), { attachments: restored });
  const changed = updateReviewPending(restored, 1, { ...emptyMark.review, text: 'あとから書いた' });
  assert.equal(changed.length, 2);
  assert.equal(changed[0], restored[0]);
  assert.equal(changed[1].review.text, 'あとから書いた');
  assert.equal(updateReviewPending(changed, 2, emptyMark.review), changed);
  assert.equal(updateReviewPending(changed, 1, { ...emptyMark.review, shape: { x: 2, y: 0 } }), changed);
});

test('Esc は一段だけ進み、IME の Enter は保存しない', () => {
  assert.equal(reviewEscapeStep({ noteOpen: true, trayOpen: true, tool: 'pin' }), 'note');
  assert.equal(reviewEscapeStep({ noteOpen: false, trayOpen: true, tool: 'pin' }), 'tray');
  assert.equal(reviewEscapeStep({ noteOpen: false, trayOpen: false, tool: 'pin' }), 'tool');
  assert.equal(reviewEscapeStep({ noteOpen: false, trayOpen: false, tool: null }), undefined);
  assert.equal(reviewEscapeStep({ noteOpen: true, trayOpen: true, tool: 'pin', isComposing: true }), undefined);
  assert.equal(reviewEscapeStep({ noteOpen: true, trayOpen: true, tool: 'pin', keyCode: 229 }), undefined);
  const key = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };
  assert.equal(reviewMemoEnterAction(key), 'save');
  assert.equal(reviewMemoEnterAction({ ...key, shiftKey: true }), 'newline');
  assert.equal(reviewMemoEnterAction({ ...key, isComposing: true }), 'ignore');
  assert.equal(reviewMemoEnterAction({ ...key, keyCode: 229 }), 'ignore');
  assert.equal(reviewMemoEnterAction({ ...key, key: 'a' }), 'ignore');
});
