import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewSessionRecorder } from '../lib/browser/review-session-recorder.js';

test('rejects denied microphone access before creating any session files', async () => {
    let backendStarts = 0;
    const service = {
        listReviewSessions: async () => [],
        startReviewSession: async () => {
            backendStarts += 1;
            throw new Error('must not be called');
        }
    };
    const states = [];
    const recorder = new ReviewSessionRecorder(service, state => states.push(state));
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            mediaDevices: {
                getUserMedia: async () => {
                    throw new DOMException('denied', 'NotAllowedError');
                }
            }
        }
    });
    try {
        await recorder.start({
            projectRootUri: 'file:///project',
            editUri: 'file:///project/edit.json',
            timelineT: 0,
            playing: false
        }, {
            timelineT: 0,
            playing: false,
            rate: 1
        });
    } finally {
        if (previousNavigator) {
            Object.defineProperty(globalThis, 'navigator', previousNavigator);
        } else {
            delete globalThis.navigator;
        }
    }
    assert.equal(backendStarts, 0);
    assert.equal(states.at(-1).status, 'error');
    assert.equal(states.at(-1).active, false);
    assert.match(states.at(-1).error, /マイク/);
});
