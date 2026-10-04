import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../asset-meta.schema.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/asset/valid-catalog/audio/whoosh-transition/meta.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);

test('asset meta schema requires tier, accepts both tiers, and ignores deprecated price for access', () => {
    const withoutPrice = { ...fixture };
    delete withoutPrice.price;
    assert.equal(validate(withoutPrice), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...withoutPrice, tier: 'pro', license: { ...fixture.license, spdx: 'LicenseRef-AKARI-Assets-v0' } }), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...withoutPrice, tier: 'paid' }), false);
    const withoutTier = { ...fixture };
    delete withoutTier.tier;
    assert.equal(validate(withoutTier), false);
    assert.ok(validate.errors.some(error => error.params?.missingProperty === 'tier'));
    assert.equal(schema.properties.price.deprecated, true);
});

test('asset meta schema accepts matching knob defaults and rejects a mismatched value', () => {
    const meta = { ...fixture, knobs: [
        { param: 'size', type: 'slider', group: 'typography', default: 24 },
        { param: 'family', type: 'text', group: 'typography', default: 'Noto Sans JP' }
    ] };
    assert.equal(validate(meta), true, JSON.stringify(validate.errors));
    meta.knobs[0].default = '24';
    assert.equal(validate(meta), false);
    assert.ok(validate.errors.some(error => error.instancePath.includes('/knobs/0/default')));
});

test('validate-asset checks knob default types', () => {
    const root = mkdtempSync(join(tmpdir(), 'akari-asset-default-'));
    const dir = join(root, 'audio', fixture.id);
    const cli = fileURLToPath(new URL('../bin/validate-asset.mjs', import.meta.url));
    mkdirSync(dir, { recursive: true });
    const meta = { ...fixture, knobs: [{ param: 'size', type: 'slider', group: 'typography', default: 24 }] };
    try {
        writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
        const valid = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
        assert.equal(valid.status, 0, valid.error?.message ?? valid.stderr);
        meta.knobs[0].default = '24';
        writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
        const invalid = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
        assert.equal(invalid.status, 1, invalid.error?.message ?? invalid.stderr);
        assert.match(invalid.stderr, /knobs\[0\]\.default/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('textstyle fixture satisfies schema and requires preset.json', () => {
    const fixtureDir = fileURLToPath(new URL('../../edit-store/test/fixtures/library-textstyle/textstyle/library-gold-sample/', import.meta.url));
    const meta = { ...JSON.parse(readFileSync(join(fixtureDir, 'meta.json'), 'utf8')), tier: 'free' };
    assert.equal(validate(meta), true, JSON.stringify(validate.errors));
    const cli = fileURLToPath(new URL('../bin/validate-asset.mjs', import.meta.url));
    const root = mkdtempSync(join(tmpdir(), 'akari-textstyle-asset-'));
    const copy = join(root, 'textstyle', 'library-gold-sample');
    try {
        mkdirSync(join(root, 'textstyle'));
        cpSync(fixtureDir, copy, { recursive: true });
        writeFileSync(join(copy, 'meta.json'), JSON.stringify(meta));
        const valid = spawnSync(process.execPath, [cli, copy], { encoding: 'utf8' });
        assert.equal(valid.status, 0, valid.error?.message ?? valid.stderr);
        unlinkSync(join(copy, 'preset.json'));
        const missing = spawnSync(process.execPath, [cli, copy], { encoding: 'utf8' });
        assert.equal(missing.status, 1, missing.error?.message ?? missing.stderr);
        assert.match(missing.stderr, /preset\.json/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
