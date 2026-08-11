import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PROJECT_GITIGNORE = [
    '# Source video and audio are intentionally kept outside the project history.',
    'assets/**',
    '!assets/.gitkeep',
    '',
    '# Temporary files used by the friendly "変更を見る" view.',
    '.akari/diffs/**',
    '!.akari/diffs/.gitkeep',
    '',
    '# Local operating-system files.',
    '.DS_Store',
    'Thumbs.db',
    ''
].join('\n');

const FALLBACK_CLAUDE_GUIDANCE = [
    '# AKARI Video プロジェクト',
    '',
    '- `assets/` は元動画と音声を置く素材の場所です。原本は書き換えたり削除したりしません。',
    '- `planning/` は企画やレポート、`exports/` は完成した動画を置く場所です。',
    '- `.akari/sidecars/` は分析結果、`.akari/events/` は作業の節目の記録を置く場所です。',
    '- 節目の記録は 1 件ずつ新しく追加し、すでにある記録は変更しません。',
    '- 編集スキルは `.claude/skills/` にあり、`/analyze-footage` などの素の名前で使えます。',
    '- Codex や Cursor など他の AI エージェント用の入り口が `.agents/skills/`、`.cursor/skills/`、`.codex/skills/` にあります（中身は `.claude/skills/` へのリンク）。',
    '- `.akari/intake.json` の `status` が `submitted` なら、そこに書かれた `tasks` / `target` / `autonomy` に従って進めます。`autonomy` が `checkpoint`（既定）なら、企画の承認や書き出し前などの要所で必ず人に確認します。`status` が `draft` のときは進め方がまだ決まっていないので、フォームや対話で確定させてから作業を始めます。',
    '- 利用者へは日本語で、内部の仕組みではなく「変更履歴」「企画メモ」「素材」などの言葉で説明します。',
    '',
    'このファイルはあなたのプロジェクトのものです。自由に書き換えて構いません。',
    ''
].join('\n');

const FALLBACK_AGENT_GUIDANCE = [
    '# AKARI Video プロジェクトの進め方',
    '',
    '`assets/` の原本を保ち、成果物は `planning/` と `exports/`、分析結果と節目の記録は `.akari/` に置く。',
    '節目の記録は `.akari/events/` に 1 件ずつ追加し、すでにある記録は変更しない。',
    '',
    'スキルは `/analyze-footage`、`/edit-plan`、`/overlay-authoring`、`/setup-library`、',
    '`/harvest-asset`、`/bake-3d` の素の名前で使う。手順を直接読む場合は',
    '`.claude/skills/<スキル名>/SKILL.md` を開く。',
    'Codex / Cursor 等のハーネスでは `.agents/skills/` / `.cursor/skills/` / `.codex/skills/`（`.claude/skills/` への',
    'symlink）から同じスキルが自動発見される。',
    '',
    '`.akari/intake.json` の `status` が `submitted` なら `tasks` / `target` / `autonomy` に従って進める。',
    '`autonomy: checkpoint`（既定）なら企画承認・書き出し前などの要所で人に確認する。',
    '`status: draft` なら進め方が未確定のため、フォームまたは対話で確定させてから進める。',
    '',
    '利用者へは日本語で、内部の仕組みではなく役割が伝わる言葉を使う。',
    'この案内はこのプロジェクトのものです。自由に書き換えて構いません。',
    ''
].join('\n');

const FALLBACK_SKILLS_GUIDANCE = [
    '# このプロジェクトのスキル',
    '',
    '6 本の編集スキルはこのフォルダーに実体で入り、素の名前で使えます。',
    '各手順は `.claude/skills/<スキル名>/SKILL.md` から直接読めます。',
    '`.agents/skills/`、`.cursor/skills/`、`.codex/skills/` は他の AI エージェント用の入り口で、この実体への symlink です。',
    '`AKARI-SKILLS-VERSION` はプロジェクト作成時のスキル内容を示します。',
    'この案内と各スキルは、運用に合わせて自由に書き換えて構いません。',
    ''
].join('\n');

