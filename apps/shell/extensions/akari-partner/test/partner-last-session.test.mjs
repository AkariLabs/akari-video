import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTNER_LAST_KEY, rememberPartnerClose } from '../lib/common/partner-last-session.js';

test('user close saves a project-local null entry', async () => {
    const writes = [];
    await rememberPartnerClose({ async setData(key, value) { writes.push([key, value]); } }, true, false);
    assert.equal(writes[0][0], PARTNER_LAST_KEY);
    assert.equal(writes[0][1].entryId, null);
    assert.ok(writes[0][1].closedAt);
});

test('shutdown dispose and cleanup dispose preserve last entry', async () => {
    const storage = { async setData() { assert.fail('must not write'); } };
    await rememberPartnerClose(storage, true, true);
    await rememberPartnerClose(storage, false, false);
});

test('closing one tab records another live partner instead of a null entry', async () => {
    const writes = [];
    await rememberPartnerClose({ async setData(key, value) { writes.push([key, value]); } }, true, false, 'other-cli');
    assert.equal(writes[0][0], PARTNER_LAST_KEY);
    assert.equal(writes[0][1].entryId, 'other-cli');
    assert.ok(writes[0][1].at);
    assert.equal('closedAt' in writes[0][1], false);
});
