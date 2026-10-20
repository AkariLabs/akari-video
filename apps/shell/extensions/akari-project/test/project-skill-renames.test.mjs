import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { promises as realFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';
import {
    readSkillCopiesManifest,
    syncProjectSkillsTree
} from '../lib/node/project-skills-sync.js';

// Some harnesses export GIT_CONFIG_COUNT without its GIT_CONFIG_KEY_* pair, which makes every
// `git` invocation fail before it starts. The fixture repositories only need the defaults.
for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_CONFIG_')) delete process.env[key];
}

async function withScratch(callback) {
    const root = await mkdtemp(join(tmpdir(), 'akari-project-rename-'));
    try {
        return await callback(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function makeBundle(root, names) {
    for (const name of names) {
        await mkdir(join(root, name), { recursive: true });
        await writeFile(join(root, name, 'SKILL.md'),
            `---\nname: ${name}\ndescription: ${name} v1\n---\n\n# ${name}\n`, 'utf8');
    }
}

async function writeRenames(root, renames) {
    await writeFile(join(root, 'renames.json'), `${JSON.stringify({ version: 1, renames })}\n`, 'utf8');
}

function renameRow(from, to) {
    return { from, to, since: 'v1.6.0' };
}

async function sync(options) {
    return syncProjectSkillsTree({ fs: realFs, ...options });
}

async function listing(destination) {
    return (await readdir(destination)).sort();
}

// ── 旧名コピーの片付け（L0） ──────────────────────────────────────────────────

test('未変更の旧名コピーは消えて新名が入り、署名とスタンプが進む', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        const destination = join(root, 'project', '.claude', 'skills');
        await makeBundle(oldBundle, ['old-name']);
        await makeBundle(newBundle, ['new-name']);
        await writeRenames(newBundle, [renameRow('old-name', 'new-name')]);

        const before = await sync({ source: oldBundle, destination, signature: 'old-sig' });
        assert.deepEqual(before.failed, []);
        assert.deepEqual((await listing(destination)).filter(name => !name.startsWith('AKARI-')), ['old-name']);
        const beforeManifest = JSON.parse(await readFile(join(destination, 'AKARI-SKILLS-COPIES.json'), 'utf8'));
        assert.ok(beforeManifest.skills['old-name']);

        const outcome = await sync({ source: newBundle, destination, signature: 'new-sig' });
        assert.equal(outcome.synced, true);
        assert.deepEqual(outcome.failed, []);
        assert.deepEqual(outcome.warnings, undefined);
        const names = (await listing(destination)).filter(name => !name.startsWith('AKARI-'));
        assert.deepEqual(names, ['new-name']);
        assert.equal(await readFile(join(destination, 'AKARI-SKILLS-VERSION'), 'utf8'), 'new-sig\n');
        const manifest = JSON.parse(await readFile(join(destination, 'AKARI-SKILLS-COPIES.json'), 'utf8'));
        assert.deepEqual(Object.keys(manifest.skills), ['new-name']);
    });
});

test('利用者が変えた旧名コピーは残り、同期結果の警告 1 行になる（署名は進む）', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        const destination = join(root, 'project', '.claude', 'skills');
        await makeBundle(oldBundle, ['old-name']);
        await makeBundle(newBundle, ['new-name']);
        await writeRenames(newBundle, [renameRow('old-name', 'new-name')]);
        await sync({ source: oldBundle, destination, signature: 'old-sig' });
        await writeFile(join(destination, 'old-name', 'SKILL.md'), 'my edit\n', 'utf8');

        const outcome = await sync({ source: newBundle, destination, signature: 'new-sig' });
        assert.equal(outcome.synced, true);
        assert.deepEqual(outcome.failed, []);
        assert.equal(outcome.warnings.length, 1);
        assert.match(outcome.warnings[0], /old-name/);
        assert.match(outcome.warnings[0], /new-name/);
        const names = (await listing(destination)).filter(name => !name.startsWith('AKARI-'));
        assert.deepEqual(names, ['new-name', 'old-name']);
        // 利用者の変更は消さないが、新しい同梱ツリーは入っているので署名は進める。
        assert.equal(await readFile(join(destination, 'AKARI-SKILLS-VERSION'), 'utf8'), 'new-sig\n');
    });
});

test('旧名コピーに利用者が足したファイルがあれば、同梱部分が無変更でも残す', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        const destination = join(root, 'project', '.claude', 'skills');
        await makeBundle(oldBundle, ['old-name']);
        await makeBundle(newBundle, ['new-name']);
        await writeRenames(newBundle, [renameRow('old-name', 'new-name')]);
        await sync({ source: oldBundle, destination, signature: 'old-sig' });
        await writeFile(join(destination, 'old-name', 'notes.md'), 'my notes\n', 'utf8');

        const outcome = await sync({ source: newBundle, destination, signature: 'new-sig' });
        assert.equal(outcome.warnings.length, 1);
        const names = (await listing(destination)).filter(name => !name.startsWith('AKARI-'));
        assert.deepEqual(names, ['new-name', 'old-name']);
        assert.equal(await readFile(join(destination, 'old-name', 'notes.md'), 'utf8'), 'my notes\n');
    });
});

