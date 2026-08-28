import test from 'node:test';
import assert from 'node:assert/strict';
import { prependCliShimDirToPath } from '../../lib/node/cli-path-startup.js';

const cases = [
    {
        name: 'posix',
        delimiter: ':',
        shimDir: '/opt/akari-test/.akari/cli/bin',
        otherEntries: ['/usr/local/bin', '/usr/bin']
    },
    {
        name: 'win32',
        delimiter: ';',
        shimDir: 'C:\\Users\\test\\.akari\\cli\\bin',
        otherEntries: ['C:\\Windows\\System32', 'C:\\Windows']
    }
];

for (const { name, delimiter, shimDir, otherEntries } of cases) {
    test(`prependCliShimDirToPath: ${name} の空 PATH は shimDir だけになる`, () => {
        assert.equal(prependCliShimDirToPath({ shimDir, existingPath: '', pathDelimiter: delimiter }), shimDir);
    });

    test(`prependCliShimDirToPath: ${name} の先頭に shimDir があれば不変`, () => {
        const existingPath = [shimDir, ...otherEntries].join(delimiter);
        assert.equal(prependCliShimDirToPath({ shimDir, existingPath, pathDelimiter: delimiter }), existingPath);
    });

    test(`prependCliShimDirToPath: ${name} の途中に shimDir があれば不変`, () => {
        const existingPath = [otherEntries[0], shimDir, otherEntries[1]].join(delimiter);
        assert.equal(prependCliShimDirToPath({ shimDir, existingPath, pathDelimiter: delimiter }), existingPath);
    });

    test(`prependCliShimDirToPath: ${name} に shimDir が無ければ先頭へ加える`, () => {
        const existingPath = otherEntries.join(delimiter);
        assert.equal(
            prependCliShimDirToPath({ shimDir, existingPath, pathDelimiter: delimiter }),
            [shimDir, ...otherEntries].join(delimiter)
        );
    });
}
