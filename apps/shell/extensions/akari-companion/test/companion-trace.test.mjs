import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('command timing is opt in and measured after two animation frames', () => {
    const protocol=fs.readFileSync(new URL('../src/common/akari-companion-protocol.ts',import.meta.url),'utf8');
    const source=fs.readFileSync(new URL('../src/browser/akari-companion-contribution.ts',import.meta.url),'utf8');
    const dispatch=source.slice(source.indexOf('protected async dispatchCommand('),source.indexOf('protected async readFileBytes('));
    assert.match(protocol,/trace\?: boolean/);
    assert.match(protocol,/timing\?: \{ recvAt: number; doneAt: number; paintedAt: number \}/);
    assert.match(dispatch,/instruction\.trace === true/);
    assert.match(dispatch,/requestAnimationFrame\(\(\) => requestAnimationFrame/);
    assert.match(dispatch,/if \(recvAt !== null && doneAt !== null\)/);
    assert.ok(dispatch.indexOf('validateCommandArgs') < dispatch.indexOf('executeCommand'));
});
