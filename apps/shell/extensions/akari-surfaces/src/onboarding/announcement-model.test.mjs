import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guideAnnouncementDecision, guideAnnouncementMarker } = require('../../lib/onboarding/announcement-model.js');
const fresh = {
    hasOpenProject: false, hasProjectHistory: false, hasCreatorRootPointer: false, hasWorkspaceDirectory: false,
    legacySetupMarkerSeen: false, guideStateSeen: false, announcementMarkerSeen: false
};

test('完全初回は通知も記録もせず、既存利用者の証拠は各1回通知する', () => {
    assert.deepEqual(guideAnnouncementDecision(fresh), { show: false, record: false });
    for (const key of ['hasOpenProject', 'hasProjectHistory', 'hasCreatorRootPointer', 'hasWorkspaceDirectory', 'legacySetupMarkerSeen']) {
        const facts = { ...fresh, [key]: true };
        const first = guideAnnouncementDecision(facts);
        assert.deepEqual(first, { show: true, record: true }, key);
        assert.deepEqual(guideAnnouncementMarker(first, '2026-09-27T00:00:00.000Z'),
            { schema: 1, shownAt: '2026-09-27T00:00:00.000Z' });
        assert.deepEqual(guideAnnouncementDecision({ ...facts, announcementMarkerSeen: true }),
            { show: false, record: false }, `${key}: 再起動`);
    }
});

test('ガイドを使った人と、記録済みの人には通知を再表示しない', () => {
    const existing = { ...fresh, hasProjectHistory: true };
    for (const key of ['guideStateSeen', 'announcementMarkerSeen']) {
        const decision = guideAnnouncementDecision({ ...existing, [key]: true });
        assert.deepEqual(decision, { show: false, record: false });
        assert.equal(guideAnnouncementMarker(decision, 'now'), undefined);
    }
});
