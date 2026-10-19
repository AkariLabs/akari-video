import './support/i18n-ja.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
    planProjectSkillsSync,
    readInstalledSkillsSignature,
    skillsSyncRequired,
    syncProjectSkillsTree
} from '../lib/node/project-skills-sync.js';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

// ── fake fs ───────────────────────────────────────────────────────────────────
// 実 fs を使わず、書いた回数と内容を数える。ディレクトリは trailing slash 無しの
// 絶対パスで持ち、readdir は「直下だけ」を返す（本物の withFileTypes と同じ約束）。

class FakeFs {
    constructor(files = {}, directories = []) {
        this.files = new Map(Object.entries(files));
        this.directories = new Set(directories);
        this.writes = [];
        this.failWrite = new Map();
    }

    entry(name, isDirectory) {
        return {
            name,
            isDirectory: () => isDirectory,
            isFile: () => !isDirectory,
            isSymbolicLink: () => false
        };
    }

    children(path) {
        const prefix = `${path}/`;
        const names = new Map();
        for (const key of [...this.files.keys(), ...this.directories]) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const slash = rest.indexOf('/');
            const name = slash < 0 ? rest : rest.slice(0, slash);
            names.set(name, slash >= 0 || this.directories.has(`${prefix}${name}`));
        }
        return [...names.entries()].map(([name, isDirectory]) => this.entry(name, isDirectory));
    }

    async readdir(path) {
        if (!this.directories.has(path) && ![...this.files.keys()].some(key => key.startsWith(`${path}/`))) {
            const error = new Error(`ENOENT: ${path}`);
            error.code = 'ENOENT';
            throw error;
        }
        return this.children(path);
    }

    async readFile(path, encoding) {
        if (!this.files.has(path)) {
            const error = new Error(`ENOENT: ${path}`);
            error.code = 'ENOENT';
            throw error;
        }
        const value = this.files.get(path);
        return encoding === 'utf8' ? String(value) : value;
    }

    async writeFile(path, data) {
        const code = this.failWrite.get(path);
        if (code) {
            const error = new Error(`${code}: ${path}`);
            error.code = code;
            throw error;
        }
        this.writes.push(path);
        this.files.set(path, Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        const parent = path.slice(0, path.lastIndexOf('/'));
        this.addDirectoryChain(parent);
    }

    async mkdir(path) {
        this.addDirectoryChain(path);
    }

    async stat(path) {
        if (this.directories.has(path)) return { isFile: () => false, isDirectory: () => true };
        if (this.files.has(path)) return { isFile: () => true, isDirectory: () => false };
        const error = new Error(`ENOENT: ${path}`);
        error.code = 'ENOENT';
        throw error;
    }

    addDirectoryChain(path) {
        let current = path;
        while (current && current !== '/') {
            this.directories.add(current);
            current = current.slice(0, current.lastIndexOf('/'));
        }
    }

    writesUnder(prefix) {
        return this.writes.filter(path => path.startsWith(`${prefix}/`));
    }
}

const BUNDLED = {
    '/bundle/analyze-footage/SKILL.md': 'analyze v2',
    '/bundle/analyze-footage/references/vision-tracks.schema.json': '{}',
    '/bundle/record-playbook/SKILL.md': 'record v1',
    '/bundle/render-cut/SKILL.md': 'render v2',
    '/bundle/.gitkeep': '',
    '/bundle/.DS_Store': 'x'
};
const BUNDLED_DIRS = ['/bundle', '/bundle/analyze-footage', '/bundle/analyze-footage/references',
    '/bundle/record-playbook', '/bundle/render-cut'];

function bundledFs() {
    return new FakeFs(BUNDLED, BUNDLED_DIRS);
}

const PROJECT = '/project/.claude/skills';
const PROJECT_DIRS = ['/project', '/project/.claude', PROJECT, `${PROJECT}/analyze-footage`,
    `${PROJECT}/analyze-footage/references`, `${PROJECT}/render-cut`, `${PROJECT}/my-skill`];

const SCHEMA = {
    text: '{"$comment":"original","type":"object"}',
    provenance: '（provenance）'
};

// ── ① 署名が同じなら書かない ──────────────────────────────────────────────────

