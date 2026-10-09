import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PartnerActivityState } = require('../lib/common/partner-activity-state.js');
const railIds = require('../../akari-shell-strip/lib/common/rail-ids.js');

test('出力中だけ busy になり、終了と close で戻る', () => {
    const state = new PartnerActivityState();
    for (let now = 0; now <= 3000; now += 100) state.feed('terminal-1', '.', now);
    assert.equal(state.isBusy('terminal-1'), true);
    assert.equal(state.anyBusy, true);
    assert.equal(state.checkTurnEnd('terminal-1', 5000), true);
    assert.equal(state.anyBusy, false);
    for (let now = 6000; now <= 9000; now += 100) state.feed('terminal-1', '.', now);
    assert.equal(state.close('terminal-1'), true);
    assert.equal(state.anyBusy, false);
});

test('公開 context key は凍結 ID と一致する', () => {
    const source = readFileSync(new URL('../src/browser/partner-activity-service.ts', import.meta.url), 'utf8');
    assert.match(source, /PARTNER_BUSY_CONTEXT_KEY = 'akari\.partner\.busy'/);
    assert.equal(railIds.AKARI_PARTNER_BUSY_CONTEXT_KEY, 'akari.partner.busy');
});
