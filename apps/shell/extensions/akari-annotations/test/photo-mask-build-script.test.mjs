import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const shellPackage = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const inline = shellPackage.scripts.build.match(/node -e "([^"]+)"/u)?.[1];

test('development build skips the helper without swiftc and builds it when available', () => {
    assert.ok(inline);
    for (const [available, helperStatus] of [[false, null], [true, 1], [true, 0]]) {
        const calls = [];
        const warnings = [];
        vm.runInNewContext(inline, {
            require: name => {
                assert.equal(name, 'child_process');
                return { spawnSync: (...args) => {
                    calls.push(args);
                    return { status: args[0] === 'swiftc' ? available ? 0 : null : helperStatus };
                } };
            },
            process: { execPath: '/node' },
            console: { warn: message => warnings.push(message) }
        });
        assert.equal(JSON.stringify(calls[0].slice(0, 2)), JSON.stringify(['swiftc', ['--version']]));
        assert.equal(calls.length, available ? 2 : 1);
        if (available) {
            assert.equal(JSON.stringify(calls[1].slice(0, 2)),
                JSON.stringify(['/node', ['resources/scripts/build-photo-mask-helper.mjs']]));
            if (helperStatus === 0) assert.equal(warnings.length, 0);
            else assert.match(warnings[0], /開発ビルドを続けます/u);
        } else assert.equal(warnings.length, 0);
    }
});
