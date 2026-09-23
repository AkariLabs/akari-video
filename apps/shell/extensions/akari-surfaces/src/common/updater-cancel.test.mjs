import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isUpdaterCancelRequest, isUpdaterTemporaryFileName, UpdaterRequestTracker } from '../../lib/electron-common/electron-api.js';

class FakeRequest extends EventEmitter {
    aborts = 0;
    abort() { this.aborts++; this.emit('abort'); }
}

test('cancel request needs the current version and download time', () => {
    const cases = [
        ['{"version":"1.2.3","time":1200}', true],
        ['{"version":"1.2.4","time":1200}', false],
        ['{"version":"1.2.3","time":999}', false],
        ['{"version":"1.2.3","time":7001}', false],
        ['{"version":"1.2.3","time":"1200"}', false],
        ['broken', false]
    ];
    for (const [raw, expected] of cases) { assert.equal(isUpdaterCancelRequest(raw, '1.2.3', 1000, 2000), expected, raw); }
});

test('cleanup selects updater temporary files only', () => {
    const names = [
        ['temp-akari.zip', true], ['0-temp-akari.zip', true],
        ['12-temp-akari.zip', true], ['akari.zip', false],
        ['update-info.json', false], ['current.blockmap', false],
        ['../temp-akari.zip', false], ['temp-../file', false]
    ];
    for (const [name, expected] of names) { assert.equal(isUpdaterTemporaryFileName(name), expected, name); }
});

test('request close leaves a receiving response available for cancellation', () => {
    const tracker = new UpdaterRequestTracker();
    const request = tracker.track(new FakeRequest());
    const response = new EventEmitter();
    request.emit('response', response);
    request.emit('close');
    assert.equal(tracker.size, 1);
    assert.deepEqual(tracker.abortAll(), []);
    assert.equal(request.aborts, 1);
    assert.equal(tracker.size, 0);
    // The tracker keeps its error listeners after abort, so late transport errors cannot crash main.
    assert.doesNotThrow(() => request.emit('error', new Error('late request error')));
    assert.doesNotThrow(() => response.emit('error', new Error('late response error')));
});

test('updater request tracker removes each completed or aborted request', () => {
    const cases = [
        ['abort', 'request'], ['error', 'request'],
        ['end', 'response'], ['error', 'response'], ['aborted', 'response'], ['close', 'response']
    ];
    for (const [event, source] of cases) {
        const tracker = new UpdaterRequestTracker();
        const request = tracker.track(new FakeRequest());
        const response = new EventEmitter();
        request.emit('response', response);
        assert.equal(tracker.size, 1, `${source}:${event}`);
        (source === 'request' ? request : response).emit(event);
        assert.equal(tracker.size, 0, `${source}:${event}`);
        assert.deepEqual(tracker.abortAll(), []);
        assert.equal(request.aborts, 0);
    }
    const tracker = new UpdaterRequestTracker();
    assert.deepEqual(tracker.track({}), {});
    assert.equal(tracker.size, 0);
});

test('cancel aborts every outstanding request even when one abort throws', () => {
    const tracker = new UpdaterRequestTracker();
    const first = tracker.track(new FakeRequest());
    const failed = tracker.track(new FakeRequest());
    failed.abort = () => { throw new Error('abort failed'); };
    const last = tracker.track(new FakeRequest());
    const completed = tracker.track(new FakeRequest());
    const response = new EventEmitter();
    completed.emit('response', response);
    response.emit('end');
    assert.equal(tracker.size, 3);
    assert.equal(tracker.abortAll().length, 1);
    assert.equal(first.aborts, 1);
    assert.equal(last.aborts, 1);
    assert.equal(completed.aborts, 0);
    assert.equal(tracker.size, 0);
});