test('① 署名が同じなら 1 バイトも書かない（write 0 回）', async () => {
    const fs = bundledFs();
    for (const [path, text] of Object.entries(BUNDLED)) {
        if (path.includes('.gitkeep') || path.includes('.DS_Store')) continue;
        const target = `${PROJECT}${path.slice('/bundle'.length)}`;
        fs.files.set(target, Buffer.from(text));
        fs.addDirectoryChain(target.slice(0, target.lastIndexOf('/')));
    }
    fs.directories.add(`${PROJECT}/my-skill`);
    fs.files.set(`${PROJECT}/my-skill/SKILL.md`, Buffer.from('mine'));
    fs.files.set(`${PROJECT}/AKARI-SKILLS-VERSION`, Buffer.from('abc123\n'));

    assert.equal(await readInstalledSkillsSignature(fs, PROJECT), 'abc123');
    assert.equal(skillsSyncRequired('abc123', 'abc123'), false);
    const outcome = await syncProjectSkillsTree({
        fs, source: '/bundle', destination: PROJECT, signature: 'abc123', schema: SCHEMA
    });
    assert.deepEqual(outcome, { synced: false, added: [], updated: [], failed: [] });
    assert.equal(fs.writes.length, 0, `unexpected writes: ${fs.writes.join(', ')}`);
    // force は署名が同じでも上書きする（コマンドパレットの入口）。
    assert.equal(skillsSyncRequired('abc123', 'abc123', true), true);
});

test('① 署名が無い / 違うときだけ同期する', () => {
    assert.equal(skillsSyncRequired(undefined, 'abc'), true);
    assert.equal(skillsSyncRequired('old', 'abc'), true);
    assert.equal(skillsSyncRequired('  abc \n', 'abc'), false);
});

// ── ② 追加・更新・利用者のものは残す ───────────────────────────────────────────

test('② 署名が違えば新しいスキルを足し、同梱ファイルを更新し、利用者のものは残す', async () => {
    const fs = bundledFs();
    // 古いプロジェクト: record-playbook が無く、analyze-footage は古い本文。
    fs.files.set(`${PROJECT}/analyze-footage/SKILL.md`, Buffer.from('analyze v1'));
    fs.files.set(`${PROJECT}/render-cut/SKILL.md`, Buffer.from('render v1'));
    fs.files.set(`${PROJECT}/my-skill/SKILL.md`, Buffer.from('my own skill'));
    fs.files.set(`${PROJECT}/analyze-footage/notes.md`, Buffer.from('my own notes'));
    fs.files.set(`${PROJECT}/AKARI-SKILLS-VERSION`, Buffer.from('stale\n'));

    const outcome = await syncProjectSkillsTree({
        fs, source: '/bundle', destination: PROJECT, signature: 'new-signature', schema: SCHEMA
    });

    assert.equal(outcome.synced, true);
    assert.deepEqual(outcome.added, ['record-playbook']);
    assert.deepEqual(outcome.updated, ['analyze-footage', 'render-cut']);
    assert.deepEqual(outcome.failed, []);

    // 新しいスキルが現れる
    assert.equal(String(fs.files.get(`${PROJECT}/record-playbook/SKILL.md`)), 'record v1');
    // 既存の同梱ファイルは更新される
    assert.equal(String(fs.files.get(`${PROJECT}/analyze-footage/SKILL.md`)), 'analyze v2');
    assert.equal(String(fs.files.get(`${PROJECT}/render-cut/SKILL.md`)), 'render v2');
    // 利用者が自分で足したスキルと、同梱スキルの中の利用者ファイルは消えない
    assert.equal(String(fs.files.get(`${PROJECT}/my-skill/SKILL.md`)), 'my own skill');
    assert.equal(String(fs.files.get(`${PROJECT}/analyze-footage/notes.md`)), 'my own notes');
    // 同梱に無いディレクトリは書き込み対象にしない
    assert.deepEqual(fs.writesUnder(`${PROJECT}/my-skill`), []);
    // .gitkeep / .DS_Store は写さない
    assert.equal(fs.files.has(`${PROJECT}/.gitkeep`), false);
    assert.equal(fs.files.has(`${PROJECT}/.DS_Store`), false);
    // 署名は最後に新しい値で書く
    assert.equal(String(fs.files.get(`${PROJECT}/AKARI-SKILLS-VERSION`)), 'new-signature\n');
    assert.equal(fs.writes.at(-1), `${PROJECT}/AKARI-SKILLS-VERSION`);
    // スキーマは provenance 付きで書き直す
    const schema = JSON.parse(String(fs.files.get(`${PROJECT}/analyze-footage/references/analysis.schema.json`)));
    assert.equal(schema.$comment, `original ${SCHEMA.provenance}`);
});

