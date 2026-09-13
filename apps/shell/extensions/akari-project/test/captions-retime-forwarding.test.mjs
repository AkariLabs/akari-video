import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('BuildCaptionsRequest.retime を captions CLI の --retime へ透過する', async () => {
    const protocol = await readFile(fileURLToPath(new URL('../src/common/akari-project-protocol.ts', import.meta.url)), 'utf8');
    const service = await readFile(fileURLToPath(new URL('../src/node/akari-project-service.ts', import.meta.url)), 'utf8');
    assert.match(protocol, /BuildCaptionsRequest[^\n]+retime\?: boolean/);
    assert.match(service, /request\.retime \? \['--retime'\] : \[\]/);
});
