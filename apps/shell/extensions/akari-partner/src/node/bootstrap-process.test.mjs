import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnBootstrapProcess } from '../../lib/node/bootstrap-process.js';

test('large bootstrap source runs through stdin with a short Windows command line', async () => {
    const source = 'console.log(process.argv.at(-1));\n//' + 'x'.repeat(60_475);
    const child = spawnBootstrapProcess(process.execPath, source, 'claude', process.env);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });
    assert.equal(code, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stdout).toString().trim(), 'claude');
});
