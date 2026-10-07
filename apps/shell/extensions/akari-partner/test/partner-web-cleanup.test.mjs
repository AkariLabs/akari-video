import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDisposeWebWidget } from '../lib/common/partner-web-cleanup.js';

test('restored empty web widget is disposed', () => {
    assert.equal(shouldDisposeWebWidget({ hasLaunch: false, starting: false, roots: ['file:///C:/work/project'] }), true);
});

test('web widget stays in place while launch is starting', () => {
    assert.equal(shouldDisposeWebWidget({ hasLaunch: false, starting: true, roots: [] }), false);
});

test('web widget for the current root stays open across path case and separator differences', () => {
    assert.equal(shouldDisposeWebWidget({ hasLaunch: true, starting: false,
        launchCwd: 'c:\\Work\\Project\\', roots: ['file:///C:/work/project/'] }), false);
});

test('web widget compares the requested drive path with the current root', () => {
    assert.equal(shouldDisposeWebWidget({ hasLaunch: true, starting: false,
        launchCwd: 'X:\\Project', roots: ['file:///X:/Project'] }), false);
});

test('web widget for another root is disposed', () => {
    assert.equal(shouldDisposeWebWidget({ hasLaunch: true, starting: false,
        launchCwd: 'C:\\Work\\old', roots: ['file:///C:/Work/new'] }), true);
});

test('closing the project disposes a launched web widget', () => {
    assert.equal(shouldDisposeWebWidget({ hasLaunch: true, starting: false,
        launchCwd: 'C:\\Work\\Project', roots: [] }), true);
});
