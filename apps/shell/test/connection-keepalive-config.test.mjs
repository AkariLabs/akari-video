import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const generatedMain = new URL('../src-gen/backend/main.js', import.meta.url);

test('backend keeps a disconnected frontend for ten minutes', () => {
    assert.equal(packageJson.theia.backend.config.frontendConnectionTimeout, 600000);
});

test('generated backend config includes the keepalive timeout', { skip: !existsSync(generatedMain) }, () => {
    const generated = readFileSync(generatedMain, 'utf8');
    const config = generated.match(/BackendApplicationConfigProvider\.set\((\{[\s\S]*?\})\);/);
    assert.ok(config, 'generated backend config was not found');
    assert.equal(JSON.parse(config[1]).frontendConnectionTimeout, 600000);
});