test('② `.claude/skills` が無いプロジェクトは全部入れで戻る', async () => {
    const fs = bundledFs();
    const plan = await planProjectSkillsSync(fs, '/bundle', PROJECT);
    assert.deepEqual(plan, { added: ['analyze-footage', 'record-playbook', 'render-cut'], updated: [] });
    const outcome = await syncProjectSkillsTree({
        fs, source: '/bundle', destination: PROJECT, signature: 'sig', schema: SCHEMA
    });
    assert.equal(outcome.synced, true);
    assert.deepEqual(outcome.added, ['analyze-footage', 'record-playbook', 'render-cut']);
    assert.equal(String(fs.files.get(`${PROJECT}/record-playbook/SKILL.md`)), 'record v1');
    assert.equal(String(fs.files.get(`${PROJECT}/AKARI-SKILLS-VERSION`)), 'sig\n');
});

// ── ③ 1 ファイルの EPERM で止まらない ─────────────────────────────────────────

test('③ EPERM が 1 ファイルで起きても他は進み、失敗した項目名が戻る', async () => {
    const fs = bundledFs();
    fs.failWrite.set(`${PROJECT}/analyze-footage/SKILL.md`, 'EPERM');
    const warnings = [];
    const outcome = await syncProjectSkillsTree({
        fs, source: '/bundle', destination: PROJECT, signature: 'sig', schema: SCHEMA,
        warn: (message, error) => warnings.push([message, error?.code])
    });

    assert.equal(outcome.synced, true);
    assert.deepEqual(outcome.failed, ['analyze-footage/SKILL.md']);
    // 失敗した 1 枚以外は書けている
    assert.equal(String(fs.files.get(`${PROJECT}/record-playbook/SKILL.md`)), 'record v1');
    assert.equal(String(fs.files.get(`${PROJECT}/render-cut/SKILL.md`)), 'render v2');
    assert.equal(String(fs.files.get(`${PROJECT}/AKARI-SKILLS-VERSION`)), 'sig\n');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /could not write analyze-footage\/SKILL\.md/);
    assert.equal(warnings[0][1], 'EPERM');
});

// ── ④ 同じ root の並行呼び出しは 1 回に合流する ────────────────────────────────

class SyncService extends AkariProjectServiceImpl {
    constructor() {
        super();
        this.runs = 0;
    }

    fsPath(uri) {
        return uri;
    }

    async findBundledSkills() {
        return '/bundle';
    }

    async findBundledSchemas() {
        return '/schemas';
    }

    async skillsSignature() {
        this.runs++;
        return 'signature';
    }

    /** スキーマの読み取りは実 fs（このテストの関心は合流と書き込み回数）。 */
    async findBundledSchemas() {
        return undefined;
    }

    async installSkillAdapters() {
        this.adapterCalls = (this.adapterCalls ?? 0) + 1;
    }
}

test('④ 同じ root の並行呼び出しは 1 回の同期に合流する', async () => {
    const fs = bundledFs();
    fs.files.set('/schemas/analysis.schema.json', Buffer.from('{"type":"object"}'));
    const service = new SyncService();
    service.fsImpl = fs;
    // git を使わないプロジェクト（commitIfChanged は何もしない既存の挙動）。
    service.gitEligibility = async () => 'none';

    const results = await Promise.all([
        service.syncProjectSkills('/project'),
        service.syncProjectSkills('/project'),
        service.syncProjectSkills('/project')
    ]);
    assert.equal(service.runs, 1, 'bundled signature must be computed once');
    assert.equal(service.adapterCalls, 1);
    for (const result of results) assert.equal(result.synced, true);
    // 書き込みも 1 回ぶんだけ（3 回ぶん重なっていない）
    assert.equal(fs.writesUnder(PROJECT).filter(path => path.endsWith('record-playbook/SKILL.md')).length, 1);

    // 終わったあとの呼び直しは新しい同期（署名が同じなので何も書かない）。
    const again = await service.syncProjectSkills('/project');
    assert.deepEqual(again, { synced: false, added: [], updated: [], failed: [] });
});

test('④ force は進行中でも上書きを要求する（コマンドパレット）', async () => {
    const fs = bundledFs();
    fs.files.set('/schemas/analysis.schema.json', Buffer.from('{"type":"object"}'));
    const service = new SyncService();
    service.fsImpl = fs;
    service.gitEligibility = async () => 'none';
    const [first, forced] = await Promise.all([
        service.syncProjectSkills('/project'),
        service.syncProjectSkills('/project', { force: true })
    ]);
    assert.equal(first.synced, true);
    assert.equal(forced.synced, true);
    assert.equal(service.runs, 2);
});