test('スタンプが無い旧名コピーは「変えた」とみなして残す', async () => {
    await withScratch(async root => {
        const newBundle = join(root, 'bundle-new');
        const destination = join(root, 'project', '.claude', 'skills');
        await makeBundle(newBundle, ['new-name']);
        await writeRenames(newBundle, [renameRow('old-name', 'new-name')]);
        await mkdir(join(destination, 'old-name'), { recursive: true });
        await writeFile(join(destination, 'old-name', 'SKILL.md'), 'legacy\n', 'utf8');

        const outcome = await sync({ source: newBundle, destination, signature: 'new-sig' });
        assert.equal(outcome.warnings.length, 1);
        const names = (await listing(destination)).filter(name => !name.startsWith('AKARI-'));
        assert.deepEqual(names, ['new-name', 'old-name']);
    });
});

test('削除に失敗したら署名を進めず、スタンプも旧名を残して次の同期に再試行させる', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        const destination = join(root, 'project', '.claude', 'skills');
        await makeBundle(oldBundle, ['old-name']);
        await makeBundle(newBundle, ['new-name']);
        await writeRenames(newBundle, [renameRow('old-name', 'new-name')]);
        await sync({ source: oldBundle, destination, signature: 'old-sig' });

        const warnings = [];
        const failingFs = {
            ...realFs,
            rm: async path => {
                const error = new Error(`EPERM: ${path}`);
                error.code = 'EPERM';
                throw error;
            }
        };
        const outcome = await syncProjectSkillsTree({
            fs: failingFs,
            source: newBundle,
            destination,
            signature: 'new-sig',
            warn: (message, error) => warnings.push([message, error?.code])
        });
        assert.deepEqual(outcome.failed, ['old-name']);
        // 新名は入っているが、削除できていないので署名は旧値のまま（次に開くと再試行）。
        assert.equal(await readFile(join(destination, 'AKARI-SKILLS-VERSION'), 'utf8'), 'old-sig\n');
        const manifest = await readSkillCopiesManifest(failingFs, destination);
        assert.ok(manifest.skills['old-name'], 'スタンプを進めると次回「変更あり」と誤判定する');
        assert.ok((await listing(destination)).includes('old-name'));
        assert.ok(warnings.some(([message]) => /could not remove the old skill copy old-name/.test(message)));
    });
});

test('連鎖 a → b → c は c に畳んで片付ける', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        const destination = join(root, 'project', '.claude', 'skills');
        await makeBundle(oldBundle, ['old-a']);
        await makeBundle(newBundle, ['new-c']);
        await writeRenames(newBundle, [renameRow('old-a', 'old-b'), renameRow('old-b', 'new-c')]);
        await sync({ source: oldBundle, destination, signature: 'old-sig' });

        const outcome = await sync({ source: newBundle, destination, signature: 'new-sig' });
        assert.deepEqual(outcome.failed, []);
        const names = (await listing(destination)).filter(name => !name.startsWith('AKARI-'));
        assert.deepEqual(names, ['new-c']);
        const manifest = JSON.parse(await readFile(join(destination, 'AKARI-SKILLS-COPIES.json'), 'utf8'));
        assert.deepEqual(Object.keys(manifest.skills), ['new-c']);
    });
});

// ── git あり: 削除も同期の commit に入る ────────────────────────────────────

test('git があるプロジェクトでは、旧名コピーの削除も同期の commit に入る', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        const project = join(root, 'project');
        const destination = join(project, '.claude', 'skills');
        await makeBundle(oldBundle, ['old-name']);
        await makeBundle(newBundle, ['new-name']);
        await writeRenames(newBundle, [renameRow('old-name', 'new-name')]);
        await sync({ source: oldBundle, destination, signature: 'old-sig' });

        const git = (args, options = {}) => execFileSync('git', args, {
            cwd: project,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options
        });
        git(['init']);
        git(['add', '-A']);
        git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'old project']);

        const service = new class extends AkariProjectServiceImpl {
            fsPath(uri) { return uri; }
            async findBundledSkills() { return newBundle; }
            async findBundledSchemas() { return undefined; }
            async skillsSignature() { return 'new-sig'; }
            async installSkillAdapters() { /* keep the commit focused on the skills tree */ }
        }();
        service.fsImpl = realFs;
        const outcome = await service.syncProjectSkills(project);
        assert.equal(outcome.synced, true);
        assert.deepEqual(outcome.failed, []);

        const changed = git(['show', '--name-status', '--format=', 'HEAD']);
        assert.match(changed, /^D\t\.claude\/skills\/old-name\/SKILL\.md$/m);
        assert.match(changed, /^A\t\.claude\/skills\/new-name\/SKILL\.md$/m);
        assert.equal(git(['status', '--porcelain']), '');
    });
});