// 進め方フォームの保存先（packages/schemas/intake.schema.json v0 準拠）。
// 新規プロジェクトは常に status: draft・空 tasks で始まり、フォームまたは対話で確定する。
// title は人間向け表示名（task 2026-08-09-project-display-title）。フォルダ名とは独立で、
// 企画が固まった時点でエージェントが書く器として null で始める。
const FALLBACK_INTAKE = {
    version: 1,
    tasks: [],
    target: { duration_s: null, keep_length: false, taste: null },
    autonomy: 'checkpoint',
    status: 'draft',
    submitted_at: null,
    title: null
};

const FALLBACK_WORKFLOW = {
    version: 1,
    roles: [
        { path: 'assets', label: '素材', kind: 'assets' },
        { path: 'planning', label: '企画', kind: 'planning' },
        { path: 'exports', label: '書き出し', kind: 'exports' }
    ],
    tree: {
        hidden: ['.claude', '.agents', '.codex', '.cursor', '.akari', 'CLAUDE.md', 'AGENTS.md', '.gitignore', '.gitkeep'],
        sidecarSuffixes: ['.meta.json', '.decisions.json', '.analysis.json'],
        developerModePreference: 'akari.developerMode'
    },
    events: {
        directory: '.akari/events',
        gateTypes: ['report-generated', 'report-approved', 'edit-completed', 'export-completed']
    }
};

function portablePath(value) {
    return value.split(path.sep).join('/');
}

function isAlreadyExists(error) {
    return error && typeof error === 'object' && error.code === 'EEXIST';
}

async function runGit(root, args) {
    return execFileAsync('git', ['-C', root, ...args], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
    });
}

export async function copyTemplateTree(sourceDir, destinationDir) {
    const copiedFiles = [];
    const skippedExisting = [];
    const skippedSymlinks = [];

    await fs.mkdir(destinationDir, { recursive: true });

    async function copyDirectory(source, destination, relativeDirectory) {
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            const from = path.join(source, entry.name);
            const to = path.join(destination, entry.name);
            const relativePath = portablePath(path.join(relativeDirectory, entry.name));

            if (entry.isDirectory()) {
                await fs.mkdir(to, { recursive: true });
                await copyDirectory(from, to, relativePath);
            } else if (entry.isSymbolicLink()) {
                console.warn(`[akari-project] skipping template symbolic link: ${relativePath}`);
                skippedSymlinks.push(relativePath);
            } else if (entry.isFile()) {
                try {
                    await fs.writeFile(to, await fs.readFile(from), { flag: 'wx' });
                    copiedFiles.push(relativePath);
                } catch (error) {
                    if (!isAlreadyExists(error)) {
                        throw error;
                    }
                    skippedExisting.push(relativePath);
                }
            }
        }
    }

    await copyDirectory(sourceDir, destinationDir, '');
    return { copiedFiles, skippedExisting, skippedSymlinks };
}

export async function writeFallbackTemplate(destinationDir) {
    const writtenFiles = [];
    const skippedExisting = [];
    const files = {
        '.gitignore': PROJECT_GITIGNORE,
        'CLAUDE.md': FALLBACK_CLAUDE_GUIDANCE,
        'AGENTS.md': FALLBACK_AGENT_GUIDANCE,
        '.claude/settings.json': JSON.stringify({
            permissions: {
                allow: ['Read(./**)', 'Edit(./planning/**)', 'Edit(./exports/**)', 'Edit(./.akari/sidecars/**)', 'Edit(./.akari/events/**)'],
                deny: ['Edit(./assets/**)']
            }
        }, null, 2) + '\n',
        '.claude/skills/README.md': FALLBACK_SKILLS_GUIDANCE,
        '.opencode/config.json': JSON.stringify({
            name: "AKARI Video Project",
            version: "1.0.0",
            description: "AKARI Video プロジェクト設定",
            skills: {
                autoDiscover: true,
                path: "./skills"
            },
            hooks: {
                sessionStart: "./hooks/session-start.mjs"
            },
            project: {
                type: "akari-video",
                version: "0.1.0"
            }
        }, null, 2) + '\n',
        '.akari/workflow.json': JSON.stringify(FALLBACK_WORKFLOW, null, 2) + '\n',
        '.akari/intake.json': JSON.stringify(FALLBACK_INTAKE, null, 2) + '\n',
        'edit.json': '{}\n',
        'assets/.gitkeep': '',
        'planning/.gitkeep': '',
        'exports/.gitkeep': '',
        '.akari/events/.gitkeep': '',
        '.akari/sidecars/.gitkeep': '',
        '.akari/diffs/.gitkeep': ''
    };

    for (const [name, content] of Object.entries(files)) {
        const destination = path.join(destinationDir, name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        try {
            await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx' });
            writtenFiles.push(name);
        } catch (error) {
            if (!isAlreadyExists(error)) {
                throw error;
            }
            skippedExisting.push(name);
        }
    }

    return { writtenFiles, skippedExisting };
}

const SKILL_ADAPTER_DIRECTORIES = ['.agents', '.codex', '.cursor', '.opencode'];

function isPermissionDenied(error) {
    return error && typeof error === 'object' && (error.code === 'EPERM' || error.code === 'EACCES');
}

async function copyDirectoryRecursive(fsImpl, source, destination) {
    await fsImpl.mkdir(destination, { recursive: true });
    for (const entry of await fsImpl.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await copyDirectoryRecursive(fsImpl, from, to);
        } else if (entry.isSymbolicLink()) {
            console.warn(`[project-scaffold] skipping nested symbolic link during fallback copy: ${from}`);
        } else if (entry.isFile()) {
            await fsImpl.writeFile(to, await fsImpl.readFile(from));
        }
    }
}

