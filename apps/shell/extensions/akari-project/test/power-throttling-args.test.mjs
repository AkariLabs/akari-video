import test, { afterEach, beforeEach } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
beforeEach(() => setLanguage('ja'));
afterEach(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import { powerThrottlingOffArgs } from '../lib/node/akari-project-service.js';

test('省電力抑制を外す引数は指定した子プロセスだけを対象にする', () => {
    const args = powerThrottlingOffArgs(1234);
    assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
    assert.match(args[5], /Release\(1234\)/);
    assert.match(args[5], /StateMask = 0/);
    assert.throws(() => powerThrottlingOffArgs(0), /正の整数/);
});
