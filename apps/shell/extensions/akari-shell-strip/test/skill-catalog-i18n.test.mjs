import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { parseFrontmatter, skillDisplay, skillCatalogName } = require('../lib/common/skill-catalog.js');

test('skill cards use the catalog and preserve frontmatter metadata', () => {
    const entry = parseFrontmatter('---\nname: akari\ndescription: Source description\n---\n');
    assert.deepEqual(entry, { name: 'akari', description: 'Source description' });
    try {
        setLanguage('ja');
        assert.equal(skillDisplay(entry).description, 'AKARI Video のプロジェクトを作る・開く・続きから再開する');
        setLanguage('en');
        assert.equal(skillDisplay(entry).description, 'Create, open, or resume an AKARI Video project');
        assert.deepEqual(skillDisplay({ name: 'my-skill', description: 'Custom skill' }),
            { name: 'my-skill', description: 'Custom skill' });
    } finally { setLanguage(undefined); }
});

// 2026-10-19: record-playbook と connect の 2 つに辞書の項目が無く、スキルの一覧で説明が原文（英語 / 日本語）のまま出ていた。
// 同梱する skills/*/SKILL.md の全部に ja / en の title と summary があることを求める（新しいスキルを足したら辞書も足す）。
test('skillCatalogName folds hyphens before letters and digits', () => {
    assert.equal(skillCatalogName('record-playbook'), 'recordPlaybook');
    assert.equal(skillCatalogName('bake-3d'), 'bake3d');
    try {
        setLanguage('ja');
        assert.equal(skillDisplay({ name: 'bake-3d', description: 'x' }).description, '3D シーンを Blender で映像素材に焼き、検証して配置');
        assert.equal(skillDisplay({ name: 'record-playbook', description: 'x' }).description, '終わったプロジェクトの作り方を playbook.md / playbook.json に記録（素材は役割ごとの仮枠）');
    } finally { setLanguage(undefined); }
});

test('every bundled skill has a ja and en catalog entry (title + summary)', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const { join, resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
    const ja = require(join(root, 'packages/i18n/locales/ja/skills.json'));
    const en = require(join(root, 'packages/i18n/locales/en/skills.json'));
    const skillsDir = join(root, 'skills');
    const names = readdirSync(skillsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
        .map(entry => entry.name);
    assert.ok(names.length >= 20, `skills が少なすぎる: ${names.length}`);
    const missing = [];
    for (const name of names) {
        const entry = parseFrontmatter(readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'));
        assert.ok(entry, `${name}/SKILL.md の frontmatter が読めない`);
        const camel = skillCatalogName(entry.name);
        for (const [lang, catalog] of [['ja', ja], ['en', en]]) {
            for (const role of ['title', 'summary']) {
                const key = `skills.catalog.${camel}.${role}`;
                if (typeof catalog[key] !== 'string' || !catalog[key].trim()) missing.push(`${lang}:${key}`);
            }
        }
    }
    assert.deepEqual(missing, [], `辞書に無い項目: ${missing.join(', ')}`);
});