/**
 * Creates `linkPath` as a directory symlink pointing at `target` (a path relative to
 * `linkPath`'s own directory). Windows without admin rights / developer mode denies plain
 * symlink creation (EPERM); junctions are the privilege-free NTFS alternative but require an
 * absolute target and only work within the same volume. If junction creation also fails
 * (e.g. cross-volume), falls back to a recursive copy so project creation still succeeds —
 * degraded (the adapter stops tracking future skill updates) but functional.
 */
export async function createSkillAdapterLink(target, linkPath, { fsImpl = fs, platform = process.platform } = {}) {
    try {
        await fsImpl.symlink(target, linkPath, 'dir');
        return { method: 'symlink' };
    } catch (error) {
        if (isAlreadyExists(error)) {
            throw error;
        }
        if (platform !== 'win32' || !isPermissionDenied(error)) {
            throw error;
        }
        const absoluteTarget = path.resolve(path.dirname(linkPath), target);
        try {
            await fsImpl.symlink(absoluteTarget, linkPath, 'junction');
            return { method: 'junction' };
        } catch (junctionError) {
            if (isAlreadyExists(junctionError)) {
                throw junctionError;
            }
            await copyDirectoryRecursive(fsImpl, absoluteTarget, linkPath);
            console.warn(`[project-scaffold] symlink and junction both failed for ${linkPath}; copied the skill directory instead (it will not reflect future skill updates)`);
            return { method: 'copy' };
        }
    }
}

async function copySkillsTree(source, destination) {
    await fs.mkdir(destination, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
            continue;
        }
        // dev-fixtures/ はスキル開発用のサンプル素材（例: skills/address-review/dev-fixtures/
        // 配下の edit.json）で、プロジェクトへ持ち込むとシェルの edit.json 探索が誤って拾う
        // （F10）。プロジェクトの .claude/skills/ には不要なため元栓として除外する。
        if (entry.isDirectory() && entry.name === 'dev-fixtures') {
            continue;
        }
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await copySkillsTree(from, to);
        } else if (entry.isSymbolicLink()) {
            console.warn(`[akari-project] skipping skill symbolic link: ${entry.name}`);
        } else if (entry.isFile()) {
            await fs.writeFile(to, await fs.readFile(from));
        }
    }
}

async function skillsSignature(source) {
    const hash = createHash('sha256');
    const walk = async (directory, relative) => {
        const entries = (await fs.readdir(directory, { withFileTypes: true }))
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (entry.name === '.gitkeep' || entry.name === '.DS_Store') {
                continue;
            }
            const absolute = path.join(directory, entry.name);
            const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(absolute, relativePath);
            } else if (entry.isFile()) {
                hash.update(relativePath);
                hash.update(await fs.readFile(absolute));
            }
        }
    };
    await walk(source, '');
    return hash.digest('hex').slice(0, 16);
}

