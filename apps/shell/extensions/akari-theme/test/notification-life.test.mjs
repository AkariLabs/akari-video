import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationLife, notificationLifeMs, NOTIFICATION_LIFE_MS } from '../lib/common/notification-life.js';

function fakeManager() {
    const toasts = new Map();
    const notifications = new Map();
    const deferredResults = new Map();
    const life = new NotificationLife({
        hideToast(id) { toasts.delete(id); life.setVisible([...toasts.keys()].slice(-3)); },
        accept(id, action) {
            toasts.delete(id);
            notifications.delete(id);
            life.setVisible([...toasts.keys()].slice(-3));
            deferredResults.get(id)?.(action);
            deferredResults.delete(id);
            life.remove(id);
        }
    });
    function show(id, kind, duration) {
        toasts.set(id, { kind });
        notifications.set(id, { kind });
        let resolve;
        const result = new Promise(done => { resolve = done; });
        deferredResults.set(id, resolve);
        life.add(id, kind, duration);
        life.setVisible([...toasts.keys()].slice(-3));
        return result;
    }
    let centerOpen = false;
    function showCenter() {
        centerOpen = true;
        life.openCenter();
        life.moveToCenter([...toasts.keys()]);
    }
    function closeCenter() { centerOpen = false; }
    function toggleCenter() { if (centerOpen) closeCenter(); else showCenter(); }
    return { toasts, notifications, deferredResults, life, show, showCenter, closeCenter, toggleCenter,
        get centerOpen() { return centerOpen; } };
}

function frames(life, start, end, step = 16, hidden = false) {
    const expired = [];
    for (let at = start + step; at < end; at += step) expired.push(...life.frame(at, hidden));
    expired.push(...life.frame(end, hidden));
    return expired;
}

test('右下の時間表は上から優先して決める', () => {
    assert.deepEqual(NOTIFICATION_LIFE_MS, { plain: 3000, action: 5000, important: 8000 });
    for (const [kind, actions, timeout, progress, expected] of [
        ['progress', 0, 9000, false, 0], ['info', 1, 9000, true, 0],
        ['error', 2, 0, false, 0], ['info', 0, -1, false, 0],
        ['warning', 0, -1200, false, 0], ['warning', 0, 1200, false, 1200],
        ['info', 0, 1750, false, 1750],
        ['error', 0, undefined, false, 8000], ['warning', 0, undefined, false, 8000],
        ['info', 2, undefined, false, 8000], ['info', 1, undefined, false, 5000],
        ['info', 0, undefined, false, 3000]
    ]) assert.equal(notificationLifeMs(kind, actions, timeout, progress), expected);
});

test('時間切れでは右下だけを外し、一覧のボタンで初めて結果を解決する', async () => {
    const base = fakeManager();
    const result = base.show('ask', 'info', 5000);
    let settled = false;
    result.then(() => { settled = true; });
    base.life.frame(0);
    assert.deepEqual(frames(base.life, 0, 4992), []);
    assert.equal(base.life.fraction('ask'), 8 / 5000);
    assert.deepEqual(base.life.frame(5000), ['ask']);
    assert.equal(base.life.fraction('ask'), 0);
    assert.equal(base.life.phase('ask'), 'absorbing');
    assert.equal(base.toasts.has('ask'), true, '吸い込み中は DOM の札に対応する toast が残る');
    base.life.finishAbsorb('ask', base.life.generation('ask'), false);
    assert.equal(base.toasts.has('ask'), false);
    assert.equal(base.notifications.has('ask'), true);
    assert.equal(base.deferredResults.has('ask'), true);
    assert.equal(base.life.unreadCount, 1);
    await Promise.resolve();
    assert.equal(settled, false);
    base.life.openCenter();
    assert.equal(base.life.unreadCount, 0);
    base.life.acceptFromCenter('ask', '今すぐ更新');
    assert.equal(await result, '今すぐ更新');
    assert.equal(base.notifications.has('ask'), false);
    assert.equal(base.deferredResults.has('ask'), false);
});

test('16ms のコマで実時間どおり減り、500ms の間隔は数えず、通常の間隔から再開する', () => {
    const life = new NotificationLife();
    life.add('one', 'info', 3000);
    life.setVisible(['one']);
    life.frame(0);
    assert.deepEqual(frames(life, 0, 992), []);
    assert.equal(life.remaining('one'), 2008);
    assert.equal(life.fraction('one'), 2008 / 3000);
    for (let at = 1492; at <= 11492; at += 500) assert.deepEqual(life.frame(at), []);
    assert.equal(life.remaining('one'), 2008);
    assert.deepEqual(frames(life, 11492, 13500), ['one']);
    assert.equal(life.remaining('one'), 0);
});

test('マウス・フォーカス・非表示で残り時間と輪が止まり、離すと残りから進む', () => {
    const life = new NotificationLife();
    life.add('one', 'info', 3000);
    life.setVisible(['one']);
    life.frame(0);
    frames(life, 0, 1000);
    life.hold('one', 'pointer', true);
    frames(life, 1000, 2000);
    life.hold('one', 'focus', true);
    life.hold('one', 'pointer', false);
    frames(life, 2000, 3000);
    life.hold('one', 'focus', false);
    frames(life, 3000, 4000, 16, true);
    assert.equal(life.remaining('one'), 2000);
    assert.equal(life.fraction('one'), 2 / 3);
    assert.deepEqual(frames(life, 4000, 6000), ['one']);
});

