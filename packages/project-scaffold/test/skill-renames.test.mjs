import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';
setLanguage('ja');
after(() => setLanguage(undefined));

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { installProjectSkills } from '../src/index.mjs';
import {
    collectOldNameReferences,
    oldNameMarker,
    oldNameMarkerCount,
    parseSkillRenameTable,
    skillDescription
} from '../../schemas/skill-renames.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RENAMES = [{ from: 'old-name', to: 'new-name', since: 'v1.6.0' }];

async function withScratch(callback) {
    const root = await mkdtemp(join(tmpdir(), 'akari-skill-rename-test-'));
    try {
        return await callback(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function write(path, text) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
}

async function makeBundle(root, name, body = `${name} v1`) {
    await write(join(root, name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n\nRun /${name}.\n`);
}

// ── コード面（src）の旧名参照の検査 ───────────────────────────────────────────

const CODE_SCAN_SUFFIXES = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.txt']);
const CODE_SCAN_SKIP = new Set(['node_modules', 'lib', 'dist', 'evidence', 'fixtures', 'dev-fixtures']);
// `edit-lint` は CLI / パッケージ名、`verify`・`connect` は一般動詞（socket の 'connect'・設定の connect 欄など）でもあるので、素の語では拾わない。
// スキル名としての参照（skills/<name>・`<name>`・/<name>）だけを拾う。
const AMBIGUOUS_IN_PROSE = new Set(['edit-lint', 'verify', 'connect']);

function codeSurfaceRoots(root) {
    const roots = [];
    const add = candidate => { if (existsSync(candidate)) roots.push(candidate); };
    const extensions = join(root, 'apps', 'shell', 'extensions');
    if (existsSync(extensions)) {
        for (const entry of readdirSync(extensions, { withFileTypes: true })) {
            if (entry.isDirectory()) add(join(extensions, entry.name, 'src'));
        }
    }
    const packages = join(root, 'packages');
    if (existsSync(packages)) {
        for (const entry of readdirSync(packages, { withFileTypes: true })) {
            if (entry.isDirectory()) add(join(packages, entry.name, 'src'));
        }
    }
    // status-core のミラーは plugin/runtime 配下にあり、src ではない。
    add(join(root, 'plugin', 'runtime'));
    return roots;
}

function codeSurfaceOldNameHits(root, renames) {
    const hits = [];
    const visit = absolute => {
        const text = readFileSync(absolute, 'utf8');
        for (const row of renames) {
            const from = row.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const patterns = [
                new RegExp(`skills/${from}(?![A-Za-z0-9_-])`, 'm'),
                new RegExp('`' + from + '`', 'm'),
                // スラッシュコマンド。パス（../edit-lint 等）は前が `.` `/` なので当たらない。
                new RegExp(`(?:^|[ \\t(（「"'\`])/${from}(?![A-Za-z0-9_-])`, 'm')
            ];
            if (!AMBIGUOUS_IN_PROSE.has(row.from)) {
                // 素の語。ただしスクリプト名・パス（compile-review-session.mjs 等）は除く。
                patterns.push(new RegExp(`(?:^|[^A-Za-z0-9_/-])${from}(?![A-Za-z0-9_./-])`, 'm'));
            }
            if (patterns.some(pattern => pattern.test(text))) {
                hits.push({ file: relative(root, absolute), from: row.from, to: row.to });
            }
        }
    };
    const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || CODE_SCAN_SKIP.has(entry.name)) continue;
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else if (entry.isFile() && CODE_SCAN_SUFFIXES.has(entry.name.slice(entry.name.lastIndexOf('.')))) visit(absolute);
        }
    };
    for (const directory of codeSurfaceRoots(root)) walk(directory);
    return hits;
}

// ── 旧名参照の検査 ─────────────────────────────────────────────────────────────

test('実リポの旧名参照は改名表と読み取り専用の契約文書だけ', async () => {
    const table = parseSkillRenameTable(await readFile(join(REPO_ROOT, 'skills', 'renames.json'), 'utf8'));
    assert.ok(table.renames.some(row => row.from === 'bake-3d' && row.to === 'author-scene3d'));
    // docs/contract-* は仕様の履歴で読み取り専用。改名の作業対象ではないので検査から除く。
    const hits = collectOldNameReferences(REPO_ROOT, table.renames)
        .filter(hit => !hit.file.startsWith(join('docs', 'contract-')));
    assert.deepEqual(hits, []);
    // 改名が入ったら、新しい SKILL.md の description に旧名マーカーがちょうど 1 回あること。
    for (const row of table.renames) {
        const markdown = await readFile(join(REPO_ROOT, 'skills', row.to, 'SKILL.md'), 'utf8');
        assert.equal(oldNameMarkerCount(markdown, row.from), 1, `${row.to}/SKILL.md`);
    }
});

test('旧名参照は赤くなり、新名へ直すと緑になる（旧名マーカーは許可）', async () => {
    await withScratch(async root => {
        await write(join(root, 'skills', 'new-name', 'SKILL.md'),
            `---\nname: new-name\ndescription: New skill ${oldNameMarker('old-name')}\n---\n\nRun /new-name. Use \`new-name\` and skills/new-name/SKILL.md.\n`);
        await write(join(root, 'docs', 'guide.md'), 'Run /old-name, or read `old-name` and skills/old-name/SKILL.md.\n');
        const red = collectOldNameReferences(root, RENAMES);
        assert.equal(red.length, 1);
        assert.deepEqual(red[0], { file: join('docs', 'guide.md'), from: 'old-name', to: 'new-name' });

        await write(join(root, 'docs', 'guide.md'), 'Run /new-name, or read `new-name` and skills/new-name/SKILL.md.\n');
        assert.deepEqual(collectOldNameReferences(root, RENAMES), []);

        // 新しい SKILL.md 本文に残った旧名は、description の 1 回だけのマーカーとは別に赤くなる。
        await write(join(root, 'skills', 'new-name', 'SKILL.md'),
            `---\nname: new-name\ndescription: New skill ${oldNameMarker('old-name')}\n---\n\nRun /old-name.\n`);
        assert.equal(collectOldNameReferences(root, RENAMES).length, 1);
    });
});

test('旧名参照の検査はアプリ・パッケージの src / bin と plugin/runtime も走査する', async () => {
    await withScratch(async root => {
        const surfaces = [
            ['apps', 'shell', 'extensions', 'demo-app', 'src', 'guidance.ts'],
            ['packages', 'demo', 'src', 'guidance.mjs'],
            ['packages', 'demo', 'bin', 'guidance.mjs'],
            ['plugin', 'runtime', 'guidance.mjs']
        ];
        for (const segments of surfaces) {
            await write(join(root, ...segments), 'Read `old-name` before you start.\n');
        }
        const hits = collectOldNameReferences(root, RENAMES);
        assert.deepEqual(
            hits.map(hit => hit.file).sort(),
            surfaces.map(segments => join(...segments)).sort()
        );
    });
});

test('改名表・CHANGELOG・リリースノートは検査から除外する', async () => {
    await withScratch(async root => {
        await write(join(root, 'skills', 'new-name', 'SKILL.md'), '---\nname: new-name\ndescription: new\n---\n');
        await write(join(root, 'skills', 'renames.json'), JSON.stringify({ version: 1, renames: RENAMES }));
        await write(join(root, 'CHANGELOG.md'), '## v1.6.0\n- renamed `old-name` to `new-name`\n');
        await write(join(root, 'docs', 'release-notes-1.6.md'), '- renamed /old-name to /new-name\n');
        assert.deepEqual(collectOldNameReferences(root, RENAMES), []);
    });
});

test('実リポのコード面（extensions/packages の src と status-core ミラー）にも旧名のスキル参照が残らない', async () => {
    const table = parseSkillRenameTable(await readFile(join(REPO_ROOT, 'skills', 'renames.json'), 'utf8'));
    assert.deepEqual(codeSurfaceOldNameHits(REPO_ROOT, table.renames), []);
});

test('コード面の検査は旧名のスキル参照を拾い、パッケージ名・スクリプト名は通す', async () => {
    await withScratch(async root => {
        const codeRenames = [
            { from: 'address-review', to: 'edit-from-review' },
            { from: 'compile-review-session', to: 'review-from-recording' },
            { from: 'edit-lint', to: 'verify-edit' }
        ];
        const extension = join(root, 'apps', 'shell', 'extensions', 'sample', 'src');
        const packageSource = join(root, 'packages', 'sample', 'src');
        await write(join(extension, 'instruction.ts'), '// 各 id を address-review スキルで記録する\n');
        await write(join(packageSource, 'comment.mjs'), '// 着地は skills/compile-review-session が行う\n');
        // パッケージ名のパスとスクリプト名は旧名のスキル参照ではない。
        await write(join(packageSource, 'paths.ts'),
            "const bin = resolve(directory, '../edit-lint/bin/edit-lint.mjs');\n// compile-review-session.mjs の写し\n");
        assert.deepEqual(codeSurfaceOldNameHits(root, codeRenames), [
            { file: join('apps', 'shell', 'extensions', 'sample', 'src', 'instruction.ts'), from: 'address-review', to: 'edit-from-review' },
            { file: join('packages', 'sample', 'src', 'comment.mjs'), from: 'compile-review-session', to: 'review-from-recording' }
        ]);

        await write(join(extension, 'instruction.ts'), '// 各 id を edit-from-review スキルで記録する\n');
        await write(join(packageSource, 'comment.mjs'), '// 着地は skills/review-from-recording が行う\n');
        assert.deepEqual(codeSurfaceOldNameHits(root, codeRenames), []);
    });
});

// ── description の旧名規約 ────────────────────────────────────────────────────

test('description の旧名は 1 回だけ書く（0 回も 2 回も不合格）', () => {
    const frontmatter = description =>
        `---\nname: new-name\ndescription: New skill${description}\n---\n\nbody\n`;
    assert.equal(oldNameMarkerCount(frontmatter(''), 'old-name'), 0);
    assert.equal(oldNameMarkerCount(frontmatter(` ${oldNameMarker('old-name')}`), 'old-name'), 1);
    assert.equal(oldNameMarkerCount(frontmatter(` ${oldNameMarker('old-name')} ${oldNameMarker('old-name')}`), 'old-name'), 2);
    assert.equal(
        skillDescription(frontmatter(` ${oldNameMarker('old-name')}`)),
        `New skill ${oldNameMarker('old-name')}`
    );
    // 実リポ: 改名表の各行の SKILL.md にマーカーがちょうど 1 回あること。
    for (const row of parseSkillRenameTable(readFileSync(join(REPO_ROOT, 'skills', 'renames.json'), 'utf8')).renames) {
        const markdown = readFileSync(join(REPO_ROOT, 'skills', row.to, 'SKILL.md'), 'utf8');
        assert.equal(oldNameMarkerCount(markdown, row.from), 1, `${row.to}/SKILL.md`);
    }
});

// ── 旧名コピーの片付け（installProjectSkills） ────────────────────────────────

test('未変更の旧名コピーは消え、新名が入り、利用者が変えたコピーは警告つきで残る', async () => {
    await withScratch(async root => {
        const oldBundle = join(root, 'bundle-old');
        const newBundle = join(root, 'bundle-new');
        await makeBundle(oldBundle, 'old-name', 'old-name v1');
        await makeBundle(newBundle, 'new-name', 'new-name v1');
        await write(join(newBundle, 'renames.json'),
            JSON.stringify({ version: 1, renames: [{ from: 'old-name', to: 'new-name', since: 'v1.6.0' }] }));

        // 1) 旧名のコピーを持つ古いプロジェクト（利用者は未変更）。
        const project = join(root, 'project');
        await installProjectSkills(project, oldBundle);
        const skillsDir = join(project, '.claude', 'skills');
        assert.ok(await readdir(skillsDir).then(names => names.includes('old-name')));
        const manifest = JSON.parse(await readFile(join(skillsDir, 'AKARI-SKILLS-COPIES.json'), 'utf8'));
        assert.ok(manifest.skills['old-name'], '旧名のスタンプが無いと片付けられない');

        const outcome = await installProjectSkills(project, newBundle);
        const afterNames = (await readdir(skillsDir)).sort();
        assert.ok(!afterNames.includes('old-name'), `旧名が残った: ${afterNames.join(', ')}`);
        assert.ok(afterNames.includes('new-name'));
        assert.deepEqual(outcome.removed, ['old-name']);
        assert.deepEqual(outcome.warnings, []);
        assert.equal(await readFile(join(skillsDir, 'new-name', 'SKILL.md'), 'utf8').then(text => text.includes('new-name v1')), true);

        // 2) 利用者が変えた旧名コピーは消さず、1 行の警告にする。
        const editedProject = join(root, 'project-edited');
        await installProjectSkills(editedProject, oldBundle);
        await write(join(editedProject, '.claude', 'skills', 'old-name', 'SKILL.md'),
            '---\nname: old-name\ndescription: my local edit\n---\n');
        const edited = await installProjectSkills(editedProject, newBundle);
        const editedNames = await readdir(join(editedProject, '.claude', 'skills'));
        assert.ok(editedNames.includes('old-name'), '利用者の変更を消してはいけない');
        assert.ok(editedNames.includes('new-name'));
        assert.deepEqual(edited.removed, []);
        assert.equal(edited.warnings.length, 1);
        assert.match(edited.warnings[0], /旧名のスキル old-name/);
        assert.match(edited.warnings[0], /new-name/);

        // 3) スタンプが無い（判定できない）旧名コピーも残す。
        const legacyProject = join(root, 'project-legacy');
        await write(join(legacyProject, '.claude', 'skills', 'old-name', 'SKILL.md'), 'legacy\n');
        const legacy = await installProjectSkills(legacyProject, newBundle);
        assert.ok((await readdir(join(legacyProject, '.claude', 'skills'))).includes('old-name'));
        assert.equal(legacy.warnings.length, 1);
    });
});