// ── Windows 固有の経路（EPERM → junction → copy）を platform 差し替えで通す ─────

class WindowsAdapterService extends AkariProjectServiceImpl {
    constructor() {
        super();
        this.platform = 'win32';
        this.methods = [];
    }

    async installSkillAdapters(root) {
        await super.installSkillAdapters(root);
    }
}

test('Windows: symlink も junction も EPERM なら copy へ落ちる（platform 差し替え）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-sync-copy-'));
    const service = new WindowsAdapterService();
    const real = (await import('node:fs')).promises;
    service.fsImpl = {
        ...real,
        symlink: async () => {
            const error = new Error('EPERM');
            error.code = 'EPERM';
            throw error;
        }
    };
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        await mkdir(join(root, '.claude', 'skills', 'record-playbook'), { recursive: true });
        await writeFile(join(root, '.claude', 'skills', 'record-playbook', 'SKILL.md'), 'record v1\n');
        await service.installSkillAdapters(root);
        assert.equal(await readFile(join(root, '.agents', 'skills', 'record-playbook', 'SKILL.md'), 'utf8'), 'record v1\n');
        assert.ok(warnings.some(line => /copied the skill directory instead/.test(line)));
    } finally {
        console.warn = originalWarn;
        await rm(root, { recursive: true, force: true });
    }
});

test('Windows: symlink が EPERM なら junction で張る（platform 差し替え）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-sync-junction-'));
    const service = new WindowsAdapterService();
    const calls = [];
    service.fsImpl = {
        ...(await import('node:fs')).promises,
        symlink: async (target, linkPath, type) => {
            calls.push(type);
            if (type === 'dir') {
                const error = new Error('EPERM');
                error.code = 'EPERM';
                throw error;
            }
            // junction は成功したことにする（Windows の実挙動を模す）。
        }
    };
    try {
        await mkdir(join(root, '.claude', 'skills', 'record-playbook'), { recursive: true });
        await service.installSkillAdapters(root);
        assert.deepEqual(calls, ['dir', 'junction', 'dir', 'junction', 'dir', 'junction']);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

// ── 実 fs で開いたときの同期（L1 の前段） ──────────────────────────────────────

test('実 fs: 古いプロジェクトを開くと record-playbook が現れ、利用者のスキルは残る', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-skills-sync-'));
    const repo = resolve(process.cwd(), '..', '..', '..', '..');
    const service = new class extends AkariProjectServiceImpl {
        fsPath(uri) { return uri; }
        async findBundledSkills() { return join(repo, 'skills'); }
        async findBundledSchemas() { return join(repo, 'packages', 'schemas'); }
        async gitEligibility() { return 'none'; }
    }();
    try {
        await mkdir(join(root, '.claude', 'skills', 'my-skill'), { recursive: true });
        await writeFile(join(root, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'my own skill\n');
        await writeFile(join(root, '.claude', 'skills', 'AKARI-SKILLS-VERSION'), 'stale\n');

        const outcome = await service.syncProjectSkills(root);
        assert.equal(outcome.synced, true);
        assert.ok(outcome.added.includes('record-playbook'), `added: ${outcome.added.join(', ')}`);
        assert.deepEqual(outcome.failed, []);

        const names = (await readdir(join(root, '.claude', 'skills'), { withFileTypes: true }))
            .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
        assert.ok(names.includes('record-playbook'));
        assert.ok(names.includes('my-skill'));
        assert.equal(await readFile(join(root, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf8'), 'my own skill\n');
        const version = await readFile(join(root, '.claude', 'skills', 'AKARI-SKILLS-VERSION'), 'utf8');
        assert.match(version, /^[a-f0-9]{16}\n$/);

        // 2 回目は署名が同じなので何も書かない（mtime も動かない）。
        const versionStat = await stat(join(root, '.claude', 'skills', 'AKARI-SKILLS-VERSION'));
        const second = await service.syncProjectSkills(root);
        assert.deepEqual(second, { synced: false, added: [], updated: [], failed: [] });
        assert.equal((await stat(join(root, '.claude', 'skills', 'AKARI-SKILLS-VERSION'))).mtimeMs, versionStat.mtimeMs);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