test('吸い込み完了時だけ未読が増え、error は赤になり、一覧を開くと既読になる', () => {
    const base = fakeManager();
    base.show('error', 'error', 8000);
    base.life.frame(0);
    assert.deepEqual(frames(base.life, 0, 8000), ['error']);
    assert.equal(base.life.unreadCount, 0);
    base.life.finishAbsorb('error', base.life.generation('error'), false);
    assert.equal(base.life.unreadCount, 1);
    assert.equal(base.life.hasUnreadError, true);
    base.life.openCenter();
    assert.equal(base.life.unreadCount, 0);
    assert.equal(base.life.hasUnreadError, false);
    base.show('open', 'info', 3000);
    base.life.resetFrame();
    base.life.frame(0);
    frames(base.life, 0, 3000);
    base.life.finishAbsorb('open', base.life.generation('open'), true);
    assert.equal(base.life.unreadCount, 0);
});

test('× とボタンは一覧からも消すが未読にはせず、進行中と timeout 0 は残る', async () => {
    const base = fakeManager();
    const dismissed = base.show('dismiss', 'info', 3000);
    const action = base.show('action', 'info', 5000);
    base.show('progress', 'progress', 0);
    base.show('pinned', 'error', 0);
    base.life.finishDismiss('dismiss', base.life.generation('dismiss'));
    base.life.finishDismiss('action', base.life.generation('action'), '開く');
    assert.equal(await dismissed, undefined);
    assert.equal(await action, '開く');
    base.life.frame(0);
    for (let at = 500; at <= 60000; at += 500) assert.deepEqual(base.life.frame(at), []);
    assert.equal(base.toasts.has('progress'), true);
    assert.equal(base.toasts.has('pinned'), true);
    assert.equal(base.life.fraction('progress'), undefined);
    assert.equal(base.life.unreadCount, 0);
    assert.equal(base.life.hasCounting, false);
});

test('明示的に右下を隠した札は未読にならず、時計も止まる', () => {
    const base = fakeManager();
    base.show('hidden', 'error', 8000);
    base.life.hideVisible(base.toasts.keys());
    base.toasts.clear();
    base.life.frame(0);
    assert.deepEqual(base.life.frame(100000), []);
    assert.equal(base.life.unreadCount, 0);
    assert.equal(base.life.phase('hidden'), 'stored');
    assert.equal(base.life.hasCounting, false);
});

test('札が出ている間に一覧を開いて閉じても既読のまま残りベルは揺れない', async () => {
    for (const opener of ['showCenter', 'toggleCenter']) {
        const base = fakeManager();
        const result = base.show('seen', 'error', 8000);
        let settled = false;
        result.then(() => { settled = true; });
        base.life.frame(0);
        frames(base.life, 0, 1000);
        base[opener]();
        assert.equal(base.centerOpen, true);
        assert.equal(base.toasts.size, 0);
        assert.equal(base.notifications.has('seen'), true);
        assert.equal(base.deferredResults.has('seen'), true);
        assert.equal(base.life.hasCounting, false);
        if (opener === 'toggleCenter') base.toggleCenter();
        else base.closeCenter();
        assert.equal(base.centerOpen, false);
        assert.deepEqual(frames(base.life, 1000, 30000), []);
        assert.equal(base.life.unreadCount, 0);
        assert.equal(base.life.ringableUnreadCount, 0);
        assert.equal(base.life.phase('seen'), 'stored');
        await Promise.resolve();
        assert.equal(settled, false);
    }
});

test('5 件では表示中の末尾 3 件だけ減り、古い札は表示されるまで止まる', () => {
    const base = fakeManager();
    for (let index = 1; index <= 5; index++) base.show(String(index), 'info', 3000);
    base.life.frame(0);
    assert.deepEqual(frames(base.life, 0, 1000), []);
    for (const id of ['1', '2']) assert.equal(base.life.remaining(id), 3000);
    for (const id of ['3', '4', '5']) assert.equal(base.life.remaining(id), 2000);
    assert.deepEqual(frames(base.life, 1000, 3000), ['3', '4', '5']);
    for (const id of ['3', '4', '5']) base.life.finishAbsorb(id, base.life.generation(id), false);
    assert.deepEqual([...base.toasts.keys()], ['1', '2']);
    assert.equal(base.life.hasCounting, true);
    base.life.frame(3000);
    assert.deepEqual(frames(base.life, 3000, 6000), ['1', '2']);
});

test('silent の札は右下に出ず一覧で未読になり、error は赤くてもベルは揺れない', () => {
    const base = fakeManager();
    base.show('silent', 'error', 8000);
    base.life.storeUnread('silent');
    assert.equal(base.toasts.size, 0);
    assert.equal(base.notifications.has('silent'), true);
    assert.equal(base.deferredResults.has('silent'), true);
    assert.equal(base.life.unreadCount, 1);
    assert.equal(base.life.hasUnreadError, true);
    assert.equal(base.life.ringableUnreadCount, 0);
    assert.equal(base.life.hasCounting, false);
    base.life.frame(0);
    assert.deepEqual(frames(base.life, 0, 30000), []);
});

test('古い世代の × と吸い込み完了は再表示された同じ id を消さない', async () => {
    const base = fakeManager();
    base.show('same', 'info', 3000);
    const old = base.life.generation('same');
    const current = base.show('same', 'info', 3000);
    assert.notEqual(base.life.generation('same'), old);
    base.life.finishDismiss('same', old);
    assert.equal(base.toasts.has('same'), true);
    assert.equal(base.deferredResults.has('same'), true);
    base.life.frame(0);
    assert.deepEqual(frames(base.life, 0, 3000), ['same']);
    base.life.finishAbsorb('same', old, false);
    assert.equal(base.life.phase('same'), 'absorbing');
    assert.equal(base.toasts.has('same'), true);
    base.life.finishAbsorb('same', base.life.generation('same'), false);
    assert.equal(base.notifications.has('same'), true);
    base.life.acceptFromCenter('same', '開く');
    assert.equal(await current, '開く');
});
