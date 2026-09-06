import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    AkariWebviewRestyleScheduler,
    RESTYLE_DEBOUNCE_MS,
    RESTYLE_HEARTBEAT_MS,
    RESTYLE_MIN_INTERVAL_MS
} from '../lib/browser/akari-webview-restyle-scheduler.js';

test('content, visibility and focus bursts coalesce after the last event', () => {
    const scheduler = new AkariWebviewRestyleScheduler();
    scheduler.requestEvent(0);
    scheduler.requestEvent(100);
    scheduler.requestEvent(200);
    assert.equal(scheduler.takeEvent(449, true), false);
    assert.equal(scheduler.takeEvent(200 + RESTYLE_DEBOUNCE_MS, true), true);
    assert.equal(scheduler.takeEvent(1000, true), false);
});

test('events and heartbeats share the one-second resend throttle', () => {
    const scheduler = new AkariWebviewRestyleScheduler();
    assert.equal(scheduler.takeHeartbeat(0, true), true);
    scheduler.requestEvent(100);
    assert.equal(scheduler.takeEvent(350, true), false);
    assert.equal(scheduler.takeHeartbeat(RESTYLE_MIN_INTERVAL_MS - 1, true), false);
    scheduler.requestEvent(750);
    assert.equal(scheduler.takeEvent(RESTYLE_MIN_INTERVAL_MS, true), true);
    assert.equal(scheduler.takeHeartbeat(1500, true), false);
    assert.equal(scheduler.takeHeartbeat(2000, true), true);
});

test('hidden widgets do not send or consume the visible resend allowance', () => {
    const scheduler = new AkariWebviewRestyleScheduler();
    scheduler.requestEvent(0);
    assert.equal(scheduler.takeEvent(250, false), false);
    assert.equal(scheduler.takeHeartbeat(45000, false), false);
    scheduler.requestEvent(45000);
    assert.equal(scheduler.takeEvent(45250, true), true);
});

test('a heartbeat consumes a pending event to avoid a duplicate resend', () => {
    const scheduler = new AkariWebviewRestyleScheduler();
    scheduler.requestEvent(44900);
    assert.equal(scheduler.takeHeartbeat(45000, true), true);
    assert.equal(scheduler.takeEvent(46000, true), false);
});

test('idle heartbeat restores within 60 seconds and stays below two sends per minute', () => {
    const scheduler = new AkariWebviewRestyleScheduler();
    assert.equal(RESTYLE_HEARTBEAT_MS, 45000);
    assert.ok(RESTYLE_HEARTBEAT_MS < 60000);
    let sends = 0;
    for (let now = RESTYLE_HEARTBEAT_MS; now <= 300000; now += RESTYLE_HEARTBEAT_MS) {
        sends += Number(scheduler.takeHeartbeat(now, true));
    }
    assert.equal(sends, 6);
    assert.ok(sends / 5 <= 2);
});
