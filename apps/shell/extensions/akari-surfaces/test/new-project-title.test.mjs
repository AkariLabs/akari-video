import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariNewProjectServiceImpl } from '../lib/node/akari-new-project-service.js';

test('node の白紙・作り方作成経路がポップアップの名前を intake.json に保存する', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-new-project-title-'));
    try {
        const service = new AkariNewProjectServiceImpl();
        const applied = [];
        service.resolveTemplateDir = async () => temp;
        service.resolveSkillsDir = async () => undefined;
        service.loadScaffoldModule = async () => ({
            async createProject(destination) {
                await mkdir(join(destination, '.akari'), { recursive: true });
                await writeFile(join(destination, '.akari', 'intake.json'), JSON.stringify({
                    version: 1, target: { duration_s: null, keep_length: false, taste: null }, title: null
                }));
            },
            async applyPlaybook(options) { applied.push(options); }
        });
        for (const [kind, create] of [
            ['blank', uri => service.createProject(uri, '新しいプロジェクト 2026-10-15')],
            ['playbook', uri => service.createProjectFromPlaybook(uri, '/example/playbook', '新しいプロジェクト 2026-10-15')]
        ]) {
            const destination = join(temp, kind);
            await create(pathToFileURL(destination).toString());
            const intake = JSON.parse(await readFile(join(destination, '.akari', 'intake.json'), 'utf8'));
            assert.equal(intake.title, '新しいプロジェクト 2026-10-15');
            assert.equal(intake.target.keep_length, true);
        }
        assert.equal(applied.length, 1);
        const empty = join(temp, 'empty-name');
        await service.createProject(pathToFileURL(empty).toString(), '  ');
        assert.equal(JSON.parse(await readFile(join(empty, '.akari', 'intake.json'), 'utf8')).title, null);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});

test('実際の project-scaffold と project-default で白紙・作り方の intake に入力名を保存する', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'akari-new-project-real-scaffold-'));
    try {
        const service = new AkariNewProjectServiceImpl();
        const template = await service.resolveTemplateDir();
        assert.match(template, /templates[/\\]project-default$/);
        assert.equal(typeof (await service.loadScaffoldModule()).createProject, 'function');

        const playbookDir = join(temp, 'minimal-playbook');
        await mkdir(playbookDir);
        await writeFile(join(playbookDir, 'playbook.json'), JSON.stringify({
            version: 0, kind: 'akari-playbook', id: 'minimal-playbook', name: '最小の作り方',
            playbookVersion: 1, depth: 1, category: 'explainer', steps: [], settings: {},
            license: 'CC0-1.0', provenance: {}
        }));
        await writeFile(join(playbookDir, 'playbook.md'), [
            '# 最小の作り方', '## 目的とできあがり', '## 流れ', '## 設定値',
            '## 必要な素材（仮枠）', '## 使った部品', '## 要る道具',
            '## ライセンス', '## 出どころ', ''
        ].join('\n'));

        const title = '新しいプロジェクト 2026-10-15';
        for (const [kind, create] of [
            ['blank', uri => service.createProject(uri, title)],
            ['playbook', uri => service.createProjectFromPlaybook(uri, playbookDir, title)]
        ]) {
            const destination = join(temp, kind);
            await create(pathToFileURL(destination).toString());
            const intake = JSON.parse(await readFile(join(destination, '.akari', 'intake.json'), 'utf8'));
            assert.equal(intake.title, title, kind);
            assert.deepEqual(intake.target, { duration_s: null, keep_length: true, taste: null }, kind);
            assert.equal(intake.status, 'draft', kind);
            assert.equal(intake.autonomy, 'checkpoint', kind);
            assert.deepEqual(intake.tasks, [], kind);
        }
        assert.equal(JSON.parse(await readFile(join(temp, 'playbook', 'planning', 'playbook.json'), 'utf8')).id,
            'minimal-playbook');
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
