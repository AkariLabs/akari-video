import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAttachments } from '../lib/common/chat-attachments.js';

test('composed annotation packet replaces the legacy review body', () => {
  const text = describeAttachments([{ kind: 'review', label: 'Review', review: {
    tool: 'pin', source: 'edit.json', sourceLabel: 'Edit', time: 2, text: 'legacy',
    packet: 'Prepared annotation packet'
  } }]);
  assert.equal(text, 'Prepared annotation packet');
});
import { connectorPrefill, initialChatPermission, partnerPermission, partnerPermissionAfterChoice,
    permissionOption, runningTools } from '../lib/common/chat-ui-logic.js';
import { screenRecordingFormat } from '../lib/common/screen-recording.js';
import { addHistory, removeHistory, renameHistory } from '../lib/node/history.js';

test('レビューとファイルを共通の文章にする', () => {
    const text = describeAttachments([
        { kind: 'review', label: 'ピン', review: {
            tool: 'pin', source: 'exports/draft.mp4', sourceLabel: '下書き v2',
            time: 12.4, text: '文字を上に', elements: ['テロップ']
        } },
        { kind: 'file', path: 'assets/clip.mp4', label: '素材' }
    ]);
    assert.match(text, /\[レビュー\] 下書き v2 0:12 ピン（テロップ付近）: 文字を上に/);
    assert.match(text, /\[ファイル\] 素材: assets\/clip.mp4/);
});

test('履歴の名前変更と索引から外す操作は他の会話を残す', () => {
    const base = { version: 1, sessions: [] };
    const one = { id: 'one', agent: 'a', sessionRef: 'r1', title: '最初', createdAt: '1', updatedAt: '1' };
    const two = { ...one, id: 'two', sessionRef: 'r2' };
    const withBoth = addHistory(addHistory(base, one), two);
    const renamed = renameHistory(withBoth, 'one', '  別の名前  ');
    assert.equal(renamed.sessions.find(row => row.id === 'one').title, '別の名前');
    assert.deepEqual(removeHistory(renamed, 'two').sessions.map(row => row.id), ['one']);
    assert.equal(withBoth.sessions.length, 2);
    assert.throws(() => renameHistory(withBoth, 'one', '   '), /名前を入力/);
});

test('進め方は共有設定を正しく写し、要所の選択では書き換えない', () => {
    assert.equal(partnerPermission('bypass'), 'bypass');
    assert.equal(initialChatPermission('ask'), 'checkpoints');
    assert.deepEqual(permissionOption('automatic', 'auto'), { permission: 'auto', available: true });
    assert.deepEqual(permissionOption('automatic', 'bypass'), { permission: 'all', available: true });
    const codex = { permissionModes: ['automatic', 'checkpoints', 'every'] };
    const claude = { permissionModes: ['automatic', 'checkpoints'],
        permissionReasons: { every: '読み取りは確認しないため選べません' } };
    const acp = { permissionModes: ['automatic', 'checkpoints'],
        permissionReasons: { every: '確認の頻度は相手側が決めるため選べません' } };
    const agy = { permissionModes: ['automatic'], permissionReasons: {
        checkpoints: 'この相手では選べません（headless では確認を出せません）',
        every: 'この相手では選べません（headless では確認を出せません）'
    } };
    assert.deepEqual(permissionOption('checkpoints', 'ask', codex), { permission: 'checkpoints', available: true });
    assert.deepEqual(permissionOption('every', 'ask', codex), { permission: 'every', available: true });
    assert.equal(permissionOption('every', 'ask', claude).available, false);
    assert.equal(permissionOption('checkpoints', 'ask', agy).available, false);
    assert.match(permissionOption('checkpoints', 'ask', agy).reason, /headless/);
    assert.match(permissionOption('every', 'ask', claude).reason, /読み取り/);
    assert.match(permissionOption('every', 'ask', acp).reason, /相手側/);
    assert.equal(partnerPermissionAfterChoice('checkpoints', 'bypass'), 'bypass');
    assert.equal(partnerPermissionAfterChoice('automatic', 'ask'), 'auto');
    assert.equal(partnerPermissionAfterChoice('automatic', 'bypass'), 'bypass');
    assert.equal(partnerPermissionAfterChoice('every', 'auto'), 'ask');
});

test('作成例文はサービス名を含み、録画は MP4 を優先する', () => {
    assert.equal(connectorPrefill('fal', '商品を白背景で撮った写真を 4 枚作って'),
        'fal で商品を白背景で撮った写真を 4 枚作って');
    assert.equal(connectorPrefill('fal', 'fal で画像を作って'), 'fal で画像を作って');
    assert.deepEqual(screenRecordingFormat(mime => mime === 'video/mp4'), {
        recorderMime: 'video/mp4', blobMime: 'video/mp4', extension: 'mp4'
    });
    assert.equal(screenRecordingFormat(mime => mime.startsWith('video/mp4')).recorderMime,
        'video/mp4;codecs=avc1.640028');
    assert.equal(screenRecordingFormat(mime => mime === 'video/webm').extension, 'webm');
});

test('道具は最新状態で数える', () => {
    assert.deepEqual(runningTools([
        { type: 'tool', id: 'a', kind: 'read', title: '読む', status: 'running' },
        { type: 'tool', id: 'b', kind: 'write', title: '書く', status: 'running' },
        { type: 'tool', id: 'a', kind: 'read', title: '読んだ', status: 'done' }
    ]).map(tool => tool.id), ['b']);
});