export async function installProjectSkills(destinationDir, skillsSourceDir, schemasSourceDir) {
    const destination = path.join(destinationDir, '.claude', 'skills');
    await copySkillsTree(skillsSourceDir, destination);
    await fs.writeFile(
        path.join(destination, 'AKARI-SKILLS-VERSION'),
        `${await skillsSignature(skillsSourceDir)}\n`,
        'utf8'
    );

    if (schemasSourceDir) {
        const schema = JSON.parse(
            await fs.readFile(path.join(schemasSourceDir, 'analysis.schema.json'), 'utf8')
        );
        const provenance = '（この analysis.schema.json は packages/schemas/analysis.schema.json からプロジェクト作成時に installProjectSkills() が機械コピーしたものです。手編集しないでください。再生成するにはプロジェクトを作り直すか、スキルの再インストールを行ってください。）';
        schema.$comment = typeof schema.$comment === 'string'
            ? `${schema.$comment} ${provenance}`
            : provenance;
        const schemaDestination = path.join(destination, 'analyze-footage', 'references', 'analysis.schema.json');
        await fs.mkdir(path.dirname(schemaDestination), { recursive: true });
        await fs.writeFile(schemaDestination, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
    }
}

export async function installSkillAdapters(destinationDir, options = {}) {
    const { fsImpl = fs, platform = process.platform } = options;
    const skillsDir = path.join(destinationDir, '.claude', 'skills');
    const skillNames = (await fsImpl.readdir(skillsDir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    const created = [];
    const skippedExisting = [];
    const degraded = [];
    for (const adapter of SKILL_ADAPTER_DIRECTORIES) {
        const adapterDir = path.join(destinationDir, adapter, 'skills');
        await fsImpl.mkdir(adapterDir, { recursive: true });
        for (const name of skillNames) {
            const relativeName = `${adapter}/skills/${name}`;
            try {
                const { method } = await createSkillAdapterLink(
                    `../../.claude/skills/${name}`,
                    path.join(adapterDir, name),
                    { fsImpl, platform }
                );
                created.push(relativeName);
                if (method !== 'symlink') {
                    degraded.push({ name: relativeName, method });
                }
            } catch (error) {
                if (!isAlreadyExists(error)) {
                    throw error;
                }
                skippedExisting.push(relativeName);
            }
        }
    }
    return { created, skippedExisting, degraded };
}

export async function readSkillsVersion(destinationDir) {
    try {
        return (await fs.readFile(
            path.join(destinationDir, '.claude', 'skills', 'AKARI-SKILLS-VERSION'),
            'utf8'
        )).trim();
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function checkGitBoundary(destinationDir) {
    try {
        const { stdout } = await runGit(destinationDir, ['rev-parse', '--is-inside-work-tree']);
        if (stdout.trim() !== 'true') {
            return { eligibility: 'none', parentRoot: null };
        }
    } catch {
        return { eligibility: 'none', parentRoot: null };
    }

    const { stdout } = await runGit(destinationDir, ['rev-parse', '--show-toplevel']);
    const [parentRoot, destinationRoot] = await Promise.all([
        fs.realpath(stdout.trim()),
        fs.realpath(destinationDir)
    ]);
    if (parentRoot === destinationRoot) {
        return { eligibility: 'own-root', parentRoot: null };
    }
    return { eligibility: 'inside-parent-repository', parentRoot };
}

export async function commitInitialProject(destinationDir, message = 'プロジェクトを作成') {
    await runGit(destinationDir, ['init']);
    await runGit(destinationDir, ['add', '-A', '--', '.']);
    const { stdout } = await runGit(destinationDir, ['status', '--porcelain']);
    if (!stdout.trim()) {
        return { committed: false };
    }
    await runGit(destinationDir, [
        '-c', 'user.name=AKARI Video',
        '-c', 'user.email=local@akari.video',
        'commit', '-m', message
    ]);
    return { committed: true };
}

function firstErrorLine(error) {
    const detail = error && typeof error === 'object' && typeof error.stderr === 'string'
        ? error.stderr
        : error instanceof Error
            ? error.message
            : String(error);
    return detail.split(/\r?\n/, 1)[0].trim() || '不明なエラー';
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderList(items, emptyText = 'なし') {
    if (items.length === 0) {
        return `<p>${escapeHtml(emptyText)}</p>`;
    }
    return `<ul>${items.map(item => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`;
}

export function renderReportHtml(report) {
    return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AKARI Video プロジェクト作成結果</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.6; }
    body { max-width: 960px; margin: 0 auto; padding: 2rem; }
    h1, h2 { line-height: 1.25; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .4rem 1rem; }
    dt { font-weight: 700; }
    dd { margin: 0; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; }
    section { margin-block: 2rem; }
  </style>
</head>
<body>
  <main>
    <h1>AKARI Video プロジェクト作成結果</h1>
    <dl>
      <dt>作成日時</dt><dd>${escapeHtml(report.createdAt)}</dd>
      <dt>作成先</dt><dd><code>${escapeHtml(report.destination)}</code></dd>
      <dt>使用した雛形</dt><dd><code>${escapeHtml(report.templateDir)}</code></dd>
    </dl>
    <section>
      <h2>コピーしたファイル（${escapeHtml(report.copy.copiedFiles.length)} 件）</h2>
      ${renderList(report.copy.copiedFiles)}
    </section>
    <section>
      <h2>フォールバック補完されたファイル（${escapeHtml(report.fallback.writtenFiles.length)} 件）</h2>
      ${renderList(report.fallback.writtenFiles)}
    </section>
    <section>
      <h2>スキップしたシンボリックリンク（${escapeHtml(report.copy.skippedSymlinks.length)} 件）</h2>
      ${renderList(report.copy.skippedSymlinks)}
    </section>
    <section>
      <h2>雛形バージョン</h2>
      <p>${report.skillsVersion === null ? '記録なし' : `<code>${escapeHtml(report.skillsVersion)}</code>`}</p>
    </section>
    <section>
      <h2>git 初期化の結果</h2>
      <dl>
        <dt>実施</dt><dd>${report.git.action === 'initialized-and-committed' ? '実施' : 'スキップ'}</dd>
        <dt>判定</dt><dd>${escapeHtml(report.git.eligibility)}</dd>
        <dt>理由</dt><dd>${escapeHtml(report.git.reason)}</dd>
      </dl>
    </section>
  </main>
</body>
</html>
`;
}

export async function createProject(destinationDir, templateDir, options = {}) {
    const destination = path.resolve(destinationDir);
    const resolvedTemplateDir = path.resolve(templateDir);
    const reportPath = path.join(destination, '.akari', 'reports', 'create-project-report.html');

    await fs.mkdir(destination, { recursive: true });
    const copy = await copyTemplateTree(resolvedTemplateDir, destination);
    const fallback = await writeFallbackTemplate(destination);
    if (options.skillsSourceDir) {
        await installProjectSkills(destination, options.skillsSourceDir, options.schemasSourceDir);
        await installSkillAdapters(destination);
    }
    const skillsVersion = await readSkillsVersion(destination);
    const boundary = await checkGitBoundary(destination);

    let action;
    let reason;
    if (boundary.eligibility === 'none') {
        try {
            await commitInitialProject(destination);
            action = 'initialized-and-committed';
            reason = 'git 初期化して単一コミットを作成';
        } catch (error) {
            action = 'skipped';
            reason = `git が利用できないためスキップ — 後からプロジェクトを開くと自動で git 化されます（${firstErrorLine(error)}）`;
        }
    } else if (boundary.eligibility === 'own-root') {
        action = 'skipped';
        reason = 'このフォルダは既に git リポジトリのため git init を skip';
    } else {
        action = 'skipped';
        reason = `親リポジトリ ${boundary.parentRoot} の内側のため git init を skip`;
    }

    const report = {
        destination,
        templateDir: resolvedTemplateDir,
        createdAt: new Date().toISOString(),
        copy,
        fallback,
        skillsVersion,
        git: {
            eligibility: boundary.eligibility,
            parentRoot: boundary.parentRoot,
            action,
            reason
        },
        reportPath
    };

    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, renderReportHtml(report), 'utf8');

    return report;
}
