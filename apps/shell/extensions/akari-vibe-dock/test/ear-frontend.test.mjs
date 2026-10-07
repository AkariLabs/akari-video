import assert from 'node:assert/strict';
import test from 'node:test';
import { AkariEarClientImpl } from '../lib/browser/ear-client.js';

test('フロント側の音量イベントは 100ms ごとに間引く', () => {
    const client = new AkariEarClientImpl();
    let now = 0;
    client.now = () => now;
    const levels = [];
    client.levelEvent(value => levels.push(value));
    client.onLevel(0.1);
    now = 50;
    client.onLevel(0.2);
    now = 100;
    client.onLevel(0.3);
    assert.deepEqual(levels, [0.1, 0.3]);
});
