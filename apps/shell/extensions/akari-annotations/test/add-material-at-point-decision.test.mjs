import test from 'node:test';
import assert from 'node:assert/strict';
import { materialDropDecision } from '../lib/common/timeline-material-insert.js';
import { isTrackLocked, lockedTrackMessage } from '../lib/common/track-lock-guard.js';

// task 2026-09-08-timeline-file-drop 指示15。
// addMaterialAtPoint（Finder → タイムライン帯のドロップ）は placeMaterialAtPoint 経由で
// 素材カード D&D と同じ「拒否理由の決定」を通る。widget の resolveMaterialDropTarget は
// getBoundingClientRect に依存するのでテストしない（既存テストの流儀）。ここで固定するのは
// **判定の呼び出し順と、そのとき出る理由文字列**:
//   1. ロック行なら lockedTrackMessage で終わり（materialDropDecision は見ない）
//   2. そうでなければ materialDropDecision(kind, trackKind) の accept / reason に従う
// 無言 no-op を作らない（拒否は必ず reason を持つ）ことが本タスクの受け入れ条件。

/** placeMaterialAtPoint の拒否理由決定を、DOM を除いて写した純関数。 */
function dropOutcome(kind, { trackKind, trackId, tracks = [] }) {
    if (isTrackLocked(tracks, trackId)) {
        return { placed: false, reason: lockedTrackMessage(trackId) };
    }
    const decision = materialDropDecision(kind, trackKind);
    if (decision.accept !== true) {
        return { placed: false, reason: decision.reason };
    }
    return { placed: true, zone: decision.zone };
}

test('ロック行が最優先で、materialDropDecision の受理より先に理由を返す', () => {
    const outcome = dropOutcome('video', {
        trackKind: 'layers', trackId: 'v1', tracks: [{ id: 'v1', locked: true }]
    });
    assert.equal(outcome.placed, false);
    assert.equal(outcome.reason, lockedTrackMessage('v1'));
});

test('ロックされていなければ materialDropDecision の受理がそのまま採用される', () => {
    assert.deepEqual(dropOutcome('video', {
        trackKind: 'layers', trackId: 'v1', tracks: [{ id: 'v1', locked: false }]
    }), { placed: true, zone: 'layers' });
    assert.deepEqual(dropOutcome('video', { trackKind: 'cuts', trackId: 'v0' }), {
        placed: true, zone: 'cuts'
    });
});

test('トラックが 0 本（trackKind undefined）の空タイムラインでも受理する — Finder ドロップの初回', () => {
    assert.deepEqual(dropOutcome('video', { trackKind: undefined }), {
        placed: true, zone: 'layers'
    });
    assert.deepEqual(dropOutcome('image', { trackKind: undefined }), {
        placed: true, zone: 'layers'
    });
    assert.deepEqual(dropOutcome('audio', { trackKind: undefined }), {
        placed: true, zone: 'audio'
    });
});

test('拒否は必ず理由文字列を伴う（無言 no-op を作らない）', () => {
    const video = dropOutcome('video', { trackKind: 'audio' });
    assert.equal(video.placed, false);
    assert.match(video.reason, /映像は映像の段へ/);
    const audio = dropOutcome('audio', { trackKind: 'layers' });
    assert.equal(audio.placed, false);
    assert.match(audio.reason, /音は音の段へ/);
});
